#!/usr/bin/env bash
# Enables the "Before User Created" Postgres Auth Hook on the hosted Supabase
# project (mirrors supabase/config.toml [auth.hook.before_user_created], which
# only applies to the LOCAL stack). Without this, public.before_user_created_hook
# never runs on the hosted project, so the signup-domain allowlist is NOT
# enforced -- anyone could sign up. Reads the token/ref from ./.env.deploy
# (gitignored). Prints the hook config before and after so you can confirm.
#
# Usage:  bash scripts/enable-auth-hook.sh
#
# If the API key names ever change and "after" still shows disabled, set it
# manually: hosted dashboard -> Authentication -> Hooks -> Before User Created
# -> Postgres -> function public.before_user_created_hook -> Enable.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env.deploy; set +a
API="https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/config/auth"
AUTH="Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}"

show() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let c;try{c=JSON.parse(s)}catch(e){console.log(s);return}const o={};for(const k in c)if(k.toLowerCase().includes("before_user_created"))o[k]=c[k];console.log(JSON.stringify(o,null,2))})'; }

echo ">> before:"
curl -s "$API" -H "$AUTH" | show

echo ">> enabling before_user_created hook -> public.before_user_created_hook"
curl -s -X PATCH "$API" -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"hook_before_user_created_enabled":true,"hook_before_user_created_uri":"pg-functions://postgres/public/before_user_created_hook"}' \
  -o /dev/null -w "   PATCH -> HTTP %{http_code}\n"

echo ">> after (hook_before_user_created_enabled should be true):"
curl -s "$API" -H "$AUTH" | show
