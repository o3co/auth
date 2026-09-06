# Provin consumer compatibility

`make test-provin` tests actual `provin-line/auth` source pinned in the Makefile
against the candidate Provider/Verifier revisions used by the Bearer E2E suite.
It packs the five consumed upstream packages and overrides every matching direct
and transitive dependency. No npm release or image push is needed.

It covers workspace build/typecheck/tests, DID issuance and HTTP policy decisions,
then generated composition-root build/typecheck/config tests, service startup and
the generated Provider's valid/tampered DID-signature grant.

`repos/provin.auth` is disposable: its manifest/lockfile are rewritten and
`instances/` regenerated. Use a fresh checkout for fresh dependency resolution.
Do not use this test checkout for application work.

The consumer's generated release pins remain unchanged. Deploying the candidate
fixes requires deliberately using the tested artifacts/revisions and updating
configuration. This check does not deploy a Provin node, prove registry ACLs or
exercise a Web/mobile application's login flow.
