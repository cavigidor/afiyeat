#!/usr/bin/env bash
# Load the reconstructed baseline into the ISOLATED project, in order, stopping at the first error.
#   ISOLATED_DB_URL='postgresql://postgres:...@db.<isolated ref>.supabase.co:5432/postgres' \
#     e0/baseline/load-baseline.sh build/baseline
# Refuses to run if the connection string names the production project.
set -euo pipefail
dir="${1:?usage: load-baseline.sh <baseline dir>}"
: "${ISOLATED_DB_URL:?set ISOLATED_DB_URL to the isolated project connection string}"
case "$ISOLATED_DB_URL" in *dmlkjpjubneqhbqoxlct*) echo "Refusing: this is the production project." >&2; exit 3;; esac
for f in $(ls "$dir"/[0-9][0-9][0-9]_*.sql | sort); do
  echo "applying $(basename "$f")"
  psql "$ISOLATED_DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done
echo "Baseline loaded. Next: record these versions as applied (README step 4)."
