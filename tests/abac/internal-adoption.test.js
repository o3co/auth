import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import jwt from 'jsonwebtoken';
import { beforeAll, describe, expect, it } from 'vitest';
import {
	AUDIENCE, CLIENT_ID, ISSUER, JWT_SECRET, PROVIDER_URL,
	codeFlow, decodeJwt, introspect, login,
} from '../shared/oauthFlow.js';

const API = 'http://localhost:3096';
const PROXY = 'http://localhost:3095';
const compose = fileURLToPath(new URL('../docker-compose.yml', import.meta.url));
const counters = () => fetch(`${API}/calls`).then((r) => r.json());
const call = (token, origin = API) => fetch(`${origin}/projects/1`, {
	headers: token ? { authorization: `Bearer ${token}` } : {},
});
const sessionGrant = async (cookie) => {
	const res = await fetch(`${PROVIDER_URL}/oauth/token`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', cookie, origin: PROVIDER_URL },
		body: JSON.stringify({ grant_type: 'session', client_id: CLIENT_ID, scope: 'read:project' }),
	});
	return { status: res.status, body: await res.json() };
};

// Only expiry/proof negatives are hand-signed. The expiry case first warms
// the cache with its short-lived token; the normal allow/deny service calls
// use a real login and the provider's code or session grant.
const negativeToken = (claims) => jwt.sign({
	iss: ISSUER, aud: AUDIENCE, sub: 'user-e2e-1', azp: CLIENT_ID,
	scope: 'read:project', exp: Math.floor(Date.now() / 1000) + 60, ...claims,
}, JWT_SECRET, { header: { typ: 'at+jwt' } });

let allowed;
let denied;
beforeAll(async () => {
	const session = await login();
	expect(session.status).toBe(200);
	allowed = await codeFlow({ cookie: session.cookie, scope: 'openid read:project' });
	denied = await codeFlow({ cookie: session.cookie, scope: 'openid read:project.member' });
}, 30_000);

describe('Internal Bearer adoption: real protected operation', () => {
	it('executes the handler with a provider-issued token, directly and through validation', async () => {
		const before = await counters();
		for (const origin of [API, PROXY]) {
			const res = await call(allowed.access_token, origin);
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ project: 1, subject: 'user-e2e-1' });
		}
		expect((await counters()).businessCalls).toBe(before.businessCalls + 2);
	});

	it('refuses missing credentials and insufficient scope before the business handler', async () => {
		const before = await counters();
		for (const origin of [API, PROXY]) {
			expect((await call(undefined, origin)).status).toBe(401);
			expect((await call(denied.access_token, origin)).status).toBe(403);
		}
		expect((await counters()).businessCalls).toBe(before.businessCalls);
	});

	it.each([{ jkt: 'unproven-key' }, { 'x5t#S256': 'unproven-certificate' }])(
		'refuses a bound token without possession evidence: %j', async (cnf) => {
			const token = negativeToken({ cnf });
			const before = await counters();
			expect((await call(token)).status).toBe(401);
			const beforeProxy = await counters();
			expect((await call(token, PROXY)).status).toBe(401);
			const after = await counters();
			expect(after.businessCalls).toBe(before.businessCalls);
			// The proxy must reject before even reaching the verifier-backed fixture.
			expect(after.authorizationCalls).toBe(beforeProxy.authorizationCalls);
		},
	);

	it('never forwards a warm cache entry after its token expires', async () => {
		const exp = Math.floor(Date.now() / 1000) + 2;
		const token = negativeToken({ exp });
		expect((await call(token, PROXY)).status).toBe(200);
		const beforeExpiry = await counters();
		await delay(Math.max(0, exp * 1000 - Date.now()) + 100);
		expect((await call(token, PROXY)).status).toBe(401);
		expect(await counters()).toEqual(beforeExpiry);
	}, 10_000);

	it('rejects fresh session issuance after independent revocation with the browser cookie retained', async () => {
		const session = await login();
		expect(session.status).toBe(200);
		const minted = await sessionGrant(session.cookie);
		expect(minted.status).toBe(200);
		expect((await call(minted.body.access_token)).status).toBe(200);
		const { sid } = decodeJwt(minted.body.access_token).payload;
		expect(typeof sid).toBe('string');
		// Delete only the tracked UserSession in this disposable compose Redis.
		// express-session remains intact: this reproduces the independent-store
		// revocation boundary, not merely logout destroying the browser cookie.
		const deleted = execFileSync('docker', [
			'compose', '-f', compose, 'exec', '-T', 'redis', 'redis-cli', '--raw', 'DEL', `ss:us:${sid}`,
		], { encoding: 'utf8', timeout: 10_000 }).trim();
		expect(deleted).toBe('1');
		const after = await sessionGrant(session.cookie);
		expect(after.status).toBe(400);
		expect(after.body.error).toBe('invalid_grant');
		expect(after.body.access_token).toBeUndefined();
	}, 15_000);

	it('logout invalidates the issued token and the warm proxy cache expires within its TTL', async () => {
		const session = await login();
		expect(session.status).toBe(200);
		const minted = await sessionGrant(session.cookie);
		expect(minted.status).toBe(200);
		const token = minted.body.access_token;
		expect((await call(token, PROXY)).status).toBe(200);
		const beforeLogout = await counters();
		const logout = await fetch(`${PROVIDER_URL}/session/logout`, {
			method: 'POST', headers: { cookie: session.cookie, origin: PROVIDER_URL },
		});
		expect(logout.status).toBe(200);
		const checked = await introspect(allowed.access_token, token);
		expect(checked.status).toBe(200);
		expect(checked.body.active).toBe(false);
		const fresh = await sessionGrant(session.cookie);
		expect(fresh.status).toBe(401);
		expect(fresh.body.access_token).toBeUndefined();
		// This fixture explicitly configures a five-second introspection TTL.
		// Offline JWT verification alone does not promise immediate revocation.
		await delay(5100);
		expect((await call(token, PROXY)).status).toBe(401);
		expect(await counters()).toEqual(beforeLogout);
	}, 15_000);
});
