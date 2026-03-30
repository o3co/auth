# Auth Platform Architecture

## Component Overview

```text
Client
  |
  |  (1) Login / Authorization code request
  v
+-----------------+
| auth.provider   |  OAuth 2.0 Provider (auth + token issuance)
+-----------------+
  |
  |  (2) JWT access token issued
  v
+-----------------+       +------------------------+
|  auth.proxy     |------>| auth.provider          |
| (reverse proxy) |       | POST /oauth/introspect |
+-----------------+       +------------------------+
  |  (3) Validated request forwarded
  v
+-----------------+       +------------------------+
|  downstream     |       |  auth.verifier         |
|    service      |------>|  (ABAC policy check)   |
+-----------------+       +------------------------+
```

## Components

| Component | Language | Repository | Description |
| --- | --- | --- | --- |
| auth.provider | Node.js/TS | [o3co/auth.provider](https://github.com/o3co/auth.provider) | OAuth 2.0 provider: login, token issuance, introspection |
| auth.proxy | Node.js/TS | [o3co/auth.proxy](https://github.com/o3co/auth.proxy) | Token validation + caching reverse proxy |
| auth.verifier | Rust (planned) | — | ABAC policy verifier |
| grpc.authz | Go | [o3co/grpc.authz](https://github.com/o3co/grpc.authz) | gRPC interceptors for policy enforcement |

## Auth Flow

1. Client authenticates via `auth.provider` (session login, OAuth authorization code, DID)
2. `auth.provider` issues JWT access token (+ optional refresh token)
3. Client sends requests with `Authorization: Bearer <token>` to `auth.proxy`
4. `auth.proxy` validates token via introspection (cached) and forwards to downstream
5. Downstream service optionally calls `auth.verifier` for fine-grained ABAC checks
6. For gRPC services, `grpc.authz` interceptors handle policy resolution from proto options

## Configuration

All Node.js components use HOCON configuration (`@o3co/ts.hocon`) with Zod schema validation.
Environment variables override config values via `${?VAR_NAME}` syntax.
