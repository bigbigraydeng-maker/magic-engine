/**
 * 一条读回链失败记录 → 今日待办三件套。旧的每日计划待办任务名不在这里。
 */
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from '../manual-items'
import { pushSocialReadbackItems } from '../social-readback-items'
import { LANE_OF_KIND } from '../five-kinds'
import { STORY_RESOLVE_JOB_NAME } from '@/lib/campaign/daily-plan-publish'

const CLIENT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const NOW = new Date('2026-11-01T00:00:00.000Z')

function fakeSupabase(
  rows: Array<{ summary: Record<string, unknown> | null }>,
  error: { message: string } | null = null,
) {
  const filters: Record<string, unknown> = {}
  const chain = {
    select: () => chain,
    eq: (col: string, val: unknown) => { filters[col] = val; return chain },
    gte: (col: string, val: unknown) => { filters[`${col}>=`] = val; return chain },
    order: () => chain,
    limit: async () => ({ data: error ? null : rows, error }),
  }
  const client: Pick<SupabaseClient, 'from'> = {
    from: ((table: string) => { filters.table = table; return chain }) as never,
  }
  return { client, filters }
}

function row(over: Record<string, unknown> = {}) {
  return {
    summary: {
      client_id: CLIENT,
      subject_kind: 'reel',
      subject_ref: '11111_22222',
      outcome: 'reel_rebind_refused:not_published',
      reason: 'not_published',
      ...over,
    },
  }
}

describe('pushSocialReadbackItems', () => {
  it('reads only social-readback-outcome failures from the last 7 days', async () => {
    const { client, filters } = fakeSupabase([])
    await pushSocialReadbackItems(client as SupabaseClient, [], NOW, new Map())
    expect(filters).toMatchObject({
      table: 'cron_run_logs',
      job_name: 'social-readback-outcome',
      status: 'failed',
      'started_at>=': '2026-10-25T00:00:00.000Z',
    })
    expect(filters.job_name).not.toBe(STORY_RESOLVE_JOB_NAME)
  })

  it('one fake refusal becomes one manual item with what / how / href', async () => {
    const { client } = fakeSupabase([row(), row()])
    const items: ManualItem[] = []
    await pushSocialReadbackItems(client as SupabaseClient, items, NOW, new Map([[CLIENT, { name: 'Acme Tours' }]]))
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('social_readback_refused')
    expect(items[0].client_name).toBe('Acme Tours')
    expect(items[0].what).toContain('拒绝开始记')
    expect(items[0].what).toContain('不会被自动记下来')
    expect(items[0].how).toContain('11111_22222')
    expect(items[0].how).toContain('不要在 Facebook 后台改状态')
    expect(items[0].href).toBe('https://www.facebook.com/11111_22222')
    expect(LANE_OF_KIND.social_readback_refused).toBe('one_click')
  })

  it('published_at_mismatch and multiple traffic rows each say what to do', async () => {
    const { client } = fakeSupabase([
      row({
        subject_ref: '11111_33333',
        outcome: 'reel_rebind_refused:published_at_mismatch',
        reason: 'published_at_mismatch',
      }),
      row({
        subject_ref: '11111_44444',
        outcome: 'reel_rebind_refused:multiple_traffic_rows',
        reason: 'multiple_traffic_rows',
      }),
    ])
    const items: ManualItem[] = []
    await pushSocialReadbackItems(client as SupabaseClient, items, NOW, new Map())
    expect(items).toHaveLength(2)
    expect(items[0].what).toContain('对不上')
    expect(items[0].how).toContain('不要重新发布')
    expect(items[1].what).toContain('多于一条流量记录')
    expect(items[1].how).toContain('不要手工删')
  })

  it('a subject that is not a page_video id links to the client page, not a relative path', async () => {
    const { client } = fakeSupabase([row({ subject_kind: 'story', subject_ref: 'story-item-1', outcome: 'story_refused', reason: 'page_mismatch' })])
    const items: ManualItem[] = []
    await pushSocialReadbackItems(client as SupabaseClient, items, NOW, new Map())
    expect(items[0].href).toBe(`https://app.magicengine.com.au/dashboard/clients/${CLIENT}`)
  })

  it('skips a row with no subject, and a read failure throws', async () => {
    const missing = fakeSupabase([row({ subject_ref: '' })])
    const items: ManualItem[] = []
    await pushSocialReadbackItems(missing.client as SupabaseClient, items, NOW, new Map())
    expect(items).toHaveLength(0)
    const broken = fakeSupabase([], { message: 'timeout' })
    await expect(pushSocialReadbackItems(broken.client as SupabaseClient, [], NOW, new Map())).rejects.toThrow(/timeout/)
  })
})
