#!/usr/bin/env bash
# Mode-A production migration deploy — FORWARD-ONLY, no destructive reset. Operator-run.
# Requires: SUPABASE_DB_URL (or a linked supabase project) pointing at the production/staging DB.
set -euo pipefail
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL must be set to the target database}"
echo "Applying migrations forward-only to the target database (no reset)…"
# supabase CLI applies only un-applied migrations; it never resets.
npx --yes supabase@latest migration up --db-url "$SUPABASE_DB_URL"
echo "Done. Verify RLS/grants/indexes, then run the DB-gated suite against a production-compatible staging DB:"
echo "  ADPORT_RUN_DATABASE_TESTS=1 pnpm --filter @adport/cloud test"
