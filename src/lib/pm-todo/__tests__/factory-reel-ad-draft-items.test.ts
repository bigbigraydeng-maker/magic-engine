import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from '../manual-item-types'
import {
  buildFactoryReelAdDraftItems,
  loadFactoryReelAdDraftSnapshot,
  pushFactoryReelAdDraftItems,
  CONTENT_BLOCK_CODES,
  IGNORED_BLOCK_CODES,
  INTENT_LIMIT,
  STUCK_AFTER_MINUTES,
  type FactoryReelAdDraftSnapshot,
  type IntentRow,
  type DraftRow,
} from '../factory-reel-ad-draft-items'

const NOW = new Date('2025-06-15T12:00:00.000Z')

function nameOf(clientId: string): string {
  return clientId === 'c1' ? '客户一' : clientId
}

function makeIntent(overrides: Partial<IntentRow> & { payload: Record<string, unknown> }): IntentRow {
  return {
    id: overrides.id ?? 'i1',
    client_id: overrides.client_id ?? 'c1',
    created_at: overrides.created_at ?? '2025-06-15T11:00:00.000Z',
    payload: overrides.payload,
  }
}

function makeSnapshot(overrides: Partial<FactoryReelAdDraftSnapshot> = {}): FactoryReelAdDraftSnapshot {
  return {
    intents: overrides.intents ?? [],
    drafts: overrides.drafts ?? new Map<string, DraftRow>(),
    permalinks: overrides.permalinks ?? new Map<string, string | null>(),
    clientCapsUsd: overrides.clientCapsUsd ?? new Map<string, number | null>(),
    truncated: overrides.truncated ?? false,
  }
}

function draftedIntent(overrides: Partial<IntentRow> = {}): IntentRow {
  return makeIntent({
    ...overrides,
    payload: {
      status: 'drafted',
      mode: 'on',
      draft_action_id: 'd1',
      work_order_id: 'wo-12345678',
      ...(overrides.payload ?? {}),
    },
  })
}

function awaitingDraft(overrides: Record<string, unknown> = {}): DraftRow {
  return {
    id: 'd1',
    payload: {
      status: 'awaiting_approval',
      draft: { dailyBudget: 20, durationDays: 3 },
      ...overrides,
    },
  }
}

// ---- fake supabase ---------------------------------------------------------

interface TableConfig {
  data?: unknown
  error?: { message: string } | null
}

interface FakeConfig {
  tables: Record<string, TableConfig>
}

interface FakeSupabase {
  client: SupabaseClient
  queriedTables: string[]
}

function makeFakeSupabase(config: FakeConfig): FakeSupabase {
  const queriedTables: string[] = []

  function makeChain(table: string): unknown {
    const result: TableConfig = config.tables[table] ?? { data: [], error: null }
    const chain = {
      select() {
        return chain
      },
      eq() {
        return chain
      },
      gte() {
        return chain
      },
      order() {
        return chain
      },
      limit() {
        return chain
      },
      in() {
        return chain
      },
      then(resolve: (v: { data: unknown; error: { message: string } | null }) => unknown) {
        return Promise.resolve({
          data: result.data ?? [],
          error: result.error ?? null,
        }).then(resolve)
      },
    }
    return chain
  }

  const client = {
    from(table: string) {
      queriedTables.push(table)
      return makeChain(table)
    },
  } as never as SupabaseClient

  return { client, queriedTables }
}

// ---- builder tests ---------------------------------------------------------

describe('buildFactoryReelAdDraftItems', () => {
  it('skips dry_run intents', () => {
    const snapshot = makeSnapshot({
      intents: [
        makeIntent({ payload: { status: 'drafted', mode: 'dry_run', draft_action_id: 'd1' } }),
      ],
      drafts: new Map([['d1', awaitingDraft()]]),
    })
    expect(buildFactoryReelAdDraftItems(snapshot, nameOf, NOW)).toHaveLength(0)
  })

  it('skips dry_run_ok status', () => {
    const snapshot = makeSnapshot({
      intents: [makeIntent({ payload: { status: 'dry_run_ok', mode: 'on' } })],
    })
    expect(buildFactoryReelAdDraftItems(snapshot, nameOf, NOW)).toHaveLength(0)
  })

  it('drafted + awaiting draft => one PM item with permalink, budget, end date, audience note, approval note', () => {
    const snapshot = makeSnapshot({
      intents: [draftedIntent()],
      drafts: new Map([['d1', awaitingDraft()]]),
      permalinks: new Map([['wo-12345678', 'https://fb.com/reel/abc']]),
    })
    const items = buildFactoryReelAdDraftItems(snapshot, nameOf, NOW)
    expect(items).toHaveLength(1)
    const item = items[0]
    expect(item.kind).toBe('factory_reel_ad_awaiting_approval')
    expect(item.what).toContain('https://fb.com/reel/abc')
    expect(item.what).toContain('$20')
    expect(item.what).toContain('2025-06-18')
    expect(item.what).toContain('不在任何受众池')
    expect(item.what).toContain('你批了才会开')
    expect(item.href).toBe('https://app.magicengine.com.au/dashboard/ad-approval')
  })

  it('drafted but draft already decided (active) => no item', () => {
    const snapshot = makeSnapshot({
      intents: [draftedIntent()],
      drafts: new Map([['d1', awaitingDraft({ status: 'active' })]]),
    })
    expect(buildFactoryReelAdDraftItems(snapshot, nameOf, NOW)).toHaveLength(0)
  })

  it('drafted with missing draft row => dev item', () => {
    const snapshot = makeSnapshot({ intents: [draftedIntent()] })
    const items = buildFactoryReelAdDraftItems(snapshot, nameOf, NOW)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('factory_reel_ad_draft_dev_issue')
    expect(items[0].what).toContain('草稿账本行找不到')
  })

  it('permalink null => text contains fallback', () => {
    const snapshot = makeSnapshot({
      intents: [draftedIntent()],
      drafts: new Map([['d1', awaitingDraft()]]),
      permalinks: new Map([['wo-12345678', null]]),
    })
    const items = buildFactoryReelAdDraftItems(snapshot, nameOf, NOW)
    expect(items[0].what).toContain('没取到 Reel 链接')
  })

  it('client cap present => text contains cap; absent => no 总上限', () => {
    const withCap = makeSnapshot({
      intents: [draftedIntent()],
      drafts: new Map([['d1', awaitingDraft()]]),
      clientCapsUsd: new Map([['c1', 50]]),
    })
    expect(buildFactoryReelAdDraftItems(withCap, nameOf, NOW)[0].what).toContain('总上限 $50')

    const withoutCap = makeSnapshot({
      intents: [draftedIntent()],
      drafts: new Map([['d1', awaitingDraft()]]),
    })
    expect(buildFactoryReelAdDraftItems(withoutCap, nameOf, NOW)[0].what).not.toContain('总上限')
  })

  it('blocked/copy_redline_hit => content_blocked item', () => {
    const snapshot = makeSnapshot({
      intents: [
        makeIntent({
          payload: { status: 'blocked', mode: 'on', block_code: 'copy_redline_hit', work_order_id: 'wo-12345678' },
        }),
      ],
      permalinks: new Map([['wo-12345678', 'https://fb.com/reel/abc']]),
    })
    const items = buildFactoryReelAdDraftItems(snapshot, nameOf, NOW)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('factory_reel_ad_content_blocked')
    expect(items[0].href).toBe('https://app.magicengine.com.au/dashboard/factory')
  })

  it('blocked/stale => no item', () => {
    const snapshot = makeSnapshot({
      intents: [makeIntent({ payload: { status: 'blocked', mode: 'on', block_code: 'stale' } })],
    })
    expect(buildFactoryReelAdDraftItems(snapshot, nameOf, NOW)).toHaveLength(0)
  })

  it('blocked/token_dead => dev item with 广告授权失效', () => {
    const snapshot = makeSnapshot({
      intents: [makeIntent({ payload: { status: 'blocked', mode: 'on', block_code: 'token_dead' } })],
    })
    const items = buildFactoryReelAdDraftItems(snapshot, nameOf, NOW)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('factory_reel_ad_draft_dev_issue')
    expect(items[0].what).toContain('广告授权失效')
  })

  it('failed with provider_impact unknown => dev item mentions [ME-DRAFT] + first 8 chars', () => {
    const snapshot = makeSnapshot({
      intents: [
        makeIntent({
          payload: {
            status: 'failed',
            mode: 'on',
            error: 'boom',
            provider_impact: 'unknown',
            work_order_id: 'wo-12345678',
          },
        }),
      ],
    })
    const items = buildFactoryReelAdDraftItems(snapshot, nameOf, NOW)
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('[ME-DRAFT] wo-12345')
  })

  it('failed with provider_impact none => no [ME-DRAFT] mention', () => {
    const snapshot = makeSnapshot({
      intents: [
        makeIntent({
          payload: { status: 'failed', mode: 'on', error: 'boom', provider_impact: 'none' },
        }),
      ],
    })
    const items = buildFactoryReelAdDraftItems(snapshot, nameOf, NOW)
    expect(items).toHaveLength(1)
    expect(items[0].what).not.toContain('[ME-DRAFT]')
  })

  it('started 10 minutes old => none; 45 minutes old => stuck dev item', () => {
    const fresh = makeSnapshot({
      intents: [
        makeIntent({
          created_at: '2025-06-15T11:50:00.000Z',
          payload: { status: 'started', mode: 'on', updated_at: '2025-06-15T11:50:00.000Z' },
        }),
      ],
    })
    expect(buildFactoryReelAdDraftItems(fresh, nameOf, NOW)).toHaveLength(0)

    const stuck = makeSnapshot({
      intents: [
        makeIntent({
          created_at: '2025-06-15T11:15:00.000Z',
          payload: { status: 'started', mode: 'on', updated_at: '2025-06-15T11:15:00.000Z' },
        }),
      ],
    })
    const items = buildFactoryReelAdDraftItems(stuck, nameOf, NOW)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('factory_reel_ad_draft_dev_issue')
  })

  it('more than 30 items => 30 + 1 overflow dev item', () => {
    const intents: IntentRow[] = []
    for (let i = 0; i < 40; i++) {
      intents.push(
        makeIntent({
          id: `i${i}`,
          payload: { status: 'failed', mode: 'on', error: 'boom', provider_impact: 'none' },
        }),
      )
    }
    const items = buildFactoryReelAdDraftItems(makeSnapshot({ intents }), nameOf, NOW)
    expect(items).toHaveLength(31)
    expect(items[30].kind).toBe('factory_reel_ad_draft_dev_issue')
    expect(items[30].what).toContain('没显示')
  })

  it('every produced item what never contains migration/token/webhook', () => {
    const snapshot = makeSnapshot({
      intents: [
        draftedIntent(),
        makeIntent({ id: 'i2', payload: { status: 'blocked', mode: 'on', block_code: 'copy_redline_hit' } }),
        makeIntent({ id: 'i3', payload: { status: 'failed', mode: 'on', error: 'boom', provider_impact: 'unknown' } }),
      ],
      drafts: new Map([['d1', awaitingDraft()]]),
    })
    const items = buildFactoryReelAdDraftItems(snapshot, nameOf, NOW)
    for (const item of items) {
      expect(item.what).not.toContain('migration')
      expect(item.what).not.toContain('token')
      expect(item.what).not.toContain('webhook')
    }
  })

  it('exposes the expected constants', () => {
    expect(CONTENT_BLOCK_CODES.has('copy_redline_hit')).toBe(true)
    expect(IGNORED_BLOCK_CODES.has('stale')).toBe(true)
    expect(INTENT_LIMIT).toBe(100)
    expect(STUCK_AFTER_MINUTES).toBe(30)
  })
})

// ---- loader tests ----------------------------------------------------------

describe('loadFactoryReelAdDraftSnapshot', () => {
  it('intents read error => ok:false', async () => {
    const fake = makeFakeSupabase({
      tables: { flywheel_actions: { data: [], error: { message: 'boom' } } },
    })
    const result = await loadFactoryReelAdDraftSnapshot(fake.client, NOW)
    expect(result.ok).toBe(false)
  })

  it('drafts read error => ok:false', async () => {
    let call = 0
    const fake = makeFakeSupabase({
      tables: {
        flywheel_actions: {
          data: [
            {
              id: 'i1',
              client_id: 'c1',
              created_at: '2025-06-15T11:00:00.000Z',
              payload: { status: 'drafted', mode: 'on', draft_action_id: 'd1', work_order_id: 'wo-1' },
            },
          ],
          error: null,
        },
      },
    })
    // override from to return error on second call
    const originalFrom = fake.client.from.bind(fake.client)
    fake.client.from = ((table: string) => {
      call++
      if (call === 2) {
        return {
          select: () => ({
            in: () => Promise.resolve({ data: [], error: { message: 'drafts boom' } }),
          }),
        } as never
      }
      return originalFrom(table)
    }) as never

    const result = await loadFactoryReelAdDraftSnapshot(fake.client, NOW)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('drafts boom')
    }
  })

  it('work-order read error => ok:true with null permalinks', async () => {
    const fake = makeFakeSupabase({
      tables: {
        flywheel_actions: {
          data: [
            {
              id: 'i1',
              client_id: 'c1',
              created_at: '2025-06-15T11:00:00.000Z',
              payload: { status: 'drafted', mode: 'on', draft_action_id: 'd1', work_order_id: 'wo-1' },
            },
            {
              id: 'd1',
              payload: { status: 'awaiting_approval', draft: { dailyBudget: 20, durationDays: 3 } },
            },
          ],
          error: null,
        },
        content_work_orders: { data: [], error: { message: 'wo boom' } },
        ad_strategy_configs: { data: [], error: null },
      },
    })
    const result = await loadFactoryReelAdDraftSnapshot(fake.client, NOW)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.snapshot.permalinks.get('wo-1') ?? null).toBeNull()
    }
  })

  it('cap read error => ok:true', async () => {
    const fake = makeFakeSupabase({
      tables: {
        flywheel_actions: {
          data: [
            {
              id: 'i1',
              client_id: 'c1',
              created_at: '2025-06-15T11:00:00.000Z',
              payload: { status: 'drafted', mode: 'on', draft_action_id: 'd1', work_order_id: 'wo-1' },
            },
            {
              id: 'd1',
              payload: { status: 'awaiting_approval', draft: { dailyBudget: 20, durationDays: 3 } },
            },
          ],
          error: null,
        },
        content_work_orders: { data: [], error: null },
        ad_strategy_configs: { data: [], error: { message: 'cap boom' } },
      },
    })
    const result = await loadFactoryReelAdDraftSnapshot(fake.client, NOW)
    expect(result.ok).toBe(true)
  })
})

// ---- pusher tests ----------------------------------------------------------

describe('pushFactoryReelAdDraftItems', () => {
  it('failing read => exactly one item containing 读不出来', async () => {
    const fake = makeFakeSupabase({
      tables: { flywheel_actions: { data: [], error: { message: 'boom' } } },
    })
    const items: ManualItem[] = []
    await pushFactoryReelAdDraftItems(fake.client, items, nameOf, NOW)
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('读不出来')
  })
})
