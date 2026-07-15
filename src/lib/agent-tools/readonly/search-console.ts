/**
 * query_search_console — 查该客户 GSC 近 N 天真实点击/曝光/CTR/排名。
 *
 * 🔴 siteUrl 来自 ctx.siteUrl（服务端由 clientId 反查 client_connectors.config，
 * §3.3 条款 B），入参不含 site_url。token 也按 ctx.clientId 解析。即便底层走
 * 服务账号 fallback（条款 F），siteUrl 已锁死本客户站 → 无法读别站。
 */

import { fetchGscSnapshot } from '@/lib/gsc/client'
import {
  type ReadonlyToolModule,
  truncateToolOutput,
  warnOnResourceIds,
  clampNumber,
} from './types'

export const querySearchConsole: ReadonlyToolModule = {
  tool: {
    name: 'query_search_console',
    description:
      'Fetch THIS client\'s real Google Search Console data (last N days): total clicks, ' +
      'impressions, average CTR & position, plus the top queries and pages. ' +
      'Use this to verify whether an SEO score reflects a real click/traffic loss and which ' +
      'queries drove it. The GSC property is fixed to the current client.',
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
    warnOnResourceIds(input, 'query_search_console')
    if (!ctx.siteUrl) {
      return JSON.stringify({ error: 'GSC connector not configured for this client (no site_url).' })
    }
    const args = (input ?? {}) as Record<string, unknown>
    const days = clampNumber(args.range_days, 28, 7, 90)

    try {
      // 🔴 siteUrl + clientId are BOTH server-injected — Claude controls neither.
      const snap = await fetchGscSnapshot(ctx.siteUrl, ctx.clientId, days)
      if (!snap) {
        return JSON.stringify({ error: 'GSC data unavailable (no valid token or empty property).', site: ctx.siteUrl })
      }
      return truncateToolOutput(JSON.stringify({
        site: snap.site_url,
        period: [snap.period_start, snap.period_end],
        total_clicks: snap.total_clicks,
        total_impressions: snap.total_impressions,
        avg_ctr: snap.avg_ctr,
        avg_position: snap.avg_position,
        top_queries: snap.top_queries.slice(0, 15).map(q => ({
          query: q.query, clicks: q.clicks, impressions: q.impressions, position: q.position,
        })),
        top_pages: snap.top_pages.slice(0, 8).map(p => ({
          page: p.page, clicks: p.clicks, impressions: p.impressions,
        })),
      }))
    } catch (err) {
      return JSON.stringify({
        error: `GSC lookup failed: ${err instanceof Error ? err.message : String(err)}`,
        site: ctx.siteUrl,
      })
    }
  },
}
