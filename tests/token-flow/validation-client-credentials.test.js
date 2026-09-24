/*
 * Cross-component E2E: auth.proxy in validation mode WITH client credentials,
 * against the REAL auth.provider introspection endpoint.
 *
 * Prerequisites: docker compose up (provider + redis + echo-upstream + the two
 * credentialed proxies)
 * Credentialed proxy:  http://localhost:3092 (CLIENT_ID/CLIENT_SECRET of `e2e-resource-server`)
 * Misconfigured proxy: http://localhost:3091 (same client, wrong secret)
 *
 * With CLIENT_ID / CLIENT_SECRET set, the proxy authenticates to
 * `POST /oauth/introspect` with HTTP Basic, and the provider then pins the
 * token's audience to the client's `allowedAudiences ∪ {clientId}`
 * (auth.provider v0.12.0+; auth.proxy README, "Introspection client
 * identity"). The uncredentialed `proxy` service in tests/token-flow/
 * index.test.js never reaches that pin. Both proxies here forward to
 * tests/fixtures/echo-upstream.mjs.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { AUDIENCE, CLIENT_ID, codeFlow, decodeJwt, introspect, login, refresh } from '../shared/oauthFlow.js';

const CREDENTIALED_PROXY = 'http://localhost:3092';
const MISCONFIGURED_PROXY = 'http://localhost:3091';

async function send(origin, token) {
	const res = await fetch(`${origin}/resource`, {
		headers: token ? { authorization: `Bearer ${token}` } : {},
	});
	return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
}

/** A provider-issued access token for the audience `e2e-resource-server` admits. */
let inAudience;
/**
 * A provider-issued access token for an audience it does NOT admit: the
 * refresh grant without `resource` stamps `aud: <client_id>` (pinned in
 * index.test.js), here `e2e-app` — valid, unexpired, simply not for this
 * resource server.
 */
let outOfAudience;

beforeAll(async () => {
	const session = await login();
	expect(session.status).toBe(200);
	inAudience = (await codeFlow({ cookie: session.cookie })).access_token;
	const other = await codeFlow({ cookie: session.cookie });
	const refreshed = await refresh({ refreshToken: other.refresh_token, resource: null });
	expect(refreshed.status).toBe(200);
	outOfAudience = refreshed.body.access_token;
}, 30_000);

describe('Validation mode with client credentials (CLIENT_ID / CLIENT_SECRET)', () => {
	it('forwards a provider-issued token whose audience the client admits', async () => {
		expect(decodeJwt(inAudience).payload.aud).toBe(AUDIENCE);
		const res = await send(CREDENTIALED_PROXY, inAudience);
		expect(res.status).toBe(200);
		// The echo upstream's body: forwarded, with the caller's token intact.
		expect(res.body.authorization).toBe(`Bearer ${inAudience}`);
	});

	it('refuses a valid token for an audience the client does not admit', async () => {
		// The token itself is good: the provider calls it active when it is its
		// own credential (no client identified, so no audience pin).
		expect(decodeJwt(outOfAudience).payload.aud).toBe(CLIENT_ID);
		const self = await introspect(outOfAudience);
		expect(self.status).toBe(200);
		expect(self.body.active).toBe(true);

		// Introspected as `e2e-resource-server`, whose audiences are
		// {https://api.e2e.test, e2e-resource-server}, it is `active: false`.
		const res = await send(CREDENTIALED_PROXY, outOfAudience);
		expect(res.status).toBe(401);
		expect(res.body).toEqual({ code: 401, message: 'Invalid Token' });
		// RFC 6750 §3, required on this refusal since auth.proxy v0.7.0 (#95 F29).
		expect(res.headers.get('www-authenticate')).toBe('Bearer error="invalid_token"');
	});

	it('answers 502 Provider Configuration Error when the provider refuses the proxy credentials', async () => {
		// auth.proxy v0.7.0 (#95 F7): the provider's 401 refused the proxy's own
		// Basic credential, so the caller's — perfectly valid — token was never
		// examined. That is the operator's to fix, not a 401 for the caller.
		const res = await send(MISCONFIGURED_PROXY, inAudience);
		expect(res.status).toBe(502);
		expect(res.body).toEqual({ code: 502, message: 'Provider Configuration Error' });
		expect(res.headers.get('www-authenticate')).toBeNull();
	});

	it('forwards a request without Authorization unchanged, misconfigured or not', async () => {
		// No Authorization, no introspection: the wrong secret surfaces only on
		// requests that carry a token, so a public route keeps working.
		for (const origin of [CREDENTIALED_PROXY, MISCONFIGURED_PROXY]) {
			const res = await send(origin);
			expect(res.status).toBe(200);
			expect(res.body.authorization).toBeNull();
		}
	});
});
