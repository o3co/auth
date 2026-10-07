# Tested component revisions. Update these deliberately and rerun the full E2E.
PROVIDER_REV := 5708b53e2843db65b2a4b2d1de025776be5f6ceb
PROXY_REV := 154d18ee67f0399360e46fef1a6d664374b758fe
VERIFIER_REV := 40be375c6bf802740a855dec9c98189e778075a0

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

# The one definition of the shared HS256 secret, interpolated into the
# containers by docker compose and exported to the test processes, which mint
# their own tokens with it. A second copy can drift, and every negative case
# then fails as a 401 that reads like a policy failure. The provider requires
# at least 32 bytes once decoded.
export OAUTH_JWT_SECRET := qmV+afsq/SMZ7hPGs9edVQDvPzNmjXemJNjqti181v0=

# The same one-definition rule for the issuer and audience: interpolated into
# the containers by docker compose and read by the test processes, which pin
# the claims the provider stamps. The audience appears again in every
# `allowedAudiences` of tests/provider/clients.yaml, which is volume-mounted
# and out of interpolation's reach; the comment there names this copy.
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
