/**
 * query_analytics — 查该客户 GA4 近 N 天真实流量/用户/转化信号。
 *
 * 🔴 propertyId 来自 ctx.propertyId（服务端由 clientId 反查 client_connectors.config，
 * §3.3 条款 B），入参不含 property_id。token 按 ctx.clientId 解析。
 * 让诸葛亮判断某战线是否真带来生意，而不是只看抽象分数。
 */

import { fetchGa4Snapshot } from '@/lib/ga4/client'
import {
  type ReadonlyToolModule,
  truncateToolOutput,
  warnOnResourceIds,
  clampNumber,
} from './types'

export const queryAnalytics: ReadonlyToolModule = {
  tool: {
    name: 'query_analytics',
    description:
      'Fetch THIS client\'s real Google Analytics 4 data (last N days): sessions, users, ' +
      'new users, pageviews, average session duration, bounce rate, plus top pages and ' +
      'traffic sources. Use this to check whether a channel actually drives business, not ' +
      'just rankings. The GA4 property is fixed to the current client.',
    input_schema: {
      type: 'object',
      properties: {
        range_days: {
          type: 'number',
          description: 'How many days back to cover. 7–90, default 28.',
        },
      },
    },
  },

  async handler(input, ctx) {
    warnOnResourceIds(input, 'query_analytics')
    if (!ctx.propertyId) {
      return JSON.stringify({ error: 'GA4 connector not configured for this client (no property_id).' })
    }
    const args = (input ?? {}) as Record<string, unknown>
    const days = clampNumber(args.range_days, 28, 7, 90)

    try {
      // 🔴 propertyId + clientId are BOTH server-injected — Claude controls neither.
      const snap = await fetchGa4Snapshot(ctx.propertyId, ctx.clientId, days)
      if (!snap) {
        return JSON.stringify({ error: 'GA4 data unavailable (no valid token or empty property).', property_id: ctx.propertyId })
      }
      return truncateToolOutput(JSON.stringify({
        property_id: snap.property_id,
        period: [snap.period_start, snap.period_end],
        total_sessions: snap.total_sessions,
        total_users: snap.total_users,
        total_new_users: snap.total_new_users,
        total_pageviews: snap.total_pageviews,
        avg_session_duration: snap.avg_session_duration,
        bounce_rate: snap.bounce_rate,
        top_pages: snap.top_pages.slice(0, 8),
        top_sources: snap.top_sources.slice(0, 8),
      }))
    } catch (err) {
      return JSON.stringify({
        error: `GA4 lookup failed: ${err instanceof Error ? err.message : String(err)}`,
        property_id: ctx.propertyId,
      })
    }
  },
}
