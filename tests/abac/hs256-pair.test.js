/*
 * Cross-component E2E: an HS256 provider and verifier pair on one shared
 * secret string.
 *
 * Prerequisites: docker compose up (provider-hs256 + both HS256 verifiers)
 * Provider:          HS256_ISSUER (http://localhost:3090), `hex` named
 * Paired verifier:   http://localhost:3089, OAUTH_JWT_SECRET_ENCODING=hex
 * Unpaired verifier: http://localhost:3088, the verifier's default (utf8)
 *
 * Both sides read the shared string as the encoding each names, and agree on
 * the key only when they name the same one (docs/claims-contract.md, "The
 * HS256 shared secret"). The unpaired verifier is the paired one with its
 * encoding left out, so its refusal is the encoding and nothing else.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { AUDIENCE, decodeJwt } from '../shared/oauthFlow.js';

const PAIRED_VERIFIER = 'http://localhost:3089';
const UNPAIRED_VERIFIER = 'http://localhost:3088';

function requireEnv(name) {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is not set. Run the suite through \`make test-e2e\`.`);
	return value;
}

/** The HS256 provider's issuer and public origin, defined once in the Makefile. */
const HS256_ISSUER = requireEnv('HS256_ISSUER');

/** The shared secret string, read out of its one definition in tests/docker-compose.yml. */
const HS256_SECRET = readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8').match(
	/HS256_SECRET=([0-9a-f]+)$/m,
)[1];

/** `e2e-hs256-service` in tests/provider/hs256.conf, which holds the hash of this secret. */
const HS256_CLIENT_ID = 'e2e-hs256-service';
const HS256_CLIENT_SECRET = 'he7nyzZuxvqgOQf3FDfumpHqKaajyoeJXB3cx3cUZWU=';

async function verifyAt(origin, token) {
	const res = await fetch(`${origin}/verify`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
		// `read` on `project:1` demands `read:project`, the scope the client is minted.
		body: JSON.stringify({ resource: 'project:1', action: 'read' }),
	});
	return { status: res.status, body: await res.json() };
}

/** An access token the HS256 provider minted, by client credentials. */
let minted;

beforeAll(async () => {
	const basic = Buffer.from(
		`${encodeURIComponent(HS256_CLIENT_ID)}:${encodeURIComponent(HS256_CLIENT_SECRET)}`,
	).toString('base64');
	const res = await fetch(`${HS256_ISSUER}/oauth/token`, {
		method: 'POST',
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
			authorization: `Basic ${basic}`,
		},
		body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'read:project' }),
	});
	const body = await res.json();
	expect(res.status, JSON.stringify(body)).toBe(200);
	minted = body.access_token;
}, 30_000);

describe('HS256 pair: the shared secret read alike on both sides', () => {
	it('the provider signs HS256 for the audience the verifiers pin', () => {
		const { header, payload } = decodeJwt(minted);
		expect(header.alg).toBe('HS256');
		expect(header.typ).toBe('at+jwt');
		expect(payload.iss).toBe(HS256_ISSUER);
		expect(payload.aud).toBe(AUDIENCE);
		expect(payload.scope).toBe('read:project');
	});

	it('the verifier naming the provider\'s encoding allows a token the provider minted', async () => {
		const res = await verifyAt(PAIRED_VERIFIER, minted);
		expect(res.status).toBe(200);
		expect(res.body.decision).toBe('allow');
		expect(res.body.subject).toBe(HS256_CLIENT_ID);
	});

	it('the verifier left at its default encoding refuses the same token', async () => {
		const res = await verifyAt(UNPAIRED_VERIFIER, minted);
		expect(res.status).toBe(401);
		expect(res.body.decision).toBe('deny');
		expect(res.body.code).toBe('invalid_token');
	});

	it('the verifier left at its default encoding allows the same claims keyed by the text\'s own bytes', async () => {
		// The control for the refusal above: the unpaired verifier works, and
		// the key bytes are all that it disagrees with the provider on.
		const { header, payload } = decodeJwt(minted);
		const keyedByText = jwt.sign(payload, Buffer.from(HS256_SECRET, 'utf8'), {
			algorithm: 'HS256',
			header: { typ: header.typ, kid: header.kid },
		});
		const res = await verifyAt(UNPAIRED_VERIFIER, keyedByText);
		expect(res.status).toBe(200);
		expect(res.body.decision).toBe('allow');
	});
});
