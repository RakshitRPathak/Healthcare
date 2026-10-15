#!/bin/sh
# Fresh database + API for the end-to-end run. Needs Postgres and Redis reachable on localhost (see docker-compose.yml).
set -e
cd "$(dirname "$0")/../../server"
PGURL="${E2E_PG_ADMIN_URL:-postgresql://ham:ham@localhost:5432/postgres}"
psql "$PGURL" -qc "DROP DATABASE IF EXISTS ham_e2e WITH (FORCE)" -c "CREATE DATABASE ham_e2e"
export DATABASE_URL="postgresql://ham:ham@localhost:5432/ham_e2e" REDIS_URL="redis://localhost:6379/5" PORT=3100 BCRYPT_COST=4 \
  CLIENT_URL="http://localhost:5174" CORS_ORIGIN="http://localhost:5174" LOG_REQUESTS=false
npx tsx src/seed.ts >/dev/null
exec npx tsx src/index.ts
