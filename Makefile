# Tested component revisions. Update these deliberately and rerun the full E2E.
PROVIDER_REV := 19ce4c7f11c7747a93068b7679fc4436aa40e398
PROXY_REV := 9828a137217426b9d6fe3115d3a4ca5ae789aa92
VERIFIER_REV := c5e0608cd0f938038af0031446e06d24cef73087
UTILS_REV := 88b7f0585b1df438931d200e053ad918ff0958fb
PROVIN_REV := f12fb8f24bbd833a7a14dfbdd8e5274e395120f6

define clone_or_pull
	@if [ -d "$(1)/.git" ]; then \
		echo "==> $(1) (already cloned)"; \
	else \
		echo "==> Cloning $(2) -> $(1)"; \
		git clone "$(2)" "$(1)"; \
	fi
	git -C "$(1)" fetch origin
	git -C "$(1)" checkout --detach "$(3)"
endef

.PHONY: setup
setup:
	$(call clone_or_pull,repos/auth.provider,git@github.com:o3co/auth.provider.git,$(PROVIDER_REV))
	$(call clone_or_pull,repos/auth.proxy,git@github.com:o3co/auth.proxy.git,$(PROXY_REV))
	$(call clone_or_pull,repos/auth.policy-verifier,git@github.com:o3co/auth.policy-verifier.git,$(VERIFIER_REV))

.PHONY: pull
pull: setup

# Exercise the actual downstream DID grant and policy extensions before release.
.PHONY: setup-provin test-provin
setup-provin:
	$(call clone_or_pull,repos/auth.utils,git@github.com:o3co/auth.utils.git,$(UTILS_REV))
	$(call clone_or_pull,repos/auth.provider,git@github.com:o3co/auth.provider.git,$(PROVIDER_REV))
	$(call clone_or_pull,repos/auth.policy-verifier,git@github.com:o3co/auth.policy-verifier.git,$(VERIFIER_REV))
	$(call clone_or_pull,repos/provin.auth,git@github.com:provin-line/auth.git,$(PROVIN_REV))

test-provin: setup-provin
	# The pinned utils revision has no tracked lockfile; keep its test lock here.
	cp tests/provin/auth-utils.pnpm-lock.yaml repos/auth.utils/pnpm-lock.yaml
	cd repos/auth.utils && pnpm install --frozen-lockfile && pnpm run build
	cd repos/auth.provider && pnpm install --frozen-lockfile && pnpm --filter @o3co/auth-provider-oauth... run build
	cd repos/auth.policy-verifier && pnpm install --frozen-lockfile && pnpm --filter @o3co/auth.policy-verifier.server... --filter @o3co/auth.policy-verifier.builtins... run build
	node tests/provin/run.mjs

.PHONY: status
status:
	@for dir in repos/auth.provider repos/auth.proxy repos/auth.policy-verifier; do \
		if [ -d "$$dir/.git" ]; then \
			echo "==> $$dir ($$(git -C "$$dir" branch --show-current))"; \
			git -C "$$dir" status -s; \
		fi; \
	done

.PHONY: build
build: setup
	cd repos/auth.provider && pnpm install --frozen-lockfile && pnpm run build
	cd repos/auth.proxy && pnpm install --frozen-lockfile && pnpm run build
	cd repos/auth.policy-verifier && pnpm install --frozen-lockfile && pnpm run build

# One definition of the shared HS256 secret, interpolated into the containers
# by docker compose and exported to the test processes, which mint their own
# tokens with it. Defining it twice is how the suite drifted before: the tests
# fell back to a stale literal and every negative case failed as a 401 that
# read like a policy failure. auth.provider#282 requires >=32 decoded bytes.
export OAUTH_JWT_SECRET := qmV+afsq/SMZ7hPGs9edVQDvPzNmjXemJNjqti181v0=

# Same one-definition rule for the issuer and audience: interpolated into the
# containers by docker compose AND read by the test processes, which pin the
# claims the provider stamps. The tests carried their own fallback literals
# before (o3co/auth#12) — the exact two-definitions drift the secret already
# had. The audience also appears once more in tests/provider/clients.yaml
# (`allowedAudiences`), which is volume-mounted and out of interpolation's
# reach; the comment there names this copy.
export OAUTH_JWT_ISSUER := https://auth.e2e.test
export OAUTH_JWT_AUDIENCE := https://api.e2e.test

.PHONY: test-e2e
test-e2e: build
	docker compose -f tests/docker-compose.yml up -d --build --wait
	cd tests/token-flow && pnpm install --frozen-lockfile && pnpm vitest run
	cd tests/abac && pnpm install --frozen-lockfile && pnpm vitest run
	docker compose -f tests/docker-compose.yml down

# Container logs for a failed run. A target rather than a bare `docker compose
# logs` because compose interpolates OAUTH_JWT_* into the provider service and
# refuses to start without them; only this Makefile exports the values, so a
# workflow step that calls compose directly prints the interpolation error
# instead of the logs it was asked for.
.PHONY: logs
logs:
	docker compose -f tests/docker-compose.yml logs --no-color

.PHONY: clean
clean:
	docker compose -f tests/docker-compose.yml down --remove-orphans 2>/dev/null || true
