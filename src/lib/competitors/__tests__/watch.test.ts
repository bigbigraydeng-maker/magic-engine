import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  loadWatchRoster,
  recentlyWatched,
  parseWatchDue,
  watchEventId,
  runOneClientWatch,
  MIN_HOURS_BETWEEN_WATCHES,
  COMPETITOR_WATCH_JOB,
} from '../watch'

const CTS = 'c0000000-0000-0000-0000-000000000000'
const OZTOP = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'

type Row = Record<string, unknown>

/**
 * 跟 flywheel/__tests__/seo-weekly.test.ts 的 fakeSupabase 同一个思路（把 .eq/.contains
 * 当真过滤条件跑），但让 chain 本身可 await（真实 supabase-js 的 builder 就是这样，
 * 不需要靠某个特定终结方法才触发）。
 */
function fakeSupabase(tables: Record<string, { data: Row[] | null; error: { message: string } | null }>): {
  client: SupabaseClient
  filtersFor: (table: string) => Array<[string, unknown]>
} {
  const filters: Record<string, Array<[string, unknown]>> = {}
  const client = {
    from(table: string) {
      filters[table] = []
      const result = tables[table] ?? { data: [], error: null }
      const apply = () => {
        if (result.error) return { data: null, error: result.error }
        const rows = (result.data ?? []).filter((r) =>
          filters[table].every(([col, val]) => {
            if (col === 'seo_config' && val && typeof val === 'object') {
              const cfg = r[col] as Record<string, unknown> | undefined
              return cfg !== undefined && Object.entries(val as Record<string, unknown>).every(([k, v]) => cfg[k] === v)
            }
            return r[col] === val
          }),
        )
        return { data: rows, error: null }
      }
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          filters[table].push([col, val])
          return chain
        },
        contains: (col: string, val: unknown) => {
          filters[table].push([col, val])
          return chain
        },
        gte: () => chain,
        order: () => chain,
        limit: () => chain,
        then: (resolve: (v: unknown) => void) => resolve(apply()),
      }
      return chain
    },
  }
  // fixture 形状只需要覆盖 loadWatchRoster/recentlyWatched 两个函数体里真实调用到的方法
  // （.from().select().eq()/.contains()/.gte()/.order()/.limit()）；本文件下方每个 it()
  // 已跑通并断言了具体返回值/过滤条件，链式调用对不上号会在 await 处直接抛错，不会静默通过——
  // 不是靠这一处类型断言掩盖形状不对，是穷举了 watch.ts 里两个查询函数的全部调用点。
  return { client: client as unknown as SupabaseClient, filtersFor: (t) => filters[t] ?? [] }
}

describe('loadWatchRoster — 谁该被扫', () => {
  it('🔴 只有显式开了 competitor_watch_enabled 的客户才进名单——没开的（包括默认关的）不许进', async () => {
    const fake = fakeSupabase({
      clients: {
        data: [
          { id: CTS, semrush_db: 'nz', client_status: 'active', seo_config: { competitor_watch_enabled: true } },
          { id: OZTOP, semrush_db: 'au', client_status: 'active', seo_config: { weekly_blog: true } },
        ],
        error: null,
      },
    })
    const r = await loadWatchRoster(fake.client)
    expect(r.ok && r.entries).toEqual([{ clientId: CTS, semrushDb: 'nz' }])
    expect(fake.filtersFor('clients')).toContainEqual(['client_status', 'active'])
    expect(fake.filtersFor('clients')).toContainEqual(['seo_config', { competitor_watch_enabled: true }])
  })

  it('已流失的客户不许进名单，即使开了开关', async () => {
    const fake = fakeSupabase({
      clients: {
        data: [{ id: CTS, semrush_db: 'nz', client_status: 'churned', seo_config: { competitor_watch_enabled: true } }],
        error: null,
      },
    })
    const r = await loadWatchRoster(fake.client)
    expect(r.ok && r.entries).toEqual([])
  })

  it('查询失败时返回 ok:false，不假装名单是空的', async () => {
    const fake = fakeSupabase({ clients: { data: null, error: { message: 'boom' } } })
    const r = await loadWatchRoster(fake.client)
    expect(r).toEqual({ ok: false, reason: 'boom' })
  })
})

describe('recentlyWatched — 防重复扣费闸', () => {
  it('MIN_HOURS_BETWEEN_WATCHES 之内有记录 → 跳过', async () => {
    const fake = fakeSupabase({
      competitor_snapshots: { data: [{ client_id: CTS, created_at: new Date().toISOString() }], error: null },
    })
    const r = await recentlyWatched(fake.client, CTS)
    expect(r).toEqual({ skip: true, reason: 'watched_recently' })
  })

  it('没有记录 → 不跳过', async () => {
    const fake = fakeSupabase({ competitor_snapshots: { data: [], error: null } })
    const r = await recentlyWatched(fake.client, CTS)
    expect(r).toEqual({ skip: false, reason: null })
  })

  it('🔴 查不出来一律当成扫过了（fail-closed）——查询失败不能变成多花一次钱', async () => {
    const fake = fakeSupabase({ competitor_snapshots: { data: null, error: { message: 'timeout' } } })
    const r = await recentlyWatched(fake.client, CTS)
    expect(r.skip).toBe(true)
    expect(r.reason).toContain('lookup_failed')
  })

  it('窗口是 156 小时（6.5 天），不是按自然周算的日历边界', () => {
    expect(MIN_HOURS_BETWEEN_WATCHES).toBe(156)
  })
})

describe('parseWatchDue', () => {
  it('合法条子解析成功', () => {
    const r = parseWatchDue({ client_id: CTS, week_key: '2026-W38' })
    expect(r).toEqual({ ok: true, value: { client_id: CTS, week_key: '2026-W38' } })
  })

  it.each([
    [null],
    [{ client_id: 'not-a-uuid', week_key: '2026-W38' }],
    [{ client_id: CTS, week_key: 'not-a-week' }],
    [{ client_id: CTS }],
  ])('缺字段/格式不对一律拒绝: %o', (raw) => {
    expect(parseWatchDue(raw).ok).toBe(false)
  })
})

describe('watchEventId', () => {
  it('同一客户同一周产生同一个 id（Inngest 24 小时去重键）', () => {
    expect(watchEventId(CTS, '2026-W38')).toBe(`competitor-watch-2026-W38-${CTS}`)
  })
})

describe('runOneClientWatch', () => {
  const due = { client_id: CTS, week_key: '2026-W38' }

  it('被防重复扣费闸拦下 → skipped，不调用 takeSnapshot', async () => {
    let called = false
    const receipt = await runOneClientWatch(
      due,
      async () => {
        called = true
        return { domainsScanned: 0, keywordsWritten: 0 }
      },
      async () => ({ skip: true, reason: 'watched_recently' }),
    )
    expect(called).toBe(false)
    expect(receipt.status).toBe('skipped')
    expect(receipt.error).toBe('watched_recently')
  })

  it('拿到数据 → completed', async () => {
    const receipt = await runOneClientWatch(
      due,
      async () => ({ domainsScanned: 19, keywordsWritten: 42 }),
      async () => ({ skip: false, reason: null }),
    )
    expect(receipt).toMatchObject({ status: 'completed', domains_scanned: 19, keywords_written: 42, error: null })
  })

  it('扫了但一条关键词都没写 → no_data，不是 completed', async () => {
    const receipt = await runOneClientWatch(
      due,
      async () => ({ domainsScanned: 0, keywordsWritten: 0 }),
      async () => ({ skip: false, reason: null }),
    )
    expect(receipt.status).toBe('no_data')
  })

  it('takeSnapshot 抛异常 → failed 回执，不往外抛', async () => {
    const receipt = await runOneClientWatch(
      due,
      async () => {
        throw new Error('dataforseo down')
      },
      async () => ({ skip: false, reason: null }),
    )
    expect(receipt).toMatchObject({ status: 'failed', error: 'dataforseo down' })
  })

  it('回执恒带 no_publish: true（这条链路只读取和入库）', async () => {
    const receipt = await runOneClientWatch(
      due,
      async () => ({ domainsScanned: 1, keywordsWritten: 1 }),
      async () => ({ skip: false, reason: null }),
    )
    expect(receipt.no_publish).toBe(true)
  })
})

describe('COMPETITOR_WATCH_JOB 命名', () => {
  it('跟登记清单 (CRON_REGISTRY) 用的 jobName 是同一个字符串', () => {
    expect(COMPETITOR_WATCH_JOB).toBe('competitor-watch-weekly')
  })
})
