.PHONY: setup dev-web dev-api up down seed lint typecheck test test-web test-api parity contract e2e licences build

COMPOSE = docker compose -f deploy/docker-compose.yml

setup:
	corepack enable
	pnpm install --frozen-lockfile
	uv sync --frozen

dev-web:
	pnpm --filter @vt/web dev

dev-api:
	cd apps/api && uv run uvicorn app.main:app --reload --port 8000 --no-access-log

up:
	$(COMPOSE) up -d --build --wait

down:
	$(COMPOSE) down

seed:
	@echo "make seed arrives in M4"

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
	uv run pytest apps/api packages/py packages/contracts packages/rules packages/seed

parity:
	@echo "make parity arrives in M2"

contract:
	uv run python -m openapi_spec_validator packages/contracts/openapi.yaml
	pnpm --filter @vt/contracts generate
	pnpm --filter @vt/contracts typecheck
	uv run python packages/seed/generate.py
	uv run pytest packages/contracts packages/rules packages/seed
	git diff --exit-code -- packages/contracts/src/generated.ts packages/seed/seed.json

e2e:
	pnpm --filter @vt/web e2e

licences:
	node scripts/licences.mjs

build:
	pnpm --filter @vt/web build
