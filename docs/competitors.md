# Competitor Analysis

Last updated: 2026-03-31

Reference document for evaluating each module's positioning. Star counts are approximate and should be verified periodically.

## auth.provider

OAuth 2.0 provider space.

### Big 3

| Project | Language | License | Stars | Summary |
| --- | --- | --- | --- | --- |
| [Keycloak](https://github.com/keycloak/keycloak) | Java (Quarkus) | Apache 2.0 | ~24k | Full-featured enterprise IAM. OAuth 2.0, OIDC, SAML, LDAP/AD federation. CNCF Incubating. Admin UI included. Extensible via Java SPI. Heavy: JVM + PostgreSQL + Infinispan clustering. |
| [Ory Hydra](https://github.com/ory/hydra) | Go | Apache 2.0 | ~16k | Headless OAuth 2.0/OIDC server. No UI, no user management — bring your own login/consent app. OpenID Foundation certified. Part of Ory ecosystem (Kratos, Oathkeeper, Keto). Single binary + PostgreSQL. |
| [Logto](https://github.com/logto-io/logto) | TypeScript | MPL 2.0 | ~19k | Developer-focused OIDC provider. Pre-built sign-in UI, SDKs for many frameworks. Multi-tenancy, M2M auth, webhook. No SAML/LDAP in OSS. Node.js + PostgreSQL. |

### Mid/Small

| Project | Language | License | Stars | Summary |
| --- | --- | --- | --- | --- |
| [Casdoor](https://github.com/casdoor/casdoor) | Go | Apache 2.0 | ~11k | UI-first identity platform. OAuth 2.0, OIDC, SAML, CAS, LDAP. 200+ social login providers. Integrates with Casbin for authorization. Active CJK community. |
| [Authelia](https://github.com/authelia/authelia) | Go | Apache 2.0 | ~22k | Auth portal/SSO gateway (forward-auth pattern). 2FA built-in (TOTP, WebAuthn). OIDC provider support is maturing but not the primary purpose. Designed for self-hosted/homelab SSO. |
| [Supabase Auth (GoTrue)](https://github.com/supabase/auth) | Go | MIT | ~4k | Auth microservice for Supabase stack. JWT-based, social OAuth, magic link, phone/OTP. PostgreSQL RLS integration is unique. Not a general-purpose OIDC provider — tightly coupled to Supabase. |

### auth.provider's position

Crowded space. No strong differentiator vs Keycloak (breadth) or Logto (DX). DID authentication grant and custom GrantRegistry extensibility are minor differentiators. Value is in being part of the auth platform as a lightweight, integrated component, not as a standalone product.

---

## auth.proxy

Token validation / auth reverse proxy space.

### Big 3

| Project | Language | License | Stars | Summary |
| --- | --- | --- | --- | --- |
| [Envoy](https://github.com/envoyproxy/envoy) (ext_authz) | C++ | Apache 2.0 | ~27k | Data plane proxy. ext_authz filter delegates to external gRPC/HTTP authz service. No built-in auth logic or caching — full flexibility. CNCF Graduated. De facto standard in service meshes. |
| [Kong](https://github.com/Kong/kong) | Lua/Go | Apache 2.0 | ~39k | API gateway. JWT plugin validates locally (HS256/RS256). OIDC plugin is Enterprise-only. Caching is limited in OSS. Rich plugin ecosystem beyond auth. |
| [Traefik](https://github.com/traefik/traefik) | Go | MIT | ~52k | Edge router. ForwardAuth middleware delegates to external service (HTTP). No built-in caching. Auto-discovers services via Docker/K8s. Commonly paired with OAuth2 Proxy or Authelia. |

### Mid/Small

| Project | Language | License | Stars | Summary |
| --- | --- | --- | --- | --- |
| [OAuth2 Proxy](https://github.com/oauth2-proxy/oauth2-proxy) | Go | MIT | ~10k | Single-purpose OIDC login proxy. Redirects to IdP, handles callback, sets session cookie. Session-based (cookie/Redis). Authentication only — no authorization logic. The "put OAuth in front of anything" solution. |
| [Ory Oathkeeper](https://github.com/ory/oathkeeper) | Go | Apache 2.0 | ~3.3k | Identity/access proxy with authenticator → authorizer → mutator pipeline. Supports JWT, introspection, session validation. JSON-based access rules. Development has slowed (Ory focus shifting to Ory Network SaaS). |
| [Pomerium](https://github.com/pomerium/pomerium) | Go | Apache 2.0 | ~4k | Zero-trust / BeyondCorp proxy. OIDC auth + context-aware policy. Supports gRPC, TCP, WebSocket. Device posture checks. Uses Envoy internally. Designed as VPN replacement. |

### auth.proxy's position

auth.proxy occupies a narrow niche: introspection-based token validation with caching, tightly integrated with auth.provider. The Big 3 are general-purpose infrastructure tools, not direct competitors. OAuth2 Proxy is closest conceptually but session-based (browser flows), while auth.proxy is token-based (API flows). Value is in the tight integration with auth.provider/auth.policy-verifier, not as a standalone product.

---

## auth.policy-verifier

Authorization / policy engine space.

### Big 3

| Project | Language | License | Stars | Summary |
| --- | --- | --- | --- | --- |
| [OPA](https://github.com/open-policy-agent/opa) | Go | Apache 2.0 | ~11.5k | General-purpose policy engine. Rego DSL (Datalog-inspired). Sidecar/library/server. CNCF Graduated. Used for K8s admission, Terraform, API auth, and more. Steep Rego learning curve. |
| [Casbin](https://github.com/casbin/casbin) | Go (multi-lang) | Apache 2.0 | ~20k | PERM metamodel. Configurable ACL/RBAC/ABAC via model file + CSV/DB policies. No DSL — configuration-driven. Library-only (casbin-server exists separately). Widest multi-language support. |
| [Cedar](https://github.com/cedar-policy/cedar) | Rust | Apache 2.0 | ~1.4k | AWS-backed. Purpose-built Cedar policy language. RBAC+ABAC. Library-only (no standalone server). Formal verification via Lean 4 proofs. Fast (Rust, no GC). Young ecosystem, low adoption outside AWS. |

### Mid/Small

| Project | Language | License | Stars | Summary |
| --- | --- | --- | --- | --- |
| [Cerbos](https://github.com/cerbos/cerbos) | Go | Apache 2.0 | ~4.3k | YAML + CEL policies. RBAC+ABAC, resource-centric. Standalone server (PDP). Built-in policy testing. GitOps-friendly. No ReBAC. Open-core (Cerbos Hub is commercial). |
| [Permify](https://github.com/Permify/permify) | Go | AGPL 3.0 | ~5.8k | Google Zanzibar clone. ReBAC primary, RBAC/ABAC layered. Relationship tuple storage. gRPC + REST API. Acquired by FusionAuth. AGPL license is a constraint for enterprises. |
| [OpenFGA](https://github.com/openfga/openfga) | Go | Apache 2.0 | ~4.9k | Google Zanzibar implementation. ReBAC primary. JSON-based model DSL. CNCF Incubating. Backed by Okta/Auth0. Contextual tuples for ABAC-like checks (less mature). |

### auth.policy-verifier's position

The "no DSL" approach is the primary differentiator vs OPA (Rego), Cedar (Cedar lang), and Cerbos (YAML+CEL). Authorization logic is TypeScript code via Collectors, not a policy language. Closest in spirit to Casbin's configuration-driven approach, but with typed TypeScript instead of PERM model files. The trade-off: less formal reasoning and auditing capability than OPA/Cedar. Permify and OpenFGA are in the ReBAC space — different access control model, not direct competitors.

---

## grpc.authz

gRPC authorization middleware space.

### Big 3 (Infrastructure-level)

| Project | Language | License | Stars | Summary |
| --- | --- | --- | --- | --- |
| [Envoy ext_authz](https://github.com/envoyproxy/envoy) (gRPC mode) | C++ | Apache 2.0 | ~27k | Proxy-level filter delegating to external gRPC authz service. No built-in policy. Per-method via authz server parsing `/package.Service/Method` path. CNCF Graduated. |
| [Istio AuthorizationPolicy](https://github.com/istio/istio) | Go/C++ | Apache 2.0 | ~38k | Kubernetes CRD (YAML). Declarative ALLOW/DENY/CUSTOM rules. Path matching for per-method gRPC auth. Translates to Envoy RBAC filter. mTLS identity (SPIFFE). CNCF Graduated. |
| OPA + gRPC ([opa-envoy-plugin](https://github.com/open-policy-agent/opa-envoy-plugin)) | Go | Apache 2.0 | ~350 | OPA as ext_authz gRPC server. Rego policies evaluate CheckRequest. Can decode protobuf payloads (unary only). Full flexibility but requires Rego. |

### Mid/Small (Library-level)

| Project | Language | License | Stars | Summary |
| --- | --- | --- | --- | --- |
| [go-grpc-middleware](https://github.com/grpc-ecosystem/go-grpc-middleware) (auth) | Go | Apache 2.0 | ~6.7k | `AuthFunc` hook point as interceptor. No policy — you implement auth logic in code. Per-method via manual `grpc.Method` inspection. Widely used Go gRPC middleware suite. |
| [Connect authn-go](https://github.com/connectrpc/authn-go) | Go | Apache 2.0 | ~89 | HTTP middleware for Connect RPC. AuthFunc pattern. Per-method via `Spec.Procedure`. Can read proto custom options in interceptors (DIY pattern). HTTP-first design. |
| [Casbin](https://github.com/casbin/casbin) (gRPC) | Go (multi-lang) | Apache 2.0 | ~20k | casbin-server as gRPC authz service, or envoy-authz as ext_authz backend. No dedicated gRPC interceptor. PERM model maps to `Enforce(sub, obj, act)`. |

### grpc.authz's position

No existing project declares authorization policy directly in `.proto` method options. This is grpc.authz's unique approach. The Big 3 are infrastructure-level (require Envoy/Istio/OPA sidecar). go-grpc-middleware provides only a hook point — policy logic is your responsibility. Casbin has model-driven policies but no gRPC interceptor. grpc.authz fills the gap: declarative per-method policy in `.proto` + pluggable verification backend, all at the library level.
