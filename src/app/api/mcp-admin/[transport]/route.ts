/**
 * Magic Engine MCP ADMIN Server — Streamable HTTP transport endpoint.
 *
 * Phase 34 / P34-P3.5. PHYSICALLY SEPARATE from the client endpoint
 * (/api/mcp/[transport]). Accepts ONLY admin keys (me_admin_*); a client key
 * here → wrong_endpoint → 401. Tools are cross-client (me_admin_*), registered
 * via registerAdminTools, which use admin-scoped-queries (explicit client_id,
 * never the client-only scoped-queries layer).
 *
 * INTERNAL ONLY — never referenced in any client-facing SOP / docs.
 * Client endpoint: /api/mcp/mcp.  Admin endpoint: /api/mcp-admin/mcp.
 *
 * Config MUST mirror the client endpoint (stateless JSON, SSE disabled) to
 * avoid handshake-behaviour drift (魏征 G5).
 */
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import { z } from 'zod'
import {
  extractBearer,
  logMcpAccess,
  requireAdminContext,
  verifyApiKey,
} from '@/lib/auth/api-key-access'
import { registerAdminTools } from '@/lib/mcp/admin-tools'

const baseHandler = createMcpHandler(
  (server) => {
    // Health check — exercises requireAdminContext chokepoint.
    server.tool(
      'me_admin_ping',
      'Health check for the Magic Engine ADMIN MCP server. Returns pong + time.',
      { echo: z.string().optional() },
      async ({ echo }, { authInfo }) => {
        const { adminKeyId } = requireAdminContext(authInfo)
        logMcpAccess({ kind: 'admin', keyId: adminKeyId, tool: 'me_admin_ping', ok: true })
        return {
          content: [
            { type: 'text' as const, text: `pong (admin)${echo ? `: ${echo}` : ''} @ ${new Date().toISOString()}` },
          ],
        }
      },
    )

    // 5 cross-client admin tools (P34-P3.5).
    registerAdminTools(server)
  },
  { serverInfo: { name: 'magic-engine-admin', version: '0.0.1' } },
  { basePath: '/api/mcp-admin', disableSse: true, verboseLogs: false },
)

const handler = withMcpAuth(
  baseHandler,
  async (req): Promise<AuthInfo | undefined> => {
    const token = extractBearer(req.headers.get('authorization'))
    const sourceIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    // expectedKind 'admin' (Z1): a client key here → wrong_endpoint → rejected.
    const result = await verifyApiKey(token, { expectedKind: 'admin', sourceIp })
    if (!result.ok || result.auth.kind !== 'admin') return undefined
    return {
      token: token ?? '',
      clientId: result.auth.keyId, // OAuth-level identifier
      scopes: result.auth.scopes,
      extra: {
        kind: 'admin',
        adminKeyId: result.auth.keyId,
        ownerEmail: result.auth.ownerEmail,
      },
    }
  },
  { required: true },
)

export { handler as GET, handler as POST, handler as DELETE }

export const dynamic = 'force-dynamic'
export const maxDuration = 60
