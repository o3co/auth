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
 * headers it received, so every assertion here is about what reached the
 * upstream.
 *
 * The contract is auth.proxy's README ("Injection mode", "Inbound
 * Authorization headers", "Scope boundary") and auth.provider's session grant
 * (its session-grant module's README). The proxy's own unit tests stub the
 * provider; here the two meet.
 *
 * The provider issues on the session grant only on same-origin evidence (an
 * `Origin` that is its public origin, or `Sec-Fetch-Site: same-origin`), which
 * the proxy passes on as the browser sent it. The proxy and the provider are
 * one origin to the browser, as a browser sends the provider's session cookie
 * only to the provider's origin: both injection proxies' public origin is the
 * provider's (INJECTION_PUBLIC_ORIGIN in tests/docker-compose.yml).
 */
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
	AUDIENCE,
	ISSUER,
	PROVIDER_URL,
	SESSION_COOKIE_NAME,
	UNVERIFIED_USERNAME,
	decodeJwt,
	introspect,
	login,
	sessionGrant,
} from '../shared/oauthFlow.js';

const INJECTION_PROXY = 'http://localhost:3094';
const STRIP_PROXY = 'http://localhost:3093';
/** INJECTION_CLIENT_ID / INJECTION_SCOPE in tests/docker-compose.yml. */
const BFF_CLIENT_ID = 'e2e-bff';
const BFF_SCOPE = 'read:project';

/**
 * The Cookie header the upstream receives for `header`: every pair but the
 * session cookie's, or `null` when none is left.
 */
function withoutSessionCookie(header) {
	const kept = header.split('; ').filter((pair) => pair.split('=')[0] !== SESSION_COOKIE_NAME);
	return kept.length === 0 ? null : [kept.join('; ')];
}

/**
 * What a browser page served from the proxy's public origin, which is the
 * provider's, sends with its own requests.
 */
const SAME_ORIGIN = { origin: PROVIDER_URL, 'sec-fetch-site': 'same-origin' };

/**
 * One request through a proxy. Returns the status, the parsed body, and the
 * response headers; on a forwarded request the body is the echo upstream's
 * report of what it received.
 */
async function send(origin, { cookie, authorization, probe, headers = {}, path = '/resource' } = {}) {
	const res = await fetch(`${origin}${path}`, {
		headers: {
			...(cookie !== undefined ? { cookie } : {}),
			...(authorization !== undefined ? { authorization } : {}),
			...(probe !== undefined ? { 'x-e2e-probe': probe } : {}),
			...headers,
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
		const sent = `${cookie}; theme=dark`;
		const res = await send(INJECTION_PROXY, {
			cookie: sent,
			path: '/resource?x=1',
			headers: SAME_ORIGIN,
		});
		expect(res.status).toBe(200);
		expect(reachedUpstream(res.body)).toBe(true);
		expect(res.body.url).toBe('/resource?x=1');
		// The session cookie stays at the proxy: the upstream receives the
		// minted Bearer and every other cookie, never the credential that
		// mints it (auth.proxy README "Cookie forwarding").
		expect(sent).toContain(`${SESSION_COOKIE_NAME}=`);
		expect(res.body.cookie).toEqual(withoutSessionCookie(sent));
		expect(res.body.cookie[0]).toContain('theme=dark');

		const token = bearerOf(onlyAuthorization(res.body));
		const { header, payload } = decodeJwt(token);
		// An RFC 9068 access token from the provider, not something the proxy
		// made up or passed through.
		expect(header.typ).toBe('at+jwt');
		expect(payload.iss).toBe(ISSUER);
		expect(payload.sub).toBe('user-e2e-1');
		// The proxy's client (RFC 9068 `client_id`), and the audience its
		// registration names first — the session grant's audience rule.
		expect(payload.client_id).toBe(BFF_CLIENT_ID);
		expect(payload.aud).toBe(AUDIENCE);
		expect(payload.scope).toBe(BFF_SCOPE);

		// And the provider vouches for it: active, same user, same client.
		const checked = await introspect(token);
		expect(checked.status).toBe(200);
		expect(checked.body.active).toBe(true);
		expect(checked.body.sub).toBe('user-e2e-1');
		expect(checked.body.client_id).toBe(BFF_CLIENT_ID);
		expect(checked.body.scope).toBe(BFF_SCOPE);
	});

	it("replaces a client's own Authorization when the session produced a token", async () => {
		const res = await send(INJECTION_PROXY, {
			cookie,
			authorization: 'Bearer client-supplied',
			headers: SAME_ORIGIN,
		});
		expect(res.status).toBe(200);
		const token = bearerOf(onlyAuthorization(res.body));
		expect(token).not.toBe('client-supplied');
		expect(decodeJwt(token).payload.client_id).toBe(BFF_CLIENT_ID);
	});

	it('re-injects the cached token for the same session rather than minting another', async () => {
		// README "Cache behavior": a hit injects the cached Bearer. Requests on
		// one cookie, well inside the 60s-minus-5s default TTL, carry the
		// identical provider-issued token. Each shows it is same-origin, as a
		// browser's does: the proxy answers only such a request from its cache.
		// The third shows it the other admitted way, with no Origin.
		const first = await send(INJECTION_PROXY, { cookie, headers: { origin: PROVIDER_URL } });
		const second = await send(INJECTION_PROXY, { cookie, headers: { origin: PROVIDER_URL } });
		const third = await send(INJECTION_PROXY, { cookie, headers: { 'sec-fetch-site': 'same-origin' } });
		expect(first.status).toBe(200);
		expect(second.status).toBe(200);
		expect(third.status).toBe(200);
		bearerOf(onlyAuthorization(first.body));
		expect(second.body.authorization).toEqual(first.body.authorization);
		expect(third.body.authorization).toEqual(first.body.authorization);
	});

	// A cache hit never reaches the provider, which holds the session grant to
	// its own same-origin check; so a request that does not show it is
	// same-origin asks the provider itself. The provider refuses such a grant
	// before it reads the session, so what is asserted is the refusal, nothing
	// forwarded, and a cache the request left as it was.
	describe('a session-cookie request that does not show it is same-origin', () => {
		it.each([
			{ label: 'a foreign Origin', headers: { origin: 'https://elsewhere.example' } },
			{ label: 'Sec-Fetch-Site: cross-site', headers: { 'sec-fetch-site': 'cross-site' } },
			{
				label: "the proxy's own Origin with Sec-Fetch-Site: cross-site",
				headers: { origin: PROVIDER_URL, 'sec-fetch-site': 'cross-site' },
			},
		])('is not answered from the cache: $label', async ({ headers }) => {
			const warm = await send(INJECTION_PROXY, { cookie, headers: SAME_ORIGIN });
			expect(warm.status).toBe(200);
			const cached = bearerOf(onlyAuthorization(warm.body));
			const hit = await send(INJECTION_PROXY, { cookie, headers: SAME_ORIGIN });
			expect(bearerOf(onlyAuthorization(hit.body))).toBe(cached);

			const probe = randomUUID();
			const res = await send(INJECTION_PROXY, { cookie, probe, headers });
			expect(res.status).toBe(401);
			expect(reachedUpstream(res.body)).toBe(false);
			expect(await seenUpstream(probe)).toBe(false);
			expect(res.body.error).toBe('session_required');

			// The refusal did not touch the cached grant.
			const after = await send(INJECTION_PROXY, { cookie, headers: SAME_ORIGIN });
			expect(bearerOf(onlyAuthorization(after.body))).toBe(cached);
		});
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
		// Same-origin, so the session is what the provider refuses.
		const session = await login();
		expect(session.status).toBe(200);
		await logout(session.cookie);

		const probe = randomUUID();
		const res = await send(INJECTION_PROXY, { cookie: session.cookie, probe, headers: SAME_ORIGIN });
		expect(res.status).toBe(401);
		expect(reachedUpstream(res.body)).toBe(false);
		expect(await seenUpstream(probe)).toBe(false);
		expect(res.body.error).toBe('session_required');
		expect(typeof res.body.error_description).toBe('string');
		// Injection mode sends no challenge on any path (README, "Validation
		// mode" challenge table note): its caller holds a cookie, not a Bearer.
		expect(res.headers.get('www-authenticate')).toBeNull();
	}, 30_000);

	it('answers 401 session_required when the provider refuses the grant with invalid_grant', async () => {
		// The provider's other refusal: the session is live and the request
		// same-origin, but an issuance policy refuses the token, here because
		// the user's email is not verified. The session grant answers that
		// `400 invalid_grant`, which the README maps to the same
		// session_required.
		const session = await login(UNVERIFIED_USERNAME);
		expect(session.status).toBe(200);
		// Asked directly at the provider, NOT through the proxy, to pin what the
		// proxy is mapping.
		const direct = await sessionGrant({
			cookie: session.cookie,
			clientId: BFF_CLIENT_ID,
			scope: BFF_SCOPE,
		});
		expect(direct.status).toBe(400);
		expect(direct.body.error).toBe('invalid_grant');

		const probe = randomUUID();
		const res = await send(INJECTION_PROXY, { cookie: session.cookie, probe, headers: SAME_ORIGIN });
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
			cookie: `${SESSION_COOKIE_NAME}="unbalanced`,
			authorization: 'Bearer client-supplied',
		});
		expect(res.status).toBe(200);
		expect(res.body.authorization).toBeNull();
	});

	it('still injects the provider-issued Bearer for a valid session cookie', async () => {
		const res = await send(STRIP_PROXY, {
			cookie,
			authorization: 'Bearer client-supplied',
			headers: SAME_ORIGIN,
		});
		expect(res.status).toBe(200);
		expect(res.body.cookie).toEqual(withoutSessionCookie(cookie));
		const { payload } = decodeJwt(bearerOf(onlyAuthorization(res.body)));
		expect(payload.sub).toBe('user-e2e-1');
		expect(payload.client_id).toBe(BFF_CLIENT_ID);
		expect(payload.aud).toBe(AUDIENCE);
	});
});
