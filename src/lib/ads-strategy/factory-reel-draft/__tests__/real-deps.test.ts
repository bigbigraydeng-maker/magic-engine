import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/meta/token-manager', () => ({
  resolveMetaTokenForClient: vi.fn(),
  getStoredPageToken: vi.fn(),
}))

vi.mock('@/lib/ads-strategy/draft-and-gate', () => ({
  createDraftForApproval: vi.fn(),
}))

vi.mock('@/lib/ads-strategy/draft-redlines', () => ({
  loadDraftRedlines: vi.fn(),
}))

import { buildRunDeps } from '../real-deps'
import { resolveMetaTokenForClient, getStoredPageToken } from '@/lib/meta/token-manager'
import { createDraftForApproval } from '@/lib/ads-strategy/draft-and-gate'
import { loadDraftRedlines } from '@/lib/ads-strategy/draft-redlines'

type TableConfig = {
  maybeSingle?: { data: unknown; error: { message: string } | null }
  awaited?: { data: unknown; error: { message: string } | null }
}

type QueryRecord = {
  table: string
  columns: string
  eqs: Array<[string, unknown]>
}

type FakeSupabase = {
  client: SupabaseClient
  queries: QueryRecord[]
  setTable: (table: string, config: TableConfig) => void
}

function makeFakeSupabase(): FakeSupabase {
  const tables = new Map<string, TableConfig>()
  const queries: QueryRecord[] = []

  function from(table: string) {
    const record: QueryRecord = { table, columns: '', eqs: [] }
    queries.push(record)

    const builder = {
      select(columns: string) {
        record.columns = columns
        return builder
      },
      eq(column: string, value: unknown) {
        record.eqs.push([column, value])
        return builder
      },
      maybeSingle() {
        const cfg = tables.get(table)
        return Promise.resolve(cfg?.maybeSingle ?? { data: null, error: null })
      },
      then(
        onFulfilled: (value: { data: unknown; error: { message: string } | null }) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) {
        const cfg = tables.get(table)
        return Promise.resolve(cfg?.awaited ?? { data: null, error: null }).then(
          onFulfilled,
          onRejected,
        )
      },
    }

    return builder
  }

  const client = { from } as never as SupabaseClient

  return {
    client,
    queries,
    setTable: (table, config) => {
      tables.set(table, config)
    },
  }
}

const mockedResolveToken = vi.mocked(resolveMetaTokenForClient)
const mockedGetStoredPageToken = vi.mocked(getStoredPageToken)
const mockedCreateDraft = vi.mocked(createDraftForApproval)
const mockedLoadRedlines = vi.mocked(loadDraftRedlines)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('buildRunDeps.loadWorkOrder', () => {
  it('returns { ok:false, error } on db error', async () => {
    const fake = makeFakeSupabase()
    fake.setTable('content_work_orders', {
      maybeSingle: { data: null, error: { message: 'boom' } },
    })
    const deps = buildRunDeps(fake.client)

    const result = await deps.loadWorkOrder('wo-1')

    expect(result).toEqual({ ok: false, error: 'boom' })
  })

  it('returns { ok:true, row:null } when no row', async () => {
    const fake = makeFakeSupabase()
    fake.setTable('content_work_orders', {
      maybeSingle: { data: null, error: null },
    })
    const deps = buildRunDeps(fake.client)

    const result = await deps.loadWorkOrder('wo-1')

    expect(result).toEqual({ ok: true, row: null })
  })

  it('coerces fields and nulls non-object brief/output/review_ref', async () => {
    const fake = makeFakeSupabase()
    const publishedRef = { id: 'pub-1' }
    fake.setTable('content_work_orders', {
      maybeSingle: {
        data: {
          id: 42,
          client_id: 7,
          status: 3,
          brief: 'a string',
          output: ['an', 'array'],
          review_ref: null,
          published_ref: publishedRef,
        },
        error: null,
      },
    })
    const deps = buildRunDeps(fake.client)

    const result = await deps.loadWorkOrder('wo-1')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.row).not.toBeNull()
    if (!result.row) return
    expect(result.row.id).toBe('42')
    expect(result.row.client_id).toBe('7')
    expect(result.row.status).toBe('3')
    expect(result.row.brief).toBeNull()
    expect(result.row.output).toBeNull()
    expect(result.row.review_ref).toBeNull()
    expect(result.row.published_ref).toBe(publishedRef)
  })

  it('queries the expected table and columns', async () => {
    const fake = makeFakeSupabase()
    fake.setTable('content_work_orders', {
      maybeSingle: { data: null, error: null },
    })
    const deps = buildRunDeps(fake.client)

    await deps.loadWorkOrder('wo-1')

    expect(fake.queries).toHaveLength(1)
    expect(fake.queries[0].table).toBe('content_work_orders')
    expect(fake.queries[0].columns).toBe(
      'id, client_id, status, brief, output, review_ref, published_ref',
    )
  })
})

describe('buildRunDeps.loadClientMeta', () => {
  it('returns null on error', async () => {
    const fake = makeFakeSupabase()
    fake.setTable('clients', {
      maybeSingle: { data: null, error: { message: 'nope' } },
    })
    const deps = buildRunDeps(fake.client)

    const result = await deps.loadClientMeta('c-1')

    expect(result).toBeNull()
  })

  it('returns null when no row', async () => {
    const fake = makeFakeSupabase()
    fake.setTable('clients', {
      maybeSingle: { data: null, error: null },
    })
    const deps = buildRunDeps(fake.client)

    const result = await deps.loadClientMeta('c-1')

    expect(result).toBeNull()
  })

  it('nulls non-string fields and passes strings through', async () => {
    const fake = makeFakeSupabase()
    fake.setTable('clients', {
      maybeSingle: {
        data: {
          meta_ad_account_id: 123,
          facebook_page_id: null,
          country: 'US',
          industry: 'retail',
        },
        error: null,
      },
    })
    const deps = buildRunDeps(fake.client)

    const result = await deps.loadClientMeta('c-1')

    expect(result).toEqual({
      adAccountId: null,
      facebookPageId: null,
      country: 'US',
      industry: 'retail',
    })
  })

  it('queries the expected table and columns', async () => {
    const fake = makeFakeSupabase()
    fake.setTable('clients', {
      maybeSingle: { data: null, error: null },
    })
    const deps = buildRunDeps(fake.client)

    await deps.loadClientMeta('c-1')

    expect(fake.queries).toHaveLength(1)
    expect(fake.queries[0].table).toBe('clients')
    expect(fake.queries[0].columns).toBe(
      'meta_ad_account_id, facebook_page_id, country, industry',
    )
  })
})

describe('buildRunDeps.isAdAccountRegistered', () => {
  it('returns null (not false) on read error', async () => {
    const fake = makeFakeSupabase()
    fake.setTable('client_meta_ad_accounts', {
      awaited: { data: null, error: { message: 'read failed' } },
    })
    const deps = buildRunDeps(fake.client)

    const result = await deps.isAdAccountRegistered('c-1', 'act_555')

    expect(result).toBeNull()
  })

  it('matches registered ids with normalization', async () => {
    const fake = makeFakeSupabase()
    fake.setTable('client_meta_ad_accounts', {
      awaited: {
        data: [{ ad_account_id: 'ACT_555 ' }, { ad_account_id: 'act_777' }],
        error: null,
      },
    })
    const deps = buildRunDeps(fake.client)

    expect(await deps.isAdAccountRegistered('c-1', 'act_555')).toBe(true)
    expect(await deps.isAdAccountRegistered('c-1', '555')).toBe(true)
    expect(await deps.isAdAccountRegistered('c-1', 'act_999')).toBe(false)
  })

  it('returns false for an empty list', async () => {
    const fake = makeFakeSupabase()
    fake.setTable('client_meta_ad_accounts', {
      awaited: { data: [], error: null },
    })
    const deps = buildRunDeps(fake.client)

    const result = await deps.isAdAccountRegistered('c-1', 'act_555')

    expect(result).toBe(false)
  })

  it('ignores rows with non-string ad_account_id', async () => {
    const fake = makeFakeSupabase()
    fake.setTable('client_meta_ad_accounts', {
      awaited: {
        data: [{ ad_account_id: 555 }, { ad_account_id: null }],
        error: null,
      },
    })
    const deps = buildRunDeps(fake.client)

    const result = await deps.isAdAccountRegistered('c-1', 'act_555')

    expect(result).toBe(false)
  })

  it('queries the expected table', async () => {
    const fake = makeFakeSupabase()
    fake.setTable('client_meta_ad_accounts', {
      awaited: { data: [], error: null },
    })
    const deps = buildRunDeps(fake.client)

    await deps.isAdAccountRegistered('c-1', 'act_555')

    expect(fake.queries).toHaveLength(1)
    expect(fake.queries[0].table).toBe('client_meta_ad_accounts')
  })
})

describe('buildRunDeps.resolveToken', () => {
  it('passes through a resolved token', async () => {
    mockedResolveToken.mockResolvedValueOnce({ token: 't', source: 'client_domain' })
    const fake = makeFakeSupabase()
    const deps = buildRunDeps(fake.client)

    const result = await deps.resolveToken('c-1')

    expect(result).toEqual({ token: 't', source: 'client_domain' })
  })

  it('returns null when the resolver resolves null', async () => {
    mockedResolveToken.mockResolvedValueOnce(null)
    const fake = makeFakeSupabase()
    const deps = buildRunDeps(fake.client)

    const result = await deps.resolveToken('c-1')

    expect(result).toBeNull()
  })

  it('returns null when the resolver rejects', async () => {
    mockedResolveToken.mockRejectedValueOnce(new Error('network'))
    const fake = makeFakeSupabase()
    const deps = buildRunDeps(fake.client)

    const result = await deps.resolveToken('c-1')

    expect(result).toBeNull()
  })
})

describe('buildRunDeps.loadPageToken', () => {
  it('passes through a resolved page token', async () => {
    mockedGetStoredPageToken.mockResolvedValueOnce('pt')
    const fake = makeFakeSupabase()
    const deps = buildRunDeps(fake.client)

    const result = await deps.loadPageToken('c-1', 'page-1')

    expect(result).toBe('pt')
  })

  it('returns null when the resolver rejects', async () => {
    mockedGetStoredPageToken.mockRejectedValueOnce(new Error('boom'))
    const fake = makeFakeSupabase()
    const deps = buildRunDeps(fake.client)

    const result = await deps.loadPageToken('c-1', 'page-1')

    expect(result).toBeNull()
  })

  it('returns null when the resolver resolves null', async () => {
    mockedGetStoredPageToken.mockResolvedValueOnce(null)
    const fake = makeFakeSupabase()
    const deps = buildRunDeps(fake.client)

    const result = await deps.loadPageToken('c-1', 'page-1')

    expect(result).toBeNull()
  })
})

describe('buildRunDeps.loadRedlines', () => {
  it('delegates to loadDraftRedlines and passes null through', async () => {
    mockedLoadRedlines.mockResolvedValueOnce(null)
    const fake = makeFakeSupabase()
    const deps = buildRunDeps(fake.client)

    const result = await deps.loadRedlines('c-1')

    expect(result).toBeNull()
    expect(mockedLoadRedlines).toHaveBeenCalledWith(fake.client, 'c-1')
  })

  it('passes an empty array through', async () => {
    mockedLoadRedlines.mockResolvedValueOnce([])
    const fake = makeFakeSupabase()
    const deps = buildRunDeps(fake.client)

    const result = await deps.loadRedlines('c-1')

    expect(result).toEqual([])
  })
})

describe('buildRunDeps.createDraft', () => {
  it('is exactly the mocked createDraftForApproval', () => {
    const fake = makeFakeSupabase()
    const deps = buildRunDeps(fake.client)

    expect(deps.createDraft).toBe(mockedCreateDraft)
  })
})

describe('buildRunDeps.nowMs', () => {
  it('returns a number close to Date.now()', () => {
    const fake = makeFakeSupabase()
    const deps = buildRunDeps(fake.client)

    const before = Date.now()
    const value = deps.nowMs()
    const after = Date.now()

    expect(typeof value).toBe('number')
    expect(value).toBeGreaterThanOrEqual(before)
    expect(value).toBeLessThanOrEqual(after)
  })
})
