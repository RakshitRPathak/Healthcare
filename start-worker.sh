#!/bin/sh
cd "$(dirname "$0")/../../server"
export DATABASE_URL="postgresql://ham:ham@localhost:5432/ham_e2e" REDIS_URL="redis://localhost:6379/5"
redis-cli -n 5 flushdb >/dev/null 2>&1 || true
sleep 6   # wait for the API to create the schema
exec npx tsx src/worker.ts
