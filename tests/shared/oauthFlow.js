/*
 * Shared driver for the real authorization-code flow against auth.provider.
 *
 * Both E2E packages (token-flow, abac) need genuine provider-minted tokens on
 * their happy paths: a token the suite signs itself leaves the
 * provider->verifier contract (claim names, `typ`, `iss`, `aud`) unexercised.
 *
 * Dependency-free (node's built-in `fetch` and `crypto`), so tests/token-flow
 * and tests/abac, which are separate pnpm packages, can import it without
 * resolving a module from outside their own tree.
 */
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

export const PROXY_URL = process.env.PROXY_URL || 'http://localhost:3098';
export const VERIFIER_URL = process.env.VERIFIER_URL || 'http://localhost:3097';

/**
 * Both must equal the containers' values in tests/docker-compose.yml. They
 * are defined once, in the Makefile (`export OAUTH_JWT_*`), which
 * `make test-e2e` feeds to both compose interpolation and this process, and
 * neither has a fallback here: a default would silently drift from compose.
 */
export const ISSUER = requireEnv('OAUTH_JWT_ISSUER');
export const AUDIENCE = requireEnv('OAUTH_JWT_AUDIENCE');
/**
 * Where the suite reaches the provider: its public origin, which is its
 * issuer. The provider compares a login's `Origin` with it.
 */
export const PROVIDER_URL = ISSUER;

/**
 * The provider's signing key (ES256), read out of the one file that defines
 * it, the provider's local layer, for the negative cases that sign what the
 * provider would never issue. Signed with any other key, every such case would
 * fail as a bad signature that reads like the rejection under test.
 */
export const SIGNING_KEY = readFileSync(
	new URL('../provider/local.conf', import.meta.url),
	'utf8',
).match(/-----BEGIN PRIVATE KEY-----[\s\S]+?-----END PRIVATE KEY-----/)[0];
/**
 * jsonwebtoken's options for SIGNING_KEY, for one token. The `kid` is
 * KEYS_SIGNING_KID in tests/docker-compose.yml: the provider verifies a token
 * by the key its `kid` names. Each token gets a `jti` of its own, as every
 * access token the provider issues carries one and it refuses one without.
 */
export function signing() {
	return { algorithm: 'ES256', keyid: 'e2e-1', jwtid: crypto.randomBytes(16).toString('base64url') };
}

function requireEnv(name) {
	const value = process.env[name];
	if (!value) {
		throw new Error(
			`${name} is not set. Run the suite through \`make test-e2e\` — the Makefile is the single definition (\`export ${name}\`) and feeds both compose interpolation and this process.`,
		);
	}
	return value;
}

/** First-party in tests/provider/local.conf. */
export const CLIENT_ID = 'e2e-app';
/** Not first-party — /authorize must refuse it. */
export const THIRD_PARTY_CLIENT_ID = 'e2e-third-party';
export const REDIRECT_URI = 'http://localhost:9099/callback';
/**
 * The second audience `e2e-app` may ask for with `resource`: a token for it is
 * valid, but not for the resource AUDIENCE names.
 */
export const OTHER_AUDIENCE = 'https://other.e2e.test';

/** The provider's session cookie, whose name it fixes. */
export const SESSION_COOKIE_NAME = 'session';

export const USERNAME = 'e2e-user';
export const PASSWORD = 'e2e-password';
/** `email_verified = false` in tests/provider/local.conf. */
export const UNVERIFIED_USERNAME = 'e2e-unverified';

/** Split a JWT without verifying it — for asserting on the envelope. */
export function decodeJwt(token) {
	const [header, payload] = token.split('.');
	return {
		header: JSON.parse(Buffer.from(header, 'base64url').toString()),
		payload: JSON.parse(Buffer.from(payload, 'base64url').toString()),
	};
}

/**
 * RFC 7636 S256 pair. The provider requires PKCE of every authorization-code
 * client and accepts only S256.
 */
export function pkce() {
	const verifier = crypto.randomBytes(32).toString('base64url');
	const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
	return { verifier, challenge };
}

/**
 * POST /session/login — returns the session cookie header value.
 *
 * The same-origin `Origin` header is what passes the provider's CSRF check.
 * The check accepts an `Origin` (or `Referer`) that is the provider's public
 * origin, and a request carrying neither must present the double-submit
 * token.
 */
export async function login(username = USERNAME, password = PASSWORD) {
	const res = await fetch(`${PROVIDER_URL}/session/login`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', origin: PROVIDER_URL },
		body: JSON.stringify({ username, password }),
		redirect: 'manual',
	});
	// `Headers#getSetCookie()` is the correct reader — it keeps multiple
	// Set-Cookie headers separate, which `get()` cannot (it folds them into one
	// comma-joined string). It needs Node 20+/undici, so fall back to the plain
	// header for anything older rather than silently producing no cookie.
	const setCookie =
		res.headers.getSetCookie?.() ??
		(res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
	const cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
	const body = await res.json().catch(() => null);
	// Every caller logs in expecting to get a session. Failing here names the
	// cause; returning an empty cookie would surface later as an unexplained
	// "/authorize did not return a code".
	if (res.status === 200 && !cookie.includes(`${SESSION_COOKIE_NAME}=`)) {
		throw new Error(
			`login succeeded but no ${SESSION_COOKIE_NAME} cookie was readable (got "${cookie}"). ` +
				'If this Node build lacks Headers#getSetCookie, the fallback above did not fire.',
		);
	}
	return { status: res.status, cookie, body };
}

/**
 * GET /oauth/authorize with PKCE. Returns the raw redirect so callers can
 * assert on the error branch as well as the success one — /authorize signals
 * refusal by redirecting to the client's registered redirect_uri with an
 * `error` query parameter (RFC 6749 §4.1.2.1), not by returning 4xx.
 *
 * Pass `resource: null` to omit the parameter. `undefined` would not omit it:
 * a destructuring default fires on an explicit `undefined`.
 */
export async function authorize({
	cookie,
	challenge,
	clientId = CLIENT_ID,
	scope = 'openid email read:project',
	resource = AUDIENCE,
	state = 'e2e-state',
}) {
	const url = new URL(`${PROVIDER_URL}/oauth/authorize`);
	const params = {
		response_type: 'code',
		client_id: clientId,
		redirect_uri: REDIRECT_URI,
		scope,
		state,
		code_challenge: challenge,
		code_challenge_method: 'S256',
		// RFC 8707. This narrows the access token's `aud` to the one audience
		// asked, here `https://api.e2e.test`, the audience
		// auth.policy-verifier pins. Without it the provider stamps the
		// client's first registered audience. Distinct from verify()'s
		// `resource` — the verifier's dot-notation resource string. Same word,
		// two protocols.
		resource,
	};
	for (const [k, v] of Object.entries(params)) {
		if (v !== undefined && v !== null) url.searchParams.set(k, v);
	}
	const res = await fetch(url, { headers: { cookie }, redirect: 'manual' });
	const location = res.headers.get('location');
	return { status: res.status, location, query: location ? new URL(location).searchParams : null };
}

/**
 * POST /oauth/token with a form body, as RFC 6749 §3.2 sends it: the provider
 * refuses a JSON body at the token endpoint. `headers` go with it, such as a
 * session cookie and its `Origin`.
 */
export async function tokenRequest(params, headers = {}) {
	const res = await fetch(`${PROVIDER_URL}/oauth/token`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
		body: new URLSearchParams(params),
	});
	return { status: res.status, body: await res.json() };
}

/** POST /oauth/token, grant_type=authorization_code. */
export function exchangeCode({ code, verifier, clientId = CLIENT_ID }) {
	return tokenRequest({
		grant_type: 'authorization_code',
		client_id: clientId,
		code,
		redirect_uri: REDIRECT_URI,
		code_verifier: verifier,
	});
}

/**
 * POST /oauth/token, grant_type=refresh_token.
 *
 * `resource` is sent by default. On refresh the presented refresh token's
 * audience is the ceiling and the default (RFC 8707 §2.2): a refresh without
 * `resource` keeps it, and a `resource` outside it is refused. The suite pins
 * both branches.
 *
 * Pass `resource: null` to omit the parameter. `undefined` would not omit it:
 * a destructuring default fires on an explicit `undefined`.
 */
export function refresh({ refreshToken, clientId = CLIENT_ID, resource = AUDIENCE }) {
	const params = { grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken };
	if (resource !== null) params.resource = resource;
	return tokenRequest(params);
}

/**
 * POST /oauth/token, grant_type=session: an access token for the user of the
 * browser session `cookie` names. The provider issues it only on same-origin
 * evidence, here the `Origin` a page on its public origin sends.
 */
export function sessionGrant({ cookie, clientId, scope }) {
	return tokenRequest(
		{ grant_type: 'session', client_id: clientId, scope },
		{ cookie, origin: PROVIDER_URL },
	);
}

/**
 * The whole happy path in one call: /authorize -> code -> /token.
 *
 * Takes an existing session cookie rather than logging in each time — the
 * login endpoint is brute-force rate limited (20 per 15 min, shared across
 * replicas through Redis), and a suite that logs in per test would start
 * failing on the limiter rather than on the contract.
 */
export async function codeFlow({ cookie, scope, resource, clientId } = {}) {
	const { verifier, challenge } = pkce();
	const az = await authorize({ cookie, challenge, scope, resource, clientId });
	const code = az.query?.get('code');
	if (!code) {
		throw new Error(
			`/authorize did not return a code: ${az.status} ${az.location ?? '(no location)'}`,
		);
	}
	const token = await exchangeCode({ code, verifier, clientId });
	if (token.status !== 200) {
		throw new Error(`/oauth/token failed: ${token.status} ${JSON.stringify(token.body)}`);
	}
	return { ...token.body, authorizeState: az.query.get('state') };
}

export async function userinfo(accessToken) {
	const res = await fetch(`${PROVIDER_URL}/oauth/userinfo`, {
		headers: { authorization: `Bearer ${accessToken}` },
	});
	return { status: res.status, body: await res.json().catch(() => null) };
}

/**
 * `e2e-introspector` in tests/provider/local.conf, which may see every
 * audience the suite's tokens carry. The provider answers introspection to an
 * authenticated confidential client alone, and reports a token active only
 * when its audience is one that client may see: so a token this client finds
 * inactive is one the provider does not vouch for at all.
 */
const INTROSPECTOR_ID = 'e2e-introspector';
const INTROSPECTOR_SECRET = '//JyDtxoM5OXIQT+9srbxP2x2VXNbPKV5VA+Yf5cjXk=';

/** POST /oauth/introspect (RFC 7662) as INTROSPECTOR_ID, with HTTP Basic. */
export async function introspect(token) {
	const basic = Buffer.from(
		`${encodeURIComponent(INTROSPECTOR_ID)}:${encodeURIComponent(INTROSPECTOR_SECRET)}`,
	).toString('base64');
	const res = await fetch(`${PROVIDER_URL}/oauth/introspect`, {
		method: 'POST',
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
			authorization: `Basic ${basic}`,
		},
		body: new URLSearchParams({ token }),
	});
	return { status: res.status, body: await res.json() };
}

/**
 * POST /verify on auth.policy-verifier.
 *
 * Invariant: the defaults here and authorize()'s default scope are two
 * spellings of one value. The verifier derives the scope it demands as
 * `{action}:{resourceType}` (ResourceActionScopeRuleCollector; see
 * docs/claims-contract.md), and `project:1` has resource type `project`, so
 * `resource = 'project:1', action = 'read'` demands exactly the `read:project`
 * that authorize() requests by default. Change either default without the
 * other and every happy-path assertion flips.
 *
 * `resource` here is the verifier's body field, a dot-notation resource
 * string, not authorize()'s RFC 8707 indicator URI. Both mirror their wire
 * fields, so neither is renamed.
 */
export async function verify({ token, resource = 'project:1', action = 'read' }) {
	const res = await fetch(`${VERIFIER_URL}/verify`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			...(token ? { authorization: `Bearer ${token}` } : {}),
		},
		body: JSON.stringify({ resource, action }),
	});
	return { status: res.status, body: await res.json() };
}
