/**
 * Magic Engine MCP Server — Streamable HTTP transport endpoint.
 *
 * Phase 34. After P34.0 (spike) + P34.1 (auth), the route is gated by
 * per-client API keys: every request must carry
 * `Authorization: Bearer me_live_<...>`, which is sha256'd and looked up
 * in `client_api_keys` to derive the locked `client_id`.
 *
 * Stateless Streamable HTTP (sessionIdGenerator undefined, persistent SSE disabled): each POST
 * is self-contained, no Redis / no long-lived session — the model that fits
 * App Router + Render's request lifecycle (design doc §2.1).
 *
 * Client endpoint: POST /api/mcp/mcp  (basePath /api/mcp + streamable /mcp).
 *
 * Tools: me_ping (health check) + 5 read-only client-data tools registered
 * via registerReadOnlyTools, which enforce client_id at the innermost
 * scoped-queries layer (design doc §6.1, 子牙 B5).
 */
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import { z } from 'zod'
import {
  extractBearer,
  logMcpAccess,
  requireMeClientId,
  verifyApiKey,
} from '@/lib/auth/api-key-access'
import { registerReadOnlyTools } from '@/lib/mcp/tools'
import { registerMetaAdsTools } from '@/lib/meta/ai/mcp'
import { META_ADS_SCOPE } from '@/lib/meta/ai/contract'
import { boundedBody, failure } from '@/lib/meta/ai/http'
import { readGrant, activeConnection, reserveRead } from '@/lib/meta/ai/store'
import { requirePilotActive } from '@/lib/meta/ai/entitlement'

const baseHandler = createMcpHandler(
  (server) => {
    // Health check — also exercises the requireMeClientId chokepoint.
    server.tool(
      'me_ping',
      'Health check for the Magic Engine MCP server. Returns pong + server time.',
      { echo: z.string().optional() },
      async ({ echo }, { authInfo }) => {
        const { meClientId, keyId } = requireMeClientId(authInfo)
        logMcpAccess({ keyId, clientId: meClientId, tool: 'me_ping', ok: true })
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

    // 5 read-only client-data tools (P34.4).
    registerReadOnlyTools(server)
  },
  { serverInfo: { name: 'magic-engine', version: '0.0.1' } },
  { basePath: '/api/mcp', disableSse: true, verboseLogs: false },
)

const legacyHandler = withMcpAuth(
  baseHandler,
  async (req): Promise<AuthInfo | undefined> => {
    // Take over bearer parsing ourselves: extractBearer tolerates multi-space
    // / casing, rather than relying on mcp-handler's internal split(" ").
    const token = extractBearer(req.headers.get('authorization'))
    const sourceIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    // expectedKind 'client' (Z1): an admin key here → wrong_endpoint → rejected.
    const result = await verifyApiKey(token, { expectedKind: 'client', sourceIp })
    if (!result.ok || result.auth.kind !== 'client' || !result.auth.scopes.includes('read:all') || result.auth.scopes.includes(META_ADS_SCOPE)) return undefined
    // OAuth-shaped AuthInfo: `clientId` is OAuth's "issuing app" concept and
    // NOT our ME client_id. We stash kind + ME client_id in extra so tool
    // callbacks read them via requireMeClientId (which throws if missing).
    return {
      token: token ?? '',
      clientId: result.auth.keyId, // OAuth-level identifier, not ME client_id
      scopes: result.auth.scopes,
      extra: {
        kind: 'client',
        meClientId: result.auth.clientId,
        keyId: result.auth.keyId,
      },
    }
  },
  { required: true },
)

/** Build the catalogue per authenticated request; no cross-key tool discovery. */
async function handler(request: Request): Promise<Response> {
  const token = extractBearer(request.headers.get('authorization'))
  const result = await verifyApiKey(token, { expectedKind: 'client' })
  if (!result.ok || result.auth.kind !== 'client') return new Response('Unauthorised',{ status:401 })
  const principal = result.auth
  if (!principal.scopes.includes(META_ADS_SCOPE)) return legacyHandler(request)
  try {
    await requirePilotActive(principal.clientId)
    if(request.method==='POST') {
      const body=await boundedBody(request)
      request=new Request(request.url,{ method:'POST',headers:request.headers,body:JSON.stringify(body) })
    }
    await reserveRead(principal.clientId)
  } catch(error) { return failure(error) }
  try {
    const grant = await readGrant(principal)
    await activeConnection(principal.clientId,grant.connection_id)
  } catch { return new Response('Reconnect required',{ status:403 }) }
  const scoped = createMcpHandler(server => registerMetaAdsTools(server,principal),
    { serverInfo:{ name:'magic-engine',version:'0.1.0' } },
    { basePath:'/api/mcp',disableSse:true,verboseLogs:false })
  return withMcpAuth(scoped,async () => ({ token:token ?? '',clientId:principal.keyId,scopes:principal.scopes,
    extra:{ kind:'client',meClientId:principal.clientId,keyId:principal.keyId } }),{ required:true })(request)
}

export { handler as GET, handler as POST, handler as DELETE }

export const dynamic = 'force-dynamic'
export const maxDuration = 60
