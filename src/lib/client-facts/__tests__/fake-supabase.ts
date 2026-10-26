// Test helper: a table-modelled fake of the supabase client plus fixtures for src/lib/client-facts tests.

export type Row = Record<string, unknown>
export interface FakeError {
  code?: string
  message: string
}
export interface RecordedQuery {
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
export const fake = (() => {
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
    // Filters on these columns are ignored, to test a row-level check behind an `eq` filter alone.
    ignoreCols: [] as string[],
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
        if (state.ignoreCols.includes(f.col)) continue
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
})()

// Synthetic ids; A has zero version/variant digits (a real id shape) and must be accepted.
export const A_ID = 'a0000000-0000-0000-0000-000000000000'
export const B_ID = 'b1111111-1111-4111-8111-111111111111'

export const OPTS_NULL = { callerClientId: null }

export function clientRow(id: string, over: Row = {}): Row {
  return {
    id,
    name: `name-${id.slice(0, 4)}`,
    domain: null,
    brand_redline_phrases: [],
    ...over,
  }
}

export function briefRow(clientId: string, over: Row = {}): Row {
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
    competitor_domains: ['LEAKCHECK-competitor.example'],
    brand_story_md: 'LEAKCHECK-story',
    style_guide_md: 'LEAKCHECK-style',
    ...over,
  }
}

export function seed(clients: Row[], briefs: Row[]): void {
  fake.state.tables.clients = clients
  fake.state.tables.master_briefs = briefs
}

/** Reset the fake database; call from beforeEach in every test file that uses it. */
export function resetFake(): void {
  fake.state.tables = { clients: [], master_briefs: [] }
  fake.state.errors = {}
  fake.state.rejects = {}
  fake.state.leak = false
  fake.state.ignoreIsFilters = false
  fake.state.ignoreCols = []
  fake.state.queries = []
}
