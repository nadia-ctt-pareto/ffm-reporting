// Phase 8a: the remote MCP server endpoint. Mounted as a Next App Router
// catch-all segment (`[transport]`) so `mcp-handler`'s `basePath`-derived
// routing lands the Streamable HTTP transport at `/api/mcp` -- see
// `mcp-handler`'s own `Config.basePath` doc comment: with `basePath: '/api'`
// and this file at `app/api/[transport]/route.ts`, the streamable-HTTP
// endpoint resolves to `/api/mcp` (SSE, disabled below, would otherwise be
// `/api/sse`). Static routes always win over a catch-all segment in Next's
// own router -- `/api/reports`, `/api/projects`, `/api/tokens` are
// unshadowed; verified in `next build`'s route table (see the gates output
// in this PR's summary).
//
// Stateless Streamable HTTP ONLY -- no `sessionIdGenerator` is passed (the
// SDK/`mcp-handler` default), so every request gets a FRESH `McpServer` +
// transport (verified directly in `node_modules/mcp-handler`'s own
// compiled source: each POST constructs `new McpServer(...)` and a new
// `WebStandardStreamableHTTPServerTransport` before calling
// `registerMcpTools`). This is also the specific property CVE-2026-25536
// depends on: reusing a transport across requests is what let one client's
// auth/session leak into another's response. `package.json` pins
// `@modelcontextprotocol/sdk@1.26.0` (the first patched SDK version) +
// `mcp-handler@1.1.0` (the first mcp-handler release that raises its own
// peer-dependency floor to require that fix) specifically for this reason
// -- see this repo's PR summary for the exact `npm audit` before/after.
// SSE is explicitly disabled (`disableSse: true`) -- this app never needs a
// long-lived stateful connection for request/response DB tools, and SSE
// would need Redis on serverless to work correctly at all (see the plan).
//
// Auth: `withMcpAuth(handler, verifyMcpAuth, { required: true })` --
// `required: true` because Phase 8a has no anonymous MCP capability
// whatsoever (every tool needs a user-scoped Supabase client; Phase 8b's
// OAuth layers a token-issuance flow on top without touching this file's
// posture). `verifyMcpAuth` (lib/server/mcp-auth.ts) IS the entire
// auth-to-Supabase-client bridge -- see that file's header comment for the
// full mechanism and security argument. A missing/garbage/revoked/expired
// bearer token -> `verifyMcpAuth` returns `undefined` -> `withMcpAuth`
// returns a 401 with a `WWW-Authenticate` header pointing at
// `/.well-known/oauth-protected-resource` (a Phase 8b route that does not
// exist yet in this phase -- the header is still correct/harmless to send;
// a client that doesn't follow it just sees the 401).
//
// 404, not a 401, when `!isMcpConfigured()` -- this route conceptually does
// not exist without BOTH Supabase configured AND `SUPABASE_JWT_SECRET` set
// (demo mode, or Supabase-mode-without-the-JWT-secret) -- matches every
// other `app/api/**` route's demo-mode-404 convention (see e.g.
// app/api/reports/route.ts's header comment).

import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { NextResponse, type NextRequest } from 'next/server';
import { isMcpConfigured, verifyMcpAuth } from '@/lib/server/mcp-auth';
import { registerMcpTools } from '@/lib/server/mcp-tools';

const mcpHandler = withMcpAuth(
  createMcpHandler(
    (server) => {
      registerMcpTools(server);
    },
    { serverInfo: { name: 'weekly-reports-foundation-first', version: '0.1.0' } },
    { basePath: '/api', maxDuration: 60, disableSse: true }
  ),
  verifyMcpAuth,
  { required: true }
);

async function handler(request: NextRequest): Promise<Response> {
  if (!isMcpConfigured()) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return mcpHandler(request);
}

export { handler as DELETE, handler as GET, handler as POST };
