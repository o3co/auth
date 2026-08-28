# auth

> This repository is the umbrella for the auth stack's three-layer separation of concerns ([authentication & token issuance](https://github.com/o3co/auth.provider) / [authorization decision](https://github.com/o3co/auth.policy-verifier) / [authorization enforcement](https://github.com/o3co/protobuf.interceptors)), and provides stack-level architecture docs and cross-component E2E tests. Perimeter protection against invalid / revoked tokens is handled by the optional [auth.proxy](https://github.com/o3co/auth.proxy), which sits outside the three layers.

Lightweight auth platform for early-stage projects.

A complete authentication + authorization stack that works out of the box. Each component runs as a standalone HTTP service and can be individually replaced with an enterprise alternative (Keycloak, OPA, Cedar, Envoy, etc.) as requirements grow — no application code changes required.

## Components

| Component | Repository | Description |
| --- | --- | --- |
| auth.provider | [o3co/auth.provider](https://github.com/o3co/auth.provider) | OAuth 2.0 provider — login, token issuance, introspection |
| auth.proxy | [o3co/auth.proxy](https://github.com/o3co/auth.proxy) | Token validation + caching reverse proxy |
| auth.policy-verifier | [o3co/auth.policy-verifier](https://github.com/o3co/auth.policy-verifier) | No-DSL ABAC policy verifier with Collector pattern |
| protobuf.interceptors | [o3co/protobuf.interceptors](https://github.com/o3co/protobuf.interceptors) | gRPC authorization middleware (Go) |

### auth.provider

OAuth 2.0 provider with DID (Decentralized Identifier) authentication. Issue JWTs from traditional login flows or DID-based cryptographic proof. Pluggable `DidDocumentResolver` interface supports any DID method (`did:web`, `did:key`, custom). Modular composition — use only the modules you need (DID-only deployments skip session/federation entirely). JWT signing supports HS256, RS256, ES256, EdDSA with JWKS endpoint for asymmetric algorithms.

### auth.proxy (optional)

Token validation reverse proxy with introspection result caching. Sits between client and downstream service.

This component is optional. auth.policy-verifier and protobuf.interceptors validate JWT directly, so the system works without auth.proxy. Benefits of adding it:

- **Introspection-based validation** — detects revoked tokens immediately, unlike JWT-only local validation which relies on token expiry
- **Caching** — introspection results are cached (default 30s TTL), reducing load on auth.provider
- **Centralized validation** — downstream services receive pre-validated requests without implementing auth logic

### auth.policy-verifier

No-DSL ABAC policy engine. Runs as an HTTP service (`POST /verify`) or embeds as a library. Authorization logic is composed in TypeScript via the Collector pattern, not a policy DSL. Configurable JWT verification — HS256, RS256, ES256, EdDSA with JWKS URI or direct public key (symmetric design with auth.provider). Replaceable with OPA or Cedar — `protobuf.interceptors` supports all three as backends.

### protobuf.interceptors

gRPC authorization middleware (Go). Declares access policy (resource + action) in `.proto` method options and enforces it via interceptors. Two independent modules: `protobuf_policy_option` (policy declaration/resolution) and `policy_verification` (enforcement against an authorization backend).

## Migration Path

Each component is designed to be replaced independently. protobuf.interceptors is the exception — it persists across migrations as the bridge between your gRPC services and whichever authorization backend you use.

| Component | Replaceable by | What changes |
| --- | --- | --- |
| auth.provider | [Keycloak](https://www.keycloak.org/), [Ory Hydra](https://www.ory.sh/hydra/), [Logto](https://logto.io/), Auth0 | Introspection endpoint URL in auth.proxy config |
| auth.proxy | [Envoy](https://www.envoyproxy.io/) ext_authz, [Traefik](https://traefik.io/) ForwardAuth, [Kong](https://konghq.com/) | Reverse proxy config; downstream services are unaffected |
| auth.policy-verifier | [OPA](https://www.openpolicyagent.org/), [Cedar](https://www.cedarpolicy.com/), [Cerbos](https://cerbos.dev/) | protobuf.interceptors backend: `NewOPAEndpoint()` or `NewCedarAgentEndpoint()` |
| protobuf.interceptors | — | **Not replaced.** Backend-agnostic by design. Supports auth.policy-verifier, OPA, Cedar, and static rules. |

See [docs/competitors.md](docs/competitors.md) for detailed competitor analysis per component.

## Architecture

```text
Client
  |
  |  (1) Login / Authorization code
  v
auth.provider ──── Redis (sessions)
  |
  |  (2) JWT access token
  v
auth.proxy ──────── auth.provider (introspection)
  |
  |  (3) Validated request
  v
downstream service
  |
  |  (4) POST /verify
  v
auth.policy-verifier (ABAC)
```

For gRPC services, [protobuf.interceptors](https://github.com/o3co/protobuf.interceptors) provides interceptors that call the policy verifier (or OPA/Cedar as alternative backends).

See [docs/architecture.md](docs/architecture.md) for detailed flow and component descriptions, and [docs/claims-contract.md](docs/claims-contract.md) for the claim-level JWT contract between auth.provider and auth.policy-verifier.

## Getting Started

```bash
make setup    # Clone all component repos
make build    # Install deps and build
make test-e2e # Start services, run E2E tests, tear down
```

## License

Apache License 2.0
