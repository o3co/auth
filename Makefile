define clone_or_pull
	@if [ -d "$(1)/.git" ]; then \
		echo "==> $(1) (already cloned, pulling)"; \
		git -C "$(1)" pull; \
	else \
		echo "==> Cloning $(2) -> $(1)"; \
		git clone "$(2)" "$(1)"; \
	fi
endef

.PHONY: setup
setup:
	$(call clone_or_pull,repos/auth.provider,git@github.com:o3co/auth.provider.git)
	$(call clone_or_pull,repos/auth.proxy,git@github.com:o3co/auth.proxy.git)
	$(call clone_or_pull,repos/auth.policy-verifier,git@github.com:o3co/auth.policy-verifier.git)

.PHONY: pull
pull:
	@for dir in repos/auth.provider repos/auth.proxy repos/auth.policy-verifier; do \
		if [ -d "$$dir/.git" ]; then \
			echo "==> Pulling $$dir"; \
			git -C "$$dir" pull; \
		else \
			echo "==> $$dir not cloned (run 'make setup')"; \
		fi; \
	done

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
	cd repos/auth.provider && pnpm install && pnpm run build
	cd repos/auth.proxy && pnpm install && pnpm run build
	cd repos/auth.policy-verifier && pnpm install && pnpm run build

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
	cd tests/token-flow && pnpm install && pnpm vitest run
	cd tests/abac && pnpm install && pnpm vitest run
	docker compose -f tests/docker-compose.yml down

.PHONY: clean
clean:
	docker compose -f tests/docker-compose.yml down 2>/dev/null || true
