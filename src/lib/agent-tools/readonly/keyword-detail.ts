/**
 * query_keyword_detail — 查该客户域名的关键词明细（词 / 搜索量 / KD / 意图）。
 *
 * 🔴 域名来自 ctx.domain（服务端注入），入参不含 domain/target（§3.3 条款 C）。
 * 让诸葛亮能下钻某维度低分背后到底是哪些词，而不是只看 "seo: 42/100"。
 */

import { getKeywordsForSite } from '@/lib/dataforseo/labs'
import {
  type ReadonlyToolModule,
  locationCodeForMarket,
  truncateToolOutput,
  warnOnResourceIds,
  clampNumber,
} from './types'

export const queryKeywordDetail: ReadonlyToolModule = {
  tool: {
    name: 'query_keyword_detail',
    description:
      'Look up the real keyword detail for THIS client\'s website: which keywords the site is ' +
      'associated with, their monthly search volume, keyword difficulty (KD) and search intent. ' +
      'Use this to drill into WHY an SEO dimension scores low instead of guessing. ' +
      'The website is fixed to the current client — you cannot query another site.',
    input_schema: {
      type: 'object',
      properties: {
        dimension: {
          type: 'string',
          description: 'Optional context hint (e.g. "seo") — advisory only, does not change the query.',
        },
        limit: {
          type: 'number',
          description: 'How many top keywords to return (by search volume). 1–50, default 20.',
        },
      },
    },
  },

  async handler(input, ctx) {
    warnOnResourceIds(input, 'query_keyword_detail')
    if (!ctx.domain) {
      return JSON.stringify({ error: 'No domain configured for this client — keyword detail unavailable.' })
    }
    const args = (input ?? {}) as Record<string, unknown>
    const limit = clampNumber(args.limit, 20, 1, 50)

    try {
      const keywords = await getKeywordsForSite(ctx.domain, locationCodeForMarket(ctx.market), limit)
      return truncateToolOutput(JSON.stringify({
        domain: ctx.domain,          // echo the SERVER-bound domain so Claude sees what was queried
        market: ctx.market,
        keyword_count: keywords.length,
        keywords: keywords.slice(0, limit).map(k => ({
          keyword: k.keyword,
          search_volume: k.search_volume,
          kd: k.keyword_difficulty,
          intent: k.intent,
        })),
      }))
    } catch (err) {
      return JSON.stringify({
        error: `Keyword detail lookup failed: ${err instanceof Error ? err.message : String(err)}`,
        domain: ctx.domain,
      })
    }
  },
}
