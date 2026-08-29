# Provider ↔ Verifier Claims Contract

The JWT contract between [auth.provider](https://github.com/o3co/auth.provider) and [auth.policy-verifier](https://github.com/o3co/auth.policy-verifier) has two halves. The **signature half** — algorithm and key-distribution symmetry (HS256/RS256/ES256/EdDSA, shared secret or JWKS URI) — is deployment configuration, documented in each repo's README. This document records the **claim half**: which claims cross the boundary, who writes them, who reads them, and what each side means by them.

Each repo's vocabulary is absolute only within that repo: the provider writes claims in OAuth/OIDC vocabulary (RFC-grounded), and the verifier translates them into its own ABAC attribute vocabulary at its edge. The table below is that correspondence. It consolidates mapping statements that already exist as comments scattered across both repos and the E2E suites here — an index over those statements, not a second source of truth. Where a row and the cited code disagree, the code and its tests win and this table has drifted.

## The boundary object

The RFC 9068 JWT access token. The provider assembles claims in `generateToken` (auth.provider's `packages/core/src/grants/token.mts`) and stamps them per grant under auth.provider's `packages/oauth/src/grants/`. The verifier authenticates the token in `tokenAuthenticator` (auth.policy-verifier's `packages/server/src/jwt/`), then the built-in collectors (its `packages/builtins`) translate the verified claims into ABAC attributes (the `ATTR_*` keys in auth.policy-verifier's `packages/core/src/keys.mts`).

Path convention for the tables below: paths in the *Provider writes* column are relative to [o3co/auth.provider](https://github.com/o3co/auth.provider), paths in *Verifier reads* to [o3co/auth.policy-verifier](https://github.com/o3co/auth.policy-verifier), and `tests/…` paths to this repo.

## Claims that cross

| Claim | Provider writes | Verifier reads | Meaning at the boundary |
| --- | --- | --- | --- |
| `scope` | Space-delimited string (RFC 6749 §3.3), or omitted entirely when nothing was granted — never `""`, never an array (CP-12 in `oauth/src/grants/authorization.mts`). Ceiling: the client's registered `allowedScopes`. | `PayloadScopeCollector` splits on spaces → `ATTR_SCOPES`; `ResourceActionScopeRuleCollector` then requires the `{action}:{resourceType}` scope it derives from each `/verify` request. | Capability ceiling — what the session **can request**, not what it has been granted (see the collector's doc comment and [auth.provider#56](https://github.com/o3co/auth.provider/issues/56)). The *grammar inside* a scope value is owned by the verifier; the provider only compares the strings opaquely. |
| `sub` | The user id from the session store — never the session id (`oauth/src/grants/authorization.mts`). | `PayloadSubjectIdCollector` → `ATTR_USER_ID`; `/verify` echoes it as the wire `subject`. | Identity travels intact across the stack. |
| `azp` | The *authenticated* client id, not the raw body `client_id` (D-6 in `oauth/src/grants/authorization.mts`). | `PayloadSubjectIdCollector` → `ATTR_CLIENT_ID`. | Which client the token was issued through. |
| `aud` | The RFC 8707 `resource` parameter echoed back as the audience; dropped on refresh when the parameter is not repeated (§2.2). | Pinned by jose verification — `oauth.jwt.audience` / `OAUTH_JWT_AUDIENCE`. | The resource server the token is addressed to. The E2E value `https://api.e2e.test` appears in `tests/provider/clients.yaml` (`allowedAudiences`) *and* the verifier's env for exactly this reason. |
| `iss` | Deployment-configured issuer; required, never request-derived. | Pinned by jose verification — `oauth.jwt.issuer` / `OAUTH_JWT_ISSUER`. | Deployment identity. |
| `typ` (header) | `at+jwt` on access tokens (RFC 9068), `rt+jwt` on refresh tokens, and the standard `JWT` on ID tokens (wire name `id_token`) since auth.provider v0.10.0 — it was the nonstandard `id+jwt` before, which strict external RPs rejected; verification accepts both spellings during the window auth.provider#402 closes. | `oauth.jwt.tokenType`, default `at+jwt`; an `application/` prefix on either side is ignored when comparing. | The **only** discriminator between the three token kinds — the pin is what keeps a refresh or id token signed with the same key from passing `/verify`. What does the keeping-out is being **disjoint from `at+jwt`**, which `JWT` satisfies exactly as `id+jwt` did. There is no claim-level fallback check. |
| `exp` / `iat` | Always stamped (`core/src/grants/token.mts`). | Both required (`tokenAuthenticator`'s required-claims check + the always-set `maxTokenAgeSeconds` bound); a token without `exp` is refused as a permanent credential. | Lifetime. The verifier additionally caps the issuer's `exp` rather than trusting issuer discipline. |

## Claims that do NOT cross

Recorded so the coupling cannot be assumed into existence:

| Claim | Status |
| --- | --- |
| `jti` | Stamped on every token (`core/src/grants/token.mts`) and used provider-side for replay detection. The verifier never reads it. |
| `groups` | Reaches userinfo / id_token only through the scope-gated claim filter (`core/src/grants/claimFilter.mts`, `groups` scope) — it is **not** in the access token. The verifier's group-style attributes arrive via the `/verify` request `context` through `RequestContextAttributeCollector`: a separate channel with a separate trust boundary (caller-supplied body, not the verified token). |

## Executable rows

Several rows are pinned by tests in this repo — read them before weakening a row:

- `typ` discrimination: `tests/token-flow/index.test.js` pins all three headers; `tests/abac/index.test.js` ("only access tokens are decision inputs") presents the id_token and refresh token at `/verify` and requires rejection. Do not weaken those into "some 4xx".
- `scope` is a string, not an array: `tests/token-flow/index.test.js` — "a `scopes` array would silently authorize nothing" (the drift [o3co/auth#3](https://github.com/o3co/auth/issues/3) called out).
- `aud` via the RFC 8707 `resource` parameter: `tests/token-flow/index.test.js` + `tests/provider/clients.yaml` (`allowedAudiences`).
- `sub` travels intact: `tests/abac/index.test.js` (provider `sub` → `/verify` `subject`).

## Change protocol

Every row is a two-repo constraint: changing either side alone breaks `/verify` — or worse, silently authorizes nothing. A PR that changes a row updates (1) the owning repo, (2) the E2E pin here, and (3) this table. The signature half's equivalent rule (alg/key symmetry) is enforced by the compose/Makefile single-sourcing under `tests/`.
