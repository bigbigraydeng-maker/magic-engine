import { describe, it, expect } from 'vitest'
import {
  buildInstagramPublishItems,
  pushInstagramPublishItems,
  INSTAGRAM_ITEM_LOOKBACK_DAYS,
  type InstagramBlockedReceipt,
} from '../instagram-publish-items'
import type { ManualItem } from '../manual-item-types'
import type { InstagramPublishReceipt } from '../../factory/publish/instagram-receipt'
import { withReceipt } from '../../factory/publish/instagram-receipt'

/** 手搓一条满足 readReceipt 的完整回执，避免走一长串 helper。 */
function makeReceipt(
  overrides: Partial<InstagramPublishReceipt> = {},
): InstagramPublishReceipt {
  return {
    schema_version: 1,
    status: 'failed',
    work_order_id: 'wo-1',
    client_id: 'client-1',
    publer_account_id: 'acct-1',
    request_id: 'req-1',
    attempts: 1,
    first_comment_requested: false,
    no_publish: false,
    authorization: 'AUTHORIZED',
    cost_usd: 0,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const nameOf = (clientId: string): string =>
  clientId === 'client-1' ? 'Acme' : clientId === 'client-2' ? 'Beta' : clientId

describe('buildInstagramPublishItems', () => {
  it('groups two account failures of one client into ONE item with count 2', () => {
    const blocked: InstagramBlockedReceipt[] = [
      { work_order_id: 'wo-1', client_id: 'client-1', failure_kind: 'account', error: 'boom' },
      { work_order_id: 'wo-2', client_id: 'client-1', failure_kind: 'account', error: 'boom2' },
    ]
    const items = buildInstagramPublishItems(blocked, nameOf)
    expect(items).toHaveLength(1)
    expect(items[0]?.kind).toBe('instagram_account_disconnected')
    expect(items[0]?.what).toContain('2 条视频')
  })

  it('produces different kinds for account vs other', () => {
    const blocked: InstagramBlockedReceipt[] = [
      { work_order_id: 'wo-1', client_id: 'client-1', failure_kind: 'account', error: 'a' },
      { work_order_id: 'wo-2', client_id: 'client-2', failure_kind: 'other', error: 'b' },
    ]
    const items = buildInstagramPublishItems(blocked, nameOf)
    const kinds = items.map((i) => i.kind)
    expect(kinds).toContain('instagram_account_disconnected')
    expect(kinds).toContain('instagram_publish_failed')
  })

  it('every item has non-empty what/how/href and contains the client name', () => {
    const blocked: InstagramBlockedReceipt[] = [
      { work_order_id: 'wo-1', client_id: 'client-1', failure_kind: 'account', error: 'a' },
      { work_order_id: 'wo-2', client_id: 'client-2', failure_kind: 'other', error: 'b' },
    ]
    const items = buildInstagramPublishItems(blocked, nameOf)
    for (const item of items) {
      expect(item.what.length).toBeGreaterThan(0)
      expect(item.how.length).toBeGreaterThan(0)
      expect(item.href.length).toBeGreaterThan(0)
      expect(item.what).toContain(item.client_name)
    }
  })

  it('keeps sample single-line and <= 120 chars', () => {
    const longError = 'x'.repeat(300) + '\n\nmore\ttext'
    const blocked: InstagramBlockedReceipt[] = [
      { work_order_id: 'wo-1', client_id: 'client-1', failure_kind: 'account', error: longError },
    ]
    const items = buildInstagramPublishItems(blocked, nameOf)
    // sample 只存在于 what 文本里:「系统报:「…」」之间的内容必须单行且不超过 120 字
    const m = /系统报:「([^」]*)」/.exec(items[0]?.what ?? '')
    const sample = m?.[1] ?? ''
    expect(sample.length).toBeGreaterThan(0)
    expect(sample).not.toMatch(/\s{2,}|[\n\t]/)
    expect(sample.length).toBeLessThanOrEqual(120)
  })

  it('orders account items before other items', () => {
    const blocked: InstagramBlockedReceipt[] = [
      { work_order_id: 'wo-1', client_id: 'client-2', failure_kind: 'other', error: 'b' },
      { work_order_id: 'wo-2', client_id: 'client-1', failure_kind: 'account', error: 'a' },
    ]
    const items = buildInstagramPublishItems(blocked, nameOf)
    expect(items[0]?.kind).toBe('instagram_account_disconnected')
    expect(items[1]?.kind).toBe('instagram_publish_failed')
  })
})

/** 极简 fake supabase：记录链式调用，最后 resolve { data, error }。 */
function makeFakeSupabase(result: {
  data: unknown
  error: { message: string } | null
}): {
  supabase: Parameters<typeof pushInstagramPublishItems>[0]
  calls: { eq: Array<[string, unknown]>; gte: Array<[string, unknown]> }
} {
  const calls = { eq: [] as Array<[string, unknown]>, gte: [] as Array<[string, unknown]> }
  const query = {
    select: () => query,
    eq: (col: string, val: unknown) => {
      calls.eq.push([col, val])
      return query
    },
    gte: (col: string, val: unknown) => {
      calls.gte.push([col, val])
      return query
    },
    order: () => query,
    limit: () => query,
    then: (resolve: (v: unknown) => unknown) => resolve(result),
  }
  const supabase = {
    from: () => query,
  }
  return {
    supabase: supabase as unknown as Parameters<typeof pushInstagramPublishItems>[0],
    calls,
  }
}

describe('pushInstagramPublishItems', () => {
  it('pushes an item for a failed+account receipt', async () => {
    const receipt = makeReceipt({ failure_kind: 'account', error: 'disconnected' })
    const { supabase } = makeFakeSupabase({
      data: [{ id: 'wo-1', client_id: 'client-1', output: withReceipt({}, receipt), published_ref: { published_at: '2024-01-09T12:00:00Z' } }],
      error: null,
    })
    const items: ManualItem[] = []
    await pushInstagramPublishItems(supabase, items, new Date('2024-01-10T00:00:00Z'), nameOf)
    expect(items).toHaveLength(1)
    expect(items[0]?.kind).toBe('instagram_account_disconnected')
  })

  it('produces nothing for a scheduled receipt', async () => {
    const receipt = makeReceipt({ status: 'scheduled', failure_kind: undefined })
    const { supabase } = makeFakeSupabase({
      data: [{ id: 'wo-1', client_id: 'client-1', output: withReceipt({}, receipt), published_ref: { published_at: '2024-01-09T12:00:00Z' } }],
      error: null,
    })
    const items: ManualItem[] = []
    await pushInstagramPublishItems(supabase, items, new Date('2024-01-10T00:00:00Z'), nameOf)
    expect(items).toHaveLength(0)
  })

  it('produces nothing for a failed-other receipt still retrying', async () => {
    const receipt = makeReceipt({
      failure_kind: 'other',
      next_retry_at: '2999-01-01T00:00:00.000Z',
    })
    const { supabase } = makeFakeSupabase({
      data: [{ id: 'wo-1', client_id: 'client-1', output: withReceipt({}, receipt), published_ref: { published_at: '2024-01-09T12:00:00Z' } }],
      error: null,
    })
    const items: ManualItem[] = []
    await pushInstagramPublishItems(supabase, items, new Date('2024-01-10T00:00:00Z'), nameOf)
    expect(items).toHaveLength(0)
  })

  it('pushes instagram_publish_failed for a failed-other receipt with next_retry_at null', async () => {
    const receipt = makeReceipt({ failure_kind: 'other', next_retry_at: null })
    const { supabase } = makeFakeSupabase({
      data: [{ id: 'wo-1', client_id: 'client-1', output: withReceipt({}, receipt), published_ref: { published_at: '2024-01-09T12:00:00Z' } }],
      error: null,
    })
    const items: ManualItem[] = []
    await pushInstagramPublishItems(supabase, items, new Date('2024-01-10T00:00:00Z'), nameOf)
    expect(items).toHaveLength(1)
    expect(items[0]?.kind).toBe('instagram_publish_failed')
  })

  it('rejects with the query error message', async () => {
    const { supabase } = makeFakeSupabase({
      data: null,
      error: { message: 'boom' },
    })
    const items: ManualItem[] = []
    await expect(
      pushInstagramPublishItems(supabase, items, new Date('2024-01-10T00:00:00Z'), nameOf),
    ).rejects.toThrow('instagram publish items query failed: boom')
  })

  it('uses .eq(status,published) and the lookback .gte', async () => {
    const { supabase, calls } = makeFakeSupabase({ data: [], error: null })
    const now = new Date('2024-01-10T00:00:00Z')
    await pushInstagramPublishItems(supabase, items(), now, nameOf)
    expect(calls.eq).toContainEqual(['status', 'published'])
    const expectedSince = new Date(
      now.getTime() - INSTAGRAM_ITEM_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString()
    expect(calls.gte).toContainEqual(['updated_at', expectedSince])
  })
})

function items(): ManualItem[] {
  return []
}

describe('跟发窗口与「防重复标记没读回」', () => {
  const NOW = new Date('2024-01-10T00:00:00Z')
  it('Facebook 发出已超过 48 小时的片:系统不会再试,不挂「接好后会自动补发」的待办', async () => {
    const receipt = makeReceipt({ failure_kind: 'account', error: 'disconnected' })
    const { supabase } = makeFakeSupabase({
      data: [{ id: 'wo-1', client_id: 'client-1', output: withReceipt({}, receipt), published_ref: { published_at: '2024-01-05T00:00:00Z' } }],
      error: null,
    })
    const out: ManualItem[] = []
    await pushInstagramPublishItems(supabase, out, NOW, nameOf)
    expect(out).toHaveLength(0)
  })

  it('Facebook 回执读不出发布时间:宁可少报,不乱报', async () => {
    const receipt = makeReceipt({ failure_kind: 'account', error: 'disconnected' })
    const { supabase } = makeFakeSupabase({
      data: [{ id: 'wo-1', client_id: 'client-1', output: withReceipt({}, receipt), published_ref: {} }],
      error: null,
    })
    const out: ManualItem[] = []
    await pushInstagramPublishItems(supabase, out, NOW, nameOf)
    expect(out).toHaveLength(0)
  })

  it('帖子已提交但防重复标记没读回 → 下发一条给开发看的待办(带 what/how/href)', async () => {
    const receipt = makeReceipt({ status: 'draft', failure_kind: undefined, idempotency_unverified: true })
    const { supabase } = makeFakeSupabase({
      data: [{ id: 'wo-1', client_id: 'client-1', output: withReceipt({}, receipt), published_ref: { published_at: '2024-01-09T12:00:00Z' } }],
      error: null,
    })
    const out: ManualItem[] = []
    await pushInstagramPublishItems(supabase, out, NOW, nameOf)
    expect(out).toHaveLength(1)
    expect(out[0]?.kind).toBe('instagram_publish_failed')
    expect(out[0]?.what).toContain('防重复')
    expect(out[0]?.how.length).toBeGreaterThan(0)
    expect(out[0]?.href).toMatch(/^https:\/\//)
  })
})
