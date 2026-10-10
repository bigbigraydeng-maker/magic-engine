/**
 * Tests for src/lib/flywheel/tune/campaign-tune-suggestions.ts — Gate B 步骤 3 支撑函数。
 *
 * evaluator 与 cohort 的过滤规则各自都有专项测试，这里只关注**批量 fan-out**：
 *   - 每条 action 的 cohort 是其它 action 的 T+72 receipt
 *   - action 没自己的 T+72 receipt → 该 idempotencyKey 落 null（不当成 INCONCLUSIVE）
 *   - T+4 receipt 不参与 cohort（即使误入）
 *   - key 是 action.idempotencyKey（不是 action.id）
 *   - thresholds 传参传到 evaluator
 */

import { describe, it, expect, vi } from 'vitest'
import { evaluateCampaignPosts } from '../campaign-tune-suggestions'

function receipt(actionId: string, likes: number, windowHours = 72) {
  return {
    actionId,
    windowHours,
    status: 'ok' as const,
    values: { likes, comments: 1 },
    missing: {},
  }
}

describe('evaluateCampaignPosts — 批量 fan-out', () => {
  it('每条 action 拿其它 action 的 T+72 当 cohort', () => {
    const suggestions = evaluateCampaignPosts({
      actions: [
        { id: 'a1', idempotencyKey: 'page_p1' },
        { id: 'a2', idempotencyKey: 'page_p2' },
        { id: 'a3', idempotencyKey: 'page_p3' },
        { id: 'a4', idempotencyKey: 'page_p4' },
      ],
      receipts: [
        receipt('a1', 20),  // target vs [10,10,10] → +100% REPEAT
        receipt('a2', 10),  // target vs [20,10,10] → -25% ITERATE
        receipt('a3', 10),
        receipt('a4', 10),
      ],
    })

    expect(suggestions['page_p1']?.decision).toBe('REPEAT')
    expect(suggestions['page_p1']?.deltaPct).toBe(100)
    expect(suggestions['page_p2']?.decision).toBe('ITERATE')
    expect(suggestions['page_p2']?.sampleSize).toBe(3)
  })

  it('cohort 里只有 2 条时该条落 INCONCLUSIVE / insufficient_cohort（默认 min=3）', () => {
    const suggestions = evaluateCampaignPosts({
      actions: [
        { id: 'a1', idempotencyKey: 'p1' },
        { id: 'a2', idempotencyKey: 'p2' },
        { id: 'a3', idempotencyKey: 'p3' },
      ],
      receipts: [receipt('a1', 10), receipt('a2', 10), receipt('a3', 10)],
    })
    // 每条 target 的 cohort 只有 2 条，都会 INCONCLUSIVE
    expect(suggestions['p1']?.decision).toBe('INCONCLUSIVE')
    expect(suggestions['p1']?.inconclusiveReason).toBe('insufficient_cohort')
    expect(suggestions['p2']?.decision).toBe('INCONCLUSIVE')
    expect(suggestions['p3']?.decision).toBe('INCONCLUSIVE')
  })

  it('action 没自己的 T+72 receipt → idempotencyKey 落 null（不是 INCONCLUSIVE）', () => {
    const suggestions = evaluateCampaignPosts({
      actions: [
        { id: 'a1', idempotencyKey: 'p1' },        // 无 receipt
        { id: 'a2', idempotencyKey: 'p2' },
        { id: 'a3', idempotencyKey: 'p3' },
        { id: 'a4', idempotencyKey: 'p4' },
        { id: 'a5', idempotencyKey: 'p5' },
      ],
      // a1 无 receipt；p2 target=20，cohort=[a3,a4,a5]=[10,10,10] → +100% REPEAT
      receipts: [receipt('a2', 20), receipt('a3', 10), receipt('a4', 10), receipt('a5', 10)],
    })
    expect(suggestions['p1']).toBeNull()
    expect(suggestions['p2']?.decision).toBe('REPEAT')
    expect(suggestions['p2']?.sampleSize).toBe(3)
  })

  it('T+4 receipt 不被当成 cohort 样本（即使传进来）', () => {
    const suggestions = evaluateCampaignPosts({
      actions: [
        { id: 'a1', idempotencyKey: 'p1' },
        { id: 'a2', idempotencyKey: 'p2' },
        { id: 'a3', idempotencyKey: 'p3' },
        { id: 'a4', idempotencyKey: 'p4' },
      ],
      receipts: [
        receipt('a1', 20),
        receipt('a2', 10),
        receipt('a3', 10),
        receipt('a4', 10),
        // 混一堆 T+4 进来 —— 不能污染 cohort
        receipt('a1', 999, 4),
        receipt('a2', 999, 4),
        receipt('a3', 999, 4),
      ],
    })
    expect(suggestions['p1']?.decision).toBe('REPEAT')
    expect(suggestions['p1']?.cohortMean).toBe(10)  // 不是 (10+10+999)/3
    expect(suggestions['p1']?.sampleSize).toBe(3)
  })

  it('返回 map 的 key 是 action.idempotencyKey（不是 action.id）', () => {
    const suggestions = evaluateCampaignPosts({
      actions: [
        { id: 'internal-uuid-1', idempotencyKey: 'facebook_post_A' },
        { id: 'internal-uuid-2', idempotencyKey: 'facebook_post_B' },
        { id: 'internal-uuid-3', idempotencyKey: 'facebook_post_C' },
        { id: 'internal-uuid-4', idempotencyKey: 'facebook_post_D' },
      ],
      receipts: [
        receipt('internal-uuid-1', 20),
        receipt('internal-uuid-2', 10),
        receipt('internal-uuid-3', 10),
        receipt('internal-uuid-4', 10),
      ],
    })
    expect(Object.keys(suggestions).sort()).toEqual([
      'facebook_post_A', 'facebook_post_B', 'facebook_post_C', 'facebook_post_D',
    ])
    // 不该出现 action id 作为 key
    expect(suggestions['internal-uuid-1']).toBeUndefined()
  })

  it('thresholds 覆盖传到 evaluator', () => {
    const suggestions = evaluateCampaignPosts({
      actions: [
        { id: 'a1', idempotencyKey: 'p1' },
        { id: 'a2', idempotencyKey: 'p2' },
        { id: 'a3', idempotencyKey: 'p3' },
        { id: 'a4', idempotencyKey: 'p4' },
      ],
      receipts: [
        receipt('a1', 15),  // target vs [10,10,10] → +50%
        receipt('a2', 10),
        receipt('a3', 10),
        receipt('a4', 10),
      ],
      thresholds: { repeatDeltaPct: 60 },  // 提高门槛，+50% 应该只是 ITERATE
    })
    expect(suggestions['p1']?.decision).toBe('ITERATE')
    expect(suggestions['p1']?.thresholdsUsed.repeatDeltaPct).toBe(60)
  })

  it('空输入 → 空 map', () => {
    expect(evaluateCampaignPosts({ actions: [], receipts: [] })).toEqual({})
  })

  it('归一化：未知 status → unmeasurable → INCONCLUSIVE / unmeasurable_target + warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const suggestions = evaluateCampaignPosts({
      actions: [
        { id: 'a1', idempotencyKey: 'p1' },
        { id: 'a2', idempotencyKey: 'p2' },
        { id: 'a3', idempotencyKey: 'p3' },
        { id: 'a4', idempotencyKey: 'p4' },
      ],
      receipts: [
        { actionId: 'a1', windowHours: 72, status: 'weird', values: { likes: 20 }, missing: {} },
        receipt('a2', 10),
        receipt('a3', 10),
        receipt('a4', 10),
      ],
    })
    expect(suggestions['p1']?.decision).toBe('INCONCLUSIVE')
    expect(suggestions['p1']?.inconclusiveReason).toBe('unmeasurable_target')
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("unknown receipt status 'weird'"))
    warnSpy.mockRestore()
  })
})
