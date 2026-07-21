#!/usr/bin/env bash
# Prints the Production environment variables to paste into Vercel
# (Settings -> Environment Variables). Fetches the project's anon/publishable
# key from the Supabase Management API using the token in ./.env.deploy
# (gitignored). The anon key is a public client key by design, so printing it
# is fine. No secret from this script is committed.
#
# Usage:  bash scripts/print-vercel-env.sh
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env.deploy; set +a

resp=$(curl -s "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/api-keys?reveal=true" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}")

anon=$(printf '%s' "$resp" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  let a; try{a=JSON.parse(s)}catch(e){process.stderr.write("Could not parse Supabase api-keys response:\n"+s+"\n");process.exit(1)}
  const list=Array.isArray(a)?a:(a.keys||[]);
  // prefer the legacy JWT-format anon key (works with @supabase/supabase-js as-is)
  const pick=list.find(k=>(k.name||k.id||"").toLowerCase()==="anon")
          || list.find(k=>(k.type||"").toLowerCase()==="anon")
          || list.find(k=>(k.name||"").toLowerCase().includes("anon")
                       ||(k.type||"").toLowerCase()==="publishable");
  const val=pick&&(pick.api_key||pick.secret||pick.value||pick.hash);
  if(!val){process.stderr.write("Could not find an anon/publishable key in:\n"+JSON.stringify(list,null,2)+"\n");process.exit(1)}
  process.stdout.write(val);
})')

cat <<EOF

Paste these into Vercel -> your project -> Settings -> Environment Variables,
target "Production" (add "Preview" too if you use branch previews), then Redeploy:

NEXT_PUBLIC_SUPABASE_URL=${SUPABASE_URL}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${anon}
AI_BYOK_ENCRYPTION_KEY=ur3Lb5waHiz+cXwAF2xL5BqnZJoQWMrIcT4EQIXTm/c=

(The MCP server also needs SUPABASE_JWT_SECRET -- the Supabase->Vercel
integration provides that one, or grab it from the Supabase dashboard:
Settings -> API -> JWT Settings -> "JWT Secret". Not required for the build
to pass; only for /api/mcp to work.)
EOF
