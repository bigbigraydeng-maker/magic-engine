/**
 * Pure-function tests for the mining pipeline (issue #1645). Real-message
 * fixtures are NAL (New Asian Logistics) production message shapes, same
 * style already used for sensitivity.test.ts.
 */

import { describe, it, expect } from 'vitest'
import {
  assertMiningBudget,
  normaliseTemplateKey,
  groupMessagesIntoTemplates,
  redactPersonalInfo,
  validateNumberProvenance,
  classifyCandidateSpecificity,
  computeValueSignature,
  computeCandidateFingerprint,
  groupCandidatesByConflict,
  estimateWorstCaseExtractionCostUsd,
  type RawMessage,
  type ConflictMember,
} from '../mining'

const REAL_MAIN_TEMPLATE =
  'Shipping rates\n' +
  '• Under 20 kg: NZD 4/kg\n' +
  '• 20 kg or more: NZD 2/kg\n' +
  'Service fees per shipment\n' +
  '• General goods: NZD 12\n' +
  '• Food products: NZD 24\n' +
  'Please note that food and general goods must be packed, shipped and charged separately.'

const REAL_MISTYPED_TEMPLATE =
  'Shipping rates\n' +
  '• Under 10 kg: NZD 4/kg\n' +
  '• 20 kg or more: NZD 2/kg\n' +
  'Service fees per shipment\n' +
  '• General goods: NZD 12\n' +
  '• Food products: NZD 24'

const REAL_138KG_QUOTE =
  'Based on the estimated chargeable weight of 138 kg, the total would be approximately:\n\n' +
  'Freight: 138 kg × NZD 4 = NZD 552\n' +
  'Service fee: NZD 12\n' +
  'Customs declaration fee: NZD 57.50\n' +
  'Rural delivery surcharge: NZD 35\n\n' +
  'Estimated total: NZD 656.50'

const REAL_CHINESE_ADDRESS_BLOCK =
  '收件地址：广东省广州市花都区花东镇北兴花侨花都大道东439号B栋一楼淘急集集运28967\n' +
  '收件人：TJJ28967 - Praash\n' +
  '电话：13682374589\n' +
  '邮编：510890'

// ── assertMiningBudget ───────────────────────────────────────────────────

describe('assertMiningBudget', () => {
  it('accepts a fully specified budget', () => {
    expect(() => assertMiningBudget({ maxMessages: 500, maxModelCalls: 20, maxSpendUsd: 5 })).not.toThrow()
  })

  it.each([
    ['missing entirely', undefined],
    ['null', null],
    ['missing maxMessages', { maxModelCalls: 20, maxSpendUsd: 5 }],
    ['zero maxMessages', { maxMessages: 0, maxModelCalls: 20, maxSpendUsd: 5 }],
    ['negative maxMessages', { maxMessages: -1, maxModelCalls: 20, maxSpendUsd: 5 }],
    ['missing maxModelCalls', { maxMessages: 500, maxSpendUsd: 5 }],
    ['zero maxModelCalls', { maxMessages: 500, maxModelCalls: 0, maxSpendUsd: 5 }],
    ['missing maxSpendUsd', { maxMessages: 500, maxModelCalls: 20 }],
    ['zero maxSpendUsd', { maxMessages: 500, maxModelCalls: 20, maxSpendUsd: 0 }],
  ] as const)('refuses to run when %s', (_label, budget) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => assertMiningBudget(budget as any)).toThrow()
  })
})

// ── template merging ─────────────────────────────────────────────────────

describe('normaliseTemplateKey', () => {
  it('collapses whitespace/newline noise but preserves every digit', () => {
    const a = normaliseTemplateKey('Under  20 kg:\nNZD 4/kg')
    const b = normaliseTemplateKey('Under 20 kg: NZD 4/kg')
    expect(a).toBe(b)
  })

  it('does NOT merge "Under 20 kg" and "Under 10 kg" — 51 vs 28 must stay distinct templates', () => {
    expect(normaliseTemplateKey(REAL_MAIN_TEMPLATE)).not.toBe(normaliseTemplateKey(REAL_MISTYPED_TEMPLATE))
  })
})

describe('groupMessagesIntoTemplates', () => {
  function outbound(body: string, sentAt: string, conversationId = 'c1'): RawMessage {
    return { body, sentAt, direction: 'outbound', conversationId }
  }
  function inbound(body: string, sentAt: string, conversationId = 'c1'): RawMessage {
    return { body, sentAt, direction: 'inbound', conversationId }
  }

  it('merges only exact-duplicate templates and counts occurrences', () => {
    const messages: RawMessage[] = [
      outbound(REAL_MAIN_TEMPLATE, '2026-01-01T00:00:00Z', 'c1'),
      outbound(REAL_MAIN_TEMPLATE, '2026-01-02T00:00:00Z', 'c2'),
      outbound(REAL_MISTYPED_TEMPLATE, '2026-01-03T00:00:00Z', 'c3'),
    ]
    const templates = groupMessagesIntoTemplates(messages)
    expect(templates).toHaveLength(2)
    const main = templates.find((t) => t.sampleBody === REAL_MAIN_TEMPLATE)
    const mistyped = templates.find((t) => t.sampleBody === REAL_MISTYPED_TEMPLATE)
    expect(main?.count).toBe(2)
    expect(mistyped?.count).toBe(1)
  })

  it('pairs each template with the immediately preceding customer question, per conversation', () => {
    const messages: RawMessage[] = [
      inbound('what is the price for 20kg?', '2026-01-01T00:00:00Z', 'c1'),
      outbound(REAL_MAIN_TEMPLATE, '2026-01-01T00:01:00Z', 'c1'),
    ]
    expect(groupMessagesIntoTemplates(messages)[0].precedingCustomerQuestion).toBe('what is the price for 20kg?')
  })

  it('leaves precedingCustomerQuestion null when the template opens the conversation', () => {
    const messages: RawMessage[] = [outbound(REAL_MAIN_TEMPLATE, '2026-01-01T00:00:00Z', 'c1')]
    expect(groupMessagesIntoTemplates(messages)[0].precedingCustomerQuestion).toBeNull()
  })

  it('ignores inbound messages as templates', () => {
    const messages: RawMessage[] = [inbound('do you ship to Hamilton?', '2026-01-01T00:00:00Z', 'c1')]
    expect(groupMessagesIntoTemplates(messages)).toEqual([])
  })

  it('counts distinctConversationCount separately from raw count — same template, 3 different customers', () => {
    const messages: RawMessage[] = [
      outbound(REAL_MAIN_TEMPLATE, '2026-01-01T00:00:00Z', 'c1'),
      outbound(REAL_MAIN_TEMPLATE, '2026-01-02T00:00:00Z', 'c2'),
      outbound(REAL_MAIN_TEMPLATE, '2026-01-03T00:00:00Z', 'c3'),
    ]
    const template = groupMessagesIntoTemplates(messages)[0]
    expect(template.count).toBe(3)
    expect(template.distinctConversationCount).toBe(3)
  })

  it('counts distinctConversationCount as 1 when the same template is repeated to the SAME customer', () => {
    const messages: RawMessage[] = [
      outbound(REAL_MAIN_TEMPLATE, '2026-01-01T00:00:00Z', 'c1'),
      outbound(REAL_MAIN_TEMPLATE, '2026-01-02T00:00:00Z', 'c1'),
      outbound(REAL_MAIN_TEMPLATE, '2026-01-03T00:00:00Z', 'c1'),
    ]
    const template = groupMessagesIntoTemplates(messages)[0]
    expect(template.count).toBe(3)
    expect(template.distinctConversationCount).toBe(1)
  })
})

// ── PII redaction ────────────────────────────────────────────────────────

describe('redactPersonalInfo', () => {
  it('redacts a real Chinese address block (province/city/district/street/number/building markers)', () => {
    const result = redactPersonalInfo(REAL_CHINESE_ADDRESS_BLOCK)
    expect(result.text).not.toContain('花都区')
    expect(result.hits).toContain('address')
  })

  it('redacts an email address', () => {
    const result = redactPersonalInfo('Contact us at support@nal-logistics.co.nz for more info')
    expect(result.text).not.toContain('support@nal-logistics.co.nz')
    expect(result.hits).toContain('email')
  })

  it('redacts a real ANZ-format phone number WITH separators', () => {
    const result = redactPersonalInfo('Call us on 021 234 5678 anytime')
    expect(result.text).not.toContain('234 5678')
    expect(result.hits).toContain('phone_or_postcode')
  })

  it('does NOT falsely redact a short digit run below the phone-digit threshold', () => {
    const result = redactPersonalInfo('Under 20 kg: NZD 4/kg')
    expect(result.text).toBe('Under 20 kg: NZD 4/kg')
    expect(result.hits).toEqual([])
  })

  it('redacts a tracking/order number shape (letters+digits)', () => {
    const result = redactPersonalInfo('Your tracking number is TJJ28967')
    expect(result.text).not.toContain('TJJ28967')
    expect(result.hits).toContain('tracking_number')
  })

  it('preserves business numbers (rates/fees) untouched — only PII shapes are redacted', () => {
    const result = redactPersonalInfo(REAL_MAIN_TEMPLATE)
    expect(result.text).toBe(REAL_MAIN_TEMPLATE)
    expect(result.hits).toEqual([])
  })

  // 魏征复审（2026-09-14）实测确认的高危缺口：跑代码验证过原实现对这条最
  // 普通的新西兰英文送货地址完全不脱敏，整句原样发给 Anthropic API。
  it('redacts a real English NZ street address (the exact gap 魏征 found empirically)', () => {
    const result = redactPersonalInfo('Please deliver to 42 Ponsonby Road, Grey Lynn, Auckland 1021')
    expect(result.text).not.toContain('Ponsonby')
    expect(result.text).not.toContain('1021')
    expect(result.hits).toContain('address')
  })

  it('redacts an English address with a unit number prefix', () => {
    const result = redactPersonalInfo('Unit 3, 15 Beach Road, Papakura')
    expect(result.text).not.toContain('Beach Road')
    expect(result.hits).toContain('address')
  })

  it('redacts a labelled recipient name (Chinese label)', () => {
    const result = redactPersonalInfo('收件人：Praash')
    expect(result.text).not.toContain('Praash')
    expect(result.hits).toContain('name')
  })

  it('redacts a labelled recipient name (English label)', () => {
    const result = redactPersonalInfo('Recipient: John Smith')
    expect(result.text).not.toContain('John Smith')
    expect(result.hits).toContain('name')
  })

  it('redacts the name in the exact fixture line 魏征 found leaking a name (tracking number line with a trailing name)', () => {
    // The real fixture's "收件人：TJJ28967 - Praash" line is itself labelled
    // with 收件人 — the name-label rule now catches the whole remainder of
    // that line, including the previously-leaking "Praash".
    const result = redactPersonalInfo('收件人：TJJ28967 - Praash')
    expect(result.text).not.toContain('Praash')
    expect(result.hits).toContain('name')
  })

  it('does NOT misredact a traditional-Chinese-only address as a phone/tracking number (regression: address check runs first)', () => {
    const result = redactPersonalInfo('地址：台北市信義區信義路五段7號')
    expect(result.hits).toContain('address')
  })

  // 魏征复审（2026-09-14）实测确认的真 bug：原 PHONE_CANDIDATE_PATTERN 把
  // 句点当分隔符，会把 "NZD 1234.56" 这类真实报价金额当成电话号码抹掉。
  it('does NOT misredact a decimal money amount as a phone number', () => {
    const result = redactPersonalInfo('Total NZD 1234.56 today')
    expect(result.text).toBe('Total NZD 1234.56 today')
    expect(result.hits).toEqual([])
  })
})

// ── number provenance ────────────────────────────────────────────────────

describe('validateNumberProvenance', () => {
  it('accepts a candidate whose numbers all appear verbatim in the source', () => {
    expect(validateNumberProvenance('Under 20 kg: NZD 4/kg', { rate: 4 }, REAL_MAIN_TEMPLATE)).toBe(true)
  })

  it('rejects a candidate with a fabricated number not present in the source (hallucination guard)', () => {
    expect(validateNumberProvenance('Under 20 kg: NZD 9/kg', { rate: 9 }, REAL_MAIN_TEMPLATE)).toBe(false)
  })

  it('does not false-positive-reject on "NZ$4" vs "4 纽币" style formatting differences', () => {
    expect(validateNumberProvenance('价格是 4 纽币每公斤', null, 'NZ$4/kg for parcels under 20kg')).toBe(true)
  })

  it('trivially accepts a candidate with no numbers at all', () => {
    expect(validateNumberProvenance('We ship worldwide', null, 'Some unrelated source text')).toBe(true)
  })

  // 魏征复审（2026-09-14）实测确认的真 bug：千分位逗号会把 "1,000" 拆成
  // 两个独立数字 1 和 0，候选侧写的完整 "1000" 永远核不到——合法候选被
  // 误杀。物流报价过千用千分位写法很常见，不是边缘场景。
  it('does not false-positive-reject a value written with a thousand-separator comma in the source', () => {
    expect(
      validateNumberProvenance(
        'Orders over NZD 1000 incur a NZD 50 surcharge.',
        { threshold: 1000, surcharge: 50 },
        'Rush fee for orders over NZD 1,000: NZD 50 surcharge applies.',
      ),
    ).toBe(true)
  })

  it('still rejects a genuinely fabricated number even when the source has comma-grouped numbers nearby', () => {
    expect(
      validateNumberProvenance('Orders over NZD 1000 incur a NZD 99 surcharge.', { surcharge: 99 }, 'Rush fee for orders over NZD 1,000: NZD 50 surcharge applies.'),
    ).toBe(false)
  })
})

// ── deal-specific classification ─────────────────────────────────────────

describe('classifyCandidateSpecificity', () => {
  it('classifies as deal_specific when the model says so, regardless of occurrence count', () => {
    expect(
      classifyCandidateSpecificity({ occurrenceCount: 10, modelSaysDealSpecific: true, numbersMatchCustomerQuestion: false }),
    ).toBe('deal_specific')
  })

  it('classifies as deal_specific when it only occurred in one conversation, even if the model approves', () => {
    expect(
      classifyCandidateSpecificity({ occurrenceCount: 1, modelSaysDealSpecific: false, numbersMatchCustomerQuestion: false }),
    ).toBe('deal_specific')
  })

  it('classifies as deal_specific when the model gives no signal at all (fail-closed)', () => {
    expect(
      classifyCandidateSpecificity({ occurrenceCount: 5, modelSaysDealSpecific: null, numbersMatchCustomerQuestion: false }),
    ).toBe('deal_specific')
  })

  it('classifies as suspected_deal_specific when numbers echo the customer\'s own question', () => {
    expect(
      classifyCandidateSpecificity({ occurrenceCount: 5, modelSaysDealSpecific: false, numbersMatchCustomerQuestion: true }),
    ).toBe('suspected_deal_specific')
  })

  it('classifies a genuinely repeated, model-approved, non-echoing template as a reusable template', () => {
    expect(
      classifyCandidateSpecificity({ occurrenceCount: 5, modelSaysDealSpecific: false, numbersMatchCustomerQuestion: false }),
    ).toBe('template')
  })

  it('rejects the real 138kg one-off quote as deal_specific (single conversation)', () => {
    expect(
      classifyCandidateSpecificity({ occurrenceCount: 1, modelSaysDealSpecific: true, numbersMatchCustomerQuestion: false }),
    ).toBe('deal_specific')
  })
})

// ── conflict grouping ────────────────────────────────────────────────────

describe('computeValueSignature', () => {
  it('is stable regardless of object key order', () => {
    expect(computeValueSignature({ rate: 4, unit: 'NZD/kg' })).toBe(computeValueSignature({ unit: 'NZD/kg', rate: 4 }))
  })

  it('treats different rates as different signatures', () => {
    expect(computeValueSignature({ rate: 4 })).not.toBe(computeValueSignature({ rate: 9 }))
  })

  it('handles null/undefined structured values', () => {
    expect(computeValueSignature(null)).toBe(computeValueSignature(undefined))
  })
})

describe('computeCandidateFingerprint', () => {
  it('is identical for the same statement+value, regardless of call time', () => {
    const a = computeCandidateFingerprint('Under 20 kg: NZD 4/kg', { rate: 4 })
    const b = computeCandidateFingerprint('Under 20 kg: NZD 4/kg', { rate: 4 })
    expect(a).toBe(b)
  })

  it('differs when the statement or value differs', () => {
    const a = computeCandidateFingerprint('Under 20 kg: NZD 4/kg', { rate: 4 })
    const b = computeCandidateFingerprint('Under 20 kg: NZD 9/kg', { rate: 9 })
    expect(a).not.toBe(b)
  })
})

describe('groupCandidatesByConflict', () => {
  function member(overrides: Partial<ConflictMember>): ConflictMember {
    return { origin: 'candidate', refId: '0', factKey: 'rate.parcel.per_kg', unit: 'NZD/kg', valueSignature: 'x', ...overrides }
  }

  it('flags a group as conflicting when it contains two different values for the same fact_key+unit', () => {
    const groups = groupCandidatesByConflict([
      member({ refId: 'a', valueSignature: computeValueSignature({ rate: 4 }) }),
      member({ refId: 'b', valueSignature: computeValueSignature({ rate: 9 }) }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].hasConflict).toBe(true)
  })

  it('does not flag a group when all members assert the same value', () => {
    const groups = groupCandidatesByConflict([
      member({ refId: 'a', valueSignature: computeValueSignature({ rate: 4 }) }),
      member({ refId: 'b', valueSignature: computeValueSignature({ rate: 4 }) }),
    ])
    expect(groups[0].hasConflict).toBe(false)
  })

  it('forces same-unit members into one group even across different proposed scopes (§9.14-B: scope disambiguation is a human decision)', () => {
    const groups = groupCandidatesByConflict([
      member({ refId: 'a', unit: 'NZD/kg', valueSignature: 'sig-a' }),
      member({ refId: 'b', unit: 'NZD/kg', valueSignature: 'sig-b' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].members).toHaveLength(2)
  })

  it('keeps different fact_keys in separate groups', () => {
    const groups = groupCandidatesByConflict([
      member({ refId: 'a', factKey: 'rate.parcel.per_kg' }),
      member({ refId: 'b', factKey: 'rate.customs.fee' }),
    ])
    expect(groups).toHaveLength(2)
  })
})

// ── budget estimation ────────────────────────────────────────────────────

describe('estimateWorstCaseExtractionCostUsd', () => {
  it('is positive and scales up with prompt length', () => {
    const short = estimateWorstCaseExtractionCostUsd('short')
    const long = estimateWorstCaseExtractionCostUsd('a'.repeat(10_000))
    expect(short).toBeGreaterThan(0)
    expect(long).toBeGreaterThan(short)
  })
})
