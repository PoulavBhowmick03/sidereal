# SPDX-License-Identifier: Apache-2.0
# Convenience targets for the sidereal monorepo (contracts + sdk + app).

.PHONY: help install test contracts-test sdk-test app-test wasm build dev deploy clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

install: ## Install JS workspace dependencies
	pnpm install

test: contracts-test sdk-test app-test ## Run every test suite

contracts-test: ## Run all Soroban contract tests
	cargo test --workspace

sdk-test: ## Typecheck and test the SDK
	pnpm --filter @sidereal/sdk run typecheck
	pnpm --filter @sidereal/sdk test

app-test: ## Typecheck and test the frontend
	pnpm --filter @sidereal/sdk build
	pnpm --filter @sidereal/app run typecheck
	pnpm --filter @sidereal/app test

wasm: ## Build all contracts to wasm release
	cargo build --release --target wasm32v1-none \
		-p sidereal-sy-wrapper -p sidereal-pt-token -p sidereal-yt-token \
		-p sidereal-tokenizer -p sidereal-amm

build: wasm ## Build contracts (wasm), the SDK, and the app
	pnpm --filter @sidereal/sdk build
	pnpm --filter @sidereal/app run build

dev: ## Run the frontend dev server
	pnpm --filter @sidereal/app dev

deploy: ## Deploy the protocol to testnet and wire the frontend
	bash scripts/deploy-testnet.sh

seed: ## Seed the deployed market with activity so the demo shows live numbers
	bash scripts/seed-demo.sh

clean: ## Remove build artifacts
	cargo clean
	rm -rf sdk/dist app/.next
