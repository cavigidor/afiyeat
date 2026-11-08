#!/usr/bin/env bash
# Runs the afiyeat-mcp tests. TEST USE ONLY: never points at the real project.
#
#   supabase/tests/afiyeat-mcp/run_tests.sh          # unit + end-to-end
#   supabase/tests/afiyeat-mcp/run_tests.sh unit     # unit tests only
#
# Needs deno, psql, a local Postgres 16 (PGHOST/PGPORT/PGUSER) and a
# PostgREST binary (POSTGREST_BIN or `postgrest` on PATH). See README.md.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

# The repo root has a package.json for the web app; these are Deno files.
DENO_FLAGS=(--no-lock --node-modules-dir=none --no-config)

deno test --allow-env "${DENO_FLAGS[@]}" recipes_test.ts
[[ "${1:-}" == "unit" ]] && exit 0

./setup_db.sh "${TEST_DB:-afiyeat_mcp_test}"
deno test --allow-all "${DENO_FLAGS[@]}" mcp_e2e_test.ts
