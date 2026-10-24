import { describe, expect, it } from 'vitest'

import {
  budgetBandCode,
  formFactsLine,
  travelWindowCode,
} from '../form-facts'

describe('travelWindowCode', () => {
  it('maps the eight example labels (en dash)', () => {
    expect(travelWindowCode('March – May 2027')).toBe('mar_may_2027')
    expect(travelWindowCode('June – September 2027')).toBe('jun_sep_2027')
    expect(travelWindowCode('October – December 2027')).toBe('oct_dec_2027')
    expect(travelWindowCode('Not sure yet')).toBe('not_sure')
  })

  it('accepts hyphen, en dash and em dash', () => {
    expect(travelWindowCode('March - May 2027')).toBe('mar_may_2027')
    expect(travelWindowCode('March – May 2027')).toBe('mar_may_2027')
    expect(travelWindowCode('March — May 2027')).toBe('mar_may_2027')
  })

  it('tolerates extra spaces and mixed case', () => {
    expect(travelWindowCode('  march   –   may   2027  ')).toBe('mar_may_2027')
    expect(travelWindowCode('JUNE – SEPTEMBER 2027')).toBe('jun_sep_2027')
    expect(travelWindowCode('October—December 2027')).toBe('oct_dec_2027')
    expect(travelWindowCode('NOT SURE YET')).toBe('not_sure')
  })

  it('returns null for unknown strings', () => {
    expect(travelWindowCode('June 2028')).toBeNull()
    expect(travelWindowCode('asap')).toBeNull()
    expect(travelWindowCode('')).toBeNull()
    expect(travelWindowCode(null)).toBeNull()
    expect(travelWindowCode(undefined)).toBeNull()
  })

  it('never does fuzzy/substring matching', () => {
    expect(travelWindowCode('March – May 2027 please')).toBeNull()
    expect(travelWindowCode('March – May')).toBeNull()
  })
})

describe('budgetBandCode', () => {
  it('maps the four example labels', () => {
    expect(budgetBandCode('Under $3,000')).toBe('under_3000')
    expect(budgetBandCode('$3,000 – $5,000')).toBe('3000_5000')
    expect(budgetBandCode('$5,000 – $8,000')).toBe('5000_8000')
    expect(budgetBandCode('Above $8,000')).toBe('above_8000')
  })

  it('accepts hyphen, en dash and em dash', () => {
    expect(budgetBandCode('$3,000 - $5,000')).toBe('3000_5000')
    expect(budgetBandCode('$3,000 – $5,000')).toBe('3000_5000')
    expect(budgetBandCode('$3,000 — $5,000')).toBe('3000_5000')
  })

  it('tolerates extra spaces and mixed case', () => {
    expect(budgetBandCode('  under   $3,000  ')).toBe('under_3000')
    expect(budgetBandCode('ABOVE $8,000')).toBe('above_8000')
    expect(budgetBandCode('$5,000—$8,000')).toBe('5000_8000')
  })

  it('returns null for unknown strings', () => {
    expect(budgetBandCode('June 2028')).toBeNull()
    expect(budgetBandCode('asap')).toBeNull()
    expect(budgetBandCode('')).toBeNull()
    expect(budgetBandCode(null)).toBeNull()
    expect(budgetBandCode(undefined)).toBeNull()
  })
})

describe('formFactsLine', () => {
  it('renders both parts joined with " · "', () => {
    expect(
      formFactsLine({ travelWindow: 'mar_may_2027', budgetBand: '3000_5000' }),
    ).toBe('预计 2027 年 3–5 月出发 · 预算 3,000–5,000/人')
  })

  it('renders only the travel window when budget is missing', () => {
    expect(formFactsLine({ travelWindow: 'not_sure' })).toBe('出发时间还没定')
  })

  it('renders only the budget when travel window is missing', () => {
    expect(formFactsLine({ budgetBand: 'above_8000' })).toBe('预算 8,000 以上/人')
  })

  it('returns null when both parts are missing', () => {
    expect(formFactsLine({})).toBeNull()
    expect(formFactsLine(null)).toBeNull()
    expect(formFactsLine(undefined)).toBeNull()
  })

  it('omits unknown codes rather than showing zero or a placeholder', () => {
    expect(formFactsLine({ travelWindow: 'bogus', budgetBand: '3000_5000' })).toBe(
      '预算 3,000–5,000/人',
    )
    expect(formFactsLine({ travelWindow: 'mar_may_2027', budgetBand: 'bogus' })).toBe(
      '预计 2027 年 3–5 月出发',
    )
    expect(formFactsLine({ travelWindow: 'bogus', budgetBand: 'bogus' })).toBeNull()
    expect(formFactsLine({ travelWindow: null, budgetBand: null })).toBeNull()
  })
})
