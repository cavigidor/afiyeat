#!/usr/bin/env bash
# Starts a throwaway Postgres for the two-connection tests: Unix socket only (no TCP listener),
# trust auth, data under /tmp. Nothing here can reach Supabase, Lovable or any network host.
set -euo pipefail
BIN=${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}
DIR=${E0_LOCAL_PG_SOCKET:-/tmp/e0pg}
PORT=${E0_LOCAL_PG_PORT:-54329}
RUN=()
if [ "$(id -u)" = 0 ]; then id e0pg >/dev/null 2>&1 || useradd -M e0pg; RUN=(runuser -u e0pg --); fi
if [ ! -s "$DIR/data/PG_VERSION" ]; then
  mkdir -p "$DIR"; [ ${#RUN[@]} -gt 0 ] && chown e0pg "$DIR"
  "${RUN[@]}" "$BIN/initdb" -D "$DIR/data" -U postgres -A trust >/dev/null
fi
"${RUN[@]}" "$BIN/pg_ctl" -D "$DIR/data" -w -o "-p $PORT -k $DIR -c listen_addresses=''" -l "$DIR/log" start >/dev/null || true
"$BIN/pg_isready" -h "$DIR" -p "$PORT"
