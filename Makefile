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

.PHONY: test-e2e
test-e2e: build
	docker compose -f tests/docker-compose.yml up -d --build --wait
	cd tests/token-flow && pnpm install && pnpm vitest run
	docker compose -f tests/docker-compose.yml down

.PHONY: clean
clean:
	docker compose -f tests/docker-compose.yml down 2>/dev/null || true
