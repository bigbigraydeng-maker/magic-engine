/**
 * MCP ADMIN tools (Phase 34 / P34-P3.5). Cross-client, FDE-only.
 *
 * Every tool goes through runAdmin, the single chokepoint that:
 *   1. requireAdminContext(authInfo) — THROWS unless extra.kind === 'admin'
 *      (a client authInfo can never reach here);
 *   2. rate-limits per admin key (30/min, lower than client 60);
 *   3. logs to mcp_access_log with kind:'admin' (admin_key_id + is_admin path);
 *   4. uniform error contract.
 *
 * Y5: admin tools intentionally SKIP scrubVendorNames — internal FDE users
 * should see real names, and admin docs/errors may legitimately mention
 * "Claude Desktop / Anthropic".
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { logMcpAccess, requireAdminContext } from '@/lib/auth/api-key-access'
import { createAdminQueries, type AdminQueries } from '@/lib/mcp/admin-scoped-queries'
import { checkRateLimit } from '@/lib/mcp/rate-limit'

const ADMIN_RATE_LIMIT = 30 // per minute, lower than client's 60

interface ToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

async function runAdmin(
  authInfo: unknown,
  tool: string,
  fn: (q: AdminQueries) => Promise<unknown>,
): Promise<ToolResult> {
  let ctx: { adminKeyId: string; ownerEmail: string }
  try {
    ctx = requireAdminContext(authInfo)
  } catch {
    return errorResult('Admin authentication context is missing. Reconnect with a valid admin key.')
  }

  const rate = await checkRateLimit(ctx.adminKeyId, { limit: ADMIN_RATE_LIMIT, kind: 'admin' })
  if (!rate.ok) {
    logMcpAccess({ kind: 'admin', keyId: ctx.adminKeyId, tool, ok: false, errorCode: 'rate_limited' })
    return errorResult(`Admin rate limit reached (${rate.limit}/min). Please wait and retry.`)
  }

  try {
    const data = await fn(createAdminQueries())
    logMcpAccess({ kind: 'admin', keyId: ctx.adminKeyId, tool, ok: true })
    // Y5: NO scrubVendorNames — internal admin users see real names.
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
  } catch (err) {
    logMcpAccess({ kind: 'admin', keyId: ctx.adminKeyId, tool, ok: false, errorCode: 'tool_error' })
    console.error(`[mcp admin tool ${tool}] failed:`, err)
    return errorResult('Something went wrong fetching admin data. Please try again shortly.')
  }
}

const ADMIN_NOTE =
  ' ⚠️ Admin tool — cross-client. Returns data for the specified client_id; ' +
  'you are authenticated as a Magic Engine admin (FDE), not as the client.'

export function registerAdminTools(server: McpServer): void {
  server.tool(
    'me_admin_list_clients',
    'List all Magic Engine clients (id, name, domain, market).' + ADMIN_NOTE,
    {},
    async (_args, { authInfo }) =>
      runAdmin(authInfo, 'me_admin_list_clients', (q) => q.listAllClients()),
  )

  server.tool(
    'me_admin_get_overview',
    'Get a client health overview (diagnostic score + content delivery counts) ' +
      'for a given client_id.' + ADMIN_NOTE,
    { client_id: z.string().uuid() },
    async ({ client_id }, { authInfo }) =>
      runAdmin(authInfo, 'me_admin_get_overview', (q) => q.getOverview(client_id)),
  )

  server.tool(
    'me_admin_list_goals',
    'List a client’s goals + progress for a given client_id. Optional status ' +
      'filter (active/draft/expired/archived).' + ADMIN_NOTE,
    { client_id: z.string().uuid(), status: z.enum(['active', 'draft', 'expired', 'archived']).optional() },
    async ({ client_id, status }, { authInfo }) =>
      runAdmin(authInfo, 'me_admin_list_goals', (q) => q.listGoals(client_id, status)),
  )

  server.tool(
    'me_admin_get_seo_performance',
    'Get a client’s recent search performance snapshots for a given client_id ' +
      '(optional limit, default 6, max 24).' + ADMIN_NOTE,
    { client_id: z.string().uuid(), limit: z.number().int().positive().max(24).optional() },
    async ({ client_id, limit }, { authInfo }) =>
      runAdmin(authInfo, 'me_admin_get_seo_performance', (q) => q.getSeoPerformance(client_id, limit)),
  )

  server.tool(
    'me_admin_list_execution_items',
    'List the execution work for a given client_id, grouped by dimension ' +
      '(skipped excluded).' + ADMIN_NOTE,
    { client_id: z.string().uuid() },
    async ({ client_id }, { authInfo }) =>
      runAdmin(authInfo, 'me_admin_list_execution_items', (q) => q.listExecutionItems(client_id)),
  )
}
