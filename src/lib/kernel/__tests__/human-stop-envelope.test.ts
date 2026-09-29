/**
 * 人按的「收」类动作专用信封（WP3.1b BLOCKER 4）。
 *
 * ## 这份用例要钉住什么
 *
 * 这不是覆盖率练习。它钉的是**一条已经被生产数据证伪过的假设**：
 * 「人按的紧急止损可以跟 AI 自动调预算共用一套信封」。
 *
 * 2026-09-27 实测（`ad_entity_snapshots` 最新快照）：
 *
 * | 客户 | 广告组 | `learning_stage` 为 NULL | CBO（`daily_budget_minor` 为 NULL） |
 * |---|---|---|---|
 * | CTS Tours NZ | 36 | **36** | 20 |
 * | New Asian Logistics | 10 | **10** | 10 |
 *
 * 按账户级统计更狠：**NAL 126/126 全 CBO、CTS 269/514**。
 * 拿 AI 信封拦人按的刹车 → 这两家客户**一个广告组都停不下来**。
 *
 * 所以下面每一条用例的事实底座都刻意用**生产上的真实形状**
 * （`learningStage: null` + `beforeCents: null`），而不是「一切正常」的理想值 ——
 * 用理想值写的测试会全绿，然后在真客户身上 100% 失败。
 */

import { describe, expect, it } from 'vitest'
import {
  HUMAN_STOP_ACTION_KEYS,
  HUMAN_STOP_ENVELOPE,
  isWithinHumanStopEnvelope,
  selectEnvelopeVerdict,
  type EnvelopeFacts,
  type EnvelopeRequest,
} from '../autonomy-envelope'
import type { AutonomyEnvelope } from '../types'

const AI_ENVELOPE: AutonomyEnvelope = {
  maxBudgetDeltaRatio: 0.2,
  respectDailyCapCents: true,
  minHoursSinceLastChange: 72,
  excludeLearningPhase: true,
  excludeAdStudies: true,
  requiresRollbackHandler: true,
}

/**
 * 🔴 **生产真实形状**，不是理想值：CBO 广告组没有自己的预算（`beforeCents: null`），
 *    学习期读不到（`learningStage: null`）—— 这两条是 CTS/NAL 46 个广告组的实际情况。
 */
function prodFacts(over: Partial<EnvelopeFacts> = {}): EnvelopeFacts {
  return {
    beforeCents: null,
    accountDailyTotalBeforeCents: null,
    dailyCapCents: null,
    hoursSinceLastChange: null,
    learningPhaseApplicable: true,
    learningStage: null,
    adStudyCount: 0,
    hasRollbackHandler: true,
    ...over,
  }
}

function req(over: Partial<EnvelopeRequest> = {}): EnvelopeRequest {
  return { kind: 'pause', afterCents: 0, ...over }
}

const HUMAN = 'human'

describe('人工减预算必须是真的收缩动作', () => {
  function cut(afterCents: number, beforeCents: number | null = 1000, kind: EnvelopeRequest['kind'] = 'budget_change') {
    return selectEnvelopeVerdict({
      triggeredBy: 'human', actionKey: 'ads.cut_unit_budget',
      request: { kind, afterCents }, facts: prodFacts({ beforeCents }), envelope: AI_ENVELOPE,
    })
  }

  it.each([0, 500, 1000])('允许降低或保持预算 %s，不套用 AI 的 20% 限制', after => {
    expect(cut(after).within).toBe(true)
  })

  it.each([1001, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('拒绝增加或无效目标 %s', after => {
    expect(cut(after).within).toBe(false)
  })

  it.each([null, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('拒绝无法证明的原预算 %s', before => {
    expect(cut(500, before).within).toBe(false)
  })

  it.each(['pause', 'new_spend', 'creative_only'] as const)('不能用 %s 伪装减预算', kind => {
    expect(cut(500, 1000, kind).within).toBe(false)
  })

  it.each([
    { kind: 'pause', afterCents: 1 },
    { kind: 'budget_change', afterCents: 0 },
    { kind: 'new_spend', afterCents: 0 },
  ] satisfies EnvelopeRequest[])('暂停必须是零花费的暂停请求：%j', request => {
    expect(selectEnvelopeVerdict({
      triggeredBy: 'human', actionKey: 'ads.pause_unit', request,
      facts: prodFacts(), envelope: AI_ENVELOPE,
    }).within).toBe(false)
  })
})

describe('人工暂停信封 · 不受学习期与冷却期限制', () => {
  it('生产真实形状（CBO + 学习期读不到 + 冷却读不到 + 没设上限）→ 仍然放行', () => {
    const v = isWithinHumanStopEnvelope('ads.pause_unit', req(), prodFacts())
    expect(v.within).toBe(true)
    expect(v.reasons).toEqual([])
  })

  it('🔴 没注册撤回处理函数 → 拒（撤不回来的事就算人按也不做）', () => {
    const v = isWithinHumanStopEnvelope('ads.pause_unit', req(), prodFacts({ hasRollbackHandler: false }))
    expect(v.within).toBe(false)
    expect(v.reasons.join('')).toContain('撤回处理函数')
  })

  it('信封常量只保留 requiresRollbackHandler，不含那三条防 AI 的判据', () => {
    // 🔴 这一条防的是「未来有人把 excludeLearningPhase / minHoursSinceLastChange /
    //    maxBudgetDeltaRatio 悄悄塞回人工信封」——那会让上面 46/46 那个失败原地复活。
    expect(HUMAN_STOP_ENVELOPE).toEqual({ kind: 'human_stop', requiresRollbackHandler: true })
    expect(Object.keys(HUMAN_STOP_ENVELOPE).sort()).toEqual(['kind', 'requiresRollbackHandler'])
  })
})

describe('人工止损信封 · 白名单是穷举的，不是黑名单', () => {
  it('白名单只有两个收类动作', () => {
    expect([...HUMAN_STOP_ACTION_KEYS].sort()).toEqual(['ads.cut_unit_budget', 'ads.pause_unit'])
  })

  it.each([
    { actionKey: 'ads.pause_unit', request: req(), facts: prodFacts() },
    { actionKey: 'ads.cut_unit_budget', request: req({ kind: 'budget_change', afterCents: 500 }), facts: prodFacts({ beforeCents: 1000 }) },
  ])(
    '$actionKey + 人触发 → 走人工信封，只允许真实收缩',
    ({ actionKey, request, facts }) => {
      const v = selectEnvelopeVerdict({
        triggeredBy: HUMAN,
        actionKey,
        request,
        facts,
        envelope: AI_ENVELOPE,
      })
      expect(v.envelopeUsed).toBe('human_stop')
      expect(v.within).toBe(true)
    },
  )

  it.each([
    'ads.scale_unit_budget',
    'ads.add_retargeting_adset',
    'ads.swap_creative',
    'ads.budget_move_plan',
    'ads.pause_campaign',
    'ads.cut_campaign_budget',
    'ads.boost_page_post',
    'ads.create_reel_ad',
  ])('🔴 %s 即使人触发也走 AI 信封（放类/建类没有「只会变少」这个安全性）', (actionKey) => {
    const v = selectEnvelopeVerdict({
      triggeredBy: HUMAN,
      actionKey,
      request: req(),
      facts: prodFacts(),
      envelope: AI_ENVELOPE,
    })
    expect(v.envelopeUsed).toBe('ads_autonomy')
    // 生产真实形状在 AI 信封下必被拒（读不到事实 + 学习期未知）
    expect(v.within).toBe(false)
  })

})

describe('人工止损信封 · triggeredBy 必须是 human，其余一律走 AI 信封', () => {
  // 🔴 `'Human'` / `'user'` / `''` 这类乱值的用例已删掉——不是不重要，是
  //    `triggeredBy` 收紧成 `TriggeredBy`（闭合 union）之后，它们**编译期就不成立**，
  //    写成运行时断言只能靠类型强转绕过去——而那一下恰好把想要的保障亲手关掉。
  //    类型系统能证明的事不要拿测试再证一遍（拿强转证的更是假证据）。
  //    下面只留合法取值里那几个“不是人按的”。
  it.each(['schedule', 'agent', 'signal', 'run'] as const)(
    '%s 触发的暂停走 AI 信封（不是人按的就不给这个宽度）',
    (triggeredBy) => {
      const v = selectEnvelopeVerdict({
        triggeredBy,
        actionKey: 'ads.pause_unit',
        request: req(),
        facts: prodFacts(),
        envelope: AI_ENVELOPE,
      })
      expect(v.envelopeUsed).toBe('ads_autonomy')
    },
  )

  it('🔴 数据库里出现一个不在白名单里的 action_key → 默认走 AI 信封', () => {
    // action_key 那一列的类型是 string（从数据库来），所以这条是真存在的运行时路径，
    // 不是类型系统能拿掉的——所以这条用例留着。
    const v = selectEnvelopeVerdict({
      triggeredBy: 'human',
      actionKey: 'ads.some_future_action_nobody_whitelisted',
      request: req(),
      facts: prodFacts(),
      envelope: AI_ENVELOPE,
    })
    expect(v.envelopeUsed).toBe('ads_autonomy')
  })
})

describe('人工止损信封 · AI 信封那条路没被改坏（回归）', () => {
  it('AI 信封下的生产真实形状必被拒，且理由里点名学习期读不到', () => {
    const v = selectEnvelopeVerdict({
      triggeredBy: 'agent',
      actionKey: 'ads.pause_unit',
      request: req(),
      facts: prodFacts(),
      envelope: AI_ENVELOPE,
    })
    expect(v.within).toBe(false)
    expect(v.reasons.join('；')).toContain('学习期')
  })

  it('AI 信封下一切正常的事实仍然放行（分派没把好路也堵了）', () => {
    const v = selectEnvelopeVerdict({
      triggeredBy: 'agent',
      actionKey: 'ads.pause_unit',
      request: req(),
      facts: {
        beforeCents: 1000,
        accountDailyTotalBeforeCents: 5000,
        dailyCapCents: 10_000,
        hoursSinceLastChange: 100,
        learningPhaseApplicable: true,
        learningStage: 'SUCCESS',
        adStudyCount: 0,
        hasRollbackHandler: true,
      },
      envelope: AI_ENVELOPE,
    })
    expect(v.within).toBe(true)
  })
})
