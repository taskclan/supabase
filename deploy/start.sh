#!/bin/sh
# Start the console.
#
# Two processes, because Studio's database screens are not self-contained: the
# Table editor, the SQL editor and every schema view go through pg-meta over
# HTTP. Upstream's docker-compose runs it as its own service; here it shares the
# container, which keeps the encrypted connection strings on loopback instead of
# putting them on the public internet between two Cloudflare containers.
#
# pg-meta is a child, not PID 1. Next is the thing the edge health-checks, so it
# gets PID 1 and the signals.
set -e

PG_META_PORT="${PG_META_PORT:-8090}"
PG_META_HOST="${PG_META_HOST:-127.0.0.1}"
export PG_META_PORT PG_META_HOST

META="/app/pgmeta/node_modules/@supabase/postgres-meta/dist/server/server.js"
if [ -f "$META" ]; then
  node "$META" &
  echo "[console] pg-meta on ${PG_META_HOST}:${PG_META_PORT} (pid $!)"
else
  # Not fatal: the console's Cloud screens work without it, and a container that
  # refuses to start tells the operator far less than one that starts and says
  # what is missing. The database screens will return errors, which is the
  # honest outcome.
  echo "[console] WARNING: pg-meta is not in this image — database screens will fail"
fi

cd /app/apps/studio
exec node server.js
