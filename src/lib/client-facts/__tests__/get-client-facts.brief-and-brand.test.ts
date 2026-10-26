import { beforeEach, describe, expect, it, vi } from 'vitest'

import { A_ID, OPTS_NULL, briefRow, clientRow, fake, resetFake, seed } from './fake-supabase'

vi.mock('@/lib/supabase', async () => {
  const { fake: shared } = await import('./fake-supabase')
  return { supabaseAdmin: { from: (t: string) => shared.from(t) } }
})

import { getClientFacts } from '../get-client-facts'

beforeEach(resetFake)

describe('getClientFacts', () => {
  describe('effective brief rules', () => {
    it('prefers a status-active row over a higher-version legacy row', async () => {
      seed(
        [clientRow(A_ID)],
        [
          briefRow(A_ID, { id: 'active-row', status: 'active', is_active: true, version: 1 }),
          briefRow(A_ID, { id: 'legacy-row', status: null, is_active: true, version: 5 }),
        ],
      )

      const result = await getClientFacts(A_ID, OPTS_NULL)
      if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)

      expect(result.facts.brief.matched_by).toBe('status')
      expect(result.facts.brief.id).toBe('active-row')
    })

    it('falls back to a legacy is_active row when no status-active row exists', async () => {
      seed(
        [clientRow(A_ID)],
        [briefRow(A_ID, { id: 'legacy-row', status: null, is_active: true, version: 3 })],
      )

      const result = await getClientFacts(A_ID, OPTS_NULL)
      if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)

      expect(result.facts.brief.matched_by).toBe('is_active_fallback')
      expect(result.facts.brief.id).toBe('legacy-row')
    })

    it('ignores a draft row even when is_active is true', async () => {
      seed(
        [clientRow(A_ID)],
        [briefRow(A_ID, { status: 'draft', is_active: true })],
      )

      const result = await getClientFacts(A_ID, OPTS_NULL)
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected failure')
      expect(result.reason).toBe('no_active_brief')
    })

    it('ignores a project-level brief', async () => {
      seed(
        [clientRow(A_ID)],
        [briefRow(A_ID, { project_id: 'p1', status: 'active' })],
      )

      const result = await getClientFacts(A_ID, OPTS_NULL)
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected failure')
      expect(result.reason).toBe('no_active_brief')
    })

    it('fails with ambiguous_brief when two active rows share a version', async () => {
      seed(
        [clientRow(A_ID)],
        [
          briefRow(A_ID, { id: 'active-a', status: 'active', version: 2 }),
          briefRow(A_ID, { id: 'active-b', status: 'active', version: 2 }),
        ],
      )

      const result = await getClientFacts(A_ID, OPTS_NULL)
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected failure')
      expect(result.reason).toBe('ambiguous_brief')
    })

    it('picks the highest version when active rows differ', async () => {
      seed(
        [clientRow(A_ID)],
        [
          briefRow(A_ID, { id: 'active-v1', status: 'active', version: 1 }),
          briefRow(A_ID, { id: 'active-v2', status: 'active', version: 2 }),
        ],
      )

      const result = await getClientFacts(A_ID, OPTS_NULL)
      if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)

      expect(result.facts.brief.version).toBe(2)
      expect(result.facts.brief.id).toBe('active-v2')
    })
  })

  describe('website host priority', () => {
    it('prefers the brief website', async () => {
      seed(
        [clientRow(A_ID, { domain: 'dom.example' })],
        [briefRow(A_ID, { website: 'https://Brief.Example/path?x=1' })],
      )

      const result = await getClientFacts(A_ID, OPTS_NULL)
      if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)
      expect(result.facts.brand.website_host.value).toBe('brief.example')
      expect(result.facts.brand.website_host.source).toBe('master_briefs.website')
    })

    it('falls back to source_website_urls', async () => {
      seed(
        [clientRow(A_ID, { domain: 'dom.example' })],
        [briefRow(A_ID, { website: null, source_website_urls: ['https://src.example/a'] })],
      )

      const result = await getClientFacts(A_ID, OPTS_NULL)
      if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)
      expect(result.facts.brand.website_host.value).toBe('src.example')
      expect(result.facts.brand.website_host.source).toBe('master_briefs.source_website_urls')
    })

    it('returns null with source none when nothing is available', async () => {
      seed(
        [clientRow(A_ID, { domain: null })],
        [briefRow(A_ID, { website: null, source_website_urls: null })],
      )

      const result = await getClientFacts(A_ID, OPTS_NULL)
      if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)
      expect(result.facts.brand.website_host.value).toBeNull()
      expect(result.facts.brand.website_host.source).toBe('none')
    })

  })

  describe('brand_voice subset', () => {
    it('keeps only known fields and warns on an invalid formality', async () => {
      seed(
        [clientRow(A_ID)],
        [
          briefRow(A_ID, {
            brand_voice: {
              tone_keywords: ['warm'],
              formality: 'shouting',
              secret_note: 'LEAKCHECK-secret',
              persona: { name: 'Sam', role: 'Guide', extra: 'x' },
            },
          }),
        ],
      )

      const result = await getClientFacts(A_ID, OPTS_NULL)
      if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)

      expect(JSON.stringify(result)).not.toContain('LEAKCHECK')
      expect(result.facts.brand.brand_voice.value?.formality).toBeNull()
      expect(result.facts.warnings).toContain('brand_voice_formality_invalid')
      expect(result.facts.brand.brand_voice.value?.persona).toEqual({ name: 'Sam', role: 'Guide' })
    })
  })

  describe('no cache', () => {
    it('re-reads the database on every call', async () => {
      seed([clientRow(A_ID)], [briefRow(A_ID)])

      const first = await getClientFacts(A_ID, OPTS_NULL)
      if (!first.ok) throw new Error(`expected ok, got ${first.reason}`)
      expect(first.facts.brand.brand_name.value).toBe('Alpha Tours')

      const queriesAfterFirst = fake.state.queries.length

      fake.state.tables.master_briefs = [briefRow(A_ID, { brand_name: 'Renamed Tours' })]

      const second = await getClientFacts(A_ID, OPTS_NULL)
      if (!second.ok) throw new Error(`expected ok, got ${second.reason}`)
      expect(second.facts.brand.brand_name.value).toBe('Renamed Tours')

      expect(fake.state.queries.length).toBe(queriesAfterFirst * 2)
    })
  })
})
