import { describe, expect, it } from 'vitest'

import { fisherLowerTailP, lnChoose } from '../stats'
import { CORE_METRIC_NOUN, isClickDrivenGoal, resolveCoreMetric } from '../core-metric'
import {
  D2_CTR_SIGNAL_FLOOR,
  D2_MIN_CTR_DROP,
  FATIGUE_FREQUENCY_HIGH,
  classifyFatigue,
} from '../fatigue'
import { costPerResult, judgeStep, sumDays, type FunnelDay } from '../funnel'

describe('stats', () => {
  it('fisherLowerTailP 小样本下尾概率', () => {
    expect(fisherLowerTailP(1, 10, 10, 20)).toBeCloseTo(0.03689583779538802, 10)
  })

  it('fisherLowerTailP 中等样本下尾概率', () => {
    expect(fisherLowerTailP(5, 128, 85, 578)).toBeCloseTo(0.0002367602900191872, 12)
  })

  it('fisherLowerTailP 大样本极低概率且计算迅速', () => {
    const p = fisherLowerTailP(20, 3000, 1600, 14000)
    expect(p).toBeLessThan(1e-100)

    const start = performance.now()
    for (let i = 0; i < 200; i++) {
      fisherLowerTailP(20, 3000, 1600, 14000)
    }
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(1000)
  })

  it('fisherLowerTailP 退化情形返回 1', () => {
    expect(fisherLowerTailP(1, 0, 10, 20)).toBe(1)
    expect(fisherLowerTailP(1, 10, 10, 0)).toBe(1)
    expect(fisherLowerTailP(0, 10, 0, 20)).toBe(1)
  })

  it('fisherLowerTailP 成功数超过试验数时被夹紧', () => {
    expect(fisherLowerTailP(12, 10, 1, 10)).toBe(1)
  })

  it('lnChoose 组合数对数', () => {
    expect(lnChoose(5, 2)).toBeCloseTo(Math.log(10), 12)
    expect(lnChoose(5, 6)).toBe(Number.NEGATIVE_INFINITY)
  })
})

describe('core-metric', () => {
  it('私信目的地 + 表单目标，客户配置为开聊 → 开聊', () => {
    expect(
      resolveCoreMetric({
        destinationType: 'MESSENGER',
        optimizationGoal: 'LEAD_GENERATION',
        clientPrimary: 'messaging_started',
      }),
    ).toBe('messaging_started')
  })

  it('私信目的地 + 表单目标，客户配置为留资 → 留资', () => {
    expect(
      resolveCoreMetric({
        destinationType: 'MESSENGER',
        optimizationGoal: 'LEAD_GENERATION',
        clientPrimary: 'lead',
      }),
    ).toBe('lead')
  })

  it('私信目的地 + 表单目标，客户未配置 → 默认开聊', () => {
    expect(
      resolveCoreMetric({
        destinationType: 'MESSENGER',
        optimizationGoal: 'LEAD_GENERATION',
        clientPrimary: null,
      }),
    ).toBe('messaging_started')
  })

  it('私信目的地 + 表单目标，客户配置为其他结果 → 默认开聊', () => {
    expect(
      resolveCoreMetric({
        destinationType: 'MESSENGER',
        optimizationGoal: 'LEAD_GENERATION',
        clientPrimary: 'deal',
      }),
    ).toBe('messaging_started')
  })

  it('私信目的地 + 会话目标，客户配置为留资也仍判开聊', () => {
    expect(
      resolveCoreMetric({
        destinationType: 'WHATSAPP',
        optimizationGoal: 'CONVERSATIONS',
        clientPrimary: 'lead',
      }),
    ).toBe('messaging_started')
  })

  it('MESSAGING_ 前缀目的地 + 会话目标 → 开聊', () => {
    expect(
      resolveCoreMetric({
        destinationType: 'MESSAGING_MESSENGER_WHATSAPP',
        optimizationGoal: 'CONVERSATIONS',
        clientPrimary: null,
      }),
    ).toBe('messaging_started')
  })

  it('站内目的地 + 表单目标 → 留资', () => {
    expect(
      resolveCoreMetric({
        destinationType: 'ON_AD',
        optimizationGoal: 'LEAD_GENERATION',
        clientPrimary: 'messaging_started',
      }),
    ).toBe('lead')
  })

  it('LEAD_FORM_MESSENGER 目的地 + 表单目标 → 留资', () => {
    expect(
      resolveCoreMetric({
        destinationType: 'LEAD_FORM_MESSENGER',
        optimizationGoal: 'LEAD_GENERATION',
        clientPrimary: null,
      }),
    ).toBe('lead')
  })

  it('未知目的地 + 优质表单目标 → 留资', () => {
    expect(
      resolveCoreMetric({
        destinationType: 'UNDEFINED',
        optimizationGoal: 'QUALITY_LEAD',
        clientPrimary: null,
      }),
    ).toBe('lead')
  })

  it('非结果类组合 → null', () => {
    expect(
      resolveCoreMetric({
        destinationType: 'ON_VIDEO',
        optimizationGoal: 'THRUPLAY',
        clientPrimary: null,
      }),
    ).toBeNull()
    expect(
      resolveCoreMetric({
        destinationType: 'WEBSITE',
        optimizationGoal: 'OFFSITE_CONVERSIONS',
        clientPrimary: null,
      }),
    ).toBeNull()
    expect(
      resolveCoreMetric({
        destinationType: 'UNDEFINED',
        optimizationGoal: 'CONVERSATIONS',
        clientPrimary: null,
      }),
    ).toBeNull()
    expect(
      resolveCoreMetric({
        destinationType: null,
        optimizationGoal: null,
        clientPrimary: null,
      }),
    ).toBeNull()
  })

  it('isClickDrivenGoal 判定点击类目标', () => {
    expect(isClickDrivenGoal('LEAD_GENERATION')).toBe(true)
    expect(isClickDrivenGoal('THRUPLAY')).toBe(false)
    expect(isClickDrivenGoal('REACH')).toBe(false)
    expect(isClickDrivenGoal(null)).toBe(false)
  })

  it('CORE_METRIC_NOUN 中文名词', () => {
    expect(CORE_METRIC_NOUN.lead).toBe('留资')
    expect(CORE_METRIC_NOUN.messaging_started).toBe('开聊')
  })
})

describe('fatigue', () => {
  it('classifyFatigue 处理空值与非法值', () => {
    expect(classifyFatigue(null)).toBe('unknown')
    expect(classifyFatigue(Number.NaN)).toBe('unknown')
  })

  it('classifyFatigue 频率边界：恰好 3 不算受众疲劳', () => {
    expect(classifyFatigue(3)).toBe('creative')
    expect(classifyFatigue(3.01)).toBe('audience')
    expect(classifyFatigue(1.7)).toBe('creative')
  })

  it('疲劳相关常量取值', () => {
    expect(D2_CTR_SIGNAL_FLOOR).toBe(0.005)
    expect(FATIGUE_FREQUENCY_HIGH).toBe(3)
    expect(D2_MIN_CTR_DROP).toBe(0.25)
  })
})

describe('funnel', () => {
  it('sumDays 汇总天数、活跃天数与花费', () => {
    const days: FunnelDay[] = [
      { date: '2026-01-01', spend: 0.1, impressions: 100, clicks: 10, linkClicks: 5, results: null },
      { date: '2026-01-02', spend: 0.2, impressions: 0, clicks: 0, linkClicks: 0, results: 3 },
    ]
    const totals = sumDays(days)
    expect(totals.days).toBe(2)
    expect(totals.activeDays).toBe(1)
    expect(totals.spend).toBe(0.3)
    expect(totals.results).toBe(3)
  })

  it('costPerResult 处理零结果与正常花费', () => {
    expect(
      costPerResult({
        days: 1,
        activeDays: 1,
        spend: 30,
        impressions: 1000,
        clicks: 100,
        linkClicks: 50,
        results: 0,
      }),
    ).toBeNull()
    expect(
      costPerResult({
        days: 1,
        activeDays: 1,
        spend: 30,
        impressions: 1000,
        clicks: 100,
        linkClicks: 50,
        results: 4,
      }),
    ).toBe(7.5)
  })

  it('judgeStep 无基线 → no_baseline', () => {
    const verdict = judgeStep({
      recentSuccess: 5,
      recentTrials: 100,
      baseSuccess: 0,
      baseTrials: 0,
      recentDaily: [{ success: 5, trials: 100 }],
      minRelativeDrop: 0.4,
    })
    expect(verdict.reason).toBe('no_baseline')
  })

  it('judgeStep 近期不低于基线 → no_drop', () => {
    const verdict = judgeStep({
      recentSuccess: 20,
      recentTrials: 100,
      baseSuccess: 10,
      baseTrials: 100,
      recentDaily: [{ success: 20, trials: 100 }],
      minRelativeDrop: 0.4,
    })
    expect(verdict.reason).toBe('no_drop')
  })

  it('judgeStep 成功数超过试验数时被夹紧 → no_drop', () => {
    const verdict = judgeStep({
      recentSuccess: 5,
      recentTrials: 3,
      baseSuccess: 10,
      baseTrials: 100,
      recentDaily: [{ success: 5, trials: 3 }],
      minRelativeDrop: 0.4,
    })
    expect(verdict.reason).toBe('no_drop')
  })

  it('judgeStep 期望样本不足 → thin', () => {
    const verdict = judgeStep({
      recentSuccess: 2,
      recentTrials: 40,
      baseSuccess: 10,
      baseTrials: 100,
      recentDaily: [{ success: 2, trials: 40 }],
      minRelativeDrop: 0.4,
    })
    expect(verdict.reason).toBe('thin')
    expect(verdict.expected).toBeCloseTo(4, 12)
  })

  it('judgeStep 降幅未达阈值 → no_drop', () => {
    const verdict = judgeStep({
      recentSuccess: 70,
      recentTrials: 1000,
      baseSuccess: 100,
      baseTrials: 1000,
      recentDaily: [{ success: 70, trials: 1000 }],
      minRelativeDrop: 0.4,
    })
    expect(verdict.reason).toBe('no_drop')
  })

  it('judgeStep 持续性不足 → not_persistent', () => {
    const verdict = judgeStep({
      recentSuccess: 20,
      recentTrials: 600,
      baseSuccess: 100,
      baseTrials: 1000,
      recentDaily: [
        { success: 0, trials: 590 },
        { success: 5, trials: 5 },
        { success: 15, trials: 5 },
      ],
      minRelativeDrop: 0.4,
    })
    expect(verdict.reason).toBe('not_persistent')
    expect(verdict.persistentDays).toBe(1)
  })

  it('judgeStep 全部条件满足 → ok 并给出 Fisher 下尾 p 值', () => {
    const verdict = judgeStep({
      recentSuccess: 5,
      recentTrials: 128,
      baseSuccess: 85,
      baseTrials: 578,
      recentDaily: [
        { success: 0, trials: 41 },
        { success: 1, trials: 40 },
        { success: 4, trials: 47 },
      ],
      minRelativeDrop: 0.4,
    })
    expect(verdict.reason).toBe('ok')
    expect(verdict.p).toBeCloseTo(0.0002367602900191872, 12)
    expect(verdict.persistentDays).toBe(3)
    expect(verdict.expected).toBeCloseTo((128 * 85) / 578, 12)
  })
})
