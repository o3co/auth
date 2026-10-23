# Tested component revisions. Update these deliberately and rerun the full E2E.
PROVIDER_REV := a0adc2416a6e67970c8b24a4e5f92ded416c8c0b
PROXY_REV := f18b1e5519ffab1677c6bedbd7e42d238cacd1a5
VERIFIER_REV := 3c1324c6ecf23473dea67928fbb9c828fd5731f8

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

# auth.provider has no build of its own: its image installs the workspace with
# the pnpm its `packageManager` names and generates the app the suite runs
# (tests/dockerfiles/provider.Dockerfile).
.PHONY: build
build: setup
	cd repos/auth.proxy && pnpm install --frozen-lockfile && pnpm run build
	cd repos/auth.policy-verifier && pnpm install --frozen-lockfile && pnpm run build

# The one definition of the issuer and the audience: interpolated into the
# containers by docker compose and read by the test processes, which pin the
# claims the provider stamps. The issuer is also the provider's public origin,
# where the test processes reach it (the provider service's host port in
# tests/docker-compose.yml), since the provider requires its issuer on its
# public origin. The provider's signing key has its one definition in
# tests/provider/local.conf, and the verifier's public half in
# tests/abac/application.conf.
export OAUTH_JWT_ISSUER := http://localhost:3099
export OAUTH_JWT_AUDIENCE := https://api.e2e.test
# The HS256 provider's issuer and public origin, on its own host port: the
# HS256 pair is a second deployment beside the ES256 one, sharing the audience.
export HS256_ISSUER := http://localhost:3090

# Every run starts from a stack with no state: a failed run stops before the
# last `down`, and a stack left up keeps its redis, whose rate-limit and
# attempt counters then refuse the next run's logins with 429.
.PHONY: test-e2e
test-e2e: build
	docker compose -f tests/docker-compose.yml down -v --remove-orphans
	docker compose -f tests/docker-compose.yml up -d --build --wait
	cd tests/token-flow && pnpm install --frozen-lockfile && pnpm vitest run
	cd tests/abac && pnpm install --frozen-lockfile && pnpm vitest run
	docker compose -f tests/docker-compose.yml down -v

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
