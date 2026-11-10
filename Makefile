.PHONY: phone-web lighthouse prod-secrets prod-up prod-admin prod-backup prod-restore-drill prod-down frozen-guard setup dev-web dev-api up down seed lint typecheck test test-web test-api parity contract e2e e2e-real-api walkthrough stack-check fuzz load study-secrets study-up study-admin study-cert study-down licences build

COMPOSE = docker compose -f deploy/docker-compose.yml

setup:
	corepack enable
	pnpm install --frozen-lockfile
	uv sync --frozen
	git config core.hooksPath .githooks

dev-web:
	@echo "The dev server cannot run the real vision workers (D37): a capture here stops at 'Measuring could not start'. To measure on a phone, use: make phone-web"
	pnpm --filter @vt/web dev

dev-api:
	cd apps/api && uv run uvicorn app.main:app --reload --port 8000 --no-access-log

# A phone test with real body detection (A10, D37): the production build on 5174, with /api sent to
# the API on 8000. The dev server can only run the simulated vision. Then: adb reverse tcp:5174 tcp:5174.
phone-web:
	cd apps/web && VITE_FEATURE_DIRECTORY=true pnpm exec vite build --outDir dist-phone
	cd apps/web && pnpm exec vite preview --outDir dist-phone --port 5174 --strictPort --host 0.0.0.0

up:
	$(COMPOSE) up -d --build --wait
	@env_val() { v=$$(printenv "$$1"); [ -n "$$v" ] || v=$$(sed -n "s/^$$1=//p" deploy/.env 2>/dev/null | tail -1); echo "$${v:-$$2}"; }; \
	host=$$(env_val VT_SITE_ADDRESS vt.localhost); port=$$(env_val VT_HTTPS_PORT 443); \
	url="https://$$host"; [ "$$port" = 443 ] || url="$$url:$$port"; \
	echo; echo "Virtual Tailor is running: $$url"; \
	echo "API health: $$url/api/v1/health"; \
	echo "Load the demo data with 'make seed'. Stop the stack with 'make down'."

down:
	$(COMPOSE) down

seed:
	$(COMPOSE) exec api vt seed demo

lint:
	pnpm format:check
	pnpm --filter @vt/web lint
	uv run ruff check .
	uv run ruff format --check .

typecheck:
	pnpm --filter @vt/web typecheck
	pnpm --filter @vt/contracts typecheck
	uv run mypy apps/api/app packages/py/vt_measure/src packages/py/vt_ml/src packages/py/vt_analysis/src

test: test-web test-api

test-web:
	pnpm --filter @vt/web test

test-api:
	uv run pytest apps/api packages/py packages/contracts packages/rules packages/seed packages/parity-fixtures

parity:
	uv run python packages/parity-fixtures/generate.py
	uv run pytest packages/parity-fixtures
	pnpm --filter @vt/web exec vitest run tests/unit/parity.test.ts
	git diff --exit-code -- packages/parity-fixtures/cases
	test -z "$$(git status --porcelain -- packages/parity-fixtures/cases)"

contract:
	uv run python -m openapi_spec_validator packages/contracts/openapi.yaml
	pnpm --filter @vt/contracts generate
	pnpm --filter @vt/contracts typecheck
	uv run python packages/seed/generate.py
	uv run pytest packages/contracts packages/rules packages/seed
	git diff --exit-code -- packages/contracts/src/generated.ts packages/seed/seed.json

e2e:
	pnpm --filter @vt/web e2e

# The browser suites against the API on compose, through Caddy with the production headers (M8, M12).
# Demo data, rate limits off, local or CI only.
E2E_COMPOSE = docker compose -p vt-e2e -f deploy/docker-compose.yml -f deploy/docker-compose.e2e.yml
E2E_BUILD = cd apps/web && VITE_API_MODE=http pnpm exec vite build --mode mock --outDir
e2e-real-api:
	$(E2E_BUILD) dist-real-api
	$(E2E_COMPOSE) up -d --build --wait api caddy
	$(E2E_COMPOSE) exec -T api .venv/bin/vt seed demo
	pnpm --filter @vt/web exec playwright test -c playwright.real-api.config.ts; status=$$?; \
		$(E2E_COMPOSE) down -v; exit $$status

# The backend-spec 15.6 walk-through with screenshots for docs/integration-report.md (M12).
walkthrough:
	$(E2E_BUILD) dist-real-api
	$(E2E_COMPOSE) up -d --build --wait api caddy
	$(E2E_COMPOSE) exec -T api .venv/bin/vt seed demo
	mkdir -p docs/integration
	VT_SHOTS_DIR=$(CURDIR)/docs/integration pnpm --filter @vt/web exec playwright test -c playwright.real-api.config.ts --project real-api; status=$$?; \
		$(E2E_COMPOSE) run --rm jobs .venv/bin/vt jobs retention --dry-run > docs/integration/retention-dry-run.txt 2>/dev/null || status=1; \
		$(E2E_COMPOSE) down -v; exit $$status

# The production build behind Caddy with rate limits on: headers, CSP and limits as deployed (M12).
STACK_COMPOSE = VT_E2E_RATE_LIMITS_OFF=false VT_E2E_DIST=dist-stack VT_E2E_HTTPS_PORT=8454 VT_E2E_API_PORT=8011 \
	docker compose -p vt-stack -f deploy/docker-compose.yml -f deploy/docker-compose.e2e.yml
stack-check:
	cd apps/web && pnpm exec vite build --outDir dist-stack
	$(STACK_COMPOSE) up -d --build --wait api caddy
	$(STACK_COMPOSE) exec -T api .venv/bin/vt seed demo
	VT_STACK_URL=https://localhost:8454 pnpm --filter @vt/web exec playwright test -c playwright.stack.config.ts; status=$$?; \
		$(STACK_COMPOSE) down -v; exit $$status

# Schemathesis on its own stack (M12). Demo data, rate limits off, local or CI only.
FUZZ_COMPOSE = VT_E2E_API_PORT=8012 VT_E2E_HTTPS_PORT=8455 \
	docker compose -p vt-fuzz -f deploy/docker-compose.yml -f deploy/docker-compose.e2e.yml
fuzz:
	$(FUZZ_COMPOSE) up -d --build --wait api
	$(FUZZ_COMPOSE) exec -T api .venv/bin/vt seed demo
	VT_FUZZ_URL=http://127.0.0.1:8012 sh scripts/fuzz.sh; status=$$?; $(FUZZ_COMPOSE) down -v; exit $$status

# The backend-spec 16.4 load test on a stack limited to 2 vCPU and 4 GB (M12). Synthetic data only.
load:
	sh scripts/load.sh

# The study site on the encrypted laptop and the study router (M12, A10). See docs/study-site.md.
study-secrets:
	sh scripts/study.sh secrets
study-up:
	sh scripts/study.sh up
study-admin:
	sh scripts/study.sh admin
study-cert:
	sh scripts/study.sh cert
study-down:
	sh scripts/study.sh down

# The production VM (M16, backend-spec 16). See docs/runbook.md.
prod-secrets:
	sh scripts/prod.sh secrets
prod-up:
	sh scripts/prod.sh up
prod-admin:
	sh scripts/prod.sh admin
prod-backup:
	sh scripts/prod.sh backup
prod-restore-drill:
	sh scripts/prod.sh restore-drill
prod-down:
	sh scripts/prod.sh down

# Lighthouse CI on the built app (frontend-spec 18, M16): accessibility 1.0, interactive <= 3.5 s.
lighthouse:
	sh scripts/lighthouse.sh

licences:
	node scripts/licences.mjs

# Nothing under packages/rules/frozen/ may change once on main (backend-spec 11.7).
frozen-guard:
	sh scripts/frozen_guard.sh

build:
	pnpm --filter @vt/web build
