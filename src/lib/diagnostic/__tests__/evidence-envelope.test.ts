import { describe, it, expect } from 'vitest'
import {
  makeEvidence,
  evidenceSource,
  isEvidenceEnvelope,
} from '../types'

describe('makeEvidence', () => {
  it('returns canonical envelope shape with defaults', () => {
    const e = makeEvidence()
    expect(e).toMatchObject({
      raw: null,
      parsed: null,
      sources: [],
    })
    expect(typeof e.collected_at).toBe('string')
    expect(new Date(e.collected_at).toString()).not.toBe('Invalid Date')
  })

  it('preserves parsed structured payload', () => {
    const parsed = { foo: 1, bar: ['baz'] }
    const e = makeEvidence({ parsed })
    expect(e.parsed).toEqual(parsed)
  })

  it('honours provided collected_at for determinism', () => {
    const e = makeEvidence({ collected_at: '2026-01-01T00:00:00.000Z' })
    expect(e.collected_at).toBe('2026-01-01T00:00:00.000Z')
  })

  it('accepts arbitrary raw payload', () => {
    const raw = { html: '<title>foo</title>', api_response: { ok: true } }
    const e = makeEvidence({ raw })
    expect(e.raw).toEqual(raw)
  })
})

describe('evidenceSource', () => {
  it('wraps URL with a fresh ISO timestamp', () => {
    const s = evidenceSource('https://example.com')
    expect(s.url).toBe('https://example.com')
    expect(typeof s.fetched_at).toBe('string')
  })

  it('honours provided fetched_at', () => {
    const s = evidenceSource('https://example.com', '2026-05-18T01:00:00Z')
    expect(s.fetched_at).toBe('2026-05-18T01:00:00Z')
  })
})

describe('isEvidenceEnvelope', () => {
  it('returns true for valid envelope', () => {
    expect(isEvidenceEnvelope(makeEvidence())).toBe(true)
    expect(isEvidenceEnvelope(makeEvidence({ parsed: { x: 1 } }))).toBe(true)
  })

  it('returns false for null and non-objects', () => {
    expect(isEvidenceEnvelope(null)).toBe(false)
    expect(isEvidenceEnvelope(undefined)).toBe(false)
    expect(isEvidenceEnvelope('string')).toBe(false)
    expect(isEvidenceEnvelope(42)).toBe(false)
  })

  it('returns false for legacy un-wrapped evidence shapes', () => {
    expect(isEvidenceEnvelope({ rating: 4.5, total_reviews: 12 })).toBe(false)
    expect(isEvidenceEnvelope({ raw: null, parsed: null })).toBe(false) // missing sources + collected_at
  })
})
