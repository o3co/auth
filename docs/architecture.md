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
+-----------------+       +--------------------------+
|  downstream     |       | auth.policy-verifier     |
|    service      |------>| POST /verify (ABAC)      |
+-----------------+       +--------------------------+
```

## Components

| Component | Language | Repository | Description |
| --- | --- | --- | --- |
| auth.provider | Node.js/TS | [o3co/auth.provider](https://github.com/o3co/auth.provider) | OAuth 2.0 provider: login, token issuance, introspection |
| auth.proxy | Node.js/TS | [o3co/auth.proxy](https://github.com/o3co/auth.proxy) | Token validation + caching reverse proxy |
| auth.policy-verifier | Node.js/TS | [o3co/auth.policy-verifier](https://github.com/o3co/auth.policy-verifier) | No-DSL ABAC policy verifier with Collector pattern |
| protobuf.interceptors | Go | [o3co/protobuf.interceptors](https://github.com/o3co/protobuf.interceptors) | gRPC interceptors for policy enforcement |

### Probes

Every HTTP component serves `GET /_healthcheck` as its liveness probe. It always answers `200` and touches no dependency, so it proves only that the process is up and its port answers — never gate a load balancer or a rollout on it. `auth.provider` additionally serves `GET /readyz`, which does run its dependency probes and answers `503` when a replica should be taken out of rotation. `auth.policy-verifier` answered on `GET /healthcheck` before the stack settled on one spelling; it keeps that path as a compatibility alias of `/_healthcheck`, so a probe config that still names it keeps working. Configure new probes with `/_healthcheck` everywhere. `protobuf.interceptors` is a library and serves no endpoint of its own.

| Component | Liveness | Readiness |
| --- | --- | --- |
| auth.provider | `GET /_healthcheck` | `GET /readyz` |
| auth.proxy | `GET /_healthcheck` | — |
| auth.policy-verifier | `GET /_healthcheck` (alias: `GET /healthcheck`) | — |

## Auth Flow

1. Client authenticates via `auth.provider` (session login — local password, passkeys or Google / GitHub federation — or the OAuth authorization code flow with PKCE; machine clients use client credentials or the device grant)
2. `auth.provider` issues JWT access token (+ optional refresh token)
3. Client sends requests with `Authorization: Bearer <token>` to `auth.proxy`
4. `auth.proxy` validates token via introspection (cached) and forwards to downstream
5. Downstream service calls `auth.policy-verifier` (`POST /verify`) for fine-grained ABAC checks
6. For gRPC services, `protobuf.interceptors` interceptors resolve policy from `.proto` options and call the verifier

The claim-level contract between steps 2 and 5 — which JWT claims cross the provider→verifier boundary, who writes and reads each, and what each side means by them — is specified in [claims-contract.md](claims-contract.md).

## Migration Path

Each component runs as a standalone HTTP service. To migrate to OPA or Cedar:

- **Policy verifier** → Replace `auth.policy-verifier` with OPA or Cedar Agent. `protobuf.interceptors` already supports all three as backends
- **Auth provider** → Replace with Keycloak, Auth0, or any OAuth 2.0 provider. `auth.proxy` just needs the introspection endpoint URL
- **Auth proxy** → Replace with any token-validating reverse proxy (e.g., Envoy with ext_authz)

No application code changes required — only endpoint URLs in configuration.

## Configuration

All Node.js components use HOCON configuration (`@o3co/ts.hocon`) with Zod schema validation.
Environment variables override config values via `${?VAR_NAME}` syntax.
