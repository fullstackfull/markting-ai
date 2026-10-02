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

.PHONY: env up down seed test supabase-start supabase-stop logs stripe-setup stripe-listen

env:
	@test -f .env || cp .env.example .env
	@node infra/scripts/fill-env.mjs .env
	@echo "Wrote .env (gitignored). Review it, then run: make up"

supabase-start:
	cd platform && $(SUPABASE) start
	cd platform && $(SUPABASE) db reset --local --yes
	@node infra/scripts/sync-supabase-env.mjs .env

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
	cd engine && uv run --frozen python -m pytest -q ../services/engine-demo/tests
	node --test infra/scripts/stripe-setup.test.mjs

stripe-setup:
	cd infra && npm install --no-audit --no-fund --silent
	set -a && . ./.env && set +a && node infra/scripts/stripe-setup.mjs --write .env

stripe-listen:
	stripe listen --forward-to localhost:3000/api/billing/webhook
