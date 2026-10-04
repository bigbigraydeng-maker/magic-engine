import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
interface FakeError {
  code?: string
  message: string
}
interface RecordedQuery {
  table: string
  select: string
  filters: Array<{ op: 'eq' | 'is'; col: string; val: unknown }>
  limit: number | null
}
interface FakeResult {
  data: Row[] | null
  error: FakeError | null
}

// Table-modelled fake of the supabase client (unmodelled tables throw). It executes eq / is /
// order / limit and projects selected columns like PostgREST; `leak` mode ignores every filter
// and projection (a broken database) so each defence inside getClientFacts is tested alone.
const fake = vi.hoisted(() => {
  const CLIENT_COLUMNS = ['id', 'name', 'domain', 'brand_redline_phrases']
  const BRIEF_COLUMNS = [
    'id', 'client_id', 'version', 'status', 'is_active', 'project_id', 'created_at',
    'brand_name', 'tagline', 'core_proposition', 'brand_voice', 'target_audience',
    'vi_colors', 'vi_style_keywords', 'vi_dos', 'vi_donts', 'avoid_words', 'excluded_topics',
    'website', 'source_website_urls',
    'competitive_notes_md', 'semrush_snapshot', 'source_file_urls', 'competitor_domains',
    'brand_story_md', 'style_guide_md',
  ]
  const state = {
    tables: { clients: [] as Row[], master_briefs: [] as Row[] },
    errors: {} as Record<string, FakeError | undefined>,
    rejects: {} as Record<string, boolean | undefined>,
    leak: false,
    // Ignore only `is` filters (project_id / status IS NULL) so the row-level checks behind them can be tested alone.
    ignoreIsFilters: false,
    queries: [] as RecordedQuery[],
  }

  function execute(table: string, q: RecordedQuery, orders: Array<{ col: string; asc: boolean }>): FakeResult {
    const known = table === 'clients' ? CLIENT_COLUMNS : BRIEF_COLUMNS
    const cols = q.select.split(',').map((c) => c.trim()).filter((c) => c.length > 0)
    const wanted = cols.includes('*') ? known : cols
    for (const c of wanted) {
      if (!known.includes(c)) return { data: null, error: { code: '42703', message: `column ${table}.${c} does not exist` } }
    }
    const err = state.errors[table]
    if (err) return { data: null, error: err }
    let rows: Row[] = [...(table === 'clients' ? state.tables.clients : state.tables.master_briefs)]
    if (!state.leak) {
      for (const f of q.filters) {
        if (state.ignoreIsFilters && f.op === 'is') continue
        rows = rows.filter((r) => (f.op === 'is' ? r[f.col] === null || r[f.col] === undefined : r[f.col] === f.val))
      }
    }
    for (const o of [...orders].reverse()) {
      rows.sort((a, b) => {
        const av = a[o.col] as string | number
        const bv = b[o.col] as string | number
        if (av === bv) return 0
        return (av > bv ? 1 : -1) * (o.asc ? 1 : -1)
      })
    }
    if (q.limit !== null) rows = rows.slice(0, q.limit)
    if (state.leak) return { data: rows, error: null }
    return { data: rows.map((r) => Object.fromEntries(wanted.map((c) => [c, r[c]]))), error: null }
  }

  function from(table: string) {
    if (table !== 'clients' && table !== 'master_briefs') throw new Error(`unmodelled table: ${table}`)
    const q: RecordedQuery = { table, select: '', filters: [], limit: null }
    const orders: Array<{ col: string; asc: boolean }> = []
    const builder = {
      select(cols: string) { q.select = cols; return builder },
      eq(col: string, val: unknown) { q.filters.push({ op: 'eq', col, val }); return builder },
      is(col: string, val: unknown) { q.filters.push({ op: 'is', col, val }); return builder },
      order(col: string, o?: { ascending?: boolean }) { orders.push({ col, asc: o?.ascending !== false }); return builder },
      limit(n: number) { q.limit = n; return builder },
      then(resolve: (v: FakeResult) => unknown, reject: (e: unknown) => unknown) {
        state.queries.push(q)
        if (state.rejects[table]) return Promise.reject(new Error('network down')).then(resolve, reject)
        return Promise.resolve(execute(table, q, orders)).then(resolve, reject)
      },
    }
    return builder
  }
  return { state, from }
})

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: (t: string) => fake.from(t) } }))

import { getClientFacts } from '../get-client-facts'

// Synthetic ids; A has zero version/variant digits (a real id shape) and must be accepted.
const A_ID = 'a0000000-0000-0000-0000-000000000000'
const B_ID = 'b1111111-1111-4111-8111-111111111111'

const OPTS_NULL = { callerClientId: null }

function clientRow(id: string, over: Row = {}): Row {
  return {
    id,
    name: `name-${id.slice(0, 4)}`,
    domain: null,
    brand_redline_phrases: [],
    ...over,
  }
}

function briefRow(clientId: string, over: Row = {}): Row {
  return {
    id: `brief-${clientId.slice(0, 4)}-1`,
    client_id: clientId,
    version: 1,
    status: 'active',
    is_active: true,
    project_id: null,
    created_at: '2026-01-01T00:00:00Z',
    brand_name: 'Alpha Tours',
    tagline: 'Tag line',
    core_proposition: 'Core',
    brand_voice: {
      tone_keywords: ['warm'],
      avoid_keywords: ['cheap'],
      formality: 'neutral',
      emoji_usage: 'minimal',
      language_mix: 'english-primary',
    },
    target_audience: {
      interests: ['travel'],
      pain_points: ['time'],
      age_range: '30-50',
      location: 'NZ',
    },
    vi_colors: { primary: '#111111', secondary: '#222222', accent: '#333333' },
    vi_style_keywords: ['clean'],
    vi_dos: ['bright'],
    vi_donts: ['dark'],
    avoid_words: ['bargain'],
    excluded_topics: ['politics'],
    website: null,
    source_website_urls: null,
    // Forbidden-column markers: these must never appear in the result.
    competitive_notes_md: 'LEAKCHECK-competitive-notes',
    semrush_snapshot: { note: 'LEAKCHECK-semrush' },
    source_file_urls: ['https://files.example/LEAKCHECK-file'],
    competitor_domains: ['leakcheck-competitor.example'],
    brand_story_md: 'LEAKCHECK-story',
    style_guide_md: 'LEAKCHECK-style',
    ...over,
  }
}

function seed(clients: Row[], briefs: Row[]): void {
  fake.state.tables.clients = clients
  fake.state.tables.master_briefs = briefs
}
beforeEach(() => {
  fake.state.tables = { clients: [], master_briefs: [] }
  fake.state.errors = {}
  fake.state.rejects = {}
  fake.state.leak = false
  fake.state.ignoreIsFilters = false
  fake.state.queries = []
})

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

    it('counts unusable entries instead of silently dropping them', async () => {
      seed(
        [clientRow(A_ID, { brand_redline_phrases: ['ok phrase', ' ', 'a'] })],
        [briefRow(A_ID)],
      )

      const result = await getClientFacts(A_ID, OPTS_NULL)
      if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)

      expect(result.facts.taboos.redline_phrases.value.items).toEqual(['ok phrase'])
      expect(result.facts.taboos.redline_phrases.value.unusable_count).toBe(2)
      expect(result.facts.taboos.redline_phrases.value.status).toBe('set')
      expect(result.facts.warnings).toContain('redline_phrases_has_unusable_entries')
    })

    it('reports an all-unusable list as set with an all_unusable warning', async () => {
      seed(
        [clientRow(A_ID, { brand_redline_phrases: [' '] })],
        [briefRow(A_ID)],
      )

      const result = await getClientFacts(A_ID, OPTS_NULL)
      if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)

      expect(result.facts.taboos.redline_phrases.value.items).toEqual([])
      expect(result.facts.taboos.redline_phrases.value.status).toBe('set')
      expect(result.facts.warnings).toContain('redline_phrases_all_unusable')
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

    it('fails with brief_malformed when excluded_topics is not a list', async () => {
      seed([clientRow(A_ID)], [briefRow(A_ID, { excluded_topics: 'not a list' })])

      const result = await getClientFacts(A_ID, OPTS_NULL)
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected failure')
      expect(result.reason).toBe('brief_malformed')
    })

    it('fails with brief_malformed when avoid_words contains a non-string', async () => {
      seed([clientRow(A_ID)], [briefRow(A_ID, { avoid_words: ['fine', 42] })])

      const result = await getClientFacts(A_ID, OPTS_NULL)
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('expected failure')
      expect(result.reason).toBe('brief_malformed')
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

    it('resolves with unexpected_error when the clients query rejects', async () => {
      seed([clientRow(A_ID)], [briefRow(A_ID)])
      fake.state.rejects.clients = true

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

    it('does not leak forbidden columns even when the database ignores projections', async () => {
      seed([clientRow(A_ID, { domain: 'a-client.example' })], [briefRow(A_ID)])
      fake.state.leak = true

      const result = await getClientFacts(A_ID, OPTS_NULL)
      if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)

      // Sanity: the leaked rows really do contain the markers.
      expect(JSON.stringify(fake.state.tables.master_briefs)).toContain('LEAKCHECK')
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

    it('keeps concurrent calls isolated', async () => {
      seedTwoClients()

      const [aResult, bResult] = await Promise.all([
        getClientFacts(A_ID, OPTS_NULL),
        getClientFacts(B_ID, OPTS_NULL),
      ])

      if (!aResult.ok) throw new Error(`expected ok, got ${aResult.reason}`)
      if (!bResult.ok) throw new Error(`expected ok, got ${bResult.reason}`)

      const aJson = JSON.stringify(aResult).toLowerCase()
      const bJson = JSON.stringify(bResult).toLowerCase()
      expect(aJson).not.toContain('beta')
      expect(aJson).toContain('alpha-redline')
      expect(bJson).not.toContain('alpha')
      expect(bJson).toContain('beta-redline')
    })

    it('filters every query by the requested id', async () => {
      seedTwoClients()

      const result = await getClientFacts(A_ID, OPTS_NULL)
      if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)

      const clientQueries = fake.state.queries.filter((q) => q.table === 'clients')
      const briefQueries = fake.state.queries.filter((q) => q.table === 'master_briefs')
      expect(clientQueries.length).toBeGreaterThan(0)
      expect(briefQueries.length).toBeGreaterThan(0)

      for (const q of clientQueries) {
        expect(q.filters).toContainEqual({ op: 'eq', col: 'id', val: A_ID })
      }
      for (const q of briefQueries) {
        expect(q.filters).toContainEqual({ op: 'eq', col: 'client_id', val: A_ID })
        expect(q.filters).toContainEqual({ op: 'is', col: 'project_id', val: null })
      }
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

    it('defence 4: rejects a project-level brief that slipped past a broken project_id filter', async () => {
      fake.state.ignoreIsFilters = true
      seed([clientRow(A_ID)], [briefRow(A_ID, { project_id: 'p1' })])

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

    it('ignores an archived row even when is_active is true', async () => {
      seed(
        [clientRow(A_ID)],
        [briefRow(A_ID, { status: 'archived', is_active: true })],
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

    it('falls back to the client domain', async () => {
      seed(
        [clientRow(A_ID, { domain: 'dom.example' })],
        [briefRow(A_ID, { website: null, source_website_urls: null })],
      )

      const result = await getClientFacts(A_ID, OPTS_NULL)
      if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)
      expect(result.facts.brand.website_host.value).toBe('dom.example')
      expect(result.facts.brand.website_host.source).toBe('clients.domain')
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

    it('ignores a non-http website and falls through', async () => {
      seed(
        [clientRow(A_ID, { domain: 'dom.example' })],
        [briefRow(A_ID, { website: 'javascript:alert(1)' })],
      )

      const result = await getClientFacts(A_ID, OPTS_NULL)
      if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)
      expect(result.facts.brand.website_host.value).toBe('dom.example')
      expect(result.facts.brand.website_host.source).toBe('clients.domain')
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
