/*
 * Cross-component E2E: auth.provider <-> auth.proxy token flow
 *
 * Prerequisites: docker compose up (provider + proxy + redis)
 * Provider: http://localhost:3099
 * Proxy:    http://localhost:3098 (forwards to provider)
 */
import { describe, it, expect } from 'vitest';
import axios from 'axios';
import jwt from 'jsonwebtoken';

const PROVIDER_URL = process.env.PROVIDER_URL || 'http://localhost:3099';
const PROXY_URL = process.env.PROXY_URL || 'http://localhost:3098';
const JWT_SECRET = process.env.OAUTH_JWT_SECRET || 'test-secret-for-e2e';
const ISSUER = process.env.OAUTH_JWT_ISSUER || 'https://auth.e2e.test';

/*
 * The provider pins the RFC 9068 `typ` header, and since auth.provider#266 it
 * also pins `iss` against its configured canonical issuer — introspection
 * reports a token carrying neither as inactive. Mint every E2E token here so
 * the envelope matches what the deployment issues.
 */
function signToken(claims, options = {}) {
  return jwt.sign(
    { iss: ISSUER, ...claims },
    JWT_SECRET,
    { expiresIn: 60, header: { typ: 'at+jwt' }, ...options },
  );
}

const provider = axios.create({
  baseURL: PROVIDER_URL,
  validateStatus: () => true,
});

const proxy = axios.create({
  baseURL: PROXY_URL,
  validateStatus: () => true,
});

describe('Token Flow: provider -> proxy', () => {
  it('proxy allows request with valid token from provider', async () => {
    // 1. Create a valid token (simulating provider issuance).
    const token = signToken({ user: { id: 1 }, scopes: ['read'] });

    // 2. Verify provider introspects it as active (self-introspect via Bearer)
    const introspectRes = await provider.post('/oauth/introspect', { token }, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(introspectRes.status).toBe(200);
    expect(introspectRes.data.active).toBe(true);

    // 3. Use the token to access proxy — should forward to downstream
    const proxyRes = await proxy.get('/_healthcheck', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(proxyRes.status).toBe(200);
  });

  it('proxy rejects request with invalid token', async () => {
    // Use a proxied route (not /_healthcheck which bypasses auth)
    const proxyRes = await proxy.get('/oauth', {
      headers: { Authorization: 'Bearer invalid.token.here' },
    });
    expect(proxyRes.status).toBe(401);
  });

  it('proxy passes through request without Authorization header', async () => {
    const proxyRes = await proxy.get('/_healthcheck');
    expect(proxyRes.status).toBe(200);
  });

  it('proxy rejects expired token', async () => {
    // The provider's verifier allows 5 minutes of clock skew on `exp`
    // (DEFAULT_CLOCK_SKEW_MS), so expire well beyond that window.
    const token = signToken({ user: { id: 1 } }, { expiresIn: -600 });

    // Use a proxied route (not /_healthcheck which bypasses auth)
    const proxyRes = await proxy.get('/oauth', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(proxyRes.status).toBe(401);
  });
});
