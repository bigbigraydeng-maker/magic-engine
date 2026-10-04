import { describe, it, expect } from 'vitest'
import { normalizeAccountId, parseActivateInput } from '../deps'

/** 一份合法的 runInput（蛇形命名，和 Kernel 传入的一致）。 */
function validRunInput(): Record<string, unknown> {
  return {
    draft_action_id: 'draft-1',
    draft_hash: 'hash-1',
    ad_account_id: 'act_111',
    campaign_id: 'c1',
    ad_set_id: 's1',
    ad_ids: ['111', '222'],
    daily_budget_cents: 500,
    currency: 'NZD',
    cap_cents_snapshot: 15000,
    meta_fingerprint: { campaign: 'fc', adSet: 'fs', ads: { '111': 'fa1', '222': 'fa2' } },
  }
}

describe('normalizeAccountId', () => {
  it('去掉 act_ 前缀', () => {
    expect(normalizeAccountId('act_123')).toBe('123')
  })

  it('没有前缀时原样返回', () => {
    expect(normalizeAccountId('123')).toBe('123')
  })

  it('先 trim 再去前缀', () => {
    expect(normalizeAccountId('  act_123  ')).toBe('123')
  })

  it('空串返回空串', () => {
    expect(normalizeAccountId('')).toBe('')
  })

  it('只去掉开头一个 act_', () => {
    expect(normalizeAccountId('act_act_1')).toBe('act_1')
  })
})

describe('parseActivateInput 合法输入', () => {
  it('解析成功并归一化账户号，其余字段逐一相等', () => {
    const input = validRunInput()
    const result = parseActivateInput(input)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.adAccountId).toBe('111')
    expect(result.value.draftActionId).toBe('draft-1')
    expect(result.value.draftHash).toBe('hash-1')
    expect(result.value.campaignId).toBe('c1')
    expect(result.value.adSetId).toBe('s1')
    expect(result.value.adIds).toEqual(['111', '222'])
    expect(result.value.dailyBudgetCents).toBe(500)
    expect(result.value.currency).toBe('NZD')
    expect(result.value.capCentsSnapshot).toBe(15000)
    expect(result.value.metaFingerprint).toEqual({
      campaign: 'fc',
      adSet: 'fs',
      ads: { '111': 'fa1', '222': 'fa2' },
    })
  })
})

describe('parseActivateInput 必填字符串字段', () => {
  const stringFields = [
    'draft_action_id',
    'draft_hash',
    'ad_account_id',
    'campaign_id',
    'ad_set_id',
    'currency',
  ] as const

  const badValues: Array<{ label: string; value: unknown }> = [
    { label: '缺失', value: undefined },
    { label: '空串', value: '' },
    { label: '纯空白', value: '   ' },
    { label: '非字符串（数字 5）', value: 5 },
  ]

  const cases = stringFields.flatMap((field) =>
    badValues.map((bad) => ({ field, label: bad.label, value: bad.value })),
  )

  it.each(cases)('$field 为 $label 时失败且 error 含字段名', ({ field, value }) => {
    const input = { ...validRunInput(), [field]: value }
    const result = parseActivateInput(input)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain(field)
  })
})

describe('parseActivateInput ad_ids', () => {
  const cases: Array<{ label: string; value: unknown }> = [
    { label: '缺失', value: undefined },
    { label: '不是数组', value: 'not-an-array' },
    { label: '空数组', value: [] },
    { label: '全是空串', value: ['', ''] },
    { label: '含非字符串元素', value: ['111', 222] },
  ]

  it.each(cases)('ad_ids $label 时失败且 error 含 ad_ids', ({ value }) => {
    const input = { ...validRunInput(), ad_ids: value }
    const result = parseActivateInput(input)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('ad_ids')
  })
})

describe('parseActivateInput 正整数金额字段', () => {
  const intFields = ['daily_budget_cents', 'cap_cents_snapshot'] as const

  const badValues: Array<{ label: string; value: unknown }> = [
    { label: '缺失', value: undefined },
    { label: '0', value: 0 },
    { label: '负数', value: -1 },
    { label: '小数', value: 1.5 },
    { label: '字符串 500', value: '500' },
    { label: 'NaN', value: Number.NaN },
  ]

  const cases = intFields.flatMap((field) =>
    badValues.map((bad) => ({ field, label: bad.label, value: bad.value })),
  )

  it.each(cases)('$field 为 $label 时失败且 error 含字段名', ({ field, value }) => {
    const input = { ...validRunInput(), [field]: value }
    const result = parseActivateInput(input)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain(field)
  })
})

describe('parseActivateInput meta_fingerprint', () => {
  const cases: Array<{ label: string; value: unknown }> = [
    { label: '缺失', value: undefined },
    { label: '不是对象', value: 'nope' },
    { label: '数组', value: [] },
    { label: 'campaign 为空', value: { campaign: '', adSet: 'fs', ads: { '111': 'fa1' } } },
    { label: 'adSet 不是字符串', value: { campaign: 'fc', adSet: 5, ads: { '111': 'fa1' } } },
    { label: 'ads 缺失', value: { campaign: 'fc', adSet: 'fs' } },
    { label: 'ads 为空对象', value: { campaign: 'fc', adSet: 'fs', ads: {} } },
    {
      label: 'ads 的值含非字符串',
      value: { campaign: 'fc', adSet: 'fs', ads: { '111': 5 } },
    },
  ]

  it.each(cases)('meta_fingerprint $label 时失败且 error 含 meta_fingerprint', ({ value }) => {
    const input = { ...validRunInput(), meta_fingerprint: value }
    const result = parseActivateInput(input)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('meta_fingerprint')
  })
})

describe('parseActivateInput 多余字段', () => {
  it('多余字段不影响解析，且 value 里不带多余字段', () => {
    const input = { ...validRunInput(), foo: 1 }
    const result = parseActivateInput(input)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.keys(result.value)).not.toContain('foo')
  })
})

describe('parseActivateInput 不修改入参', () => {
  it('解析后入参保持原样', () => {
    const input = validRunInput()
    const snapshot = structuredClone(input)
    parseActivateInput(input)
    expect(input).toEqual(snapshot)
  })
})
