/*
 * Cross-component E2E: auth.policy-verifier ABAC verification
 *
 * Prerequisites: docker compose up (policy-verifier + provider + redis)
 * Verifier: http://localhost:3097
 */
import { describe, it, expect } from 'vitest';
import axios from 'axios';
import jwt from 'jsonwebtoken';

const VERIFIER_URL = process.env.VERIFIER_URL || 'http://localhost:3097';
const JWT_SECRET = process.env.OAUTH_JWT_SECRET || 'test-secret-for-e2e';
const ISSUER = process.env.OAUTH_JWT_ISSUER || 'https://auth.e2e.test';
const AUDIENCE = process.env.OAUTH_JWT_AUDIENCE || 'https://api.e2e.test';

/*
 * The verifier validates `iss` / `aud` / the `typ` header alongside the
 * signature (RFC 9068 §4 — auth.policy-verifier#105), so a token that carries
 * only a scope is rejected as `invalid_token` before any rule runs. Mint every
 * E2E token through here so the envelope matches what the deployment pins.
 */
function signToken(claims, options = {}) {
  return jwt.sign(
    { iss: ISSUER, aud: AUDIENCE, ...claims },
    JWT_SECRET,
    { expiresIn: 60, header: { typ: 'at+jwt' }, ...options },
  );
}

const verifier = axios.create({
  baseURL: VERIFIER_URL,
  validateStatus: () => true,
});

describe('ABAC: POST /verify', () => {
  it('allows when scope matches resource action', async () => {
    const token = signToken({ user: { id: 1 }, scope: 'read:project' });

    const res = await verifier.post('/verify', {
      resource: 'project:1',
      action: 'read',
    }, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(res.data.decision).toBe('allow');
  });

  it('denies when scope does not match resource action', async () => {
    const token = signToken({ user: { id: 1 }, scope: 'write:project' });

    const res = await verifier.post('/verify', {
      resource: 'project:1',
      action: 'read',
    }, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(403);
    expect(res.data.decision).toBe('deny');
    expect(res.data.code).toBe('invalid_scope');
  });

  it('denies with 401 when Authorization header is missing', async () => {
    const res = await verifier.post('/verify', {
      resource: 'project:1',
      action: 'read',
    });

    expect(res.status).toBe(401);
    expect(res.data.decision).toBe('deny');
    expect(res.data.code).toBe('missing_token');
  });

  it('denies with 401 for invalid JWT', async () => {
    const res = await verifier.post('/verify', {
      resource: 'project:1',
      action: 'read',
    }, {
      headers: { Authorization: 'Bearer invalid.token.here' },
    });

    expect(res.status).toBe(401);
    expect(res.data.decision).toBe('deny');
    expect(res.data.code).toBe('invalid_token');
  });

  it('denies with 401 for expired JWT', async () => {
    const token = signToken({ user: { id: 1 }, scope: 'read:project' }, { expiresIn: -1 });

    const res = await verifier.post('/verify', {
      resource: 'project:1',
      action: 'read',
    }, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(401);
    expect(res.data.decision).toBe('deny');
    expect(res.data.code).toBe('invalid_token');
  });

  it('allows nested resource when scope matches', async () => {
    const token = signToken({ user: { id: 1 }, scope: 'read:project_member' });

    const res = await verifier.post('/verify', {
      resource: 'project:1.member:2',
      action: 'read',
    }, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(res.data.decision).toBe('allow');
  });
});
