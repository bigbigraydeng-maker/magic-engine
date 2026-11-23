import { beforeEach, describe, expect, it, vi } from 'vitest'

import { A_ID, B_ID, OPTS_NULL, briefRow, clientRow, fake, resetFake, seed } from './fake-supabase'

vi.mock('@/lib/supabase', async () => {
  const { fake: shared } = await import('./fake-supabase')
  return { supabaseAdmin: { from: (t: string) => shared.from(t) } }
})

import { getClientFacts } from '../get-client-facts'

beforeEach(resetFake)

describe('getClientFacts', () => {
  describe('happy path', () => {
    it('returns the assembled facts for a client with an active brief', async () => {
      seed([clientRow(A_ID, { domain: 'a-client.example' })], [briefRow(A_ID)])

      const result = await getClientFacts(A_ID, OPTS_NULL)
      if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)

      expect(result.facts.client_id).toBe(A_ID)
      expect(result.facts.brief.matched_by).toBe('status')
      expect(result.facts.brand.brand_name.value).toBe('Alpha Tours')
      expect(result.facts.brand.brand_name.source).toBe('master_briefs.brand_name')
      expect(result.facts.visual.vi_colors.value?.primary).toBe('#111111')
      expect(result.facts.visual.vi_style_keywords.value).toEqual(['clean'])
      expect(result.facts.brand.website_host.value).toBe('a-client.example')
      expect(result.facts.brand.website_host.source).toBe('clients.domain')
      expect(result.facts.warnings).toContain('redline_phrases_none_configured')
      expect(result.facts.warnings).not.toContain('topics_none_configured')
    })
  })

  describe('three-tier taboos', () => {
    it('keeps the three tiers separate', async () => {
      seed(
        [clientRow(A_ID, { brand_redline_phrases: ['Redline One'] })],
        [
          briefRow(A_ID, {
            excluded_topics: ['topic-x'],
            avoid_words: ['word-y'],
            brand_voice: {
              tone_keywords: ['warm'],
              avoid_keywords: ['word-z'],
              formality: 'neutral',
              emoji_usage: 'minimal',
              language_mix: 'english-primary',
            },
          }),
        ],
      )

      const result = await getClientFacts(A_ID, OPTS_NULL)
      if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)

      expect(result.facts.taboos.redline_phrases.value.items).toEqual(['Redline One'])
      expect(result.facts.taboos.redline_phrases.source).toBe('clients.brand_redline_phrases')
      expect(result.facts.taboos.topics.value.items).toEqual(['topic-x'])
      expect(result.facts.taboos.tone_words.value.items).toContain('word-y')
      expect(result.facts.taboos.tone_words.value.items).toContain('word-z')
      expect(result.facts.taboos.tone_words.value.items).toHaveLength(2)
      expect(result.facts.taboos.redline_phrases.value.items).not.toContain('topic-x')
      expect(result.facts.taboos.topics.value.items).not.toContain('Redline One')
      expect(result.facts.taboos.tone_words.value.items).not.toContain('Redline One')
    })

    it('treats none_configured as a warning, not a failure', async () => {
      seed(
        [clientRow(A_ID)],
        [briefRow(A_ID, { excluded_topics: null, avoid_words: null })],
      )

      const result = await getClientFacts(A_ID, OPTS_NULL)
      if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)

      expect(result.facts.taboos.topics.value.status).toBe('none_configured')
      expect(result.facts.warnings).toContain('topics_none_configured')
    })

  })

  describe('malformed taboo data fails closed', () => {
    it('fails with client_malformed when brand_redline_phrases is not a list', async () => {
      seed([clientRow(A_ID, { brand_redline_phrases: 'not a list' })], [briefRow(A_ID)])

      const result = await getClientFacts(A_ID, OPTS_NULL)
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected failure')
      expect(result.reason).toBe('client_malformed')
    })

  })

  describe('failures never return an empty pack', () => {
    it('fails with no_active_brief when there is no brief', async () => {
      seed([clientRow(A_ID)], [])

      const result = await getClientFacts(A_ID, OPTS_NULL)
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected failure')
      expect(result.reason).toBe('no_active_brief')
      expect('facts' in result).toBe(false)
    })

    it('fails with client_not_found when the client row is missing', async () => {
      seed([], [briefRow(A_ID)])

      const result = await getClientFacts(A_ID, OPTS_NULL)
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected failure')
      expect(result.reason).toBe('client_not_found')
      expect('facts' in result).toBe(false)
    })

    it('fails with client_lookup_failed when the clients query errors', async () => {
      seed([clientRow(A_ID)], [briefRow(A_ID)])
      fake.state.errors.clients = { message: 'boom' }

      const result = await getClientFacts(A_ID, OPTS_NULL)
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected failure')
      expect(result.reason).toBe('client_lookup_failed')
      expect('facts' in result).toBe(false)
    })

    it('fails with brief_lookup_failed when the briefs query errors', async () => {
      seed([clientRow(A_ID)], [briefRow(A_ID)])
      fake.state.errors.master_briefs = { message: 'boom' }

      const result = await getClientFacts(A_ID, OPTS_NULL)
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected failure')
      expect(result.reason).toBe('brief_lookup_failed')
      expect('facts' in result).toBe(false)
    })

    it('maps a 42703 error to schema_not_ready', async () => {
      seed([clientRow(A_ID)], [briefRow(A_ID)])
      fake.state.errors.master_briefs = { code: '42703', message: 'x' }

      const result = await getClientFacts(A_ID, OPTS_NULL)
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected failure')
      expect(result.reason).toBe('schema_not_ready')
      expect('facts' in result).toBe(false)
    })

    it('resolves with unexpected_error when the briefs query rejects', async () => {
      seed([clientRow(A_ID)], [briefRow(A_ID)])
      fake.state.rejects.master_briefs = true

      const result = await getClientFacts(A_ID, OPTS_NULL)
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected failure')
      expect(result.reason).toBe('unexpected_error')
      expect('facts' in result).toBe(false)
    })

  })

  describe('field whitelist', () => {
    it('never selects forbidden columns and never leaks their values', async () => {
      seed([clientRow(A_ID, { domain: 'a-client.example' })], [briefRow(A_ID)])

      const result = await getClientFacts(A_ID, OPTS_NULL)
      if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)

      const forbidden = [
        'competitive_notes_md',
        'semrush_snapshot',
        'source_file_urls',
        'competitor_domains',
        'brand_story_md',
        'style_guide_md',
      ]

      for (const q of fake.state.queries) {
        expect(q.select).not.toContain('*')
        if (q.table === 'master_briefs') {
          for (const col of forbidden) {
            expect(q.select).not.toContain(col)
          }
        }
      }

      const clientQuery = fake.state.queries.find((q) => q.table === 'clients')
      expect(clientQuery?.select).toBe('id, domain, brand_redline_phrases')

      expect(JSON.stringify(result)).not.toContain('LEAKCHECK')
    })

  })

  describe('two-client isolation', () => {
    function seedTwoClients(): void {
      seed(
        [
          clientRow(A_ID, { domain: 'alpha.example', brand_redline_phrases: ['alpha-redline'] }),
          clientRow(B_ID, { domain: 'beta.example', brand_redline_phrases: ['beta-redline'] }),
        ],
        [
          briefRow(A_ID, {
            brand_name: 'Alpha Tours',
            website: 'https://alpha.example',
            excluded_topics: ['alpha-topic'],
            avoid_words: ['alpha-avoid'],
          }),
          briefRow(B_ID, {
            brand_name: 'Beta Floors',
            website: 'https://beta.example',
            excluded_topics: ['beta-topic'],
            avoid_words: ['beta-avoid'],
          }),
        ],
      )
    }

    it('returns only the requested client facts', async () => {
      seedTwoClients()

      const aResult = await getClientFacts(A_ID, OPTS_NULL)
      if (!aResult.ok) throw new Error(`expected ok, got ${aResult.reason}`)
      const aJson = JSON.stringify(aResult).toLowerCase()
      expect(aJson).not.toContain('beta')
      expect(aJson).toContain('alpha-redline')

      const bResult = await getClientFacts(B_ID, OPTS_NULL)
      if (!bResult.ok) throw new Error(`expected ok, got ${bResult.reason}`)
      const bJson = JSON.stringify(bResult).toLowerCase()
      expect(bJson).not.toContain('alpha')
      expect(bJson).toContain('beta-redline')
    })

    it('defence 1: rejects multiple client rows even when filters are ignored', async () => {
      seed(
        [clientRow(A_ID), clientRow(B_ID)],
        [briefRow(A_ID)],
      )
      fake.state.leak = true

      const result = await getClientFacts(A_ID, OPTS_NULL)
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected failure')
      expect(result.reason).toBe('isolation_violation')
    })

    it('defence 2: rejects a client row whose id does not match', async () => {
      // A's brief is seeded on purpose: with B's brief the brief check would also fail and hide this defence.
      seed([clientRow(B_ID)], [briefRow(A_ID)])
      fake.state.leak = true

      const result = await getClientFacts(A_ID, OPTS_NULL)
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected failure')
      expect(result.reason).toBe('isolation_violation')
    })

    it('defence 5: rejects a draft row that slipped past a broken legacy-fallback filter', async () => {
      fake.state.ignoreIsFilters = true
      seed([clientRow(A_ID)], [briefRow(A_ID, { status: 'draft', is_active: true })])

      const result = await getClientFacts(A_ID, OPTS_NULL)
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected failure')
      expect(result.reason).toBe('brief_malformed')
    })

    it('defence 3: rejects a brief row whose client_id does not match', async () => {
      seed([clientRow(A_ID)], [briefRow(B_ID)])
      fake.state.leak = true

      const result = await getClientFacts(A_ID, OPTS_NULL)
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected failure')
      expect(result.reason).toBe('isolation_violation')
    })
  })

  describe('caller identity', () => {
    it('rejects a non-uuid client id without querying', async () => {
      const result = await getClientFacts('not-a-uuid', OPTS_NULL)
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected failure')
      expect(result.reason).toBe('invalid_client_id')
      expect(fake.state.queries.length).toBe(0)
    })

    it('rejects a caller whose client id does not match', async () => {
      seed([clientRow(A_ID)], [briefRow(A_ID)])

      const result = await getClientFacts(A_ID, { callerClientId: B_ID })
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected failure')
      expect(result.reason).toBe('client_mismatch')
      expect(fake.state.queries.length).toBe(0)
    })

    it('accepts a caller id that matches case-insensitively', async () => {
      seed([clientRow(A_ID)], [briefRow(A_ID)])

      const result = await getClientFacts(A_ID, { callerClientId: A_ID.toUpperCase() })
      if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)
      expect(result.facts.client_id).toBe(A_ID)
    })

    it('accepts an upper-case client id and normalises it', async () => {
      seed([clientRow(A_ID)], [briefRow(A_ID)])

      const result = await getClientFacts(A_ID.toUpperCase(), OPTS_NULL)
      if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)
      expect(result.facts.client_id).toBe(A_ID)
    })

    it('accepts a uuid whose version and variant digits are zero', async () => {
      seed([clientRow(A_ID)], [briefRow(A_ID)])

      const result = await getClientFacts(A_ID, OPTS_NULL)
      if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)
      expect(result.facts.client_id).toBe(A_ID)
    })
  })
})
