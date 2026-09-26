import { describe, expect, it } from 'vitest'
import {
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
    expect(finding.detail).toContain('NZ$7.05')
    expect(finding.detail).toContain('NZ$33.50')
    expect(finding.detail).toContain('表单')
    expect(finding.action).toContain('10月1日')
    expect(finding.action).toContain('你不用动手')
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
    expect(finding.detail).toContain('NZ$20.00')
    expect(finding.detail).toContain('NZ$6.00')
    expect(finding.action).toContain('欢迎语或快捷问题')
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
    expect(finding.detail).toContain('还没有带来留下联系方式的客户')
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
    }
    const high: ClientRuleFinding = {
      kind: 'fatigue',
      adName: 'high',
      headline: 'HIGH_SPEND_HEADLINE',
      detail: 'd',
      action: 'a',
      spend: 100,
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
    expect(out).toContain('这次没有发现哪条广告明显变差')
    expect(out).toContain('看了 12 条正在投放的广告')
    expect(out).toContain('9月24日')
    expect(out.startsWith('三、需要留意的广告')).toBe(true)
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
    ]
    for (const reason of reasons) {
      const out = renderRuleSection({ source: 'none', reason })
      expect(out).toContain('这个广告账户这次没有做单条广告检查')
      expect(out.startsWith('三、需要留意的广告')).toBe(true)
      expectNoBanned(out)
    }
    expect(renderRuleSection({ source: 'none', reason: 'not_connected' })).toContain(
      '还没有接入每日检查',
    )
    expect(renderRuleSection({ source: 'none', reason: 'no_delivering_ads' })).toContain(
      '没有正在投放的广告',
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
