/*
 * Cross-component E2E: the authentication claims the REAL auth.provider
 * writes on the access token — `amr`, `auth_time` and `acr` — which cross to
 * every consumer of the token (docs/claims-contract.md, "Claims that cross").
 *
 * Every login on this rig is a password login, the only way to sign in the
 * provider image composes, and a password login proves `["pwd"]` (the
 * provider's login-password module). So `["pwd"]` is the exact list every
 * token minted for a user here carries, never more and never an empty one.
 *
 * `acr` is asked through `acr_values` and met from the acr table in
 * tests/provider/local.conf, whose one entry a password login meets.
 *
 * No `act` here: the rig composes no token exchange, the one grant that
 * writes it.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import {
	CLIENT_ID,
	codeFlow,
	decodeJwt,
	login,
	refresh,
	sessionGrant,
} from '../shared/oauthFlow.js';

/** What a password login proves. */
const PASSWORD_AMR = ['pwd'];
/** The entry of `acr.values` in tests/provider/local.conf. */
const PASSWORD_ACR = 'urn:e2e:acr:pwd';
/**
 * How far the provider's clock may stand from this process's: the login's
 * time is taken here, `auth_time` there.
 */
const CLOCK_ALLOWANCE_S = 5;

let cookie;
/** This process's clock just before and just after the login, in ms. */
let loginStartedAt;
let loginEndedAt;

beforeAll(async () => {
	loginStartedAt = Date.now();
	const session = await login();
	loginEndedAt = Date.now();
	expect(session.status).toBe(200);
	cookie = session.cookie;
	// Every token below is issued at least a second after the login, by the
	// provider's own clock too, so an `auth_time` that dates the issuance
	// instead of the login is told apart by `auth_time < iat`.
	await sleep(1_100);
}, 30_000);

/**
 * The claims a token minted from this suite's login carries: the method list
 * a password login proves, and the time of that login, in whole seconds,
 * before the token's issuance.
 */
function expectPasswordLogin(payload) {
	expect(payload.amr).toEqual(PASSWORD_AMR);
	// Whole seconds: an integer within seconds of the login. The same time in
	// milliseconds would be an integer three orders of magnitude out of range.
	expect(Number.isInteger(payload.auth_time)).toBe(true);
	expect(payload.auth_time).toBeGreaterThanOrEqual(
		Math.floor(loginStartedAt / 1000) - CLOCK_ALLOWANCE_S,
	);
	expect(payload.auth_time).toBeLessThanOrEqual(
		Math.ceil(loginEndedAt / 1000) + CLOCK_ALLOWANCE_S,
	);
	// The login, not the issuance: both times are the provider's.
	expect(payload.auth_time).toBeLessThan(payload.iat);
}

describe('Authentication claims on the access token', () => {
	it('authorization_code: `amr` and `auth_time` of the login, and no `acr` when none is asked', async () => {
		const { payload } = decodeJwt((await codeFlow({ cookie })).access_token);
		expectPasswordLogin(payload);
		expect(payload).not.toHaveProperty('acr');
	}, 30_000);

	it('session grant: the same `amr` and `auth_time` as the code flow from the same session', async () => {
		const code = decodeJwt((await codeFlow({ cookie })).access_token).payload;
		const res = await sessionGrant({ cookie, clientId: CLIENT_ID, scope: 'read:project' });
		expect(res.status).toBe(200);
		const { payload } = decodeJwt(res.body.access_token);
		expectPasswordLogin(payload);
		// `auth_time` is the session's sign-in, whichever grant stands on it.
		expect(payload.auth_time).toBe(code.auth_time);
		// `acr` originates only in authorization_code.
		expect(payload).not.toHaveProperty('acr');
	}, 30_000);

	it('authorization_code: `acr` is the first value asked that the table knows and the login meets', async () => {
		// The first value asked is one the table does not know: it is passed
		// over, not refused, as long as a later one is known.
		const { payload } = decodeJwt(
			(await codeFlow({ cookie, acrValues: `urn:e2e:acr:unknown ${PASSWORD_ACR}` })).access_token,
		);
		expect(payload.acr).toBe(PASSWORD_ACR);
		expectPasswordLogin(payload);
	}, 30_000);
});

describe('Authentication claims across a refresh', () => {
	it('carries the original `amr` and `auth_time`, not the refresh, onto the refreshed token', async () => {
		const grant = await codeFlow({ cookie });
		const original = decodeJwt(grant.access_token).payload;

		const refreshed = await refresh({ refreshToken: grant.refresh_token });
		expect(refreshed.status).toBe(200);
		const { payload } = decodeJwt(refreshed.body.access_token);
		expect(payload.amr).toEqual(original.amr);
		expect(payload.auth_time).toBe(original.auth_time);
		expectPasswordLogin(payload);
		expect(payload).not.toHaveProperty('acr');
	}, 30_000);

	it('carries the original `acr` onto the refreshed token', async () => {
		const grant = await codeFlow({ cookie, acrValues: PASSWORD_ACR });
		const original = decodeJwt(grant.access_token).payload;
		expect(original.acr).toBe(PASSWORD_ACR);

		// A refresh asks no acr; the family keeps the one it started with.
		const refreshed = await refresh({ refreshToken: grant.refresh_token });
		expect(refreshed.status).toBe(200);
		const { payload } = decodeJwt(refreshed.body.access_token);
		expect(payload.acr).toBe(PASSWORD_ACR);
		expect(payload.auth_time).toBe(original.auth_time);
		expectPasswordLogin(payload);
	}, 30_000);
});
