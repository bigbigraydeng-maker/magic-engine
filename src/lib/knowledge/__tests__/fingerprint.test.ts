import { describe, it, expect } from 'vitest'
import { computeContentFingerprint, type FingerprintInput } from '../fingerprint'

function baseInput(): FingerprintInput {
  return {
    statement: '16-day Auckland Christmas tour is $7188 NZD per person',
    structuredValue: { amount: 7188, currency: 'NZD' },
    scope: { city: 'Auckland', days: 16 },
    validFrom: '2026-09-01T00:00:00.000Z',
    validUntil: '2026-12-24T00:00:00.000Z',
    visibility: 'customer_ok',
    sensitivity: 'price',
  }
}

describe('computeContentFingerprint', () => {
  it('is deterministic for identical input', () => {
    const a = computeContentFingerprint(baseInput())
    const b = computeContentFingerprint(baseInput())
    expect(a).toBe(b)
  })

  it('is stable across scope key order (object key order must not matter)', () => {
    const a = computeContentFingerprint({ ...baseInput(), scope: { city: 'Auckland', days: 16 } })
    const b = computeContentFingerprint({ ...baseInput(), scope: { days: 16, city: 'Auckland' } })
    expect(a).toBe(b)
  })

  // 每一项都是 issue §"变异测试:指纹任一组成项改动" 里点名的那 6 个组成项——
  // 正文/结构化值/范围/有效期(valid_from + valid_until)/visibility/sensitivity。
  it('changes when statement changes', () => {
    const a = computeContentFingerprint(baseInput())
    const b = computeContentFingerprint({ ...baseInput(), statement: 'a different statement' })
    expect(a).not.toBe(b)
  })

  it('changes when structuredValue changes', () => {
    const a = computeContentFingerprint(baseInput())
    const b = computeContentFingerprint({
      ...baseInput(),
      structuredValue: { amount: 6188, currency: 'NZD' },
    })
    expect(a).not.toBe(b)
  })

  it('changes when scope changes', () => {
    const a = computeContentFingerprint(baseInput())
    const b = computeContentFingerprint({ ...baseInput(), scope: { city: 'Christchurch', days: 15 } })
    expect(a).not.toBe(b)
  })

  it('changes when validFrom changes', () => {
    const a = computeContentFingerprint(baseInput())
    const b = computeContentFingerprint({ ...baseInput(), validFrom: '2026-10-01T00:00:00.000Z' })
    expect(a).not.toBe(b)
  })

  it('changes when validUntil changes', () => {
    const a = computeContentFingerprint(baseInput())
    const b = computeContentFingerprint({ ...baseInput(), validUntil: '2026-11-01T00:00:00.000Z' })
    expect(a).not.toBe(b)
  })

  it('changes when visibility changes', () => {
    const a = computeContentFingerprint(baseInput())
    const b = computeContentFingerprint({ ...baseInput(), visibility: 'internal_only' })
    expect(a).not.toBe(b)
  })

  it('changes when sensitivity changes', () => {
    const a = computeContentFingerprint(baseInput())
    const b = computeContentFingerprint({ ...baseInput(), sensitivity: 'timeline' })
    expect(a).not.toBe(b)
  })

  it('treats null and undefined structuredValue the same (both normalise to null)', () => {
    const a = computeContentFingerprint({ ...baseInput(), structuredValue: null })
    const b = computeContentFingerprint({ ...baseInput(), structuredValue: undefined })
    expect(a).toBe(b)
  })
})
