#!/usr/bin/env bash
# Builds a throwaway local database from the repo's real migrations, for the
# afiyeat-mcp integration tests. TEST USE ONLY.
#
#   PGHOST=/tmp PGPORT=54329 PGUSER=postgres ./setup_db.sh [dbname]
#
# Drops and recreates the database (default: afiyeat_mcp_test), applies
# supabase_scaffold.sql, then every file in supabase/migrations/ in order.
# pg_cron and pg_net are not available on a plain Postgres, so their
# CREATE EXTENSION lines are skipped; the scaffold stubs the functions the
# migrations call instead.
set -euo pipefail

DB="${1:-afiyeat_mcp_test}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"

psql -v ON_ERROR_STOP=1 -q -d postgres -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)"
psql -v ON_ERROR_STOP=1 -q -d postgres -c "CREATE DATABASE \"$DB\""
# Roles are cluster-wide; the scaffold creates them if missing.
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$HERE/supabase_scaffold.sql"
psql -v ON_ERROR_STOP=1 -q -d "$DB" -c "ALTER DATABASE \"$DB\" SET search_path TO \"\$user\", public, extensions"

# 20260714024532 re-applies these three push-notification migrations in one
# file (see its header and .lovable/plan.md); the originals were never
# applied on their own, and running both fails on CREATE TABLE.
SUPERSEDED="20260713162528_ 20260714020628_ 20260714020715_"

for f in "$ROOT"/supabase/migrations/*.sql; do
  base="$(basename "$f")"
  skip=""
  for s in $SUPERSEDED; do [[ "$base" == "$s"* ]] && skip=1; done
  [[ -n "$skip" ]] && continue
  # Each file runs in one transaction, so a failure leaves nothing half-applied.
  if ! sed -E '/CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net)/Id' "$f" \
      | psql -v ON_ERROR_STOP=1 -q -1 -d "$DB" >/dev/null 2>"$HERE/.last_migration_error"; then
    # Some unrelated migrations were reconciled by hand in production (for
    # example a function whose return type changed without a DROP). Those
    # are reported and skipped, as are Lovable's re-applied copies of
    # hand-written migrations ("already exists"). Any other failure in a
    # migration that touches recipes is fatal, because then the tests would
    # not reflect production RLS. The policy check below is the final guard.
    if grep -qi 'recipes' "$f" && ! grep -q 'already exists' "$HERE/.last_migration_error"; then
      echo "Migration failed (touches recipes): $base" >&2
      cat "$HERE/.last_migration_error" >&2
      exit 1
    fi
    echo "warning: skipped $base ($(grep -m1 ERROR "$HERE/.last_migration_error" | sed 's/.*ERROR: *//'))" >&2
  fi
done
rm -f "$HERE/.last_migration_error"

# The tests depend on these; fail loudly if any is missing.
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
DO $$
DECLARE
  missing TEXT[] := ARRAY[]::TEXT[];
  p TEXT;
BEGIN
  FOREACH p IN ARRAY ARRAY[
    'Users can view own recipes', 'Users can view public recipes',
    'Users can insert own recipes', 'Users can update own recipes',
    'Users can delete own recipes', 'Blocked users cannot view recipes',
    'Hidden recipes are not shown'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recipes' AND policyname = p) THEN
      missing := missing || p;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recipes_user_import_key_key') THEN
    missing := missing || 'recipes_user_import_key_key'::text;
  END IF;
  IF array_length(missing, 1) > 0 THEN
    RAISE EXCEPTION 'Recipe schema incomplete, missing: %', missing;
  END IF;
END $$;
SQL
echo "Database $DB ready (recipe policies and import-key constraint present)"
