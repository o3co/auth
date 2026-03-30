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
    // 1. Create a valid token (simulating provider issuance)
    const token = jwt.sign(
      { user: { id: 1 }, scopes: ['read'] },
      JWT_SECRET,
      { expiresIn: 60 }
    );

    // 2. Verify provider introspects it as active
    const introspectRes = await provider.post('/oauth/introspect', { token });
    expect(introspectRes.status).toBe(200);
    expect(introspectRes.data.active).toBe(true);

    // 3. Use the token to access proxy — should forward to downstream
    const proxyRes = await proxy.get('/healthcheck', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(proxyRes.status).toBe(200);
  });

  it('proxy rejects request with invalid token', async () => {
    const proxyRes = await proxy.get('/healthcheck', {
      headers: { Authorization: 'Bearer invalid.token.here' },
    });
    expect(proxyRes.status).toBe(401);
  });

  it('proxy passes through request without Authorization header', async () => {
    const proxyRes = await proxy.get('/healthcheck');
    expect(proxyRes.status).toBe(200);
  });

  it('proxy rejects expired token', async () => {
    const token = jwt.sign(
      { user: { id: 1 } },
      JWT_SECRET,
      { expiresIn: -1 }
    );

    const proxyRes = await proxy.get('/healthcheck', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(proxyRes.status).toBe(401);
  });
});
