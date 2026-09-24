/**
 * 受限自治信封的判定（spec 2026-09-24 §3 G5）。
 *
 * 这是整个受限自治里**唯一**决定「这笔钱动不动」的判据，所以这份用例的重点不是
 * 覆盖率好看，而是钉住三类最容易被改坏的性质：
 *
 *   ① 读不到 ≠ 没超标 —— 任何一项事实是 null 都必须拒，不许给默认值
 *   ② 判据要落在对的动作性质上 —— 暂停不能被「变动不超过 20%」拦死
 *      （降到 0 就是 100% 变动，套上去这个动作永远过不了闸，而它恰恰是
 *       PM 明确授权可自动做的收类动作）
 *   ③ 越线就是越线 —— 比例、日上限各自独立，任一超了都拒
 */

import { describe, expect, it } from 'vitest'
import { isWithinEnvelope, type EnvelopeFacts, type EnvelopeRequest } from '../autonomy-envelope'
import type { AutonomyEnvelope } from '../types'

const ENVELOPE: AutonomyEnvelope = {
  maxBudgetDeltaRatio: 0.2,
  respectDailyCapCents: true,
  minHoursSinceLastChange: 72,
  excludeLearningPhase: true,
  excludeAdStudies: true,
  requiresRollbackHandler: true,
}

/** 一切都正常的事实底座：改前 1000 分、账户合计 5000 分、上限 10000 分。 */
function facts(over: Partial<EnvelopeFacts> = {}): EnvelopeFacts {
  return {
    beforeCents: 1000,
    accountDailyTotalBeforeCents: 5000,
    dailyCapCents: 10_000,
    hoursSinceLastChange: 100,
    learningPhaseApplicable: true,
    learningStage: 'SUCCESS',
    adStudyCount: 0,
    hasRollbackHandler: true,
    ...over,
  }
}

function req(over: Partial<EnvelopeRequest> = {}): EnvelopeRequest {
  return { kind: 'budget_change', afterCents: 1100, ...over }
}

describe('信封 · 正常放行', () => {
  it('加 10%、账户没超上限、冷却够、已出学习期、没在实验 → 放行', () => {
    const v = isWithinEnvelope(req(), facts(), ENVELOPE)
    expect(v.within).toBe(true)
    expect(v.reasons).toEqual([])
  })

  it('减 20%（正好在边界上）→ 放行（边界是含的）', () => {
    const v = isWithinEnvelope(req({ afterCents: 800 }), facts(), ENVELOPE)
    expect(v.within).toBe(true)
  })
})

describe('信封 · 读不到一律拒，不给默认值', () => {
  it.each([
    ['改动前预算', { beforeCents: null }, '改动前的日预算'],
    ['账户日预算合计', { accountDailyTotalBeforeCents: null }, '日预算合计'],
    ['上次变动时间', { hoursSinceLastChange: null }, '上次设置变动的时间'],
    ['客户日预算上限', { dailyCapCents: null }, '日预算上限'],
  ])('%s 读不到 → 拒绝', (_label, over, needle) => {
    const v = isWithinEnvelope(req(), facts(over as Partial<EnvelopeFacts>), ENVELOPE)
    expect(v.within).toBe(false)
    expect(v.reasons.some(r => r.includes(needle))).toBe(true)
  })

  it('读不到学习期状态 → 按还在学习期处理，拒绝', () => {
    const v = isWithinEnvelope(req(), facts({ learningStage: null }), ENVELOPE)
    expect(v.within).toBe(false)
    expect(v.reasons.some(r => r.includes('学习期'))).toBe(true)
  })

  it('🔴 多项同时读不到 → 原因逐条列出，不是只报第一条', () => {
    const v = isWithinEnvelope(
      req(),
      facts({ beforeCents: null, hoursSinceLastChange: null, dailyCapCents: null }),
      ENVELOPE,
    )
    expect(v.within).toBe(false)
    expect(v.reasons.length).toBeGreaterThanOrEqual(3)
  })
})

describe('信封 · 明确不该动', () => {
  it('没有撤回处理函数 → 拒绝（撤不回来的事不自动做）', () => {
    const v = isWithinEnvelope(req(), facts({ hasRollbackHandler: false }), ENVELOPE)
    expect(v.within).toBe(false)
    expect(v.reasons.some(r => r.includes('撤回'))).toBe(true)
  })

  it('在 Meta 对比测试里 → 拒绝（测试期间动手会毁掉结论）', () => {
    const v = isWithinEnvelope(req(), facts({ adStudyCount: 2 }), ENVELOPE)
    expect(v.within).toBe(false)
    expect(v.reasons.some(r => r.includes('对比测试'))).toBe(true)
  })

  it('还在学习期（LEARNING）→ 拒绝', () => {
    const v = isWithinEnvelope(req(), facts({ learningStage: 'LEARNING' }), ENVELOPE)
    expect(v.within).toBe(false)
    expect(v.reasons.some(r => r.includes('学习期'))).toBe(true)
  })

  it('学习期状态是 FAIL（已退出）→ 不因学习期被拦', () => {
    const v = isWithinEnvelope(req(), facts({ learningStage: 'FAIL' }), ENVELOPE)
    expect(v.within).toBe(true)
  })

  it('距上次变动不足 72 小时 → 拒绝（反复改会一直重置学习期）', () => {
    const v = isWithinEnvelope(req(), facts({ hoursSinceLastChange: 71.9 }), ENVELOPE)
    expect(v.within).toBe(false)
    expect(v.reasons.some(r => r.includes('72'))).toBe(true)
  })

  it('正好 72 小时 → 放行（边界是含的）', () => {
    const v = isWithinEnvelope(req(), facts({ hoursSinceLastChange: 72 }), ENVELOPE)
    expect(v.within).toBe(true)
  })
})

describe('信封 · 变动比例只管「改预算」这一类', () => {
  it('加 21% → 超出信封，拒绝', () => {
    const v = isWithinEnvelope(req({ afterCents: 1210 }), facts(), ENVELOPE)
    expect(v.within).toBe(false)
    expect(v.reasons.some(r => r.includes('21%'))).toBe(true)
  })

  it('🔴 暂停不走变动比例 —— 降到 0 是 100% 变动，套上比例这个动作永远做不了', () => {
    const v = isWithinEnvelope({ kind: 'pause', afterCents: 0 }, facts(), ENVELOPE)
    expect(v.within).toBe(true)
  })

  it('只换素材不碰钱 → 不走变动比例，也不走日上限', () => {
    const v = isWithinEnvelope({ kind: 'creative_only', afterCents: 1000 }, facts(), ENVELOPE)
    expect(v.within).toBe(true)
  })

  it('改动前预算是 0 → 算不出比例，拒绝（不假装 0 变 X 是 0%）', () => {
    const v = isWithinEnvelope(req({ afterCents: 500 }), facts({ beforeCents: 0 }), ENVELOPE)
    expect(v.within).toBe(false)
    expect(v.reasons.some(r => r.includes('算不出变动比例'))).toBe(true)
  })

  it('改动后金额不是有效数字 → 拒绝', () => {
    const v = isWithinEnvelope(req({ afterCents: Number.NaN }), facts(), ENVELOPE)
    expect(v.within).toBe(false)
    expect(v.reasons.some(r => r.includes('有效金额'))).toBe(true)
  })

  it('改动后金额是负数 → 拒绝', () => {
    const v = isWithinEnvelope(req({ afterCents: -100 }), facts(), ENVELOPE)
    expect(v.within).toBe(false)
  })
})

describe('信封 · 日预算上限（PM 2026-09-24：20% 缓冲 + 超缓冲时放减类）', () => {
  it('改完 ≤ 上限 → 放行（本来就在规则内）', () => {
    const ok = isWithinEnvelope(
      req({ afterCents: 1100 }),
      facts({ accountDailyTotalBeforeCents: 9900, dailyCapCents: 10_000 }),
      ENVELOPE,
    )
    expect(ok.within).toBe(true)
  })

  it('改完在缓冲区内（上限 < accountAfter ≤ 上限×1.2）→ 放行', () => {
    // accountAfter = 9900 - 1000 + 2100 = 11000，在 10000..12000 之间
    const v = isWithinEnvelope(
      req({ afterCents: 2100 }),
      facts({ beforeCents: 1000, accountDailyTotalBeforeCents: 9900, dailyCapCents: 10_000 }),
      { ...ENVELOPE, maxBudgetDeltaRatio: 1.5 }, // 放宽变动比例以孤立日上限这条判据
    )
    expect(v.within).toBe(true)
  })

  it('缓冲边界正好 = 上限×1.2 → 放行（边界含）', () => {
    // accountAfter = 5000 - 1000 + 7000 = 11000 = 10000 × 1.1；再拉到 12000 试正好
    const v = isWithinEnvelope(
      req({ afterCents: 8000 }),
      facts({ beforeCents: 1000, accountDailyTotalBeforeCents: 5000, dailyCapCents: 10_000 }),
      { ...ENVELOPE, maxBudgetDeltaRatio: 8 }, // 放宽比例
    )
    // accountAfter = 12000，等于 10000×1.2 → 放行
    expect(v.within).toBe(true)
  })

  it('🔴 加类超缓冲上限（accountAfter > 上限×1.2）→ 拒绝', () => {
    // accountAfter = 5000 - 1000 + 8001 = 12001 > 12000 → 拒
    const v = isWithinEnvelope(
      req({ afterCents: 8001 }),
      facts({ beforeCents: 1000, accountDailyTotalBeforeCents: 5000, dailyCapCents: 10_000 }),
      { ...ENVELOPE, maxBudgetDeltaRatio: 8 },
    )
    expect(v.within).toBe(false)
    expect(v.reasons.some(r => r.includes('缓冲'))).toBe(true)
  })

  it('🔴 账户已经远超上限，减预算 → 放行（让 AI 立刻自动降下来，PM 2026-09-24 拍板）', () => {
    // accountBefore = 20000（远超 10000×1.2 = 12000）；减 100 → accountAfter = 19900，仍超缓冲，
    // 但是"减类"：accountAfter < accountBefore，信封放行让 AI 帮忙降下来。
    const v = isWithinEnvelope(
      req({ afterCents: 900 }),
      facts({ beforeCents: 1000, accountDailyTotalBeforeCents: 20_000, dailyCapCents: 10_000 }),
      ENVELOPE,
    )
    expect(v.within).toBe(true)
  })

  it('暂停不走日上限（只会让花费变少）', () => {
    const v = isWithinEnvelope(
      { kind: 'pause', afterCents: 0 },
      facts({ accountDailyTotalBeforeCents: 20_000, dailyCapCents: 10_000 }),
      ENVELOPE,
    )
    expect(v.within).toBe(true)
  })

  it('新增花费超过上限×1.2 缓冲 → 拒绝', () => {
    // accountAfter = 5000 + 7100 = 12100 > 10000×1.2 → 拒
    const v = isWithinEnvelope(
      { kind: 'new_spend', afterCents: 7100 },
      facts({ beforeCents: 0, accountDailyTotalBeforeCents: 5000, dailyCapCents: 10_000 }),
      ENVELOPE,
    )
    expect(v.within).toBe(false)
    expect(v.reasons.some(r => r.includes('缓冲'))).toBe(true)
  })
})

describe('信封 · 学习期判据适不适用', () => {
  it('🔴 新建还不存在的广告组：学习期判据不适用，读不到状态也不该被拦', () => {
    const v = isWithinEnvelope(
      { kind: 'new_spend', afterCents: 2000 },
      facts({ beforeCents: 0, learningPhaseApplicable: false, learningStage: null }),
      ENVELOPE,
    )
    expect(v.within).toBe(true)
  })

  it('判据适用时，读不到状态仍然拒 —— 「不适用」和「读不到」不能混成一件事', () => {
    const v = isWithinEnvelope(
      { kind: 'new_spend', afterCents: 2000 },
      facts({ beforeCents: 0, learningPhaseApplicable: true, learningStage: null }),
      ENVELOPE,
    )
    expect(v.within).toBe(false)
  })
})
