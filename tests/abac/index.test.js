/*
 * Cross-component E2E: auth.policy-verifier ABAC verification.
 *
 * Prerequisites: docker compose up (policy-verifier + provider + redis)
 * Verifier: http://localhost:3097
 *
 * The allow/deny decisions below run against tokens auth.provider actually
 * minted through `login -> /authorize (PKCE) -> /token`. That is the point of
 * o3co/auth#3: a self-signed token proves the verifier can validate a
 * signature, not that the two components agree on what a token looks like.
 *
 * Hand-signed tokens remain only where the provider cannot be made to produce
 * the input — a wrong issuer, a wrong audience, an expired token, a scopeless
 * token. Those are envelope negatives, and each says so.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import {
	AUDIENCE,
	ISSUER,
	JWT_SECRET,
	codeFlow,
	decodeJwt,
	login,
	verify,
} from '../shared/oauthFlow.js';

/**
 * Envelope-correct hand-signed token, for the negatives the real flow cannot
 * produce. Matches what the deployment issues (RFC 9068 §4: `iss`, `aud`, and
 * the `at+jwt` header) so a rejection is attributable to the thing under test
 * rather than to a malformed envelope.
 */
function signToken(claims, options = {}) {
	return jwt.sign({ iss: ISSUER, aud: AUDIENCE, ...claims }, JWT_SECRET, {
		expiresIn: 60,
		header: { typ: 'at+jwt' },
		...options,
	});
}

/** Grant carrying `read:project`. */
let projectGrant;
/**
 * Grant carrying only `read:project.member` — used for the deny case, and for
 * the nested-resource allow. The scope name tracks the resource type the
 * verifier derives: auth.policy-verifier#117 stopped rewriting the `.`
 * separator to `_`, so `project:1.member:2` now derives `project.member`.
 */
let memberGrant;

beforeAll(async () => {
	const session = await login();
	expect(session.status).toBe(200);
	projectGrant = await codeFlow({ cookie: session.cookie, scope: 'openid read:project' });
	memberGrant = await codeFlow({ cookie: session.cookie, scope: 'openid read:project.member' });
}, 30_000);

describe('ABAC: POST /verify with provider-issued access tokens', () => {
	it('allows when the minted scope matches the resource action', async () => {
		const res = await verify({ token: projectGrant.access_token });
		expect(res.status).toBe(200);
		expect(res.body.decision).toBe('allow');
		// The subject travels intact from the provider's `sub` claim to the
		// verifier's decision — the cross-component identity contract.
		expect(res.body.subject).toBe('user-e2e-1');
	});

	it('denies when the minted scope does not match the resource action', async () => {
		// A real token, correctly signed, simply not carrying `read:project`.
		const res = await verify({ token: memberGrant.access_token });
		expect(res.status).toBe(403);
		expect(res.body.decision).toBe('deny');
		expect(res.body.code).toBe('invalid_scope');
	});

	it('allows a nested resource when the minted scope matches', async () => {
		const res = await verify({
			token: memberGrant.access_token,
			resource: 'project:1.member:2',
		});
		expect(res.status).toBe(200);
		expect(res.body.decision).toBe('allow');
	});
});

describe('ABAC: only access tokens are decision inputs', () => {
	/*
	 * The provider mints three JWTs from one grant, all signed with the same
	 * key. Only the access token is a bearer credential for a resource server:
	 * an id_token is an assertion about an authentication event delivered to
	 * the client, and a refresh token is a credential for the token endpoint.
	 * Presenting either at /verify must fail.
	 *
	 * NOTE: the `typ` header is the ONLY thing that distinguishes them. There
	 * is no claim-level check — the verifier pins `at+jwt` and rejects
	 * everything else before any rule runs. So if auth.provider ever changes
	 * the `typ` it stamps, or the verifier ever relaxes the pin, these two
	 * tests are what catch it. Do not weaken them into "some 4xx".
	 */

	it('rejects the id_token from the same grant', async () => {
		const res = await verify({ token: projectGrant.id_token });
		expect(decodeJwt(projectGrant.id_token).header.typ).toBe('id+jwt');
		expect(res.status).toBe(401);
		expect(res.body.decision).toBe('deny');
		expect(res.body.code).toBe('invalid_token');
	});

	it('rejects the refresh token from the same grant', async () => {
		const res = await verify({ token: projectGrant.refresh_token });
		expect(decodeJwt(projectGrant.refresh_token).header.typ).toBe('rt+jwt');
		expect(res.status).toBe(401);
		expect(res.body.decision).toBe('deny');
		expect(res.body.code).toBe('invalid_token');
	});
});

describe('ABAC: RFC 9068 envelope validation', () => {
	it('denies with 401 when Authorization header is missing', async () => {
		const res = await verify({ token: undefined });
		expect(res.status).toBe(401);
		expect(res.body.decision).toBe('deny');
		expect(res.body.code).toBe('missing_token');
	});

	it('denies with 401 for invalid JWT', async () => {
		const res = await verify({ token: 'invalid.token.here' });
		expect(res.status).toBe(401);
		expect(res.body.decision).toBe('deny');
		expect(res.body.code).toBe('invalid_token');
	});

	it('denies with 401 for expired JWT', async () => {
		const res = await verify({
			token: signToken({ sub: 'user-e2e-1', scope: 'read:project' }, { expiresIn: -60 }),
		});
		expect(res.status).toBe(401);
		expect(res.body.decision).toBe('deny');
		expect(res.body.code).toBe('invalid_token');
	});

	it('denies a token from a different issuer', async () => {
		// RFC 9068 §4 — a correctly signed token is still not this
		// deployment's token. Shared-secret HS256 makes this the only thing
		// standing between two providers on the same key.
		const res = await verify({
			token: signToken({ sub: 'user-e2e-1', scope: 'read:project', iss: 'https://evil.e2e.test' }),
		});
		expect(res.status).toBe(401);
		expect(res.body.decision).toBe('deny');
		expect(res.body.code).toBe('invalid_token');
	});

	it('denies a token minted for a different audience', async () => {
		const res = await verify({
			token: signToken({ sub: 'user-e2e-1', scope: 'read:project', aud: 'https://other.e2e.test' }),
		});
		expect(res.status).toBe(401);
		expect(res.body.decision).toBe('deny');
		expect(res.body.code).toBe('invalid_token');
	});

	it('denies a token whose `typ` is not at+jwt', async () => {
		const res = await verify({
			token: signToken({ sub: 'user-e2e-1', scope: 'read:project' }, { header: { typ: 'JWT' } }),
		});
		expect(res.status).toBe(401);
		expect(res.body.decision).toBe('deny');
		expect(res.body.code).toBe('invalid_token');
	});

	it('denies a scopeless token against a scope-only pipeline', async () => {
		// The provider will not mint a scopeless token for this client, so the
		// input is hand-signed. auth.policy-verifier#104: an empty rule set
		// denies rather than allowing by vacuous truth.
		const res = await verify({ token: signToken({ sub: 'user-e2e-1' }) });
		expect(res.status).toBe(403);
		expect(res.body.decision).toBe('deny');
		expect(res.body.code).toBe('invalid_scope');
	});
});
