import { describe, expect, it } from 'vitest'
import type { PrescriptionIntake } from '@/types/diagnostic'
import { layoutParagraphs, personalIpFacts, splitMetricFormula, statusNotice } from '../present'

const INTAKE: PrescriptionIntake = {
  business_goal: '让更多人认识我',
  timeline_urgency: 'short_term',
  monthly_budget_aud: 500,
  priority_dimensions: [],
  notes: null,
}

describe('摘要卡的个人 IP 两行', () => {
  it('个人 IP 方案多「每周拍几条」和「按个人 IP 方案开」', () => {
    expect(personalIpFacts({ ...INTAKE, client_kind: 'personal_ip', weekly_shoot_count: 3 })).toEqual([
      { term: '每周拍几条', value: '3 条' },
      { term: '按个人 IP 方案开', value: '是' },
    ])
  })

  it('没问到条数时写读不到，不编', () => {
    expect(personalIpFacts({ ...INTAKE, client_kind: 'personal_ip', weekly_shoot_count: null })[0].value).toBe('读不到')
  })

  it('普通方案、老数据、没有 intake，都不多出行', () => {
    expect(personalIpFacts(INTAKE)).toEqual([])
    expect(personalIpFacts({ ...INTAKE, client_kind: 'standard' })).toEqual([])
    expect(personalIpFacts(null)).toEqual([])
  })
})

describe('处方全文只换行、不改字', () => {
  it('splits on 。 ； and numbered markers without dropping characters', () => {
    const raw = '先写清楚。第二天再看；然后停。（1）先停贵的（2）再换素材'
    expect(layoutParagraphs(raw)).toEqual([
      '先写清楚。',
      '第二天再看；',
      '然后停。',
      '（1）先停贵的',
      '（2）再换素材',
    ])
    expect(layoutParagraphs(raw).join('')).toBe(raw)
  })

  it('leaves a short line as one paragraph', () => {
    expect(layoutParagraphs('先把价格写清楚')).toEqual(['先把价格写清楚'])
  })
})

describe('指标里的算式', () => {
  it('keeps an ordinary name visible and hides the formula', () => {
    const metric = '一条线索的成本，继续线 $12 = 目标成本 C（按当前数据算，第 7 天重算）'
    expect(splitMetricFormula(metric)).toEqual({
      label: '一条线索的成本，继续线',
      formula: '$12 = 目标成本 C（按当前数据算，第 7 天重算）',
    })
  })

  it('does not treat a plain explanation as a formula', () => {
    const metric = '新增留资（客人填表留下联系方式）'
    expect(splitMetricFormula(metric)).toEqual({ label: metric, formula: null })
  })
})

describe('状态提示', () => {
  it('mentions the agree button only when that button is shown', () => {
    expect(statusNotice('draft', { approveShown: true, manual: false })).toContain('点「同意」')
    expect(statusNotice('draft', { approveShown: false, manual: true })).not.toContain('点「同意」')
    expect(statusNotice('approved', { approveShown: false, manual: true })).not.toContain('还没同意')
    expect(statusNotice('rejected', { approveShown: false, manual: false })).toContain('已退回')
  })
})
