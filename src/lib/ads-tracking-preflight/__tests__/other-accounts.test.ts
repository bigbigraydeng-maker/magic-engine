import { describe, expect, it } from 'vitest'
import { readOtherAccounts } from '../other-accounts'

type Row = Record<string, unknown>

interface FakeDb {
  tables: Record<string, Row[]>
  errors: Record<string, string>
  /** 库没报错、但原样返回这个东西（模拟读回来的形状不对） */
  raw: Record<string, unknown>
  reads: string[]
}

function makeDb(tables: Record<string, Row[]>, errors: Record<string, string> = {}): FakeDb {
  return { tables, errors, raw: {}, reads: [] }
}

interface Chain extends PromiseLike<{ data: Row[] | null; error: { message: string } | null }> {
  select: (cols?: string) => Chain
  eq: (col: string, val: unknown) => Chain
  in: (col: string, arr: readonly unknown[]) => Chain
  gte: (col: string, val: unknown) => Chain
  order: (col: string, opts: { ascending: boolean }) => Chain
  limit: (n: number) => Chain
  range: (a: number, b: number) => Chain
}

function chain(db: FakeDb, table: string): Chain {
  db.reads.push(table)
  let rows: Row[] = (db.tables[table] ?? []).slice()
  const err = db.errors[table]
  const self: Chain = {
    select: () => self,
    eq: (col, val) => {
      rows = rows.filter(r => String(r[col]) === String(val))
      return self
    },
    in: (col, arr) => {
      const set = new Set(arr.map(v => String(v)))
      rows = rows.filter(r => set.has(String(r[col])))
      return self
    },
    gte: (col, val) => {
      rows = rows.filter(r => String(r[col]) >= String(val))
      return self
    },
    order: (col, opts) => {
      rows = rows.slice().sort((a, b) => {
        const av = String(a[col])
        const bv = String(b[col])
        if (av === bv) return 0
        const cmp = av < bv ? -1 : 1
        return opts.ascending === false ? -cmp : cmp
      })
      return self
    },
    limit: n => {
      rows = rows.slice(0, n)
      return self
    },
    range: (a, b) => {
      rows = rows.slice(a, b + 1)
      return self
    },
    then: (onFulfilled, onRejected) => {
      const result = err
        ? { data: null, error: { message: err } }
        : table in db.raw
          ? { data: db.raw[table] as Row[] | null, error: null }
          : { data: rows, error: null }
      return Promise.resolve(result).then(onFulfilled, onRejected)
    },
  }
  return self
}

function fakeSupabase(db: FakeDb) {
  return { from: (table: string) => chain(db, table) } as unknown as Parameters<typeof readOtherAccounts>[0]['supabase']
}

const NOW = new Date('2026-10-21T10:00:00.000Z')
const CLIENT = 'client-1'
const MINE = 'act_1111111111'
const OTHER = 'act_2222222222'

function iso(hoursAgo: number): string {
  return new Date(NOW.getTime() - hoursAgo * 60 * 60 * 1000).toISOString()
}

function registryRow(id: string, label: string | null, hidden: boolean): Row {
  return { client_id: CLIENT, ad_account_id: id, label, hidden_from_ad_health: hidden }
}

function captureRow(accountId: string, level: string, hoursAgo = 2, overrides: Row = {}): Row {
  return {
    client_id: CLIENT,
    ad_account_id: accountId,
    level,
    captured_at: iso(hoursAgo),
    complete: true,
    skipped_shared: false,
    ...overrides,
  }
}

function capturesFor(accountId: string, hoursAgo = 2): Row[] {
  return ['account', 'campaign', 'adset'].map(level => captureRow(accountId, level, hoursAgo))
}

function entityRow(accountId: string, level: string, entityId: string, overrides: Row = {}): Row {
  return {
    client_id: CLIENT,
    ad_account_id: accountId,
    level,
    entity_id: entityId,
    campaign_id: null,
    effective_status: 'ACTIVE',
    daily_budget_minor: null,
    lifetime_budget_minor: null,
    capture_reason: 'changed',
    account_status: null,
    currency: null,
    captured_at: iso(2),
    ...overrides,
  }
}

function baseTables(): Record<string, Row[]> {
  return {
    client_meta_ad_accounts: [registryRow(MINE, 'Official', false), registryRow(OTHER, 'Old main', true)],
    ad_snapshot_captures: capturesFor(OTHER),
    ad_entity_snapshots: [],
  }
}

async function run(db: FakeDb) {
  return readOtherAccounts({ supabase: fakeSupabase(db), clientId: CLIENT, adAccountId: MINE, now: NOW })
}

describe('readOtherAccounts', () => {
  it('reads the realistic case', async () => {
    const tables = baseTables()
    tables.ad_entity_snapshots = [
      entityRow(OTHER, 'account', 'acc', { account_status: 3, currency: 'nzd' }),
      entityRow(OTHER, 'campaign', 'c1', { daily_budget_minor: 4000 }),
      entityRow(OTHER, 'campaign', 'c2', { daily_budget_minor: 6000 }),
      entityRow(OTHER, 'campaign', 'c3'),
      entityRow(OTHER, 'campaign', 'c4'),
      entityRow(OTHER, 'adset', 'a1', { campaign_id: 'c3', daily_budget_minor: 500 }),
      entityRow(OTHER, 'adset', 'a2', { campaign_id: 'c3', daily_budget_minor: 400 }),
      entityRow(OTHER, 'adset', 'a3', { campaign_id: 'c4', daily_budget_minor: 600 }),
      entityRow(OTHER, 'campaign', 'c5', { effective_status: 'PAUSED' }),
      entityRow(OTHER, 'campaign', 'c6', { captured_at: iso(5) }),
      entityRow(OTHER, 'campaign', 'c6', { effective_status: 'PAUSED', captured_at: iso(1) }),
    ]
    const res = await run(makeDb(tables))
    expect(res).toEqual({
      ok: true,
      accounts: [
        {
          tail: '2222',
          label: 'Old main',
          hidden: true,
          account_status: 3,
          currency: 'NZD',
          open_campaign_count: 4,
          live_daily_budget_cents: 11500,
          live_lifetime_budget_count: 0,
          live_entity_count: 5,
          snapshot_at: iso(2),
        },
      ],
    })
  })

  it('returns zero fact when everything is paused', async () => {
    const tables = baseTables()
    tables.ad_entity_snapshots = [
      entityRow(OTHER, 'account', 'acc', { account_status: 1, currency: 'NZD' }),
      entityRow(OTHER, 'campaign', 'c1', { effective_status: 'PAUSED', daily_budget_minor: 4000 }),
      entityRow(OTHER, 'adset', 'a1', { effective_status: 'PAUSED', daily_budget_minor: 500 }),
    ]
    const res = await run(makeDb(tables))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.accounts).toHaveLength(1)
    expect(res.accounts[0].open_campaign_count).toBe(0)
    expect(res.accounts[0].live_daily_budget_cents).toBe(0)
    expect(res.accounts[0].live_entity_count).toBe(0)
  })

  it('ignores disappeared rows', async () => {
    const tables = baseTables()
    tables.ad_entity_snapshots = [
      entityRow(OTHER, 'campaign', 'c1', { capture_reason: 'disappeared', daily_budget_minor: 4000 }),
    ]
    const res = await run(makeDb(tables))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.accounts[0].open_campaign_count).toBe(0)
    expect(res.accounts[0].live_daily_budget_cents).toBe(0)
  })

  it('ignores rows older than 48h', async () => {
    const tables = baseTables()
    tables.ad_entity_snapshots = [
      entityRow(OTHER, 'campaign', 'c1', { daily_budget_minor: 4000, captured_at: iso(72) }),
    ]
    const res = await run(makeDb(tables))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.accounts[0].open_campaign_count).toBe(0)
  })

  it('returns empty when only this account is registered', async () => {
    const tables = baseTables()
    tables.client_meta_ad_accounts = [registryRow(MINE, 'Official', false)]
    const db = makeDb(tables)
    const res = await run(db)
    expect(res).toEqual({ ok: true, accounts: [] })
    expect(db.reads).not.toContain('ad_snapshot_captures')
    expect(db.reads).not.toContain('ad_entity_snapshots')
  })

  it('returns empty when registry is empty', async () => {
    const tables = baseTables()
    tables.client_meta_ad_accounts = []
    const res = await run(makeDb(tables))
    expect(res).toEqual({ ok: true, accounts: [] })
  })

  it('matches ids with and without act_ prefix', async () => {
    const tables = baseTables()
    tables.client_meta_ad_accounts = [registryRow(MINE, 'Official', false), registryRow('2222222222', 'Old main', true)]
    tables.ad_snapshot_captures = capturesFor(OTHER)
    tables.ad_entity_snapshots = [entityRow(OTHER, 'campaign', 'c1', { daily_budget_minor: 4000 })]
    const res = await run(makeDb(tables))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.accounts[0].live_daily_budget_cents).toBe(4000)
  })

  it('matches ids the other way round', async () => {
    const tables = baseTables()
    tables.client_meta_ad_accounts = [registryRow(MINE, 'Official', false), registryRow(OTHER, 'Old main', true)]
    tables.ad_snapshot_captures = capturesFor('2222222222')
    tables.ad_entity_snapshots = [entityRow('2222222222', 'campaign', 'c1', { daily_budget_minor: 4000 })]
    const res = await run(makeDb(tables))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.accounts[0].live_daily_budget_cents).toBe(4000)
  })

  describe('failures', () => {
    it('registry query error', async () => {
      const db = makeDb(baseTables(), { client_meta_ad_accounts: 'boom' })
      const res = await run(db)
      expect(res.ok).toBe(false)
      if (res.ok) return
      expect(res.error).toContain('client_meta_ad_accounts')
    })

    it('registry data not an array', async () => {
      const db = makeDb(baseTables())
      db.raw.client_meta_ad_accounts = { not: 'a list' }
      const res = await run(db)
      expect(res.ok).toBe(false)
    })

    it('snapshot row that cannot be read is a failure, never skipped', async () => {
      const db = makeDb(baseTables())
      db.raw.ad_entity_snapshots = [{ ad_account_id: OTHER, level: 'campaign', effective_status: 'ACTIVE' }]
      const res = await run(db)
      expect(res.ok).toBe(false)
      if (res.ok) return
      expect(res.error).toContain('ad_entity_snapshots')
      expect(res.error).not.toContain('2222222222')
    })

    it('registry row without a string account id', async () => {
      const db = makeDb(baseTables())
      db.raw.client_meta_ad_accounts = [{ ad_account_id: 5, label: 'x', hidden_from_ad_health: false }]
      const res = await run(db)
      expect(res.ok).toBe(false)
    })

    it('my account missing', async () => {
      const tables = baseTables()
      tables.client_meta_ad_accounts = [registryRow(OTHER, 'Old main', true)]
      const res = await run(makeDb(tables))
      expect(res.ok).toBe(false)
      if (res.ok) return
      expect(res.error).not.toContain('2222222222')
    })

    it('no capture rows', async () => {
      const tables = baseTables()
      tables.ad_snapshot_captures = []
      const res = await run(makeDb(tables))
      expect(res.ok).toBe(false)
      if (res.ok) return
      expect(res.error).not.toContain('2222222222')
    })

    it('capture older than 12h', async () => {
      const tables = baseTables()
      tables.ad_snapshot_captures = capturesFor(OTHER, 13)
      const res = await run(makeDb(tables))
      expect(res.ok).toBe(false)
    })

    it('capture not complete for adset', async () => {
      const tables = baseTables()
      tables.ad_snapshot_captures = [
        captureRow(OTHER, 'account'),
        captureRow(OTHER, 'campaign'),
        captureRow(OTHER, 'adset', 2, { complete: false }),
      ]
      const res = await run(makeDb(tables))
      expect(res.ok).toBe(false)
      if (res.ok) return
      expect(res.error).toContain('广告组级')
    })

    it('capture skipped_shared', async () => {
      const tables = baseTables()
      tables.ad_snapshot_captures = [
        captureRow(OTHER, 'account'),
        captureRow(OTHER, 'campaign', 2, { skipped_shared: true }),
        captureRow(OTHER, 'adset'),
      ]
      const res = await run(makeDb(tables))
      expect(res.ok).toBe(false)
    })

    it('snapshot query error', async () => {
      const db = makeDb(baseTables(), { ad_entity_snapshots: 'boom' })
      const res = await run(db)
      expect(res.ok).toBe(false)
    })

    it.each([-5, 12.5, 'abc'])('bad budget %s', async bad => {
      const tables = baseTables()
      tables.ad_entity_snapshots = [entityRow(OTHER, 'campaign', 'c1', { daily_budget_minor: bad })]
      const res = await run(makeDb(tables))
      expect(res.ok).toBe(false)
      if (res.ok) return
      expect(res.error).not.toContain('2222222222')
    })

    it('adset with no budget and no budgeted campaign', async () => {
      const tables = baseTables()
      tables.ad_entity_snapshots = [
        entityRow(OTHER, 'campaign', 'c1'),
        entityRow(OTHER, 'adset', 'a1', { campaign_id: 'c1' }),
      ]
      const res = await run(makeDb(tables))
      expect(res.ok).toBe(false)
    })
  })

  it('two other accounts in registry order', async () => {
    const tables = baseTables()
    tables.client_meta_ad_accounts = [
      registryRow(MINE, 'Official', false),
      registryRow(OTHER, 'Old main', true),
      registryRow('act_3333333333', 'Third', false),
    ]
    tables.ad_snapshot_captures = [...capturesFor(OTHER), ...capturesFor('act_3333333333')]
    tables.ad_entity_snapshots = [
      entityRow(OTHER, 'campaign', 'c1', { daily_budget_minor: 4000 }),
      entityRow('act_3333333333', 'campaign', 'c2', { daily_budget_minor: 7000 }),
    ]
    const res = await run(makeDb(tables))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.accounts.map(a => a.tail)).toEqual(['2222', '3333'])
    expect(res.accounts[0].live_daily_budget_cents).toBe(4000)
    expect(res.accounts[1].live_daily_budget_cents).toBe(7000)
  })

  it('one failing capture fails the whole call', async () => {
    const tables = baseTables()
    tables.client_meta_ad_accounts = [
      registryRow(MINE, 'Official', false),
      registryRow(OTHER, 'Old main', true),
      registryRow('act_3333333333', 'Third', false),
    ]
    tables.ad_snapshot_captures = capturesFor(OTHER)
    const res = await run(makeDb(tables))
    expect(res.ok).toBe(false)
  })
})
