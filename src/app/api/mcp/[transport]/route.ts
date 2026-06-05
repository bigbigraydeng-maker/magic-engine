/**
 * Magic Engine MCP Server — Streamable HTTP transport endpoint.
 *
 * Phase 34. After P34.0 (spike) + P34.1 (auth), the route is gated by
 * per-client API keys: every request must carry
 * `Authorization: Bearer me_live_<...>`, which is sha256'd and looked up
 * in `client_api_keys` to derive the locked `client_id`.
 *
 * Stateless JSON mode (sessionIdGenerator undefined, SSE disabled): each POST
 * is self-contained, no Redis / no long-lived session — the model that fits
 * App Router + Render's request lifecycle (design doc §2.1).
 *
 * Client endpoint: POST /api/mcp/mcp  (basePath /api/mcp + streamable /mcp).
 *
 * Real client-data tools land in P34.4 with scoped-queries enforcing
 * client_id at the innermost layer (design doc §6.1, 子牙 B5).
 */
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import { z } from 'zod'
import {
  logMcpAccess,
  verifyApiKey,
} from '@/lib/auth/api-key-access'

const baseHandler = createMcpHandler(
  (server) => {
    server.tool(
      'me_ping',
      'Health check for the Magic Engine MCP server. Returns pong + server ' +
        'time. (P34.0/1 stub — real client-data tools land in P34.4.)',
      { echo: z.string().optional() },
      async ({ echo }, { authInfo }) => {
        // authInfo is populated by withMcpAuth below; we always log access so
        // the access log doubles as audit + rate-limit source + future
        // billing aggregation (design doc §6.5).
        if (authInfo?.extra) {
          const meClientId = authInfo.extra.meClientId as string | undefined
          const keyId = authInfo.extra.keyId as string | undefined
          if (meClientId && keyId) {
            logMcpAccess({
              keyId,
              clientId: meClientId,
              tool: 'me_ping',
              ok: true,
            })
          }
        }
        return {
          content: [
            {
              type: 'text' as const,
              text: `pong${echo ? `: ${echo}` : ''} @ ${new Date().toISOString()}`,
            },
          ],
        }
      },
    )
  },
  { serverInfo: { name: 'magic-engine', version: '0.0.1' } },
  { basePath: '/api/mcp', disableSse: true, verboseLogs: false },
)

const handler = withMcpAuth(
  baseHandler,
  async (_req, bearerToken): Promise<AuthInfo | undefined> => {
    const result = await verifyApiKey(bearerToken)
    if (!result.ok) return undefined
    // OAuth-shaped AuthInfo: `clientId` is OAuth's "issuing app" concept and
    // NOT our ME client_id. We stash both keyId and the locked ME client_id
    // in `extra.meClientId` so tool callbacks (P34.4) can read them safely.
    return {
      token: bearerToken ?? '',
      clientId: result.auth.keyId, // OAuth-level identifier, not ME client_id
      scopes: result.auth.scopes,
      extra: {
        meClientId: result.auth.clientId,
        keyId: result.auth.keyId,
      },
    }
  },
  { required: true },
)

export { handler as GET, handler as POST, handler as DELETE }

export const dynamic = 'force-dynamic'
export const maxDuration = 60
