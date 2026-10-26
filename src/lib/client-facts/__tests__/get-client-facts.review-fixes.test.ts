import { beforeEach, describe, expect, it, vi } from 'vitest'

import { A_ID, OPTS_NULL, briefRow, clientRow, fake, resetFake, seed } from './fake-supabase'

vi.mock('@/lib/supabase', async () => {
  const { fake: shared } = await import('./fake-supabase')
  return { supabaseAdmin: { from: (t: string) => shared.from(t) } }
})

import { getClientFacts } from '../get-client-facts'

beforeEach(resetFake)

describe('getClientFacts review fixes', () => {
  it('rejects an inactive legacy row that slipped past a broken is_active filter', async () => {
    fake.state.ignoreCols = ['is_active']
    seed([clientRow(A_ID)], [briefRow(A_ID, { status: null, is_active: false })])

    const result = await getClientFacts(A_ID, OPTS_NULL)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.reason).toBe('brief_malformed')
  })

  describe('effective brief — legacy rows', () => {
    it('fails with no_active_brief when the only legacy row is inactive', async () => {
      seed([clientRow(A_ID)], [briefRow(A_ID, { status: null, is_active: false })])

      const result = await getClientFacts(A_ID, OPTS_NULL)
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected failure')
      expect(result.reason).toBe('no_active_brief')
    })

    it('fails with ambiguous_brief when two legacy active rows share a version', async () => {
      seed(
        [clientRow(A_ID)],
        [
          briefRow(A_ID, { id: 'l1', status: null, is_active: true, version: 2 }),
          briefRow(A_ID, { id: 'l2', status: null, is_active: true, version: 2 }),
        ],
      )

      const result = await getClientFacts(A_ID, OPTS_NULL)
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected failure')
      expect(result.reason).toBe('ambiguous_brief')
    })
  })

  describe('redline column read goes wrong', () => {
    it('fails with client_malformed when brand_redline_phrases is null', async () => {
      seed([clientRow(A_ID, { brand_redline_phrases: null })], [briefRow(A_ID)])

      const result = await getClientFacts(A_ID, OPTS_NULL)
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected failure')
      expect(result.reason).toBe('client_malformed')
    })

  })

  describe('warnings', () => {
    it('warns tone_words_none_configured when avoid_words is null and avoid_keywords is empty', async () => {
      seed(
        [clientRow(A_ID)],
        [
          briefRow(A_ID, {
            avoid_words: null,
            brand_voice: {
              tone_keywords: ['warm'],
              avoid_keywords: [],
              formality: 'neutral',
              emoji_usage: 'minimal',
              language_mix: 'english-primary',
            },
          }),
        ],
      )

      const result = await getClientFacts(A_ID, OPTS_NULL)
      if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)

      expect(result.facts.warnings).toContain('tone_words_none_configured')
    })

  })

  describe('leak markers (case-insensitive)', () => {
    it('never leaks forbidden columns on a successful call', async () => {
      seed([clientRow(A_ID)], [briefRow(A_ID)])

      const result = await getClientFacts(A_ID, OPTS_NULL)
      if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)

      expect(JSON.stringify(result).toUpperCase()).not.toContain('LEAKCHECK')
    })

    it('never leaks forbidden columns even when the database ignores filters', async () => {
      seed([clientRow(A_ID)], [briefRow(A_ID)])
      fake.state.leak = true

      const result = await getClientFacts(A_ID, OPTS_NULL)
      if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)

      expect(JSON.stringify(result).toUpperCase()).not.toContain('LEAKCHECK')
    })
  })

  describe('unreadable nested JSON is reported, not silently null', () => {
    it('warns brand_voice_malformed when brand_voice is a JSON string', async () => {
      seed(
        [clientRow(A_ID)],
        [briefRow(A_ID, { brand_voice: '{"tone_keywords":["x"]}' })],
      )

      const result = await getClientFacts(A_ID, OPTS_NULL)
      if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)

      expect(result.facts.brand.brand_voice.value).toBeNull()
      expect(result.facts.warnings).toContain('brand_voice_malformed')
    })

  })

  describe('full field mapping', () => {
    it('maps every field of the default fixture', async () => {
      seed([clientRow(A_ID)], [briefRow(A_ID)])

      const result = await getClientFacts(A_ID, OPTS_NULL)
      if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)

      expect(result.facts.brand.brand_voice.value).toEqual({
        tone_keywords: ['warm'],
        avoid_keywords: ['cheap'],
        formality: 'neutral',
        emoji_usage: 'minimal',
        language_mix: 'english-primary',
        persona: null,
      })
      expect(result.facts.brand.target_audience.value).toEqual({
        interests: ['travel'],
        pain_points: ['time'],
        age_range: '30-50',
        location: 'NZ',
      })
      expect(result.facts.visual.vi_colors.value).toEqual({
        primary: '#111111',
        secondary: '#222222',
        accent: '#333333',
        background: null,
      })
      expect(result.facts.visual.vi_style_keywords.value).toEqual(['clean'])
      expect(result.facts.visual.vi_dos.value).toEqual(['bright'])
      expect(result.facts.visual.vi_donts.value).toEqual(['dark'])
      expect(result.facts.brand.brand_name.value).toBe('Alpha Tours')
      expect(result.facts.brand.tagline.value).toBe('Tag line')
      expect(result.facts.brand.core_proposition.value).toBe('Core')

      expect(result.facts.brand.brand_voice.source).toBe('master_briefs.brand_voice')
      expect(result.facts.brand.target_audience.source).toBe('master_briefs.target_audience')
      expect(result.facts.visual.vi_colors.source).toBe('master_briefs.vi_colors')

      expect(result.facts.brief.id).toBe(`brief-${A_ID.slice(0, 4)}-1`)
      expect('logo' in result.facts.visual).toBe(false)
    })
  })

  describe('website host', () => {
    it('uses the first source_website_urls entry', async () => {
      seed(
        [clientRow(A_ID)],
        [
          briefRow(A_ID, {
            website: null,
            source_website_urls: ['https://first.example/a', 'https://second.example/b'],
          }),
        ],
      )

      const result = await getClientFacts(A_ID, OPTS_NULL)
      if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)

      expect(result.facts.brand.website_host.value).toBe('first.example')
      expect(result.facts.brand.website_host.source).toBe('master_briefs.source_website_urls')
    })

    it('returns null with source none when the client domain is not http', async () => {
      seed(
        [clientRow(A_ID, { domain: 'javascript:alert(1)' })],
        [briefRow(A_ID, { website: null, source_website_urls: null })],
      )

      const result = await getClientFacts(A_ID, OPTS_NULL)
      if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)

      expect(result.facts.brand.website_host.value).toBeNull()
      expect(result.facts.brand.website_host.source).toBe('none')
    })

  })

  describe('list truncation', () => {
    it('truncates vi_dos to 50 entries and warns', async () => {
      const many = Array.from({ length: 60 }, (_, i) => `do-${i}`)
      seed([clientRow(A_ID)], [briefRow(A_ID, { vi_dos: many })])

      const result = await getClientFacts(A_ID, OPTS_NULL)
      if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)

      expect(result.facts.visual.vi_dos.value).toHaveLength(50)
      expect(result.facts.warnings).toContain('vi_dos_truncated')
    })
  })
})
