#!/usr/bin/env bash
# Local-only checks for the daily-notification migration. Starts a throwaway
# Postgres in a temp directory (never touches a real project), applies
# harness.sql + the migration twice, then runs checks.sql and a concurrency
# test. Needs Postgres 15+ server binaries (initdb, pg_ctl) and psql.
#   PG_BIN=/usr/lib/postgresql/16/bin supabase/tests/daily-notifications/run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
migration="$here/../../migrations/20261118120000_good_morning_fun_facts_and_city_explore.sql"
PG_BIN="${PG_BIN:-$(dirname "$(command -v pg_ctl || echo /usr/lib/postgresql/16/bin/pg_ctl)")}"
port="${PGPORT_TEST:-55432}"
dir="$(mktemp -d)"
chmod 755 "$dir"

as_pg() { if [ "$(id -u)" = 0 ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
[ "$(id -u)" = 0 ] && chown postgres "$dir"
cleanup() { as_pg "'$PG_BIN/pg_ctl' -D '$dir/data' -m immediate stop" >/dev/null 2>&1 || true; rm -rf "$dir"; }
trap cleanup EXIT

as_pg "'$PG_BIN/initdb' -D '$dir/data' -A trust -U postgres" >/dev/null
as_pg "'$PG_BIN/pg_ctl' -D '$dir/data' -o '-p $port -k $dir' -l '$dir/log' -w start" >/dev/null
psql=(psql -h "$dir" -p "$port" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)

"${psql[@]}" -f "$here/harness.sql" >/dev/null
"${psql[@]}" -f "$migration" >/dev/null 2>&1
"${psql[@]}" -f "$migration" >/dev/null 2>&1   # re-applying must be harmless
echo "ok  0  migration applies cleanly, and applies again without error"

"${psql[@]}" -v msgs="$(cat "$here/messages.json")" -f "$here/checks.sql" | grep -E "^(ok|FAIL)"

# 8. Two cron runs overlapping: the second must wait for the first and then
#    send nothing. 13:00Z = 07:00 in Chicago (users 1, 20, 21 are Chicago).
"${psql[@]}" -c "update public.profiles set timezone = 'America/Chicago' where user_id = '00000000-0000-0000-0000-000000000001'; update public.device_tokens set user_id = '00000000-0000-0000-0000-000000000001' where token = 'tok-1'; truncate public.sent_log;" >/dev/null
"${psql[@]}" -c "begin; select set_config('test.now', '2027-02-01 13:00Z', true); select public.send_good_morning_fun_fact('2027-02-01 13:00Z'); select pg_sleep(3); commit;" >/dev/null &
first=$!
sleep 1
"${psql[@]}" -c "select set_config('test.now', '2027-02-01 13:00Z', false); select public.send_good_morning_fun_fact('2027-02-01 13:00Z');" >/dev/null
wait "$first"
read -r total distinct_users < <("${psql[@]}" -At -F ' ' -c "select count(*), count(distinct user_id) from public.sent_log")
if [ "$total" != "$distinct_users" ] || [ "$total" = 0 ]; then
  echo "FAIL 8  overlapping runs sent $total pushes to $distinct_users users"; exit 1
fi
echo "ok  8  overlapping cron runs: second run waits, then sends nothing ($total pushes, $distinct_users users)"
echo "all checks passed"
