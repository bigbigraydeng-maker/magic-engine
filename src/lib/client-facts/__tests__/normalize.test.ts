import { describe, expect, it } from 'vitest'

import {
  MAX_BRAND_LIST_ITEMS,
  MAX_BRAND_TEXT_LEN,
  buildTier,
  cleanText,
  hostFromUrlLike,
  parseBrandVoice,
  parseTargetAudience,
  parseViColors,
  readLenientList,
  readStrictList,
} from '../normalize'
import { classifyBriefActivation } from '../classify-brief-activation'
import type { BriefActivationRow } from '../classify-brief-activation'

describe('cleanText', () => {
  it('strips control chars and zero-width chars and trims the result', () => {
    // Leading/trailing spaces are trimmed; the zero-width space and the BEL
    // control char in the middle are removed, leaving 'ab'.
    expect(cleanText('  a\u200Bb\u0007 ')).toBe('ab')
  })

  it('returns null for non-string input', () => {
    expect(cleanText(5)).toBeNull()
    expect(cleanText(null)).toBeNull()
    expect(cleanText(undefined)).toBeNull()
    expect(cleanText({})).toBeNull()
  })

  it('returns null for blank or whitespace-only strings', () => {
    expect(cleanText('')).toBeNull()
    expect(cleanText('   ')).toBeNull()
    // A string made only of stripped characters becomes empty after stripping.
    expect(cleanText('\u200B\u0007')).toBeNull()
  })

  it('caps the result at MAX_BRAND_TEXT_LEN characters', () => {
    const long = 'a'.repeat(300)
    const result = cleanText(long)
    expect(result).not.toBeNull()
    expect(result).toHaveLength(MAX_BRAND_TEXT_LEN)
    expect(MAX_BRAND_TEXT_LEN).toBe(200)
  })
})

describe('readStrictList', () => {
  it('returns an empty array for null and undefined', () => {
    expect(readStrictList(null)).toEqual([])
    expect(readStrictList(undefined)).toEqual([])
  })

  it('returns null for a non-array value', () => {
    expect(readStrictList('x')).toBeNull()
  })

  it('returns null when any element is not a string', () => {
    expect(readStrictList(['a', 1])).toBeNull()
  })

  it('returns the array unchanged without trimming or dropping elements', () => {
    const input = ['  Keep Me  ', '']
    const result = readStrictList(input)
    expect(result).toEqual(['  Keep Me  ', ''])
    // Same elements, same order, no trimming and no dropping.
    expect(result).toHaveLength(2)
    expect(result?.[0]).toBe('  Keep Me  ')
    expect(result?.[1]).toBe('')
  })
})

describe('readLenientList', () => {
  it('returns an empty array and pushes a warning for a non-array value', () => {
    const warnings: string[] = []
    const result = readLenientList('not-an-array', warnings, 'label')
    expect(result).toEqual([])
    expect(warnings).toEqual(['label_malformed'])
  })

  it('keeps only usable strings and warns once for mixed input', () => {
    const warnings: string[] = []
    const result = readLenientList(['a', 1, ' ', 'b'], warnings, 'label')
    // '1' is not a string and ' ' cleans to null, so both are dropped.
    expect(result).toEqual(['a', 'b'])
    // The malformed warning is pushed exactly once even though a non-string was seen.
    expect(warnings).toEqual(['label_malformed'])
  })

  it('caps the result at MAX_BRAND_LIST_ITEMS items', () => {
    const warnings: string[] = []
    const input = Array.from({ length: 60 }, (_unused, index) => `item-${index}`)
    const result = readLenientList(input, warnings, 'label')
    expect(result).toHaveLength(MAX_BRAND_LIST_ITEMS)
    expect(MAX_BRAND_LIST_ITEMS).toBe(50)
    expect(warnings).toEqual([])
  })
})

describe('buildTier', () => {
  it('reports none_configured for an empty set of lists', () => {
    const tier = buildTier([])
    expect(tier.status).toBe('none_configured')
    expect(tier.items).toEqual([])
    expect(tier.unusable_count).toBe(0)
  })

  it('de-duplicates case-insensitively while keeping the first original casing', () => {
    const tier = buildTier([['Foo', 'foo ', 'BAR']])
    // 'foo ' normalizes to the same key as 'Foo', so it is dropped; 'Foo' wins.
    expect(tier.items).toEqual(['Foo', 'BAR'])
    expect(tier.status).toBe('set')
  })

  it('counts unusable entries without including them in items', () => {
    const tier = buildTier([['a', '!!', '  ']])
    // 'a' is too short after normalization, '!!' and '  ' normalize to nothing.
    expect(tier.items).toEqual([])
    expect(tier.unusable_count).toBe(3)
    expect(tier.status).toBe('set')
  })

  it('treats full-width NFKC characters as usable and keeps the trimmed original', () => {
    const tier = buildTier([['ＡＢＣ']])
    // NFKC normalization makes the full-width letters count as word characters.
    expect(tier.items).toEqual(['ＡＢＣ'])
    expect(tier.unusable_count).toBe(0)
  })

  it('does not truncate a very long entry', () => {
    const long = 'x'.repeat(500)
    const tier = buildTier([[long]])
    expect(tier.items).toHaveLength(1)
    expect(tier.items[0]).toHaveLength(500)
  })

  it('merges entries across multiple lists', () => {
    const tier = buildTier([['alpha'], ['beta', 'gamma']])
    expect(tier.items).toEqual(['alpha', 'beta', 'gamma'])
    expect(tier.status).toBe('set')
  })
})

describe('parseBrandVoice', () => {
  it('returns null for a non-object value', () => {
    const warnings: string[] = []
    expect(parseBrandVoice('nope', warnings)).toBeNull()
    expect(parseBrandVoice(null, warnings)).toBeNull()
    expect(parseBrandVoice([], warnings)).toBeNull()
  })

  it('keeps only the whitelisted keys', () => {
    const warnings: string[] = []
    const result = parseBrandVoice(
      {
        tone_keywords: ['friendly'],
        avoid_keywords: ['spam'],
        formality: 'casual',
        emoji_usage: 'minimal',
        language_mix: 'en',
        persona: { name: 'Ada', role: 'writer' },
        secret: 'should-not-appear',
      },
      warnings,
    )
    expect(result).not.toBeNull()
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(JSON.stringify(result)).not.toContain('should-not-appear')
    expect(Object.keys(result ?? {})).toEqual([
      'tone_keywords',
      'avoid_keywords',
      'formality',
      'emoji_usage',
      'language_mix',
      'persona',
    ])
  })

  it('rejects an invalid formality with a warning', () => {
    const warnings: string[] = []
    const result = parseBrandVoice({ formality: 'shouting' }, warnings)
    expect(result?.formality).toBeNull()
    expect(warnings).toContain('brand_voice_formality_invalid')
  })

  it('accepts an explicit null formality without a warning', () => {
    const warnings: string[] = []
    const result = parseBrandVoice({ formality: null }, warnings)
    expect(result?.formality).toBeNull()
    expect(warnings).toEqual([])
  })

  it('accepts a missing formality without a warning', () => {
    const warnings: string[] = []
    const result = parseBrandVoice({}, warnings)
    expect(result?.formality).toBeNull()
    expect(warnings).toEqual([])
  })

  it('returns a null persona when the persona name is blank', () => {
    const warnings: string[] = []
    const result = parseBrandVoice({ persona: { name: '   ', role: 'writer' } }, warnings)
    expect(result?.persona).toBeNull()
  })
})

describe('parseTargetAudience', () => {
  it('keeps only interests, pain_points, age_range and location', () => {
    const warnings: string[] = []
    const result = parseTargetAudience(
      {
        interests: ['running'],
        pain_points: ['sore knees'],
        age_range: '30-40',
        location: 'Berlin',
        secret: 'should-not-appear',
      },
      warnings,
    )
    expect(result).not.toBeNull()
    expect(Object.keys(result ?? {})).toEqual([
      'interests',
      'pain_points',
      'age_range',
      'location',
    ])
    expect(JSON.stringify(result)).not.toContain('secret')
  })
})

describe('parseViColors', () => {
  it('keeps only primary, secondary, accent and background', () => {
    const result = parseViColors({
      primary: '#111',
      secondary: '#222',
      accent: '#333',
      background: '#444',
      secret: '#555',
    })
    expect(result).not.toBeNull()
    expect(Object.keys(result ?? {})).toEqual([
      'primary',
      'secondary',
      'accent',
      'background',
    ])
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it('returns null for a non-object value', () => {
    expect(parseViColors('nope')).toBeNull()
    expect(parseViColors(null)).toBeNull()
    expect(parseViColors([])).toBeNull()
  })
})

describe('hostFromUrlLike', () => {
  it('extracts and lowercases the host from a full URL', () => {
    expect(hostFromUrlLike('https://Example.COM/a?b=1')).toBe('example.com')
  })

  it('accepts a bare hostname', () => {
    expect(hostFromUrlLike('example.com')).toBe('example.com')
  })

  it('drops credentials and port from the host', () => {
    expect(hostFromUrlLike('http://user:pw@host.example:8080/x')).toBe('host.example')
  })

  it('rejects non-http(s) schemes', () => {
    expect(hostFromUrlLike('javascript:alert(1)')).toBeNull()
    expect(hostFromUrlLike('ftp://files.example')).toBeNull()
  })

  it('rejects hostnames without a dot', () => {
    expect(hostFromUrlLike('localhost')).toBeNull()
  })

  it('rejects empty, null and non-string input', () => {
    expect(hostFromUrlLike('')).toBeNull()
    expect(hostFromUrlLike(null)).toBeNull()
    expect(hostFromUrlLike(5)).toBeNull()
  })
})

describe('classifyBriefActivation', () => {
  it('classifies a single status-active row that is_active true as consistent_active', () => {
    const rows: BriefActivationRow[] = [
      { id: 'a', status: 'active', is_active: true, project_id: null },
    ]
    const report = classifyBriefActivation(rows)
    expect(report.kind).toBe('consistent_active')
    expect(report.status_active_ids).toEqual(['a'])
    expect(report.is_active_ids).toEqual(['a'])
  })

  it('classifies no rows as consistent_none', () => {
    const report = classifyBriefActivation([])
    expect(report.kind).toBe('consistent_none')
    expect(report.status_active_ids).toEqual([])
    expect(report.is_active_ids).toEqual([])
  })

  it('classifies only archived rows with is_active false as consistent_none', () => {
    const rows: BriefActivationRow[] = [
      { id: 'a', status: 'archived', is_active: false, project_id: null },
      { id: 'b', status: 'archived', is_active: false, project_id: null },
    ]
    const report = classifyBriefActivation(rows)
    expect(report.kind).toBe('consistent_none')
    expect(report.status_active_ids).toEqual([])
    expect(report.is_active_ids).toEqual([])
  })

  it('classifies two status-active rows as multiple_status_active', () => {
    const rows: BriefActivationRow[] = [
      { id: 'a', status: 'active', is_active: true, project_id: null },
      { id: 'b', status: 'active', is_active: true, project_id: null },
    ]
    const report = classifyBriefActivation(rows)
    expect(report.kind).toBe('multiple_status_active')
    expect(report.status_active_ids).toEqual(['a', 'b'])
  })

  it('classifies a status-active row with is_active false as status_active_but_is_active_false', () => {
    const rows: BriefActivationRow[] = [
      { id: 'a', status: 'active', is_active: false, project_id: null },
    ]
    const report = classifyBriefActivation(rows)
    expect(report.kind).toBe('status_active_but_is_active_false')
    expect(report.status_active_ids).toEqual(['a'])
    expect(report.is_active_ids).toEqual([])
  })

  it('classifies a status-active row plus a draft with is_active true as is_active_without_active_status', () => {
    const rows: BriefActivationRow[] = [
      { id: 'a', status: 'active', is_active: true, project_id: null },
      { id: 'draft-1', status: 'draft', is_active: true, project_id: null },
    ]
    const report = classifyBriefActivation(rows)
    expect(report.kind).toBe('is_active_without_active_status')
    expect(report.draft_with_is_active_ids).toEqual(['draft-1'])
  })

  it('classifies a status null row with is_active true as is_active_without_active_status', () => {
    const rows: BriefActivationRow[] = [
      { id: 'legacy-1', status: null, is_active: true, project_id: null },
    ]
    const report = classifyBriefActivation(rows)
    expect(report.kind).toBe('is_active_without_active_status')
    expect(report.legacy_null_status_is_active_ids).toEqual(['legacy-1'])
  })

  it('ignores rows with a non-null project_id entirely', () => {
    const rows: BriefActivationRow[] = [
      { id: 'project-1', status: 'active', is_active: true, project_id: 'proj-1' },
    ]
    const report = classifyBriefActivation(rows)
    expect(report.kind).toBe('consistent_none')
    expect(report.status_active_ids).toEqual([])
    expect(report.is_active_ids).toEqual([])
  })
})
