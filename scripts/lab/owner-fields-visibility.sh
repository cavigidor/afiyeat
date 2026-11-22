#!/usr/bin/env bash
# Lab check for db/proposals/lists_v2_owner_fields.sql on a real, throwaway Postgres server (two sessions).
# Never connects anywhere else: it creates a temporary cluster on a local socket and deletes it at the end.
#
# What it shows:
#   1. While the file runs, another session cannot see or use either new table, even in the window after
#      the table grants and before row-level security is switched on.
#   2. If the file fails part-way, nothing is left behind (tables, functions, policies, triggers).
#   3. When it succeeds, all nine postchecks pass, including the exact-text digest.
#
# Needs the Postgres server binaries (initdb, pg_ctl, postgres, psql). Run from the repository root:
#   bash scripts/lab/owner-fields-visibility.sh            (PGBIN=/path/to/bin to choose a version)
set -euo pipefail

PGBIN=${PGBIN:-$(dirname "$(command -v pg_ctl || ls /usr/lib/postgresql/*/bin/pg_ctl 2>/dev/null | tail -1)")}
SQL=db/proposals/lists_v2_owner_fields.sql
POSTCHECK=db/proposals/lists_v2_owner_fields_postcheck.sql
STUBS=tests/fixtures/supabase-stubs.sql
WORK=$(mktemp -d)
fail() { echo "FAIL: $*"; exit 1; }

"$PGBIN/initdb" -D "$WORK/data" -U postgres -A trust >/dev/null
"$PGBIN/pg_ctl" -D "$WORK/data" -o "-k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null
trap '"$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT
echo "Postgres $("$PGBIN/postgres" --version | awk '{print $3}') on a temporary socket"

export PGOPTIONS='-c client_min_messages=error'
psql_() { "$PGBIN/psql" -h "$WORK" -U postgres -d "$1" -X -q -At -v ON_ERROR_STOP=1 "${@:2}"; }

# The Supabase stand-ins the in-process tests use (roles are cluster-wide, so they are created once), plus the
# two existing tables the file refers to. Like Supabase, new public tables are granted to anon and
# authenticated by default: the file's REVOKE is what takes that away.
psql_ postgres -f <(grep '^CREATE ROLE' "$STUBS") >/dev/null
fresh_db() {
  psql_ postgres -c "DROP DATABASE IF EXISTS lab" -c "CREATE DATABASE lab"
  psql_ lab -f <(grep -v '^CREATE ROLE' "$STUBS") >/dev/null
  psql_ lab -c "CREATE TABLE public.custom_lists (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL)" \
    -c "CREATE TABLE public.custom_list_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), list_id uuid NOT NULL REFERENCES public.custom_lists(id) ON DELETE CASCADE)" >/dev/null
}

# A copy of the file with a pause (and optionally an error) inserted after the line that matches $1.
variant() { awk -v at="$1" -v extra="$2" '{print} index($0, at) == 1 {print "SELECT pg_sleep(3);"; if (extra != "") print extra}' "$SQL"; }
GRANT_LINE='GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_list_owner_settings'
LAST_GRANT='GRANT EXECUTE ON FUNCTION public.export_my_list_owner_data() TO authenticated;'

probe() { # what a second session sees right now
  psql_ lab -c "SELECT coalesce(to_regclass('public.custom_list_owner_settings')::text, '-') || ',' || coalesce(to_regclass('public.custom_list_item_owner_values')::text, '-')"
  for role in anon authenticated; do
    psql_ lab -c "SET ROLE $role" -c "SELECT count(*) FROM public.custom_list_owner_settings" 2>&1 | grep -m1 -E "ERROR|^[0-9]+$" | sed "s/^/  as $role: /" || true
  done
}
leftovers() {
  psql_ lab -c "SELECT (SELECT count(*) FROM pg_class WHERE relname IN ('custom_list_owner_settings', 'custom_list_item_owner_values'))
    + (SELECT count(*) FROM pg_proc WHERE proname LIKE 'lv2\_%' OR proname IN ('count_custom_list_field_values', 'delete_custom_list_field', 'export_my_list_owner_data'))
    + (SELECT count(*) FROM pg_policies WHERE tablename IN ('custom_list_owner_settings', 'custom_list_item_owner_values'))
    + (SELECT count(*) FROM pg_trigger WHERE tgname IN ('lv2_check_owner_values', 'lv2_guard_field_removal'))"
}

for where in "$GRANT_LINE" "$LAST_GRANT"; do
  label=$([ "$where" = "$GRANT_LINE" ] && echo "after the table grants, before row-level security" || echo "after the last statement, before COMMIT")
  echo; echo "== Success run, paused $label"
  fresh_db
  variant "$where" "" > "$WORK/run.sql"
  psql_ lab -f "$WORK/run.sql" > "$WORK/a.out" 2>&1 & A=$!
  sleep 1.5
  seen=$(probe); echo "$seen" | sed 's/^/  second session: /'
  echo "$seen" | head -1 | grep -qx -- '-,-' || fail "another session could see a new table mid-migration"
  echo "$seen" | grep -q 'as anon: .*does not exist' || fail "anon was not refused mid-migration"
  echo "$seen" | grep -q 'as authenticated: .*does not exist' || fail "authenticated was not refused mid-migration"
  wait $A || { cat "$WORK/a.out"; fail "the file did not apply"; }
  bad=$(psql_ lab -f "$POSTCHECK" | grep -c '|f$' || true)
  [ "$bad" = 0 ] || { psql_ lab -f "$POSTCHECK"; fail "$bad postcheck(s) false"; }
  echo "  after COMMIT: all 9 postchecks true (digest 4816778c included)"
  psql_ lab -c "SET ROLE anon" -c "SELECT 1 FROM public.custom_list_owner_settings" >/dev/null 2>&1 && fail "anon can read after COMMIT"
  echo "  after COMMIT: anon refused"
done

echo; echo "== Failure run: paused after the table grants, then an error before COMMIT"
fresh_db
variant "$GRANT_LINE" "SELECT 1/0;" > "$WORK/run.sql"
psql_ lab -f "$WORK/run.sql" > "$WORK/a.out" 2>&1 & A=$!
sleep 1.5
seen=$(probe); echo "$seen" | sed 's/^/  second session: /'
echo "$seen" | head -1 | grep -qx -- '-,-' || fail "another session could see a new table mid-migration"
if wait $A; then fail "the broken copy did not fail"; fi
grep -m1 -o 'division by zero' "$WORK/a.out" | sed 's/^/  the run stopped: /'
n=$(leftovers); [ "$n" = 0 ] || fail "$n objects left behind after the failure"
echo "  after the failure: 0 tables, functions, policies or triggers left"

echo; echo "RESULT: PASS"
