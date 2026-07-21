#!/usr/bin/env bash
# Applies supabase/migrations/*.sql (in filename order) to the linked remote
# Supabase project via the Management API, recording each in
# supabase_migrations.schema_migrations so a future `supabase db push` stays in
# sync. Reads the access token + project ref from ./.env.deploy (gitignored) --
# no secret is stored in this file. Idempotent per-migration (skips versions
# already recorded), so it is safe to re-run.
#
# Usage:  bash scripts/apply-remote-migrations.sh
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env.deploy; set +a
: "${SUPABASE_ACCESS_TOKEN:?set in .env.deploy}"
: "${SUPABASE_PROJECT_REF:?set in .env.deploy}"

API="https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query"
AUTH="Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}"

# JSON-encode a literal SQL string / a whole SQL file safely (handles $$ quoting,
# newlines, embedded quotes) via node -- no jq dependency.
enc_str()  { node -e 'process.stdout.write(JSON.stringify({query:process.argv[1]}))' "$1"; }
enc_file() { node -e 'const fs=require("fs");process.stdout.write(JSON.stringify({query:fs.readFileSync(process.argv[1],"utf8")}))' "$1"; }
run()      { curl -s -w $'\n%{http_code}' -X POST "$API" -H "$AUTH" -H "Content-Type: application/json" -d "$1"; }
# the Management API query endpoint returns 200 OR 201 on success
ok()       { [ "$1" = "200" ] || [ "$1" = "201" ]; }

echo ">> ensuring migration-history table"
resp=$(run "$(enc_str "create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations (version text primary key, name text, inserted_at timestamptz default now());")")
ok "$(printf '%s' "$resp" | tail -n1)" || { echo "FAILED: $resp"; exit 1; }

# versions already applied (as a newline list)
applied=$(run "$(enc_str "select version from supabase_migrations.schema_migrations")" | sed '$d' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{JSON.parse(s).forEach(r=>console.log(r.version))}catch(e){}})')

for f in $(ls -1 supabase/migrations/*.sql | sort); do
  base=$(basename "$f" .sql); version=${base%%_*}; name=${base#*_}
  if printf '%s\n' "$applied" | grep -qx "$version"; then echo "-- skip $base (already applied)"; continue; fi
  printf ">> apply %s ... " "$base"
  resp=$(run "$(enc_file "$f")"); code=$(printf '%s' "$resp" | tail -n1)
  if ! ok "$code"; then echo "FAILED ($code): $(printf '%s' "$resp" | sed '$d' | head -c 500)"; exit 1; fi
  run "$(enc_str "insert into supabase_migrations.schema_migrations (version,name) values ('${version}','${name}') on conflict (version) do nothing")" >/dev/null
  echo "OK"
done

echo ">> done. public tables now:"
run "$(enc_str "select tablename from pg_tables where schemaname='public' order by tablename")" | sed '$d'
echo ""
