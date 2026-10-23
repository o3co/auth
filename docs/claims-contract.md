# Provider ↔ Verifier Claims Contract

The JWT contract between [auth.provider](https://github.com/o3co/auth.provider) and [auth.policy-verifier](https://github.com/o3co/auth.policy-verifier) has two halves. The **signature half** — algorithm and key-distribution symmetry (HS256/RS256/ES256/EdDSA, shared secret or JWKS URI) — is deployment configuration, documented in each repo's README, except for the one value both sides must read alike, the [HS256 shared secret](#the-hs256-shared-secret), recorded here. This document records the **claim half**: which claims cross the boundary, who writes them, who reads them, and what each side means by them.

Each repo's vocabulary is absolute only within that repo: the provider writes claims in OAuth/OIDC vocabulary (RFC-grounded), and the verifier translates them into its own ABAC attribute vocabulary at its edge. The table below is that correspondence. It consolidates mapping statements that already exist as comments scattered across both repos and the E2E suites here — an index over those statements, not a second source of truth. Where a row and the cited code disagree, the code and its tests win and this table has drifted. The exception is [Delegated tokens](#delegated-tokens), which states the provider's side before that side exists.

## The boundary object

The RFC 9068 JWT access token. The provider writes its claims in one place, its `tokens` module (`grantClaims` in auth.provider's `modules/oauth/tokens/src/module.ts`), from the grant each grant module issues through it. The verifier authenticates the token in `tokenAuthenticator` (auth.policy-verifier's `packages/server/src/jwt/`), then the built-in collectors (its `packages/builtins`) translate the verified claims into ABAC attributes (the `ATTR_*` keys in auth.policy-verifier's `packages/core/src/keys.mts`).

Path convention for the tables below: paths in the *Provider writes* column are relative to [o3co/auth.provider](https://github.com/o3co/auth.provider), paths in *Verifier reads* to [o3co/auth.policy-verifier](https://github.com/o3co/auth.policy-verifier), and `tests/…` paths to this repo.

## Claims that cross

| Claim | Provider writes | Verifier reads | Meaning at the boundary |
| --- | --- | --- | --- |
| `scope` | Space-delimited string (RFC 6749 §3.3), or omitted entirely when nothing was granted — never `""`, never an array (`grantClaims`). Ceiling: the client's registered scopes (its `client-allowance` section's `scopes`). | `PayloadScopeCollector` splits on spaces → `ATTR_SCOPES`; `ResourceActionScopeRuleCollector` then requires the `{action}:{resourceType}` scope it derives from each `/verify` request. | Capability ceiling — what the session **can request**, not what it has been granted (see the collector's doc comment and [auth.provider#56](https://github.com/o3co/auth.provider/issues/56)). The *grammar inside* a scope value is owned by the verifier; the provider only compares the strings opaquely. |
| `sub` | The subject of the user the session logged in (`users`' `subject`) — never the session id (`grantClaims`). | `PayloadSubjectIdCollector` → `ATTR_USER_ID`; `/verify` echoes it as the wire `subject`. | Identity travels intact across the stack. |
| `client_id` | The *authenticated* client the token was issued to (RFC 9068 §2.2; `grantClaims`); a `client_id` in a request body is never read for it. The access token carries no `azp` (auth.provider's [migration guide, "Access and refresh tokens"](https://github.com/o3co/auth.provider/blob/develop/docs/migration.md#access-and-refresh-tokens)). | Not read: `PayloadSubjectIdCollector` lifts `azp` alone into `ATTR_CLIENT_ID`, so no rule can read the client from these tokens. | Which client the token was issued through. |
| `aud` | The RFC 8707 `resource` parameter echoed back as the audience; without one, the client's first registered audience (its `client-allowance` section's `audiences`). On refresh (RFC 8707 §2.2) the presented refresh token's audience is both the ceiling and the default: a refresh without `resource` keeps it, and a `resource` outside it is refused `invalid_target`. A `resource` within it narrows the access token only; the rotated refresh token keeps the original scope and audience. | Pinned by jose verification — `oauth.jwt.audience` / `OAUTH_JWT_AUDIENCE`. | The resource server the token is addressed to. The E2E value `https://api.e2e.test` is set in both the provider's environment, which `tests/provider/local.conf` reads into its clients' `audiences`, *and* the verifier's for exactly this reason. |
| `iss` | Deployment-configured issuer; required, never request-derived. | Pinned by jose verification — `oauth.jwt.issuer` / `OAUTH_JWT_ISSUER`. | Deployment identity. |
| `typ` (header) | `at+jwt` on access tokens (RFC 9068) and the standard `JWT` on ID tokens (wire name `id_token`). Refresh tokens are opaque, not JWTs (auth.provider's [migration guide, "Access and refresh tokens"](https://github.com/o3co/auth.provider/blob/develop/docs/migration.md#access-and-refresh-tokens)). | `oauth.jwt.tokenType`, default `at+jwt`; an `application/` prefix on either side is ignored when comparing. | The **only** discriminator between the two JWT kinds signed with the same key — the pin is what keeps an id token from passing `/verify`. What does the keeping-out is being **disjoint from `at+jwt`**, which `JWT` is. There is no claim-level fallback check. A refresh token is no JWT, so no JWT verification takes it. |
| `exp` / `iat` | Always stamped (`modules/oauth/tokens/src/module.ts`). | Both required (`tokenAuthenticator`'s required-claims check + the always-set `maxTokenAgeSeconds` bound); a token without `exp` is refused as a permanent credential. | Lifetime. The verifier additionally caps the issuer's `exp` rather than trusting issuer discipline. |
| `amr` / `acr` / `auth_time` | How, to which assurance level, and when the user authenticated; each written only when the grant gives it (`grantClaims`). `amr` and `auth_time` come from the grants that stand on a user's authentication: `authorization_code` (the code's session), `session`, `device_code` (the approving session) and the WebAuthn login grant (`urn:o3co:oauth:grant-type:webauthn`, whose `amr` is `["hwk"]`). A federated login proves `fed` plus the values its IdP's `upstream-amr` maps; a second factor the login gates then require adds its own. `acr` originates only in `authorization_code`: the first of the request's `acr_values` that the acr table (`acr.values` and the entries modules offer, `modules/oauth/acr`) knows and the session's `amr` meets. A refresh token is opaque; its family's record keeps the `amr`, authentication time and `acr` the family started with, and every access token a refresh issues carries them (`modules/oauth/refresh`). A token exchange carries them only from a subject token that is this provider's own access token (`modules/oauth/token-exchange`). An empty `amr` is left out and an empty `acr` is never issued; `auth_time` is in seconds, never after `iat`, and left out where the authentication time is not known (`modules/oauth/tokens/src/limits.ts`). | No built-in collector reads them. A deployment that gates on them maps the verified claim to an attribute key of its own with `PayloadClaimAttributeCollector` (`packages/builtins`), e.g. `{ from = "amr", to = "amr", type = "string[]" }`, and writes the rule. | The **original** authentication event, as OIDC Core §12.2 keeps `auth_time` across a refresh: a refreshed or exchanged access token reports the login it descends from, not the refresh. `auth_time` is the session's sign-in: a later step-up adds to `amr` and may meet an `acr`, but keeps `auth_time`, which therefore does not date them. `hwk` from a passkey login says only that the key was held, not that user verification took place. Absent means the provider recorded none; it is not a statement that the user did not use a second factor. |
| `act` | Written only by the token exchange grant (RFC 8693, `urn:ietf:params:oauth:grant-type:token-exchange`, `modules/oauth/token-exchange`), and only when an `actor_token` is presented: `act.sub` is the actor token's subject, nested over the subject token's own chain as `act.act` (RFC 8693 §4.1); `sub` stays the subject token's subject (`grantClaims`). Without an actor token the issued token has no `act`. The chain is at most `token-exchange.max-actor-depth` deep (1–10, default 3). A refresh never carries it: token exchange issues access tokens only, and a refresh family's record holds no actor (`modules/oauth/refresh/src/record.ts`). | No built-in collector reads it. A deployment promotes `act.sub` with `PayloadClaimAttributeCollector` (`packages/builtins`), e.g. `{ from = "act.sub", to = "actorId" }`, for policies that name the actor. | Who is acting for the subject. Only the outermost `act` names the current actor; nested ones are prior actors, which RFC 8693 §4.1 keeps out of access-control decisions. |

## Claims that do NOT cross

Recorded so the coupling cannot be assumed into existence:

| Claim | Status |
| --- | --- |
| `jti` | Stamped on every access token (`modules/oauth/tokens/src/module.ts`), which the provider refuses one without; it revokes a token and records it to its session by it. The verifier never reads it. |
| `groups` | Reaches userinfo / id_token only through the `groups` scope (`oidc`'s claim table, `modules/oauth/oidc`) — it is **not** in the access token, where the provider refuses it as a reserved name. The verifier's group-style attributes arrive via the `/verify` request `context` through `RequestContextAttributeCollector`: a separate channel with a separate trust boundary (caller-supplied body, not the verified token). |

## Delegated tokens

A delegation grant ([auth.provider#861](https://github.com/o3co/auth.provider/issues/861)) issues tokens in which a client acts for a subject within a range. The provider has no such grant yet. It writes `act` only through token exchange (see [Claims that cross](#claims-that-cross)), and it never writes `authorization_details`: the name is on the list `added-claims` keeps from the issuer and from every grant (`modules/foundation/added-claims/src/claims.ts`). The verifier reads `authorization_details` since v0.16.0, so this section is the contract the provider's delegation package implements. Unlike the tables above, it is not an index over code on both sides: until the provider's side exists, this section is where that side is stated. The verifier's side is pinned by its vectors test (below), not by an E2E here; a disagreement between this section and that test is fixed in both in one change. Once the provider implements it, the section becomes an index like the rest, citing the provider's code.

| Claim | Provider writes | Verifier reads | Meaning at the boundary |
| --- | --- | --- | --- |
| `act` | `act.sub` = the acting client (RFC 8693 §4.1); `sub` stays the subject. Token exchange writes `act` in this shape today, with the actor token's subject as `act.sub` (see [Claims that cross](#claims-that-cross)). | As in [Claims that cross](#claims-that-cross): no built-in collector reads it; a deployment promotes `act.sub` with `PayloadClaimAttributeCollector`. | Who is acting, and for whom. |
| `authorization_details` | RFC 9396 entries of the delegation package's one type, each `{ "type": <that type>, "path": "<path>" }`: the range the token may act within. | `DelegationRangeCollector` → `ATTR_DELEGATION_RANGE` (the builtins' own key, in auth.policy-verifier's `packages/builtins/src/keys.mts`); `DelegationRangeRuleCollector` emits `WithinDelegationRange` for the requested path `<resource>.<action>` when the token carries a range: an entry of the type, or the claim in another shape (not a list of entry objects), which is a range that contains nothing. Both are configured with the same `type` (and `claim`, if overridden). | A delegated token is allowed only what its range **and** the policies allow. The range rule restricts and never allows on its own, so a delegated token no policy rule applies to goes to `onEmptyRuleSet`: denied (`no_applicable_rule`) by default; under `"allow"`, allowed when its range contains the request. A token without a range is decided by the policies alone. |

**Path grammar.** A path is `(type(:id)?.)*action`:

- `type` and `action` are `[a-z][a-z0-9_]*`;
- `id` is one or more of `[A-Za-z0-9_~-]`, any other character percent-encoded in **upper-case** hex. An id is compared as written, so `%41` and `A` are two ids: the issuer and the resource must encode alike;
- the last element is the action and carries no id. In an entry it may be a type the range stops at (`project:p1.report`); an entry cannot end in `type:id`, so a range over everything under `project:p1` names what lies under it.

**Containment.** An entry contains a path when it is a segment-wise prefix of it: each entry element has the path element's type, and an entry element that names no id contains the same type with any id. Nothing is normalized — both sides are compared as written — and a side outside the grammar contains, and is contained by, nothing. The provider applies the same rule when a pull narrows a grant's range, and checks a child grant's entries against the prefix its parent names segment by segment in the same way; the verifier applies it to each request. An entry's last element is compared as a type even when it names an action, so `a:1.run` contains `a:1.run.more`: keep action names apart from type names. The verifier's requested path is the request's resource, then its action. The resource is the string the caller sent, whatever resource parser the deployment configures, and its parent chain is the caller's claim: a deployment whose policies rely on the chain confirms it against its own store. The action must be one action of the grammar, since one of several elements (`report.delete`) would re-split the joined path and read a request on the parent as one on a child.

Vectors both sides are held to (`auth.policy-verifier`'s `packages/builtins/src/__tests__/delegation/range.test.mts` pins them):

| Entry | Path | Contained |
| --- | --- | --- |
| `a:1.b` | `a:1.b:2.c:3.run` | yes |
| `a:1.b` | `a:1.b.run` | yes |
| `a.run` | `a:1.run` | yes |
| `a:1.run` | `a:1.run.more` | yes — a prefix contains what lies under it |
| `a:1.b:2.run` | `a:1.b:3.run` | no |
| `a:1.run` | `a.run` | no — an entry that names an id does not contain a path that names none |
| `a:1.b.c.run` | `a:1.b.run` | no — an entry longer than the path |
| `a:1.run` | `a:1.read` | no |
| `doc:x%2Fy.read` | `doc:x/y.read` | no — `/` is outside the grammar; the encoding is part of the id |
| `a:%41.run` | `a:A.run` | no — an id is compared as written |

**Open, for the provider's package to fix:**

- the `authorization_details` type value. The verifier takes it as configuration (`type`) and has no default, so it adds no constraint of its own;
- whether a delegated token also carries `scope`. The range only narrows, so under the default `onEmptyRuleSet` the verifier needs a policy rule that grants the request; a token without `scope` is granted only by a policy that does not read it;
- the claim that carries the grant id. The verifier does not read it;
- the containment rule is an extension point on the provider; the verifier implements only the rule above, so a deployment that replaces the provider's rule replaces `DelegationRangeRuleCollector` too.

## The HS256 shared secret

The one value of the signature half that both sides hold. Under HS256 the provider signs, and the verifier verifies, with the same secret string. Each side turns that string into the HMAC key bytes by a setting of its own, and a token verifies only when both get the same bytes. Paths in the *Provider* column are relative to [o3co/auth.provider](https://github.com/o3co/auth.provider), and in the *Verifier* column to [o3co/auth.policy-verifier](https://github.com/o3co/auth.policy-verifier).

| | Provider | Verifier |
| --- | --- | --- |
| Setting | `keys.signing.secret-encoding`, since 0.18.0 (`modules/foundation/keys/src/secret/secret.ts`) | `oauth.jwt.secretEncoding` / `OAUTH_JWT_SECRET_ENCODING`, since v0.17.0 (`packages/server/src/config/secretEncoding.mts`). A value other than the three below refuses boot, in every mode. |
| `utf8` | The text's own bytes. | The text's own bytes. |
| `hex` | The bytes the value spells, when it is whole bytes of hex (`/^(?:[0-9a-fA-F]{2})+$/`). | The same. |
| `base64` | The bytes the value spells, when it is strict padded standard base64. | The same. |
| Unset | Hex where the value is whole bytes of hex, otherwise strict padded standard base64. A value that is both, such as 64 hex characters, reads as hex. | `utf8`. |
| A value not of the reading named | Refuses boot. | Refuses boot. |
| Key size | At least 32 bytes and at least 8 distinct byte values, under any reading. | At least 32 bytes, judged on the bytes the reading gives (its `README.md`, "How the secret string is read"). |

**Pairing rule: set both sides to the same explicit encoding.** Do not leave either side at its default. The defaults differ: `utf8` is the reading the verifier has always applied, and the one the provider applied before 0.18 (the setting's description in the provider's `modules/foundation/keys/src/signing/section.ts`); since 0.18 the provider's unset reading decodes hex or base64, and the verifier kept its own. So the same string, with both sides at their defaults, is two different keys. The provider keeps its unset reading through 0.18 and 0.19, and may come to require the setting for HS256 before 1.0.

**Failure mode.** A mismatch is not a boot error on either side: both start, and the verifier answers every token the provider signs with `401` `invalid_token`. Only a string that is not of the reading a side names refuses boot, on that side.

## Executable rows

Several rows are pinned by tests in this repo — read them before weakening a row:

- `typ` discrimination: `tests/token-flow/index.test.js` pins the access token's and the id_token's headers and the refresh token's opaque form; `tests/abac/index.test.js` ("only access tokens are decision inputs") presents the id_token and refresh token at `/verify` and requires rejection. Do not weaken those into "some 4xx".
- `scope` is a string, not an array: `tests/token-flow/index.test.js` — "a `scopes` array would silently authorize nothing" (the drift [o3co/auth#3](https://github.com/o3co/auth/issues/3) called out).
- `aud` via the RFC 8707 `resource` parameter: `tests/token-flow/index.test.js` + `tests/provider/local.conf` (each client's `audiences`).
- `client_id`, not `azp`: `tests/token-flow/index.test.js` and `tests/token-flow/injection.test.js`.
- `sub` travels intact: `tests/abac/index.test.js` (provider `sub` → `/verify` `subject`).
- `amr` / `acr` / `auth_time`: `tests/token-flow/authentication-claims.test.js`. After a password login, the access token from `authorization_code` and from the `session` grant carries `amr` `["pwd"]`, never an empty one, and the login's `auth_time` in whole seconds, not after `iat` (strictly before it here, since the suite waits a second after the login). `acr` is the first of `acr_values` that the table knows and the login meets, in the request's order, not the table's (the `acr.values` entries in `tests/provider/local.conf`), and is absent when none is asked and on the `session` grant. A refresh carries the original `amr`, `auth_time` and `acr`.
- The HS256 shared secret: `tests/abac/hs256-pair.test.js`, against the HS256 provider and the two HS256 verifiers in `tests/docker-compose.yml` (`provider-hs256`, `policy-verifier-hs256` and `policy-verifier-hs256-unpaired`). The provider names `hex` (`tests/provider/hs256.conf`). The verifier that names `hex` too allows a token the provider minted. The one left at its default refuses that token with `401`, and allows the same claims signed with the text's own bytes, so the encoding is all the two disagree on.

Pinned outside this repo: the delegation range grammar and containment vectors, by auth.policy-verifier's `packages/builtins/src/__tests__/delegation/range.test.mts`. There is no E2E pin here until the provider writes `authorization_details`.

No test in this repo asserts `act`: the rig composes no token exchange, the one grant that writes it. Nor can the rig reach the `amr` / `auth_time` branches beyond a password login, such as an empty `amr` left out or an unknown authentication time. auth.provider's `modules/oauth/tokens/test/tokens.test.ts` pins the claim names and when they are written, the contract every `tokens` implementation passes (`modules/oauth/tokens/src/testing.ts`) what reads back, `modules/oauth/refresh/test/refresh.test.ts` that a refresh carries `amr` / `acr` / `auth_time`, and `modules/oauth/token-exchange/test/exchange.test.ts` the actor chain token exchange builds.

## Change protocol

Every row is a two-repo constraint: changing either side alone breaks `/verify` — or worse, silently authorizes nothing. A PR that changes a row updates (1) the owning repo, (2) the E2E pin here, and (3) this table. The signature half's equivalent rule (alg/key symmetry) is enforced by the compose/Makefile single-sourcing under `tests/`. The HS256 secret string has its one definition there too; its encoding does not, since each side names its own, as a deployment does, and the pairing rule is that the two names agree.
