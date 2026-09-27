import { describe, expect, it } from 'vitest'
import {
  SELF_SERVE_FOOTER,
  SELF_SERVE_INTRO,
  formatDay,
  formatMoney,
  formatPct,
  renderRuleSection,
  toClientFinding,
  type ClientRuleFinding,
  type RuleSectionInput,
} from '../client-copy'
import type { RuleFinding } from '../patrol-findings'

const opts = (freq: number | null = null) => ({
  currency: 'NZD',
  dataDate: '2026-09-24',
  campaignFrequency: () => freq,
})

function hit(
  code: 'D2' | 'D10',
  evidence: Record<string, string | number | boolean | null>,
  adName = '测试广告',
): RuleFinding {
  return {
    code,
    status: 'hit',
    title: 'internal title with PM words',
    units: [
      { level: 'ad', id: 'ad1', name: adName, adAccountId: 'act_1' },
      { level: 'adset', id: 'as1', name: 'as1' },
    ],
    reasons: ['止损：内部'],
    evidence,
    clientVisible: true,
  }
}

const BANNED = [
  '巡检',
  '规则',
  'D2',
  'D10',
  '显著',
  'p=',
  'p 值',
  '手册',
  'PM',
  'FDE',
  'CTR',
  'CPL',
  'CPM',
  'Claude',
  'Haiku',
  'Anthropic',
  'OpenAI',
  '留资',
  '开聊',
  '平时',
  '客户的成本',
]

function expectNoBanned(text: string): void {
  for (const word of BANNED) {
    expect(text).not.toContain(word)
  }
}

function expectFindingClean(f: ClientRuleFinding): void {
  expectNoBanned(f.headline)
  expectNoBanned(f.detail)
  expectNoBanned(f.action)
}

describe('toClientFinding — D10', () => {
  it('own_history lead: headline, detail, action, spend, kind', () => {
    const f = toClientFinding(
      hit('D10', {
        core_metric: 'lead',
        baseline_source: 'own_history',
        base_rate: 0.16,
        recent_rate: 0.039,
        base_cost_per_result: 7.05,
        recent_cost_per_result: 33.5,
        recent_spend: 167.48,
      }),
      opts(),
    )
    expect(f).not.toBeNull()
    const finding = f as ClientRuleFinding
    expect(finding.kind).toBe('post_click_drop')
    expect(finding.spend).toBe(167.48)
    expect(finding.headline).toContain('留下联系方式的比例从之前两周的 16.0% 降到了 3.9%')
    expect(finding.headline).toContain('（数据截至 9月24日）')
    expect(finding.detail).toContain('平均每带来一位留下联系方式的人，花费从 NZ$7.05 涨到了 NZ$33.50。')
    expect(finding.action).toContain('如果你最近自己改过这条广告的表单，请告诉我们。')
    expect(finding.action).not.toContain('你不用动手')
    expectFindingClean(finding)
  })

  it('same_adset_peers messaging: headline and detail', () => {
    const f = toClientFinding(
      hit('D10', {
        core_metric: 'messaging_started',
        baseline_source: 'same_adset_peers',
        base_rate: 0.2,
        recent_rate: 0.05,
        base_cost_per_result: 6,
        recent_cost_per_result: 20,
        recent_spend: 60,
      }),
      opts(),
    )
    expect(f).not.toBeNull()
    const finding = f as ClientRuleFinding
    expect(finding.headline).toContain('发私信咨询的比例只有 5.0%，同一组里其它广告是 20.0%')
    expect(finding.detail).toContain('平均每带来一位发私信咨询的人要花 NZ$20.00')
    expect(finding.detail).toContain('同一组里其它广告最近两周多平均每位只要 NZ$6.00')
    expect(finding.action).toContain('如果你最近自己改过这条广告的欢迎语或快捷问题，请告诉我们。')
    expectFindingClean(finding)
  })

  it('own_history with recent_rate 0 and null recent_cost_per_result', () => {
    const f = toClientFinding(
      hit('D10', {
        core_metric: 'lead',
        baseline_source: 'own_history',
        base_rate: 0.16,
        recent_rate: 0,
        base_cost_per_result: 7.05,
        recent_cost_per_result: null,
        recent_spend: 167.48,
      }),
      opts(),
    )
    expect(f).not.toBeNull()
    const finding = f as ClientRuleFinding
    expect(finding.headline).toContain('还没有人留下联系方式')
    expect(finding.headline).toContain('之前两周点进来的人里有 16.0% 会留下联系方式')
    expect(finding.detail).toContain('还没有带来留下联系方式的人')
    expectFindingClean(finding)
  })

  it('same_adset_peers with recent_rate 0 never shows 0.0%', () => {
    const f = toClientFinding(
      hit('D10', {
        core_metric: 'lead',
        baseline_source: 'same_adset_peers',
        base_rate: 0.16,
        recent_rate: 0,
        base_cost_per_result: 7.05,
        recent_cost_per_result: null,
        recent_spend: 167.48,
      }),
      opts(),
    )
    expect(f).not.toBeNull()
    const finding = f as ClientRuleFinding
    expect(finding.headline).toContain('还没有人留下联系方式；同一组里其它广告')
    expect(finding.headline).not.toContain('0.0%')
    expectFindingClean(finding)
  })

  it('own_history with null base_cost_per_result and recent 0.03 cost 20', () => {
    const f = toClientFinding(
      hit('D10', {
        core_metric: 'lead',
        baseline_source: 'own_history',
        base_rate: 0.16,
        recent_rate: 0.03,
        base_cost_per_result: null,
        recent_cost_per_result: 20,
        recent_spend: 60,
      }),
      opts(),
    )
    expect(f).not.toBeNull()
    const finding = f as ClientRuleFinding
    expect(finding.detail).toContain('现在平均每带来一位留下联系方式的人要花 NZ$20.00')
    expect(finding.detail).not.toContain('—')
    expectFindingClean(finding)
  })

  it('returns null when core_metric is null', () => {
    const f = toClientFinding(
      hit('D10', {
        core_metric: null,
        baseline_source: 'own_history',
        base_rate: 0.16,
        recent_rate: 0.04,
        base_cost_per_result: 7,
        recent_cost_per_result: 30,
        recent_spend: 100,
      }),
      opts(),
    )
    expect(f).toBeNull()
  })
})

describe('toClientFinding — D2', () => {
  it('creative fatigue wording', () => {
    const f = toClientFinding(
      hit('D2', { base_rate: 0.02, recent_rate: 0.01, frequency_7d: 1.7, fatigue_kind: 'creative' }),
      opts(),
    )
    expect(f).not.toBeNull()
    const finding = f as ClientRuleFinding
    expect(finding.kind).toBe('fatigue')
    expect(finding.detail).toContain('和它一起投放的这批广告')
    expect(finding.detail).toContain('1.7 次')
    expect(finding.detail).toContain('图片或视频不够吸引人')
    expectFindingClean(finding)
  })

  it('audience fatigue wording', () => {
    const f = toClientFinding(
      hit('D2', { base_rate: 0.02, recent_rate: 0.01, frequency_7d: 3.6, fatigue_kind: 'audience' }),
      opts(),
    )
    expect(f).not.toBeNull()
    const finding = f as ClientRuleFinding
    expect(finding.detail).toContain('看多了')
    expectFindingClean(finding)
  })

  it('falls back to campaignFrequency when frequency_7d is null', () => {
    const f = toClientFinding(
      hit('D2', { base_rate: 0.02, recent_rate: 0.01, frequency_7d: null }),
      opts(4.2),
    )
    expect(f).not.toBeNull()
    const finding = f as ClientRuleFinding
    expect(finding.detail).toContain('4.2 次')
    expect(finding.detail).toContain('看多了')
    expectFindingClean(finding)
  })

  it('unknown frequency wording when both are null', () => {
    const f = toClientFinding(
      hit('D2', { base_rate: 0.02, recent_rate: 0.01, frequency_7d: null }),
      opts(null),
    )
    expect(f).not.toBeNull()
    const finding = f as ClientRuleFinding
    expect(finding.detail).toContain('拿不到每个人看了几次')
    expectFindingClean(finding)
  })
})

describe('toClientFinding — guards', () => {
  it('returns null when status is not hit', () => {
    const f = toClientFinding(
      { ...hit('D2', { base_rate: 0.02, recent_rate: 0.01 }), status: 'ok' },
      opts(),
    )
    expect(f).toBeNull()
  })

  it('returns null when there is no ad unit', () => {
    const f = toClientFinding(
      {
        ...hit('D2', { base_rate: 0.02, recent_rate: 0.01 }),
        units: [{ level: 'adset', id: 'as1', name: 'as1' }],
      },
      opts(),
    )
    expect(f).toBeNull()
  })

  it('returns null when base_rate is missing', () => {
    const f = toClientFinding(hit('D2', { recent_rate: 0.01 }), opts())
    expect(f).toBeNull()
  })
})

describe('renderRuleSection', () => {
  it('sorts findings by spend descending', () => {
    const low: ClientRuleFinding = {
      kind: 'fatigue',
      adName: 'low',
      headline: 'LOW_SPEND_HEADLINE',
      detail: 'd',
      action: 'a',
      spend: 10,
      explainsCtr: true,
    }
    const high: ClientRuleFinding = {
      kind: 'fatigue',
      adName: 'high',
      headline: 'HIGH_SPEND_HEADLINE',
      detail: 'd',
      action: 'a',
      spend: 100,
      explainsCtr: true,
    }
    const out = renderRuleSection({
      source: 'patrol',
      dataDate: '2026-09-24',
      adsChecked: 12,
      findings: [low, high],
    })
    expect(out.indexOf('HIGH_SPEND_HEADLINE')).toBeLessThan(out.indexOf('LOW_SPEND_HEADLINE'))
    expectNoBanned(out)
  })

  it('patrol with no findings', () => {
    const out = renderRuleSection({
      source: 'patrol',
      dataDate: '2026-09-24',
      adsChecked: 12,
      findings: [],
    })
    expect(out).toContain('这次没有发现连续两天以上明显变差的广告')
    expect(out).toContain('检查了 12 条正在投放的广告')
    expect(out).toContain('9月24日')
    expect(out.startsWith('三、需要留意的广告')).toBe(true)
    expectNoBanned(out)
  })

  it('promise sentence appears once, ask sentence in both blocks, CTR explainer once', () => {
    const d10: ClientRuleFinding = {
      kind: 'post_click_drop',
      adName: 'A',
      headline: 'HEADLINE_ONE',
      detail: 'DETAIL_ONE',
      action: '如果你最近自己改过这条广告的表单，请告诉我们。',
      spend: 100,
      explainsCtr: false,
    }
    const d2: ClientRuleFinding = {
      kind: 'fatigue',
      adName: 'B',
      headline: 'HEADLINE_TWO',
      detail: 'DETAIL_TWO',
      action: '如果你最近自己改过这条广告的图片或视频，请告诉我们。',
      spend: 50,
      explainsCtr: true,
    }
    const out = renderRuleSection({
      source: 'patrol',
      dataDate: '2026-09-24',
      adsChecked: 12,
      findings: [d10, d2],
    })
    const promise = '下面这几条我们的广告团队已经看到，会在10月1日前后复查并处理，你不用动手。'
    expect(out.split(promise)).toHaveLength(2)
    expect(out.split('如果你最近自己改过这条广告的').length - 1).toBe(2)
    const explainer = '点击率就是看到广告的人里点进来的比例。'
    expect(out.split(explainer)).toHaveLength(2)
    expect(out.indexOf(explainer)).toBeLessThan(out.indexOf('DETAIL_TWO'))
    expectNoBanned(out)
  })

  it('none reasons render their specific text', () => {
    const reasons: Array<Extract<RuleSectionInput, { source: 'none' }>['reason']> = [
      'not_connected',
      'stale',
      'partial',
      'shared_account',
      'client_page_unknown',
      'not_loaded',
      'no_delivering_ads',
      'preparing',
      'incomplete_findings',
    ]
    for (const reason of reasons) {
      const out = renderRuleSection({ source: 'none', reason })
      expect(out).toContain('这个广告账户这次没有做单条广告检查')
      expect(out).toContain('报告里其它部分的分析不受影响')
      expect(out.startsWith('三、需要留意的广告')).toBe(true)
      expectNoBanned(out)
    }
    expect(renderRuleSection({ source: 'none', reason: 'not_connected' })).toContain(
      '还没有接入每日检查',
    )
    expect(renderRuleSection({ source: 'none', reason: 'no_delivering_ads' })).toContain(
      '没有正在投放的广告',
    )
    expect(renderRuleSection({ source: 'none', reason: 'preparing' })).toContain(
      '单条广告检查还在准备中',
    )
    expect(renderRuleSection({ source: 'none', reason: 'incomplete_findings' })).toContain(
      '数据不完整',
    )
  })
})

describe('formatters', () => {
  it('formatMoney', () => {
    expect(formatMoney(12.3, 'NZD')).toBe('NZ$12.30')
    expect(formatMoney(5, 'AUD')).toBe('A$5.00')
    expect(formatMoney(5, 'USD')).toBe('US$5.00')
    expect(formatMoney(5, 'CNY')).toBe('CNY 5.00')
    expect(formatMoney(null, 'NZD')).toBe('—')
    expect(formatMoney(5, null)).toBe('5.00')
  })

  it('formatDay', () => {
    expect(formatDay('2026-09-24')).toBe('9月24日')
  })

  it('formatPct', () => {
    expect(formatPct(0.0391)).toBe('3.9%')
  })
})

const selfServeOpts = (freq: number | null = null) => ({
  currency: 'NZD',
  dataDate: '2026-09-24',
  campaignFrequency: () => freq,
  voice: 'self_serve' as const,
})

describe('toClientFinding — self_serve voice', () => {
  it('D10 lead suggests editing the form', () => {
    const f = toClientFinding(
      hit('D10', {
        core_metric: 'lead',
        baseline_source: 'own_history',
        base_rate: 0.16,
        recent_rate: 0.039,
        base_cost_per_result: 7.05,
        recent_cost_per_result: 33.5,
        recent_spend: 167.48,
      }),
      selfServeOpts(),
    )
    expect(f).not.toBeNull()
    expect((f as ClientRuleFinding).action).toBe(
      '表单发布后不能直接改：给这条广告换一个新表单（可以复制原来的），只留非问不可的问题，再看两三天。',
    )
  })

  it('D10 messaging suggests editing the welcome message', () => {
    const f = toClientFinding(
      hit('D10', {
        core_metric: 'messaging_started',
        baseline_source: 'own_history',
        base_rate: 0.2,
        recent_rate: 0.05,
        base_cost_per_result: 6,
        recent_cost_per_result: 20,
        recent_spend: 60,
      }),
      selfServeOpts(),
    )
    expect(f).not.toBeNull()
    expect((f as ClientRuleFinding).action).toBe(
      '把私信欢迎语的第一句改成直接回答顾客最常问的（价格、地址、怎么约），再看两三天。',
    )
  })

  it('D2 creative suggests swapping the image or video', () => {
    const f = toClientFinding(
      hit('D2', { base_rate: 0.02, recent_rate: 0.01, frequency_7d: 1.7, fatigue_kind: 'creative' }),
      selfServeOpts(),
    )
    expect(f).not.toBeNull()
    expect((f as ClientRuleFinding).action).toBe('换一张新图或新视频试试，文字和受众先不动。')
  })

  it('D2 audience suggests swapping the audience', () => {
    const f = toClientFinding(
      hit('D2', { base_rate: 0.02, recent_rate: 0.01, frequency_7d: 3.6, fatigue_kind: 'audience' }),
      selfServeOpts(),
    )
    expect(f).not.toBeNull()
    expect((f as ClientRuleFinding).action).toBe(
      '先换一版新图或新视频；过几天还不行，再把这组广告的地区或年龄放宽一点。',
    )
  })

  it('D2 unknown kind suggests swapping the image or video', () => {
    const f = toClientFinding(
      hit('D2', { base_rate: 0.02, recent_rate: 0.01, frequency_7d: null }),
      selfServeOpts(null),
    )
    expect(f).not.toBeNull()
    expect((f as ClientRuleFinding).action).toBe('先换一张新图或新视频试试，文字和受众先不动。')
  })

  it('managed voice keeps the ask sentence', () => {
    const f = toClientFinding(
      hit('D10', {
        core_metric: 'lead',
        baseline_source: 'own_history',
        base_rate: 0.16,
        recent_rate: 0.039,
        base_cost_per_result: 7.05,
        recent_cost_per_result: 33.5,
        recent_spend: 167.48,
      }),
      opts(),
    )
    expect(f).not.toBeNull()
    expect((f as ClientRuleFinding).action).toContain('如果你最近自己改过这条广告的表单，请告诉我们。')
  })
})

describe('renderRuleSection — live', () => {
  const liveFinding: ClientRuleFinding = {
    kind: 'fatigue',
    adName: 'A',
    headline: 'HEADLINE_ONE',
    detail: 'DETAIL_ONE',
    action: '换一张新图或新视频试试，文字和受众先不动。',
    spend: 100,
    explainsCtr: true,
  }

  it('with findings shows intro and footer exactly once and no managed wording', () => {
    const out = renderRuleSection({
      source: 'live',
      dataDate: '2026-09-24',
      adsChecked: 12,
      findings: [liveFinding],
    })
    expect(out.startsWith('三、需要留意的广告')).toBe(true)
    expect(out.split(SELF_SERVE_INTRO)).toHaveLength(2)
    expect(out.split(SELF_SERVE_FOOTER)).toHaveLength(2)
    expect(out).not.toContain('你不用动手')
    expect(out).not.toContain('请告诉我们')
    expect(out).toContain('HEADLINE_ONE')
    expect(out).toContain('DETAIL_ONE')
  })

  it('without findings shows the self-serve empty text', () => {
    const out = renderRuleSection({
      source: 'live',
      dataDate: '2026-09-24',
      adsChecked: 12,
      findings: [],
    })
    expect(out).toBe(
      '三、需要留意的广告\n这次没发现需要你动的广告（看了 12 条在花钱的广告，数据截至 9月24日）。',
    )
  })
})

describe('renderRuleSection — new none reasons', () => {
  it('mixed_pages', () => {
    expect(renderRuleSection({ source: 'none', reason: 'mixed_pages' })).toContain(
      '你的账户同时给好几个主页投广告，这次没法判断哪个是你的主页',
    )
  })

  it('too_many_ads', () => {
    expect(renderRuleSection({ source: 'none', reason: 'too_many_ads' })).toContain(
      '在花钱的广告太多，一次看不完',
    )
  })

  it('live_unavailable', () => {
    expect(renderRuleSection({ source: 'none', reason: 'live_unavailable' })).toContain(
      '这次没拿到每条广告的数据',
    )
  })
})
