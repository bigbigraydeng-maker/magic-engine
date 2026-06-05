/**
 * MCP read-only tools (Phase 34 / P34.4).
 *
 * Every tool goes through runScoped, which is the single chokepoint that:
 *   1. derives the locked client_id from the API key via requireMeClientId
 *      (THROWS if missing — never runs a query without a tenant);
 *   2. builds a createScopedQueries(clientId) instance (innermost isolation);
 *   3. logs the call to mcp_access_log (audit / rate-limit / billing);
 *   4. wraps everything in a uniform error contract so DB errors / missing
 *      auth never leak stack traces or SQL to the client.
 *
 * Tool descriptions use plain client-facing language and封装名 (no internal
 * vendor names). A belt-and-braces vendor-name scrub of the payload is added
 * in P34.5.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { logMcpAccess, requireMeClientId } from '@/lib/auth/api-key-access'
import { createScopedQueries, type ScopedQueries } from '@/lib/mcp/scoped-queries'
import { checkRateLimit } from '@/lib/mcp/rate-limit'
import { scrubVendorNames } from '@/lib/mcp/vendor-filter'

interface ToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

async function runScoped(
  authInfo: unknown,
  tool: string,
  fn: (q: ScopedQueries) => Promise<unknown>,
): Promise<ToolResult> {
  let ctx: { meClientId: string; keyId: string }
  try {
    ctx = requireMeClientId(authInfo)
  } catch {
    // No locked client context — refuse rather than run unscoped. We have no
    // keyId to attribute, so we don't write the access log here.
    return errorResult(
      'Authentication context is missing. Please reconnect with a valid API key.',
    )
  }

  // Rate limit per key (sliding window over mcp_access_log). Logged as a
  // throttled call so repeated abuse keeps counting against the window.
  const rate = await checkRateLimit(ctx.keyId)
  if (!rate.ok) {
    logMcpAccess({
      keyId: ctx.keyId,
      clientId: ctx.meClientId,
      tool,
      ok: false,
      errorCode: 'rate_limited',
    })
    return errorResult(
      `Rate limit reached (${rate.limit} requests/min). Please wait a moment and try again.`,
    )
  }

  try {
    const data = await fn(createScopedQueries(ctx.meClientId))
    logMcpAccess({ keyId: ctx.keyId, clientId: ctx.meClientId, tool, ok: true })
    // Final vendor-name scrub before the payload leaves the server (CLAUDE.md
    // 封装名 — no real third-party vendor names in client-facing output).
    const safe = scrubVendorNames(data)
    return { content: [{ type: 'text', text: JSON.stringify(safe, null, 2) }] }
  } catch (err) {
    logMcpAccess({
      keyId: ctx.keyId,
      clientId: ctx.meClientId,
      tool,
      ok: false,
      errorCode: 'tool_error',
    })
    console.error(`[mcp tool ${tool}] failed:`, err)
    return errorResult(
      'Something went wrong while fetching your data. Please try again shortly.',
    )
  }
}

export function registerReadOnlyTools(server: McpServer): void {
  server.tool(
    'me_get_overview',
    'Get an at-a-glance health summary for your account: the latest diagnostic ' +
      'score across the six dimensions (SEO, AI visibility, ads, social, ' +
      'reputation, competitor), plus how many blog posts and social posts have ' +
      'been delivered.',
    {},
    async (_args, { authInfo }) =>
      runScoped(authInfo, 'me_get_overview', (q) => q.getOverview()),
  )

  server.tool(
    'me_list_goals',
    'List your marketing goals and their progress (baseline, current value, ' +
      'target, and verdict). Optionally filter by status: active, draft, ' +
      'expired, or archived. Defaults to all goals, newest first.',
    { status: z.enum(['active', 'draft', 'expired', 'archived']).optional() },
    async ({ status }, { authInfo }) =>
      runScoped(authInfo, 'me_list_goals', (q) => q.listGoals(status)),
  )

  server.tool(
    'me_get_goal_detail',
    'Get full detail for one goal by its id: the primary metric, baseline / ' +
      'current / target values, supporting metrics, the period, and the ' +
      'verdict with its summary. Use me_list_goals first to find the goal id.',
    { goal_id: z.string().min(1) },
    async ({ goal_id }, { authInfo }) =>
      runScoped(authInfo, 'me_get_goal_detail', (q) => q.getGoalDetail(goal_id)),
  )

  server.tool(
    'me_get_seo_performance',
    'Get your recent search performance snapshots: clicks, impressions, ' +
      'average click-through rate, average position, plus your top queries and ' +
      'top pages. Optionally pass a limit (default 6, max 24 most recent ' +
      'periods).',
    { limit: z.number().int().positive().max(24).optional() },
    async ({ limit }, { authInfo }) =>
      runScoped(authInfo, 'me_get_seo_performance', (q) => q.getSeoPerformance(limit)),
  )

  server.tool(
    'me_get_traffic',
    'Get your recent website traffic snapshots (Google Analytics 4): sessions, ' +
      'users, new users, pageviews, average session duration, bounce rate, plus ' +
      'top pages and top sources. Optionally pass a limit (default 6, max 24 most ' +
      'recent periods).',
    { limit: z.number().int().positive().max(24).optional() },
    async ({ limit }, { authInfo }) =>
      runScoped(authInfo, 'me_get_traffic', (q) => q.getTraffic(limit)),
  )

  server.tool(
    'me_list_execution_items',
    'List the work currently being done for you, grouped by dimension (SEO, ' +
      'AI visibility, ads, social, reputation, competitor). Each item shows its ' +
      'title, status, and due date. Skipped items are excluded.',
    {},
    async (_args, { authInfo }) =>
      runScoped(authInfo, 'me_list_execution_items', (q) => q.listExecutionItems()),
  )
}
