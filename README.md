# auth

Lightweight auth platform for early-stage projects — the step before OPA/Cedar.

If you need authentication and authorization but OPA, Cedar, or Keycloak feel like overkill, start here. When you outgrow it, the HTTP-based architecture makes migration straightforward — swap components without touching application code.

## Components

| Component | Repository | Description |
| --- | --- | --- |
| auth.provider | [o3co/auth.provider](https://github.com/o3co/auth.provider) | OAuth 2.0 provider — login, token issuance, introspection |
| auth.proxy | [o3co/auth.proxy](https://github.com/o3co/auth.proxy) | Token validation + caching reverse proxy |
| auth.policy-verifier | [o3co/auth.policy-verifier](https://github.com/o3co/auth.policy-verifier) | No-DSL ABAC policy verifier with Collector pattern |
| grpc.authz | [o3co/grpc.authz](https://github.com/o3co/grpc.authz) | gRPC authorization middleware (Go) |

## Why This Over OPA/Cedar?

- **No policy DSL to learn** — write authorization logic in TypeScript, not Rego or Cedar policy language
- **Minutes to deploy** — `docker run` each component, configure via environment variables
- **Familiar stack** — Node.js/TypeScript, Express, JWT. Your team already knows this
- **Designed to be replaced** — each component runs as an HTTP sidecar. When you need OPA or Cedar, swap the endpoint. No application code changes
- **Extensible** — write custom Collectors to integrate your own permission/role APIs

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

For gRPC services, [grpc.authz](https://github.com/o3co/grpc.authz) provides interceptors that call the policy verifier (or OPA/Cedar as alternative backends).

See [docs/architecture.md](docs/architecture.md) for detailed flow and component descriptions.

## Getting Started

```bash
make setup    # Clone all component repos
make build    # Install deps and build
make test-e2e # Start services, run E2E tests, tear down
```

## License

Apache License 2.0
