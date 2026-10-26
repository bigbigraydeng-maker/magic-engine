import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  pushFacebookSyncFailingItems,
  consecutivelyFailing,
  isFacebookAuthError,
  type SyncRunRow,
} from '../facebook-sync-items'
import type { ManualItem } from '../manual-item-types'

const NOW = new Date('2026-09-26T03:30:00Z')
const NAL = 'client-nal'
const CTS = 'client-cts'

const LEADS_190 =
  'leadgen_forms HTTP 400: {"error":{"message":"Any of the pages_read_engagement ... permission(s) must be granted before impersonating a user\'s page.","type":"OAuthException","code":190}}'
const MSG_190 =
  'fetchPageConversations failed: HTTP 400 code=190 Any of the pages_messaging permission(s) must be granted'

function run(hoursAgo: number, results: Array<Record<string, unknown>>): SyncRunRow {
  return {
    finished_at: new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString(),
    summary: { results: results as SyncRunRow['summary'] extends { results?: infer R } ? R : never },
  }
}

const statusFilters: unknown[] = []

function fakeRuns(byJob: Record<string, SyncRunRow[]>, queryError?: string): SupabaseClient {
  function chain() {
    let job = ''
    const c = {
      select: () => c,
      eq: (column: string, value: string) => {
        if (column === 'job_name') job = value
        return c
      },
      not: () => c,
      in: (_column: string, values: unknown) => {
        statusFilters.push(values)
        return c
      },
      order: () => c,
      limit: async (n: number) =>
        queryError
          ? { data: null, error: { message: queryError } }
          : { data: (byJob[job] ?? []).slice(0, n), error: null },
    }
    return c
  }
  return { from: () => chain() } as unknown as SupabaseClient
}

/**
 * 生产 2026-09-26 02:11 UTC 真实报错，逐字照抄：Roman HU 与 East International
 * 的私信同步就是这一条。当场试跑时它被判成「不是授权问题」，这条断言钉住修法。
 */
const MSG_200 =
  'fetchPageConversations failed: HTTP 403 code=200 (#200) Requires permission: pages_messaging or User associated with the Page access token does not have an approved role'

describe('isFacebookAuthError', () => {
  it('认 code 190 的两种写法和 OAuthException', () => {
    expect(isFacebookAuthError(LEADS_190)).toBe(true)
    expect(isFacebookAuthError(MSG_190)).toBe(true)
  })

  it('认 code 200「缺权限 / 没有被批准的角色」—— 生产两个客户撞的就是这条', () => {
    expect(isFacebookAuthError(MSG_200)).toBe(true)
  })

  it('认 (#200) 这种括号井号写法，也认 code 10', () => {
    expect(isFacebookAuthError('Graph error (#200) Requires permission')).toBe(true)
    expect(isFacebookAuthError('{"error":{"code":10,"message":"Permission denied"}}')).toBe(true)
  })

  it('不把普通 5xx 和形似的长数字当授权失效', () => {
    expect(isFacebookAuthError('fetchPageConversations failed: HTTP 500 boom')).toBe(false)
    expect(isFacebookAuthError('code=1900')).toBe(false)
    expect(isFacebookAuthError('code=2000')).toBe(false)
    expect(isFacebookAuthError('code=100')).toBe(false)
    // HTTP 200 不是 Graph 的 code=200：必须有 `code` 前缀或 `(#200)` 才算
    expect(isFacebookAuthError('HTTP 200 OK but empty body')).toBe(false)
  })
})

describe('consecutivelyFailing', () => {
  it('三轮都失败的客户会被返回，带 clientName 和 error', () => {
    const runs = [
      run(1, [{ clientId: NAL, clientName: 'New Asian Logistics', error: MSG_190 }]),
      run(2, [{ clientId: NAL, clientName: 'New Asian Logistics', error: MSG_190 }]),
      run(3, [{ clientId: NAL, clientName: 'New Asian Logistics', error: MSG_190 }]),
    ]
    const out = consecutivelyFailing(runs, NOW)
    expect(out.get(NAL)).toEqual({ clientName: 'New Asian Logistics', error: MSG_190 })
  })

  it('三轮里只失败两轮（最旧那轮没 error）不下发', () => {
    const runs = [
      run(1, [{ clientId: NAL, clientName: 'New Asian Logistics', error: MSG_190 }]),
      run(2, [{ clientId: NAL, clientName: 'New Asian Logistics', error: MSG_190 }]),
      run(3, [{ clientId: NAL, clientName: 'New Asian Logistics' }]),
    ]
    expect(consecutivelyFailing(runs, NOW).size).toBe(0)
  })

  it('skipped = page_not_verified 有自己的待办，这里不重复', () => {
    const runs = [
      run(1, [{ clientId: NAL, clientName: 'New Asian Logistics', error: MSG_190, skipped: 'page_not_verified' }]),
      run(2, [{ clientId: NAL, clientName: 'New Asian Logistics', error: MSG_190, skipped: 'page_not_verified' }]),
      run(3, [{ clientId: NAL, clientName: 'New Asian Logistics', error: MSG_190, skipped: 'page_not_verified' }]),
    ]
    expect(consecutivelyFailing(runs, NOW).size).toBe(0)
  })

  it('最近一轮 7 小时前 = 任务自己停了，不报旧问题', () => {
    const runs = [
      run(7, [{ clientId: NAL, clientName: 'New Asian Logistics', error: MSG_190 }]),
      run(8, [{ clientId: NAL, clientName: 'New Asian Logistics', error: MSG_190 }]),
      run(9, [{ clientId: NAL, clientName: 'New Asian Logistics', error: MSG_190 }]),
    ]
    expect(consecutivelyFailing(runs, NOW).size).toBe(0)
  })

  it('只有两轮运行记录不下发', () => {
    const runs = [
      run(1, [{ clientId: NAL, clientName: 'New Asian Logistics', error: MSG_190 }]),
      run(2, [{ clientId: NAL, clientName: 'New Asian Logistics', error: MSG_190 }]),
    ]
    expect(consecutivelyFailing(runs, NOW).size).toBe(0)
  })

  it('某一轮 summary 是 null（运行记录没写摘要）→ 不当成失败，也不报错', () => {
    const runs: SyncRunRow[] = [
      run(1, [{ clientId: NAL, clientName: 'New Asian Logistics', error: MSG_190 }]),
      { finished_at: new Date(NOW.getTime() - 2 * 3_600_000).toISOString(), summary: null },
      run(3, [{ clientId: NAL, clientName: 'New Asian Logistics', error: MSG_190 }]),
    ]
    expect(consecutivelyFailing(runs, NOW).size).toBe(0)
  })
})

describe('pushFacebookSyncFailingItems', () => {
  it('两个任务都连续失败 → 按客户合并成一条，授权失效走「连接 Meta」', async () => {
    const items: ManualItem[] = []
    const supabase = fakeRuns({
      'messenger-sync-hourly': [
        run(1, [{ clientId: NAL, clientName: 'New Asian Logistics', error: MSG_190 }]),
        run(2, [{ clientId: NAL, clientName: 'New Asian Logistics', error: MSG_190 }]),
        run(3, [{ clientId: NAL, clientName: 'New Asian Logistics', error: MSG_190 }]),
      ],
      'meta-leads-sync': [
        run(1, [{ clientId: NAL, clientName: 'New Asian Logistics', error: LEADS_190 }]),
        run(2, [{ clientId: NAL, clientName: 'New Asian Logistics', error: LEADS_190 }]),
        run(3, [{ clientId: NAL, clientName: 'New Asian Logistics', error: LEADS_190 }]),
      ],
    })

    await pushFacebookSyncFailingItems(supabase, items, NOW)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'facebook_sync_failing',
      client_id: NAL,
      client_name: 'New Asian Logistics',
    })
    expect(items[0].what).toContain('私信同步和表单留资同步')
    expect(items[0].what).toContain('主页授权失效了')
    expect(items[0].how).toContain('连接 Meta')
    expect(items[0].href).toBe(`https://app.magicengine.com.au/dashboard/clients/${NAL}?settings=platform`)
    expect(statusFilters.some((values) => Array.isArray(values) && values.includes('partial'))).toBe(true)
  })

  it('只有表单留资同步连续失败 → 只提这个任务', async () => {
    const items: ManualItem[] = []
    const supabase = fakeRuns({
      'messenger-sync-hourly': [
        run(1, [{ clientId: NAL, clientName: 'New Asian Logistics' }]),
        run(2, [{ clientId: NAL, clientName: 'New Asian Logistics' }]),
        run(3, [{ clientId: NAL, clientName: 'New Asian Logistics' }]),
      ],
      'meta-leads-sync': [
        run(1, [{ clientId: NAL, clientName: 'New Asian Logistics', error: LEADS_190 }]),
        run(2, [{ clientId: NAL, clientName: 'New Asian Logistics', error: LEADS_190 }]),
        run(3, [{ clientId: NAL, clientName: 'New Asian Logistics', error: LEADS_190 }]),
      ],
    })

    await pushFacebookSyncFailingItems(supabase, items, NOW)

    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('表单留资同步')
    expect(items[0].what).not.toContain('私信同步')
  })

  it('非授权错误 → 不用客户动手，回我们一句去查', async () => {
    const items: ManualItem[] = []
    const supabase = fakeRuns({
      'messenger-sync-hourly': [
        run(1, [{ clientId: NAL, clientName: 'New Asian Logistics', error: 'fetchPageConversations failed: HTTP 500 boom' }]),
        run(2, [{ clientId: NAL, clientName: 'New Asian Logistics', error: 'fetchPageConversations failed: HTTP 500 boom' }]),
        run(3, [{ clientId: NAL, clientName: 'New Asian Logistics', error: 'fetchPageConversations failed: HTTP 500 boom' }]),
      ],
    })

    await pushFacebookSyncFailingItems(supabase, items, NOW)

    expect(items).toHaveLength(1)
    expect(items[0].how).toContain('查一下 Facebook 同步')
    expect(items[0].what).toContain('不是授权问题')
  })

  it('没有连续失败 → 不下发', async () => {
    const items: ManualItem[] = []
    const supabase = fakeRuns({
      'messenger-sync-hourly': [
        run(1, [{ clientId: CTS, clientName: 'CTS Tours NZ' }]),
        run(2, [{ clientId: CTS, clientName: 'CTS Tours NZ' }]),
        run(3, [{ clientId: CTS, clientName: 'CTS Tours NZ' }]),
      ],
      'meta-leads-sync': [
        run(1, [{ clientId: CTS, clientName: 'CTS Tours NZ' }]),
        run(2, [{ clientId: CTS, clientName: 'CTS Tours NZ' }]),
        run(3, [{ clientId: CTS, clientName: 'CTS Tours NZ' }]),
      ],
    })

    await pushFacebookSyncFailingItems(supabase, items, NOW)

    expect(items).toEqual([])
  })

  it('取数失败直接抛，由调用方 catch', async () => {
    await expect(pushFacebookSyncFailingItems(fakeRuns({}, 'permission denied'), [], NOW)).rejects.toThrow(
      'permission denied',
    )
  })
})
