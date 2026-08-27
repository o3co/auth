/*
 * Shared driver for the REAL authorization-code flow against auth.provider.
 *
 * Both E2E packages (token-flow, abac) need a genuine provider-minted token,
 * and neither should hand-sign one on its happy path — that was the defect
 * behind o3co/auth#3: the suite verified liveness against tokens it minted
 * itself, so the provider->verifier contract (claim names, `typ`, `iss`,
 * `aud`) was never actually exercised.
 *
 * Deliberately dependency-free: it runs on node's built-in `fetch` and
 * `crypto` so it can be imported across package boundaries (tests/token-flow
 * and tests/abac are separate pnpm packages) without either one having to
 * resolve a module from outside its own tree.
 */
import crypto from 'node:crypto';

export const PROVIDER_URL = process.env.PROVIDER_URL || 'http://localhost:3099';
export const PROXY_URL = process.env.PROXY_URL || 'http://localhost:3098';
export const VERIFIER_URL = process.env.VERIFIER_URL || 'http://localhost:3097';

export const ISSUER = process.env.OAUTH_JWT_ISSUER || 'https://auth.e2e.test';
export const AUDIENCE = process.env.OAUTH_JWT_AUDIENCE || 'https://api.e2e.test';
/**
 * Must equal the containers' `OAUTH_JWT_SECRET` in tests/docker-compose.yml.
 * The negative ABAC tests mint their own tokens with it, so a value that
 * merely looks plausible produces 401s that read like a policy failure.
 * There is deliberately no fallback: auth.provider#282 put a >=32-byte floor
 * on the secret, and a default here would silently drift from compose again
 * the next time the floor or the value changes.
 */
export const JWT_SECRET = requireEnv('OAUTH_JWT_SECRET');

function requireEnv(name) {
	const value = process.env[name];
	if (!value) {
		throw new Error(
			`${name} is not set. Run the suite through \`make test-e2e\`, which exports it from tests/docker-compose.yml.`,
		);
	}
	return value;
}

/** Marked `firstParty: true` in tests/provider/clients.yaml. */
export const CLIENT_ID = 'e2e-app';
/** Marked `firstParty: false` — /authorize must refuse it. */
export const THIRD_PARTY_CLIENT_ID = 'e2e-third-party';
export const REDIRECT_URI = 'http://localhost:9099/callback';

export const USERNAME = 'e2e-user';
export const PASSWORD = 'e2e-password';
/** `emailVerified: false` in tests/provider/users.yaml. */
export const UNVERIFIED_USERNAME = 'e2e-unverified';

/** Split a JWT without verifying it — for asserting on the envelope. */
export function decodeJwt(token) {
	const [header, payload] = token.split('.');
	return {
		header: JSON.parse(Buffer.from(header, 'base64url').toString()),
		payload: JSON.parse(Buffer.from(payload, 'base64url').toString()),
	};
}

/** RFC 7636 S256 pair. The provider MANDATES S256 for public clients. */
export function pkce() {
	const verifier = crypto.randomBytes(32).toString('base64url');
	const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
	return { verifier, challenge };
}

/**
 * POST /session/login — returns the session cookie header value.
 *
 * The `Origin` header is sent deliberately. The current provider accepts a
 * same-origin `Origin` (its CSRF check passes anything whose origin matches
 * the server's, and no-Origin requests outright), and auth.provider#344 will
 * make one of `Origin` / a signed double-submit token REQUIRED. Sending it now
 * works against both, so this suite does not break when that lands.
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
	if (res.status === 200 && !cookie.includes('auth.session=')) {
		throw new Error(
			`login succeeded but no auth.session cookie was readable (got "${cookie}"). ` +
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
		// RFC 8707. This is what stamps `aud: https://api.e2e.test` on the
		// access token — the audience auth.policy-verifier pins. Without it the
		// provider falls back to the client id and the verifier correctly
		// rejects the token.
		resource,
	};
	for (const [k, v] of Object.entries(params)) {
		if (v !== undefined) url.searchParams.set(k, v);
	}
	const res = await fetch(url, { headers: { cookie }, redirect: 'manual' });
	const location = res.headers.get('location');
	return { status: res.status, location, query: location ? new URL(location).searchParams : null };
}

/** POST /oauth/token, grant_type=authorization_code. */
export async function exchangeCode({ code, verifier, clientId = CLIENT_ID }) {
	const res = await fetch(`${PROVIDER_URL}/oauth/token`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			grant_type: 'authorization_code',
			client_id: clientId,
			code,
			redirect_uri: REDIRECT_URI,
			code_verifier: verifier,
		}),
	});
	return { status: res.status, body: await res.json() };
}

/**
 * POST /oauth/token, grant_type=refresh_token.
 *
 * `resource` is passed by default and that matters: RFC 8707 §2.2 has the
 * client repeat it on refresh, and the provider takes it literally — omit it
 * and the refreshed access token falls back to `aud: <client_id>`, which the
 * resource server then rejects. The suite pins both branches.
 *
 * Pass `resource: null` to omit the parameter. Not `undefined`: a destructuring
 * default fires on an explicit `undefined`, so that would silently send the
 * default and test the opposite of what it looks like.
 */
export async function refresh({ refreshToken, clientId = CLIENT_ID, resource = AUDIENCE }) {
	const body = { grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken };
	if (resource !== null) body.resource = resource;
	const res = await fetch(`${PROVIDER_URL}/oauth/token`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
	return { status: res.status, body: await res.json() };
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

export async function introspect(accessToken, token = accessToken) {
	const res = await fetch(`${PROVIDER_URL}/oauth/introspect`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
		body: JSON.stringify({ token }),
	});
	return { status: res.status, body: await res.json() };
}

/** POST /verify on auth.policy-verifier. */
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
