/*
 * Cross-component E2E: auth.proxy in injection mode against the REAL
 * auth.provider `session` grant.
 *
 * Prerequisites: docker compose up (provider + redis + echo-upstream + the two
 * injection proxies)
 * Injection proxy:           http://localhost:3094 (strip off, the default)
 * Injection proxy, stripped: http://localhost:3093 (INJECTION_STRIP_INBOUND_AUTHORIZATION=true)
 *
 * Both forward to tests/fixtures/echo-upstream.mjs, which answers with the
 * headers it received — so every assertion here is about what actually
 * reached the upstream, not about what an application upstream made of it.
 *
 * The contract is auth.proxy v0.7.0's README ("Injection mode", "Inbound
 * Authorization headers", "Scope boundary") and auth.provider's session grant
 * (packages/oauth/src/grants/session.mts). The proxy's own unit tests stub the
 * provider; this is the first place the two meet.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { AUDIENCE, ISSUER, PROVIDER_URL, decodeJwt, introspect, login } from '../shared/oauthFlow.js';

const INJECTION_PROXY = 'http://localhost:3094';
const STRIP_PROXY = 'http://localhost:3093';
/** INJECTION_CLIENT_ID / INJECTION_SCOPE in tests/docker-compose.yml. */
const BFF_CLIENT_ID = 'e2e-bff';
const BFF_SCOPE = 'read:project';

const compose = fileURLToPath(new URL('../docker-compose.yml', import.meta.url));

/**
 * One request through a proxy. Returns the status, the parsed body, and the
 * response headers; on a forwarded request the body is the echo upstream's
 * report of what it received.
 */
async function send(origin, { cookie, authorization, probe, path = '/resource' } = {}) {
	const res = await fetch(`${origin}${path}`, {
		headers: {
			...(cookie !== undefined ? { cookie } : {}),
			...(authorization !== undefined ? { authorization } : {}),
			...(probe !== undefined ? { 'x-e2e-probe': probe } : {}),
		},
	});
	return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
}

/** True when the body is the echo upstream's, i.e. the request was forwarded. */
const reachedUpstream = (body) => body !== null && typeof body === 'object' && 'url' in body;

/** Whether the echo upstream received a request marked with `probe` (asked through a pass-through). */
async function seenUpstream(probe) {
	const res = await send(INJECTION_PROXY, { path: `/_seen/${probe}` });
	expect(res.status).toBe(200);
	return res.body.seen;
}

/** The one `Authorization` the upstream received — failing if it got none, or more than one. */
const onlyAuthorization = (body) => {
	expect(body.authorization).toHaveLength(1);
	return body.authorization[0];
};

const bearerOf = (authorization) => {
	expect(authorization).toMatch(/^Bearer \S+$/);
	return authorization.slice('Bearer '.length);
};

async function logout(cookie) {
	const res = await fetch(`${PROVIDER_URL}/session/logout`, {
		method: 'POST',
		headers: { cookie, origin: PROVIDER_URL },
	});
	expect(res.status).toBe(200);
}

let cookie;
beforeAll(async () => {
	const session = await login();
	expect(session.status).toBe(200);
	cookie = session.cookie;
}, 30_000);

describe('Injection mode (AUTH_MODE=injection): session cookie -> provider-issued Bearer', () => {
	it('injects a token the provider minted for the signed-in user through the session grant', async () => {
		const res = await send(INJECTION_PROXY, { cookie, path: '/resource?x=1' });
		expect(res.status).toBe(200);
		expect(reachedUpstream(res.body)).toBe(true);
		expect(res.body.url).toBe('/resource?x=1');
		// The Cookie header goes upstream as sent, session cookie included:
		// auth.proxy narrows only its provider call to the session cookie
		// (README "Cookie forwarding"); stripping cookies is not its contract.
		expect(res.body.cookie).toEqual([cookie]);

		const token = bearerOf(onlyAuthorization(res.body));
		const { header, payload } = decodeJwt(token);
		// An RFC 9068 access token from the provider, not something the proxy
		// made up or passed through.
		expect(header.typ).toBe('at+jwt');
		expect(payload.iss).toBe(ISSUER);
		expect(payload.sub).toBe('user-e2e-1');
		// The proxy's client, and the audience its registration names first —
		// the session grant's audience rule.
		expect(payload.azp).toBe(BFF_CLIENT_ID);
		expect(payload.aud).toBe(AUDIENCE);
		expect(payload.scope).toBe(BFF_SCOPE);
		// Bound to the tracked browser session, as the README's revocation
		// section describes.
		expect(typeof payload.sid).toBe('string');

		// And the provider vouches for it: active, same user, same client.
		const checked = await introspect(token);
		expect(checked.status).toBe(200);
		expect(checked.body.active).toBe(true);
		expect(checked.body.sub).toBe('user-e2e-1');
		expect(checked.body.client_id).toBe(BFF_CLIENT_ID);
		expect(checked.body.scope).toBe(BFF_SCOPE);
	});

	it("replaces a client's own Authorization when the session produced a token", async () => {
		const res = await send(INJECTION_PROXY, { cookie, authorization: 'Bearer client-supplied' });
		expect(res.status).toBe(200);
		const token = bearerOf(onlyAuthorization(res.body));
		expect(token).not.toBe('client-supplied');
		expect(decodeJwt(token).payload.azp).toBe(BFF_CLIENT_ID);
	});

	it('re-injects the cached token for the same session rather than minting another', async () => {
		// README "Cache behavior": a hit injects the cached Bearer. Two requests
		// on one cookie, well inside the 60s-minus-5s default TTL, carry the
		// identical provider-issued token.
		const first = await send(INJECTION_PROXY, { cookie });
		const second = await send(INJECTION_PROXY, { cookie });
		expect(first.status).toBe(200);
		expect(second.status).toBe(200);
		expect(second.body.authorization).toEqual(first.body.authorization);
	});

	it('forwards a request without the session cookie unchanged, with no Bearer', async () => {
		const res = await send(INJECTION_PROXY, { cookie: 'unrelated=1' });
		expect(res.status).toBe(200);
		expect(reachedUpstream(res.body)).toBe(true);
		expect(res.body.authorization).toBeNull();
		expect(res.body.cookie).toEqual(['unrelated=1']);
	});

	it("passes a client's own Authorization through when there is no session cookie (strip off)", async () => {
		// The documented default: the proxy minted nothing, so it forwards the
		// request as-is — which is why the upstream must verify what it gets.
		const res = await send(INJECTION_PROXY, { authorization: 'Bearer client-supplied' });
		expect(res.status).toBe(200);
		expect(res.body.authorization).toEqual(['Bearer client-supplied']);
	});

	it('answers 401 session_required for a signed-out session, without reaching the upstream', async () => {
		// A cookie this proxy has never exchanged, so nothing is cached for it:
		// the proxy has to ask the provider, which no longer knows the session.
		const session = await login();
		expect(session.status).toBe(200);
		await logout(session.cookie);

		const probe = randomUUID();
		const res = await send(INJECTION_PROXY, { cookie: session.cookie, probe });
		expect(res.status).toBe(401);
		expect(reachedUpstream(res.body)).toBe(false);
		expect(await seenUpstream(probe)).toBe(false);
		expect(res.body.error).toBe('session_required');
		expect(typeof res.body.error_description).toBe('string');
		// Injection mode sends no challenge on any path (README, "Validation
		// mode" challenge table note): its caller holds a cookie, not a Bearer.
		expect(res.headers.get('www-authenticate')).toBeNull();
	}, 30_000);

	it('answers 401 session_required when the browser session outlives its tracked UserSession', async () => {
		// The provider's other refusal: the browser session is intact but its
		// tracked record is gone, which the session grant answers
		// `400 invalid_grant` and the README maps to the same session_required.
		const session = await login();
		expect(session.status).toBe(200);
		// The sid is read from a grant made directly at the provider, NOT
		// through the proxy — going through the proxy would cache a token for
		// this cookie and the next request would never reach the provider.
		const direct = await fetch(`${PROVIDER_URL}/oauth/token`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', cookie: session.cookie, origin: PROVIDER_URL },
			body: JSON.stringify({ grant_type: 'session', client_id: BFF_CLIENT_ID, scope: BFF_SCOPE }),
		});
		expect(direct.status).toBe(200);
		const { sid } = decodeJwt((await direct.json()).access_token).payload;
		expect(typeof sid).toBe('string');
		// Same disposable-Redis surgery as tests/abac/internal-adoption.test.js:
		// only the tracked UserSession goes; express-session stays.
		const deleted = execFileSync(
			'docker',
			['compose', '-f', compose, 'exec', '-T', 'redis', 'redis-cli', '--raw', 'DEL', `ss:us:${sid}`],
			{ encoding: 'utf8', timeout: 10_000 },
		).trim();
		expect(deleted).toBe('1');

		const probe = randomUUID();
		const res = await send(INJECTION_PROXY, { cookie: session.cookie, probe });
		expect(res.status).toBe(401);
		expect(reachedUpstream(res.body)).toBe(false);
		expect(await seenUpstream(probe)).toBe(false);
		expect(res.body.error).toBe('session_required');
		expect(res.headers.get('www-authenticate')).toBeNull();
	}, 30_000);
});

describe('Injection mode with INJECTION_STRIP_INBOUND_AUTHORIZATION=true', () => {
	it("drops a client's own Authorization when there is no session cookie", async () => {
		const res = await send(STRIP_PROXY, { authorization: 'Bearer client-supplied' });
		expect(res.status).toBe(200);
		expect(reachedUpstream(res.body)).toBe(true);
		expect(res.body.authorization).toBeNull();
	});

	it("drops a client's own Authorization when the session cookie is refused by the grammar check", async () => {
		// An unbalanced DQUOTE: refused as `quoting` without a provider call,
		// so the proxy minted nothing and strips the inbound header.
		const res = await send(STRIP_PROXY, {
			cookie: 'auth.session="unbalanced',
			authorization: 'Bearer client-supplied',
		});
		expect(res.status).toBe(200);
		expect(res.body.authorization).toBeNull();
	});

	it('still injects the provider-issued Bearer for a valid session cookie', async () => {
		const res = await send(STRIP_PROXY, { cookie, authorization: 'Bearer client-supplied' });
		expect(res.status).toBe(200);
		expect(res.body.cookie).toEqual([cookie]);
		const { payload } = decodeJwt(bearerOf(onlyAuthorization(res.body)));
		expect(payload.sub).toBe('user-e2e-1');
		expect(payload.azp).toBe(BFF_CLIENT_ID);
		expect(payload.aud).toBe(AUDIENCE);
	});
});
