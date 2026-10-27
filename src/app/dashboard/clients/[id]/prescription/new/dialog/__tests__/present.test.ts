import { describe, expect, it } from 'vitest'
import { layoutParagraphs, splitMetricFormula, statusNotice } from '../present'

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
