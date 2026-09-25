# Internal adoption baseline

Start with ordinary Bearer access tokens, the provider's real login and PKCE
authorization-code flow, and signature-verifying policy evaluation. The E2E
also covers session-grant issuance and an optional validation proxy. Component
revisions are pinned in `Makefile`; `make setup` and `make pull` check out those
exact revisions. Updating the baseline means updating the pins and rerunning
`make test-e2e`, after checking that the nightly `e2e-develop` workflow is
still enabled and green (the README's "E2E revisions" lists the steps). A run
at other revisions — a command-line override such as
`make test-e2e PROVIDER_REV=origin/develop`, or the nightly `e2e-develop`
workflow — is not the baseline; see "E2E revisions" in the README.

The disposable compose fixture proves:

- A provider-issued token can invoke a protected operation with the expected subject.
- Missing credentials and insufficient scope never execute the business handler.
- DPoP/mTLS-bound tokens presented on a Bearer-only boundary are rejected; the
  proxy rejects them before forwarding to the protected service.
- A warm introspection cache cannot forward a token beyond its `exp`.
- Deleting only a tracked UserSession prevents fresh session-grant issuance even
  while the separate browser session is retained.
- Local logout invalidates the issued token; the validation proxy refuses its
  previously warm entry after the configured cache TTL.
- An injection-mode proxy exchanges the browser session cookie at the
  provider's `session` grant and forwards a provider-issued Bearer for that
  user; without the cookie it mints nothing, a signed-out or untracked session
  is `401 session_required`, and `stripInboundAuthorization` removes a client's
  own header (`tests/token-flow/injection.test.js`).
- A validation proxy authenticating to introspection with client credentials
  forwards tokens for an audience its client is registered for, refuses a
  valid token for any other audience, and answers `502` when its own
  credentials are refused (`tests/token-flow/validation-client-credentials.test.js`).

`tests/fixtures/echo-upstream.mjs`, the upstream behind those proxies, echoes
the headers it received and verifies nothing.

`tests/fixtures/protected-api.mjs` is test scaffolding with counters to prove the
order of enforcement and handler execution. Its counters and public health
routes must not be deployed as an application. It uses the HTTP verifier
contract directly; it does not test the Go gRPC/ConnectRPC interceptor.

## Deployment boundary

The compose uses one provider, Redis-backed state, HS256, and disposable users,
clients and secrets. Configure the real application's clients, permitted scopes,
issuer/audience, secrets, HTTPS and secure cookies before sending real traffic.
Keep the verifier and the upstream behind the intended enforcement boundary.
The sample credentials and plain-HTTP settings are only for this test rig.

The protected validation proxy's five-second TTL is explicit. Revocation can
remain cached for that interval, capped by token expiry. Use a zero introspection
TTL if each request must observe revocation immediately; pure offline JWT
verification observes expiry, not live session deletion.

This baseline does not enable end-to-end DPoP/mTLS. Such tokens are refused by
the default Bearer-only consumers until a trusted possession-verification
boundary is implemented. Injection mode's external-credential exchange (RFC
7523 jwt-bearer) is not exercised: the standalone provider wires no
`assertionVerifier`, so its issuer registry cannot be configured from this
rig. The exchange, actual Go interceptors, multiple provider or proxy replicas
and asymmetric JWKS rotation need their own deployment-specific smoke tests
before enabling those paths. Passing this
baseline supports internal evaluation of the described topology; it is not a
release-candidate or production-readiness certification.
