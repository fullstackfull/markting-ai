# markting-ai — one-command local stack.
#
#   make env      copy .env.example → .env and fill the random secrets
#   make up       start Supabase (CLI, ./platform) then docker compose (cloud + engine + engine-db)
#   make seed     create the demo workspace (user, operator plan, onboarding, aliases)
#   make down     stop everything
#   make test     run the bridge tests (cloud vitest), the engine-host tests (pytest) and the infra script tests
#   make stripe-setup    create Stripe test products/prices and write their ids into .env
#   make stripe-listen   forward Stripe test webhooks to the local cloud app (needs the Stripe CLI)
#
# Supabase is started with its CLI because adport's migrations need auth.users, pg_cron and the
# adport_backend role, which a plain Postgres image does not provide.

SHELL := /bin/bash
SUPABASE ?= npx --yes supabase@latest
COMPOSE ?= docker compose

# Pin the engine kill-switch outside the vendored engine/workspace so running the engine-demo host
# from tests never leaves engine/workspace/KILL_SWITCH behind and redden the upstream engine suite.
KILL_SWITCH_PATH ?= $(CURDIR)/.cache/markting/KILL_SWITCH

.PHONY: env up down seed test migrate ci supabase-start supabase-stop logs stripe-setup stripe-listen

env:
	@test -f .env || cp .env.example .env
	@node infra/scripts/fill-env.mjs .env
	@echo "Wrote .env (gitignored). Review it, then run: make up"

supabase-start:
	cd platform && $(SUPABASE) start
	cd platform && $(SUPABASE) db reset --local --yes   # LOCAL ONLY: destructive reset of the local dev DB. Never run against a deployed DB.
	@node infra/scripts/sync-supabase-env.mjs .env

# Forward-only schema apply — the sanctioned path for any non-local database. Production deploys run
# this (or `supabase db push`), NEVER `db reset`. Validates that migrations apply cleanly in order.
migrate:
	cd platform && $(SUPABASE) migration up --local

supabase-stop:
	cd platform && $(SUPABASE) stop

up: supabase-start
	$(COMPOSE) up -d --build
	@echo
	@echo "Cloud app:      http://localhost:3000"
	@echo "Supabase Studio http://127.0.0.1:55323   (mail viewer http://127.0.0.1:55324)"
	@echo "Next: make seed   (creates demo@markting.local / see .env MARKTING_DEMO_PASSWORD)"

down:
	-$(COMPOSE) down
	-cd platform && $(SUPABASE) stop

seed:
	cd infra && npm install --no-audit --no-fund --silent
	node infra/seed/seed-demo.mjs .env

logs:
	$(COMPOSE) logs -f --tail=100

test:
	cd platform && pnpm --filter @adport/cloud exec vitest run test/markting-translate.test.ts test/markting-bridge.test.ts test/markting-engine-client.test.ts test/markting-sandbox.test.ts test/markting-snapchat-wire.test.ts test/i18n.test.ts
	cd engine && PAID_MEDIA_KILL_SWITCH_PATH=$(KILL_SWITCH_PATH) uv run --frozen python -m pytest -q ../services/engine-demo/tests
	node --test infra/scripts/stripe-setup.test.mjs

# The full gate CI runs. Non-DB here; the DB-gated authz/isolation/concurrency suites run in the
# root CI workflow against a disposable Postgres (ADPORT_RUN_DATABASE_TESTS=1).
ci:
	cd platform && pnpm install --frozen-lockfile
	cd platform && pnpm -r typecheck
	cd platform && pnpm -r --filter './packages/*' run test
	cd platform && ADPORT_RUN_DATABASE_TESTS=0 pnpm --filter @adport/cloud test
	cd engine && PAID_MEDIA_KILL_SWITCH_PATH=$(KILL_SWITCH_PATH) uv run --frozen ruff check . && uv run --frozen ruff format --check . && uv run --frozen mypy src
	cd engine && uv run --frozen python -m pytest -q
	cd engine && PAID_MEDIA_KILL_SWITCH_PATH=$(KILL_SWITCH_PATH) uv run --frozen python -m pytest -q ../services/engine-demo/tests
	node --test infra/scripts/stripe-setup.test.mjs

stripe-setup:
	cd infra && npm install --no-audit --no-fund --silent
	set -a && . ./.env && set +a && node infra/scripts/stripe-setup.mjs --write .env

stripe-listen:
	stripe listen --forward-to localhost:3000/api/billing/webhook
