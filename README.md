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

OAuth 2.0 / OIDC provider. Issues JWTs from session login (local username/password, WebAuthn passkeys, Google / GitHub federation) or the authorization code flow with PKCE; machine and delegated access via client credentials, the device authorization grant (RFC 8628) and token exchange (RFC 8693); sender-constrained tokens via DPoP (RFC 9449) and mTLS-bound tokens (RFC 8705); introspection, revocation, RP-initiated and back-channel logout. Modular composition — use only the modules you need. JWT signing supports EdDSA (default), ES256, RS256 and HS256, with a JWKS endpoint for the asymmetric algorithms.

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

### E2E revisions

`make test-e2e` tests each component at the revision pinned at the top of the `Makefile` (`PROVIDER_REV`, `PROXY_REV`, `VERIFIER_REV`). The pins are the tested baseline, and the pinned run of the [`e2e`](.github/workflows/e2e.yml) workflow — on every push to `develop`, on every pull request, and on a manual run left at its defaults — is the release gate. Moving the baseline means changing a pin in a pull request, where that gate runs.

To test another revision, override its variable on the command line; a command-line variable wins over the Makefile's `:=`:

```bash
make test-e2e PROVIDER_REV=origin/develop  # a branch, written origin/<branch>
make test-e2e PROXY_REV=v0.7.0             # a tag
make test-e2e VERIFIER_REV=1e29749         # a SHA
```

`make setup` runs `git fetch origin` and then `git checkout --detach <rev>`, so write a branch as `origin/<branch>`: a bare branch name resolves to the clone's local branch, which is stale in a clone that already existed. Only commits reachable from the component's branches and tags are fetched.

In CI:

- **A manual run with overrides.** The `e2e` workflow's *Run workflow* form takes `provider_rev`, `proxy_rev` and `verifier_rev` in the same forms; an empty field keeps the pin. A run with any override is not the release gate, and its run name says so.
- **Nightly against `develop`.** [`e2e-develop`](.github/workflows/e2e-develop.yml) runs the same suite daily with every component at `origin/develop`. It gates nothing: a red run means a component's `develop` no longer passes this suite, found before the pin is bumped at release time.
- **From auth.provider.** auth.provider's `umbrella-e2e` workflow runs this suite, at this repository's `develop`, on its pull requests to `develop`, with the pull request's code as `PROVIDER_REV` and the proxy and verifier at their pins. A broken `develop` here turns those checks red.

Every run's job summary lists the commit each component was tested at, next to its pin.

A component change that narrows what it accepts (a required config key, a stricter claim, a new status) is met here first: update `tests/` so that it passes against both the pinned component and the change, then the component's pull request can go green.

## License

Apache License 2.0
