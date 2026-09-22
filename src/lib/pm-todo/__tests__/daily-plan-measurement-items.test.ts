/**
 * 「帖子发出去了但成绩收不回来」→ 今日待办。
 * 锁住：只读失败记录、按帖子去重、what/how/href 三件套齐全、授权过期指向重新授权。
 */
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from '../manual-items'
import { pushDailyPlanMeasurementItems } from '../daily-plan-measurement-items'
import { STORY_RESOLVE_JOB_NAME } from '@/lib/campaign/daily-plan-publish'

const CLIENT = '00000000-0000-4000-8000-000000000001'
const NOW = new Date('2026-09-18T00:00:00.000Z')

function fakeSupabase(rows: Array<{ summary: Record<string, unknown> | null }>, error: { message: string } | null = null) {
  const filters: Record<string, unknown> = {}
  const chain = {
    select: () => chain,
    eq: (col: string, val: unknown) => { filters[col] = val; return chain },
    gte: (col: string, val: unknown) => { filters[`${col}>=`] = val; return chain },
    order: () => chain,
    limit: async () => ({ data: error ? null : rows, error }),
  }
  const client: Pick<SupabaseClient, 'from'> = { from: ((table: string) => { filters.table = table; return chain }) as never }
  return { client, filters }
}

function failure(over: Record<string, unknown> = {}) {
  return {
    summary: {
      outcome: 'unresolved', reason: 'no_page_story_id', client_id: CLIENT,
      date: '2026-09-17', idempotency_key: 'fbpost_a', photo_id: '1750835520181969', page_id: '1616575215312482',
      ...over,
    },
  }
}

describe('pushDailyPlanMeasurementItems', () => {
  it('🔴 reads only this workflow\'s failed records from the last 7 days', async () => {
    const { client, filters } = fakeSupabase([])
    await pushDailyPlanMeasurementItems(client as SupabaseClient, [], NOW, new Map())
    expect(filters).toMatchObject({
      table: 'cron_run_logs',
      job_name: STORY_RESOLVE_JOB_NAME,
      status: 'failed',
      'started_at>=': '2026-09-11T00:00:00.000Z',
    })
  })

  it('🔴 one item per Post with what / how / href, deduped by idempotency key', async () => {
    const { client } = fakeSupabase([failure(), failure(), failure({ idempotency_key: 'fbpost_b', date: '2026-09-18' })])
    const items: ManualItem[] = []
    await pushDailyPlanMeasurementItems(client as SupabaseClient, items, NOW, new Map([[CLIENT, { name: 'Acme Tours' }]]))

    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ kind: 'daily_plan_post_unmeasured', client_id: CLIENT, client_name: 'Acme Tours' })
    expect(items[0].what).toContain('2026-09-17')
    expect(items[0].what).toContain('不会被自动记下来')
    // Direct link to the Post on Facebook — the first thing to check.
    expect(items[0].href).toBe('https://www.facebook.com/1750835520181969')
  })

  it('🔴 how is doable today: no "reply to me" step; hands off to dev with both ids written out', async () => {
    const { client } = fakeSupabase([failure()])
    const items: ManualItem[] = []
    await pushDailyPlanMeasurementItems(client as SupabaseClient, items, NOW, new Map())
    expect(items[0].how).not.toMatch(/回我一句|补测/)
    expect(items[0].how).toContain('确认这条帖子在 Facebook 上是公开状态')
    expect(items[0].how).toContain('转给开发补读成绩')
    expect(items[0].how).toContain('1750835520181969')
    expect(items[0].how).toContain('fbpost_a')
  })

  it('an immediate post whose handoff failed (post_id, no photo_id) still becomes an item', async () => {
    const { client } = fakeSupabase([failure({ photo_id: undefined, post_id: '1616575215312482_1750000091', reason: 'event_send_failed' })])
    const items: ManualItem[] = []
    await pushDailyPlanMeasurementItems(client as SupabaseClient, items, NOW, new Map())
    expect(items).toHaveLength(1)
    expect(items[0].href).toBe('https://www.facebook.com/1616575215312482_1750000091')
  })

  it('expired Page authorisation points at re-connecting Meta in settings', async () => {
    const { client } = fakeSupabase([failure({ reason: 'token_unavailable' })])
    const items: ManualItem[] = []
    await pushDailyPlanMeasurementItems(client as SupabaseClient, items, NOW, new Map())
    expect(items[0].how).toContain('连接 Meta')
    expect(items[0].how).not.toMatch(/回我一句|补测/)
    // Re-connecting alone does not backfill: the dev hand-off is still spelled out.
    expect(items[0].how).toContain('仍需把这条待办转给开发补读成绩')
    expect(items[0].how).toContain('https://www.facebook.com/1750835520181969')
    expect(items[0].href).toBe(`https://app.magicengine.com.au/dashboard/clients/${CLIENT}/settings`)
  })

  it('a read failure throws (caller logs it without blocking other items) instead of pretending there is nothing', async () => {
    const { client } = fakeSupabase([], { message: 'timeout' })
    await expect(pushDailyPlanMeasurementItems(client as SupabaseClient, [], NOW, new Map())).rejects.toThrow(/timeout/)
  })
})
