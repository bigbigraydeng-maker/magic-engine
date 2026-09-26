/**
 * query_flywheel_history — 查**该客户**历史动作的归因成效（这招上次灵不灵）。
 *
 * 🔴 条款 A：绝不用 fetchOutcomeConfidenceMap（查全表跨客户）。改用
 * fetchClientOutcomeHistory，SQL 强制 .eq('flywheel_actions.client_id', ctx.clientId)。
 * 让诸葛亮参照本客户历史成效挑打法，而不是重复无效动作。
 */

import { fetchClientOutcomeHistory } from '@/lib/case-library/outcome-confidence'
import { MIN_DECIDED_FOR_RATE } from '@/lib/flywheel/attribution/outcome-identity'
import {
  type ReadonlyToolModule,
  truncateToolOutput,
  warnOnResourceIds,
  optString,
} from './types'

export const queryFlywheelHistory: ReadonlyToolModule = {
  tool: {
    name: 'query_flywheel_history',
    description:
      'Look up THIS client\'s own historical action outcomes: for each action_type the client ' +
      'has tried before, its success rate over DECIDED cases (confirmed vs reversed; null when ' +
      'fewer than 3 were decided) and how many cases were decided out of all cases (from the ' +
      'flywheel attribution library). Use this to prefer moves that already worked for THIS client and ' +
      'avoid re-proposing ones that failed. Scoped to the current client only.',
    input_schema: {
      type: 'object',
      properties: {
        flywheel: {
          type: 'string',
          description: 'Optional filter: one of seo / geo / ads / social.',
        },
        action_type: {
          type: 'string',
          description: 'Optional filter: a specific action_type slug, e.g. "seo.publish_blog".',
        },
      },
    },
  },

  async handler(input, ctx) {
    warnOnResourceIds(input, 'query_flywheel_history')
    const args = (input ?? {}) as Record<string, unknown>
    const flywheel = optString(args.flywheel)
    const actionType = optString(args.action_type)

    try {
      // 🔴 clientId is server-injected — the query can only ever see this client's outcomes.
      const map = await fetchClientOutcomeHistory(ctx.supabase, ctx.clientId, {
        ...(flywheel ? { flywheel } : {}),
        ...(actionType ? { actionType } : {}),
      })
      const actions = Object.entries(map)
        .map(([action_type, e]) => ({
          action_type,
          // null = too few decided cases to state a rate; it means "unknown", not 0%.
          success_rate_pct: e.sampleSize >= MIN_DECIDED_FOR_RATE ? Math.round(e.successRate * 100) : null,
          decided_cases: e.sampleSize,
          total_cases: e.totalCases,
        }))
        .sort(
          (a, b) =>
            (b.success_rate_pct ?? -1) - (a.success_rate_pct ?? -1) || b.decided_cases - a.decided_cases,
        )

      if (actions.length === 0) {
        return JSON.stringify({ client_scoped: true, note: 'No historical outcomes for this client yet.', actions: [] })
      }
      return truncateToolOutput(
        JSON.stringify({
          client_scoped: true,
          note:
            'success_rate_pct counts decided cases only (confirmed vs reversed). Whole-site SEO traffic ' +
            'changes and changes inside the noise floor are inconclusive and excluded. ' +
            `null = fewer than ${MIN_DECIDED_FOR_RATE} decided cases: treat it as unknown, not as a failure.`,
          actions,
        }),
      )
    } catch (err) {
      return JSON.stringify({
        error: `Flywheel history lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  },
}
