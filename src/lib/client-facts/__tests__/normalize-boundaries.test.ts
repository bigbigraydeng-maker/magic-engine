import { describe, expect, it } from 'vitest'
import {
  buildTier,
  cleanText,
  hostFromUrlLike,
  parseBrandVoice,
  parseTargetAudience,
  parseViColors,
  readLenientList,
} from '../normalize'
import { classifyBriefActivation } from '../classify-brief-activation'

describe('buildTier boundaries', () => {
  it("treats 'ab' as usable and 'a' as unusable", () => {
    const tier = buildTier([['ab', 'a']])
    expect(tier.items).toEqual(['ab'])
    expect(tier.unusable_entries).toEqual(['a'])
    expect(tier.unusable_count).toBe(1)
    expect(tier.status).toBe('set')
  })

  it('treats symbol-only entries as unusable', () => {
    const tier = buildTier([['$$', '©©']])
    expect(tier.items).toEqual([])
    expect(tier.status).toBe('all_unusable')
    expect(tier.unusable_entries).toEqual(['$$', '©©'])
  })

  it('treats the ﬁ ligature as usable because NFKC expands it to two characters', () => {
    const tier = buildTier([['ﬁ']])
    expect(tier.items).toEqual(['ﬁ'])
    expect(tier.status).toBe('set')
  })

  it('treats a single Han character as usable but a single Latin letter as unusable', () => {
    const han = buildTier([['酒']])
    expect(han.items).toEqual(['酒'])
    expect(han.status).toBe('set')

    const latin = buildTier([['a']])
    expect(latin.items).toEqual([])
    expect(latin.status).toBe('all_unusable')
  })

  it("treats 'C++' as unusable because only one word character remains", () => {
    const tier = buildTier([['C++']])
    expect(tier.unusable_entries).toEqual(['C++'])
  })

  it('reports none_configured for an empty input list', () => {
    const tier = buildTier([])
    expect(tier.status).toBe('none_configured')
    expect(tier.unusable_entries).toEqual([])
  })

  it('reports a zero-width-only entry as (blank)', () => {
    const tier = buildTier([['\u200B\u200B']])
    expect(tier.unusable_entries).toEqual(['(blank)'])
  })

  it('removes zero-width space from a usable entry', () => {
    const tier = buildTier([['a\u200Bb']])
    expect(tier.items).toEqual(['ab'])
  })

  it('removes the word joiner from a usable entry', () => {
    const tier = buildTier([['a⁠b']])
    expect(tier.items).toEqual(['ab'])
  })

  it('removes zero-width no-break space from a usable entry', () => {
    const tier = buildTier([['a\uFEFFb']])
    expect(tier.items).toEqual(['ab'])
  })

  it('removes soft hyphen from a usable entry', () => {
    const tier = buildTier([['a\u00ADb']])
    expect(tier.items).toEqual(['ab'])
  })

  it('removes right-to-left mark from a usable entry', () => {
    const tier = buildTier([['a\u200Fb']])
    expect(tier.items).toEqual(['ab'])
  })

  it('turns a DEL control character into a single space', () => {
    const tier = buildTier([['a\u007Fb']])
    expect(tier.items).toEqual(['a b'])
  })

  it('turns a NUL control character into a single space', () => {
    const tier = buildTier([['a\u0000b']])
    expect(tier.items).toEqual(['a b'])
  })

  it('collapses CRLF into a single space', () => {
    const tier = buildTier([['a\r\nb']])
    expect(tier.items).toEqual(['a b'])
  })
})

describe('cleanText code points', () => {
  it('cuts to exactly 200 code points without splitting a surrogate pair', () => {
    const result = cleanText('x'.repeat(199) + '😀😀')
    expect(result).not.toBeNull()
    const text = result as string
    expect(Array.from(text).length).toBe(200)
    expect(text.endsWith('😀')).toBe(true)
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(text)).toBe(false)
  })

  it('returns a 200-character string unchanged', () => {
    const input = 'x'.repeat(200)
    expect(cleanText(input)).toBe(input)
  })

  it('cuts a 201-character string down to 200', () => {
    const result = cleanText('x'.repeat(201))
    expect(result).not.toBeNull()
    expect(Array.from(result as string).length).toBe(200)
  })
})

describe('readLenientList truncation', () => {
  it('truncates 60 strings to 50 items and warns', () => {
    const warnings: string[] = []
    const input = Array.from({ length: 60 }, (_, i) => `item${i}`)
    const result = readLenientList(input, warnings, 'label')
    expect(result.length).toBe(50)
    expect(warnings).toEqual(['label_truncated'])
  })

  it('keeps exactly 50 strings without warning', () => {
    const warnings: string[] = []
    const input = Array.from({ length: 50 }, (_, i) => `item${i}`)
    const result = readLenientList(input, warnings, 'label')
    expect(result.length).toBe(50)
    expect(warnings).toEqual([])
  })
})

describe('parse* malformed warnings', () => {
  it('warns on a JSON string input to parseBrandVoice', () => {
    const warnings: string[] = []
    expect(parseBrandVoice('{"tone_keywords":[]}', warnings)).toBeNull()
    expect(warnings).toContain('brand_voice_malformed')
  })

  it('does not warn on null input to parseBrandVoice', () => {
    const warnings: string[] = []
    expect(parseBrandVoice(null, warnings)).toBeNull()
    expect(warnings).toEqual([])
  })

  it('warns on an array input to parseBrandVoice', () => {
    const warnings: string[] = []
    expect(parseBrandVoice([], warnings)).toBeNull()
    expect(warnings).toContain('brand_voice_malformed')
  })

  it('warns on an array input to parseTargetAudience', () => {
    const warnings: string[] = []
    expect(parseTargetAudience([], warnings)).toBeNull()
    expect(warnings).toContain('target_audience_malformed')
  })

  it('does not warn on undefined input to parseTargetAudience', () => {
    const warnings: string[] = []
    expect(parseTargetAudience(undefined, warnings)).toBeNull()
    expect(warnings).toEqual([])
  })

  it('warns on a number input to parseViColors', () => {
    const warnings: string[] = []
    expect(parseViColors(42, warnings)).toBeNull()
    expect(warnings).toContain('vi_colors_malformed')
  })

  it('accepts explicit nulls for formality and emoji_usage without warning', () => {
    const warnings: string[] = []
    const result = parseBrandVoice({ formality: null, emoji_usage: null }, warnings)
    expect(result).not.toBeNull()
    expect(result?.formality).toBeNull()
    expect(result?.emoji_usage).toBeNull()
    expect(warnings).toEqual([])
  })

  it('warns on an invalid emoji_usage value', () => {
    const warnings: string[] = []
    const result = parseBrandVoice({ emoji_usage: 'loud' }, warnings)
    expect(result).not.toBeNull()
    expect(result?.emoji_usage).toBeNull()
    expect(warnings).toContain('brand_voice_emoji_usage_invalid')
  })

  it('trims language_mix', () => {
    const warnings: string[] = []
    const result = parseBrandVoice({ language_mix: ' mix ' }, warnings)
    expect(result?.language_mix).toBe('mix')
  })

  it('maps tone_keywords and avoid_keywords to their own fields', () => {
    const warnings: string[] = []
    const result = parseBrandVoice({ tone_keywords: ['warm'], avoid_keywords: ['cheap'] }, warnings)
    expect(result?.tone_keywords).toEqual(['warm'])
    expect(result?.avoid_keywords).toEqual(['cheap'])
  })

  it('maps all target audience fields without swapping', () => {
    const warnings: string[] = []
    const result = parseTargetAudience(
      { interests: ['i'], pain_points: ['p'], age_range: '30-50', location: 'NZ' },
      warnings,
    )
    expect(result).toEqual({
      interests: ['i'],
      pain_points: ['p'],
      age_range: '30-50',
      location: 'NZ',
    })
  })

  it('maps all vi colors fields without swapping accent and background', () => {
    const warnings: string[] = []
    const result = parseViColors(
      { primary: '#1', secondary: '#2', accent: '#3', background: '#4' },
      warnings,
    )
    expect(result).toEqual({
      primary: '#1',
      secondary: '#2',
      accent: '#3',
      background: '#4',
    })
  })
})

describe('hostFromUrlLike', () => {
  it('extracts the host from a host:port/path string', () => {
    expect(hostFromUrlLike('example.com:8080/x')).toBe('example.com')
  })

  it('extracts the host from an https URL', () => {
    expect(hostFromUrlLike('https://a.example')).toBe('a.example')
  })

  it('rejects a file URL', () => {
    expect(hostFromUrlLike('file:///etc/passwd')).toBeNull()
  })

  it('rejects a data URL', () => {
    expect(hostFromUrlLike('data:text/html,x')).toBeNull()
  })

  it('rejects a host without a dot', () => {
    expect(hostFromUrlLike('http://x')).toBeNull()
  })
})

describe('classifyBriefActivation', () => {
  it('counts a row without a status key as legacy null-status is_active', () => {
    const report = classifyBriefActivation([{ id: 'x', is_active: true }])
    expect(report.legacy_null_status_is_active_ids).toEqual(['x'])
  })
})
