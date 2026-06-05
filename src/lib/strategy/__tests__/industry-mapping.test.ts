import { describe, expect, it } from 'vitest'
import { resolveIndustryCode, matchAliases } from '../industry-mapping'

describe('resolveIndustryCode', () => {
  // 2026-06-05: generic tourism keywords default to outbound_tour because
  // most AU/NZ retail travel agents (CTS Tours NZ et al) serve outbound
  // demand. Inbound operators must use an explicit "inbound" keyword.
  it('maps generic "travel" → "outbound_tour" (default AU/NZ retail direction)', () => {
    expect(resolveIndustryCode('travel')).toBe('outbound_tour')
  })

  it('maps "tourism" → "outbound_tour"', () => {
    expect(resolveIndustryCode('tourism')).toBe('outbound_tour')
  })

  it('maps "tour operator" → "outbound_tour"', () => {
    expect(resolveIndustryCode('tour operator')).toBe('outbound_tour')
  })

  it('maps explicit "inbound tour" → "inbound_tour"', () => {
    expect(resolveIndustryCode('inbound tour')).toBe('inbound_tour')
  })

  it('maps Chinese "入境旅游" → "inbound_tour"', () => {
    expect(resolveIndustryCode('入境旅游')).toBe('inbound_tour')
  })

  it('maps Chinese "出境旅游" → "outbound_tour"', () => {
    expect(resolveIndustryCode('出境旅游')).toBe('outbound_tour')
  })

  it('maps "flooring" → "flooring"', () => {
    expect(resolveIndustryCode('flooring')).toBe('flooring')
  })

  it('maps "Flooring  &  Tiles" (mixed case + double space) → "flooring"', () => {
    // 魏征 v3 P1-B normalisation: collapse spaces + standardise & spacing
    expect(resolveIndustryCode('Flooring  &  Tiles')).toBe('flooring')
  })

  it('maps "flooring and tiles" (and not &) → "flooring"', () => {
    expect(resolveIndustryCode('flooring and tiles')).toBe('flooring')
  })

  it('returns null for null input', () => {
    expect(resolveIndustryCode(null)).toBeNull()
    expect(resolveIndustryCode(undefined)).toBeNull()
  })

  it('returns null for unknown industry', () => {
    expect(resolveIndustryCode('cryptocurrency')).toBeNull()
  })

  it('maps Chinese "餐饮" → "restaurant"', () => {
    expect(resolveIndustryCode('餐饮')).toBe('restaurant')
  })
})

describe('matchAliases', () => {
  it('matches when text contains the brand name (case-insensitive)', () => {
    expect(matchAliases('Visit CTS TOURS today', 'CTS Tours', null)).toBe(true)
  })

  it('matches when text contains an alias', () => {
    expect(matchAliases('Best 中国旅行社 in Auckland', 'CTS Tours', ['中国旅行社', '中旅'])).toBe(true)
  })

  it('returns false when neither name nor any alias matches', () => {
    expect(matchAliases('Wendy Wu Tours review', 'CTS Tours', ['中国旅行社'])).toBe(false)
  })

  it('handles empty aliases array', () => {
    expect(matchAliases('CTS Tours is great', 'CTS Tours', [])).toBe(true)
    expect(matchAliases('Other brand', 'CTS Tours', [])).toBe(false)
  })

  it('handles null aliases', () => {
    expect(matchAliases('CTS Tours', 'CTS Tours', null)).toBe(true)
    expect(matchAliases('Other', 'CTS Tours', null)).toBe(false)
  })
})
