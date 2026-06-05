/**
 * Magic Engine MCP Server — Streamable HTTP transport endpoint.
 *
 * Phase 34 · P34.0 transport spike. Goal: prove that mcp-handler's
 * Web-standard handler mounts cleanly into a Next.js 14 App Router route
 * handler, builds, and answers a tools/call — BEFORE wiring real auth
 * (P34.1) and real client-data tools (P34.4).
 *
 * Stateless JSON mode (sessionIdGenerator undefined, SSE disabled): each POST
 * is self-contained, no Redis / no long-lived session — the model that fits
 * App Router + Render's request lifecycle (design doc §2.1).
 *
 * Client endpoint: POST /api/mcp/mcp  (basePath /api/mcp + streamable /mcp).
 * Auth: NONE yet — added in P34.1 via withMcpAuth + client_api_keys lookup.
 */
import { createMcpHandler } from 'mcp-handler'
import { z } from 'zod'

const handler = createMcpHandler(
  (server) => {
    server.tool(
      'me_ping',
      'Health check for the Magic Engine MCP server. Returns pong + server ' +
        'time. (P34.0 spike stub — real client-data tools land in P34.4.)',
      { echo: z.string().optional() },
      async ({ echo }) => ({
        content: [
          {
            type: 'text' as const,
            text: `pong${echo ? `: ${echo}` : ''} @ ${new Date().toISOString()}`,
          },
        ],
      }),
    )
  },
  { serverInfo: { name: 'magic-engine', version: '0.0.1-spike' } },
  { basePath: '/api/mcp', disableSse: true, verboseLogs: false },
)

export { handler as GET, handler as POST }

export const dynamic = 'force-dynamic'
export const maxDuration = 60
