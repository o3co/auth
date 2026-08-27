/*
 * Cross-component E2E: the REAL auth.provider grant path, plus auth.proxy.
 *
 * Prerequisites: docker compose up (provider + proxy + redis)
 * Provider: http://localhost:3099
 * Proxy:    http://localhost:3098 (forwards to provider)
 *
 * Every token on the happy path below is minted by the provider through
 * `login -> /authorize (PKCE) -> /token`. Nothing here hand-signs a token and
 * calls the result an end-to-end test — that was o3co/auth#3. Hand-signing
 * survives only in the negative cases, where the point IS to present something
 * the provider would never issue (an expired token, a garbage token).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import {
	AUDIENCE,
	CLIENT_ID,
	ISSUER,
	JWT_SECRET,
	PROVIDER_URL,
	PROXY_URL,
	REDIRECT_URI,
	THIRD_PARTY_CLIENT_ID,
	UNVERIFIED_USERNAME,
	authorize,
	codeFlow,
	decodeJwt,
	introspect,
	login,
	pkce,
	refresh,
	userinfo,
} from '../shared/oauthFlow.js';

const proxy = axios.create({ baseURL: PROXY_URL, validateStatus: () => true });

let cookie;
/** One full grant, reused by the read-only assertions below. */
let grant;

beforeAll(async () => {
	const session = await login();
	expect(session.status).toBe(200);
	cookie = session.cookie;
	expect(cookie).toMatch(/auth\.session=/);
	grant = await codeFlow({ cookie });
}, 30_000);

describe('Real grant path: login -> /authorize (PKCE) -> /token', () => {
	it('mints a code bound to the session and echoes state', () => {
		expect(grant.authorizeState).toBe('e2e-state');
		expect(grant.access_token).toBeTruthy();
	});

	it('returns an access token, a refresh token and an id_token', () => {
		expect(grant.token_type).toBe('Bearer');
		expect(grant.access_token).toBeTruthy();
		expect(grant.refresh_token).toBeTruthy();
		expect(grant.id_token).toBeTruthy();
	});

	it('stamps the RFC 9068 access-token envelope', () => {
		const { header, payload } = decodeJwt(grant.access_token);
		// RFC 9068 §2.1 — the media type that distinguishes an access token
		// from every other JWT this provider mints.
		expect(header.typ).toBe('at+jwt');
		expect(payload.iss).toBe(ISSUER);
		// The RFC 8707 `resource` parameter, not the client id: this is what
		// makes the token usable at the policy-verifier.
		expect(payload.aud).toBe(AUDIENCE);
		expect(payload.azp).toBe(CLIENT_ID);
		expect(payload.sub).toBe('user-e2e-1');
		expect(payload.jti).toBeTruthy();
	});

	it('carries `scope` as a space-delimited string, not a `scopes` array', () => {
		const { payload } = decodeJwt(grant.access_token);
		// The claim-shape drift o3co/auth#3 called out. The verifier reads
		// `scope` (string); a `scopes` array would silently authorize nothing.
		expect(typeof payload.scope).toBe('string');
		expect(payload.scope.split(' ')).toContain('read:project');
		expect(payload.scopes).toBeUndefined();
	});

	it('gives the id_token and refresh token their own `typ`', () => {
		// The verifier's ONLY discriminator between token kinds is this header
		// (see the negative tests in tests/abac). Pinning all three here means
		// a provider-side change to any of them fails on this repo's CI rather
		// than silently widening what /verify accepts.
		expect(decodeJwt(grant.id_token).header.typ).toBe('id+jwt');
		expect(decodeJwt(grant.refresh_token).header.typ).toBe('rt+jwt');
	});

	it('binds the id_token to the client, not the resource', () => {
		const { payload } = decodeJwt(grant.id_token);
		// OIDC Core §2: an id_token's audience is the RP. Its audience being
		// different from the access token's is exactly why one is a decision
		// input at a resource server and the other is not.
		expect(payload.aud).toBe(CLIENT_ID);
		expect(payload.sub).toBe('user-e2e-1');
		expect(payload.email_verified).toBe(true);
	});
});

describe('Real grant path: /userinfo and /introspect', () => {
	it('returns the scope-filtered claims for the provider-issued token', async () => {
		const res = await userinfo(grant.access_token);
		expect(res.status).toBe(200);
		// `sub` must be the user id the Store published, not the session id —
		// the AT-sub-from-session defect (auth.provider#259) would surface here.
		expect(res.body.sub).toBe('user-e2e-1');
		// Granted `email` scope, so these appear; `name` was never requested.
		expect(res.body.email).toBe('e2e-user@e2e.test');
		expect(res.body.email_verified).toBe(true);
		expect(res.body.name).toBeUndefined();
	});

	it('introspects the provider-issued token as active with matching claims', async () => {
		const res = await introspect(grant.access_token);
		expect(res.status).toBe(200);
		expect(res.body.active).toBe(true);
		expect(res.body.iss).toBe(ISSUER);
		expect(res.body.aud).toBe(AUDIENCE);
		expect(res.body.sub).toBe('user-e2e-1');
		expect(res.body.client_id).toBe(CLIENT_ID);
	});
});

describe('Real grant path: refresh rotation and replay', () => {
	it('rotates the refresh token and rejects the replayed one', async () => {
		const fresh = await codeFlow({ cookie });

		const first = await refresh({ refreshToken: fresh.refresh_token });
		expect(first.status).toBe(200);
		expect(first.body.access_token).toBeTruthy();
		// Rotation: the old refresh token must not come back.
		expect(first.body.refresh_token).toBeTruthy();
		expect(first.body.refresh_token).not.toBe(fresh.refresh_token);
		expect(decodeJwt(first.body.access_token).payload.aud).toBe(AUDIENCE);

		// Replaying the consumed token is reuse detection, not a stale-token
		// shrug: the provider names it.
		const replay = await refresh({ refreshToken: fresh.refresh_token });
		expect(replay.status).toBe(400);
		expect(replay.body.error).toBe('invalid_grant');
		expect(replay.body.error_description).toBe('replay_detected');
	}, 30_000);

	it('drops the audience when `resource` is omitted on refresh', async () => {
		const fresh = await codeFlow({ cookie });
		expect(decodeJwt(fresh.access_token).payload.aud).toBe(AUDIENCE);

		// RFC 8707 §2.2 has the client repeat `resource` on refresh, and the
		// provider takes that literally — omitting it falls back to the client
		// id. The refreshed token is then still perfectly valid and completely
		// unusable at the resource server, which is a trap worth pinning: if
		// the provider ever starts carrying the audience forward, this test
		// fails and tells us the contract changed rather than letting a
		// silently-broken refresh path ship.
		const noResource = await refresh({ refreshToken: fresh.refresh_token, resource: null });
		expect(noResource.status).toBe(200);
		expect(decodeJwt(noResource.body.access_token).payload.aud).toBe(CLIENT_ID);
	}, 30_000);
});

describe('/authorize admission rules', () => {
	it('refuses a client not marked first-party', async () => {
		const { challenge } = pkce();
		const res = await authorize({
			cookie,
			challenge,
			clientId: THIRD_PARTY_CLIENT_ID,
			scope: 'read:project',
		});
		// auth.provider#316/#330: the invariant is unconditional, and the
		// refusal is delivered as a redirect per RFC 6749 §4.1.2.1 — no code
		// is minted.
		expect(res.status).toBe(302);
		expect(res.query.get('error')).toBe('unauthorized_client');
		expect(res.query.get('code')).toBeNull();
	});

	it('refuses a user whose email the Store has not verified', async () => {
		const unverified = await login(UNVERIFIED_USERNAME);
		expect(unverified.status).toBe(200);
		const { challenge } = pkce();
		const res = await authorize({ cookie: unverified.cookie, challenge });
		// auth.provider#297/#320, with OAUTH_REQUIRE_EMAIL_VERIFIED=true in
		// the compose file. `access_denied` is RFC 6749 §4.1.2.1's code for a
		// refusal by the authorization server, not a malformed request.
		expect(res.status).toBe(302);
		expect(res.query.get('error')).toBe('access_denied');
		expect(res.query.get('code')).toBeNull();
	}, 30_000);

	it('rejects a code redeemed with the wrong PKCE verifier', async () => {
		const { challenge } = pkce();
		const az = await authorize({ cookie, challenge });
		const code = az.query.get('code');
		expect(code).toBeTruthy();

		const res = await fetch(`${PROVIDER_URL}/oauth/token`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				grant_type: 'authorization_code',
				client_id: CLIENT_ID,
				code,
				redirect_uri: REDIRECT_URI,
				code_verifier: pkce().verifier, // a verifier for a different challenge
			}),
		});
		expect(res.status).toBe(400);
		expect((await res.json()).error).toBe('invalid_grant');
	}, 30_000);
});

describe('Token flow: provider -> proxy', () => {
	it('proxy allows a request carrying a provider-issued token', async () => {
		const res = await proxy.get('/_healthcheck', {
			headers: { Authorization: `Bearer ${grant.access_token}` },
		});
		expect(res.status).toBe(200);
	});

	it('proxy rejects request with invalid token', async () => {
		// Use a proxied route (not /_healthcheck which bypasses auth)
		const res = await proxy.get('/oauth', {
			headers: { Authorization: 'Bearer invalid.token.here' },
		});
		expect(res.status).toBe(401);
	});

	it('proxy passes through request without Authorization header', async () => {
		const res = await proxy.get('/_healthcheck');
		expect(res.status).toBe(200);
	});

	it('proxy rejects expired token', async () => {
		// Hand-signed on purpose: the provider will not mint an already-expired
		// token, and the envelope still has to match what it issues or the
		// rejection would prove nothing about expiry. The provider's verifier
		// allows 5 minutes of clock skew on `exp` (DEFAULT_CLOCK_SKEW_MS), so
		// expire well beyond that window.
		const token = jwt.sign({ iss: ISSUER, aud: AUDIENCE, sub: 'user-e2e-1' }, JWT_SECRET, {
			expiresIn: -600,
			header: { typ: 'at+jwt' },
		});
		const res = await proxy.get('/oauth', { headers: { Authorization: `Bearer ${token}` } });
		expect(res.status).toBe(401);
	});
});
