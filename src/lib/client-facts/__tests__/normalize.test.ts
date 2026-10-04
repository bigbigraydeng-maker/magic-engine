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

})

describe('readStrictList', () => {
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

describe('buildTier', () => {
  it('de-duplicates case-insensitively while keeping the first original casing', () => {
    const tier = buildTier([['Foo', 'foo ', 'BAR']])
    // 'foo ' normalizes to the same key as 'Foo', so it is dropped; 'Foo' wins.
    expect(tier.items).toEqual(['Foo', 'BAR'])
    expect(tier.status).toBe('set')
  })

  it('merges entries across multiple lists', () => {
    const tier = buildTier([['alpha'], ['beta', 'gamma']])
    expect(tier.items).toEqual(['alpha', 'beta', 'gamma'])
    expect(tier.status).toBe('set')
  })
})

describe('parseBrandVoice', () => {
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

})

describe('hostFromUrlLike', () => {
  it('extracts and lowercases the host from a full URL', () => {
    expect(hostFromUrlLike('https://Example.COM/a?b=1')).toBe('example.com')
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

  it('counts a row whose status key is missing as a legacy null-status row', () => {
    const report = classifyBriefActivation([{ id: 'x', is_active: true }])
    expect(report.legacy_null_status_is_active_ids).toEqual(['x'])
    expect(report.kind).toBe('is_active_without_active_status')
  })
})

describe('buildTier boundaries', () => {
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

  it('removes the word joiner from a usable entry', () => {
    const tier = buildTier([['a⁠b']])
    expect(tier.items).toEqual(['ab'])
  })

  it('turns a DEL control character into a single space', () => {
    const tier = buildTier([['a\u007Fb']])
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

})
