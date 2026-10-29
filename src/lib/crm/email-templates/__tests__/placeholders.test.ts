import { describe, it, expect } from 'vitest'
import {
  COMMON_VARIABLES,
  INPUT_VARIABLE_RE,
  scanPlaceholders,
  validateTemplateText,
  substitute,
  hasUnresolvedBraces,
} from '@/lib/crm/email-templates/placeholders'
import type { ProviderValue, VariableSpec } from '@/lib/crm/email-templates/facts/types'
import type { PickMode } from '@/lib/crm/email-templates/types'

const providerVars: Readonly<Record<string, VariableSpec>> = {
  tour_name: { pickModes: ['one'], list: false, multiline: false },
  tour_highlights: { pickModes: ['one'], list: true, multiline: true },
  tour_cards: { pickModes: ['many'], list: false, multiline: true },
}

describe('constants', () => {
  it('exposes common variables', () => {
    expect(COMMON_VARIABLES).toEqual(['first_name', 'sender_name', 'call_when'])
  })

  it('input variable regex accepts lowercase names', () => {
    expect(INPUT_VARIABLE_RE.test('input.note')).toBe(true)
    expect(INPUT_VARIABLE_RE.test('input.Bad')).toBe(false)
  })
})

describe('scanPlaceholders', () => {
  it('finds refs with correct offsets', () => {
    const text = 'Hi {{first_name}}, see {{ tour_name }}.'
    const refs = scanPlaceholders(text)
    expect(refs).toHaveLength(2)
    expect(refs[0]).toMatchObject({ name: 'first_name', count: null, start: 3 })
    expect(refs[0].raw).toBe('{{first_name}}')
    expect(refs[0].end).toBe(3 + '{{first_name}}'.length)
    expect(refs[1]).toMatchObject({ name: 'tour_name', count: null })
    expect(refs[1].raw).toBe('{{ tour_name }}')
    expect(text.slice(refs[1].start, refs[1].end)).toBe('{{ tour_name }}')
  })

  it('tolerates spaces and count suffix', () => {
    const refs = scanPlaceholders('{{ tour_highlights : 3 }}')
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ name: 'tour_highlights', count: 3 })
  })

  it('returns refs in order of appearance', () => {
    const refs = scanPlaceholders('{{first_name}} {{sender_name}} {{call_when}}')
    expect(refs.map((r) => r.name)).toEqual(['first_name', 'sender_name', 'call_when'])
  })
})

describe('validateTemplateText', () => {
  const validate = (text: string, field: 'subject' | 'body', pickMode: PickMode): string[] =>
    validateTemplateText(text, field, pickMode, providerVars)

  it('accepts a valid body', () => {
    expect(validate('Hi {{first_name}}', 'body', 'one')).toEqual([])
  })

  it('reports unknown variable', () => {
    expect(validate('{{nope}}', 'body', 'one')).toEqual(['未知变量 {{nope}}'])
  })

  it('accepts input.note', () => {
    expect(validate('{{input.note}}', 'body', 'none')).toEqual([])
  })

  it('rejects input.Bad', () => {
    // Uppercase name does not match the placeholder name pattern, so it is a format error.
    expect(validate('{{input.Bad}}', 'body', 'none')).toEqual(['占位符格式不正确'])
  })

  it('requires matching pickMode for provider variables', () => {
    expect(validate('{{tour_name}}', 'body', 'many')).toEqual([
      '变量 {{tour_name}} 与选团方式不匹配',
    ])
    expect(validate('{{tour_name}}', 'body', 'one')).toEqual([])
  })

  it('allows count suffix on list variable', () => {
    expect(validate('{{tour_highlights:3}}', 'body', 'one')).toEqual([])
  })

  it('rejects count suffix on non-list variable', () => {
    expect(validate('{{tour_name:2}}', 'body', 'one')).toEqual([
      '变量 {{tour_name}} 不支持数量后缀',
    ])
  })

  it('rejects count 0 and 21', () => {
    expect(validate('{{tour_highlights:0}}', 'body', 'one')).toEqual([
      '变量 {{tour_highlights}} 的数量后缀超出范围（1-20）',
    ])
    expect(validate('{{tour_highlights:21}}', 'body', 'one')).toEqual([
      '变量 {{tour_highlights}} 的数量后缀超出范围（1-20）',
    ])
  })

  it('rejects multiline variable in subject but allows in body', () => {
    expect(validate('{{tour_highlights}}', 'subject', 'one')).toEqual([
      '主题里不能用多行变量 {{tour_highlights}}',
    ])
    expect(validate('{{tour_highlights}}', 'body', 'one')).toEqual([])
  })

  it('reports stray braces', () => {
    expect(validate('hello {{ world', 'body', 'one')).toEqual(['占位符格式不正确'])
    expect(validate('{{}}', 'body', 'one')).toEqual(['占位符格式不正确'])
  })

  it('reports duplicates once', () => {
    expect(validate('{{nope}} {{nope}}', 'body', 'one')).toEqual(['未知变量 {{nope}}'])
  })
})

describe('substitute', () => {
  const ok = (value: string): ProviderValue => ({ ok: true, value })
  const missing = (label: string): ProviderValue => ({ ok: false, missing: label })

  it('replaces all occurrences', () => {
    const result = substitute('{{first_name}} and {{first_name}}', () => ok('Ann'))
    expect(result.text).toBe('Ann and Ann')
    expect(result.missing).toEqual([])
  })

  it('inserts replacement-like values verbatim', () => {
    const value = "$1,999 $& $'"
    const result = substitute('Price: {{tour_name}}', () => ok(value))
    expect(result.text).toBe(`Price: ${value}`)
  })

  it('does not re-expand inserted values', () => {
    const result = substitute('{{tour_name}}', () => ok('{{first_name}}'))
    expect(result.text).toBe('{{first_name}}')
    expect(hasUnresolvedBraces(result.text)).toBe(true)
  })

  it('collects missing labels unique in order and keeps placeholder', () => {
    const result = substitute('{{tour_name}} {{tour_cards}} {{tour_name}}', (ref) =>
      ref.name === 'tour_name' ? missing('tour_name') : missing('tour_cards'),
    )
    expect(result.text).toBe('{{tour_name}} {{tour_cards}} {{tour_name}}')
    expect(result.missing).toEqual(['tour_name', 'tour_cards'])
  })

  it('leaves text without placeholders unchanged', () => {
    const result = substitute('plain text', () => ok('x'))
    expect(result.text).toBe('plain text')
    expect(result.missing).toEqual([])
  })
})
