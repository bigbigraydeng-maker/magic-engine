/**
 * 每周 SEO 快照的纯逻辑测试。
 *
 * 这条链路花钱，所以测的重点不是「跑通了」，而是四件**花钱相关**的事：
 *   1. 谁会被扫（名单判据不能悄悄放宽）
 *   2. 会不会重复付款（防重复扣费闸 + 周编号的时区）
 *   3. 回执说的是不是实话（花费是上限、没数据不算成功）
 *   4. 来路不明的条子会不会被放行
 */

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  FLYWHEEL_SEO_SNAPSHOT_DUE_EVENT,
  FLYWHEEL_SEO_WEEKLY_CRON,
  FLYWHEEL_SEO_WEEKLY_TZ,
  isoWeekKey,
  loadSnapshotRoster,
  MIN_HOURS_BETWEEN_SNAPSHOTS,
  parseSnapshotDue,
  PROVIDER_CALLS_PER_CLIENT,
  recentlySnapshotted,
  SEO_WEEKLY_PAID_SOURCE,
  snapshotEventId,
  snapshotOneClient,
} from '../seo-weekly'

const CTS = 'c0000000-0000-0000-0000-000000000000'
const OZTOP = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'

const NEVER_SKIP = async () => ({ skip: false, reason: null })

type Row = Record<string, unknown>

/**
 * 假 supabase 按**表**建模，不按调用顺序建模。
 *
 * 🔴 而且它**真的记下并执行 .eq() 的过滤条件**。第一版写的是 `eq: () => chain`，
 *    把入参丢了 —— 复审实测：把 `.eq('client_status','active')` 整行删掉，这个文件
 *    全绿。也就是「只扫在服务中的客户」这条**直接决定花谁的钱**的判据，
 *    一条测试都没盯着。假件写宽松一点，测的就是假件自己。
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
        const rows = (result.data ?? []).filter((r) => filters[table].every(([col, val]) => {
          if (col === 'seo_config' && val && typeof val === 'object') {
            const cfg = r[col] as Record<string, unknown> | undefined
            // Legacy fixtures omit the new config; treat them as enabled so
            // existing roster tests remain focused on their stated invariant.
            return cfg === undefined || Object.entries(val as Record<string, unknown>).every(([k, v]) => cfg[k] === v)
          }
          return r[col] === val
        }))
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
        // 两个终结符：名单查询用 .not() 收尾，最近扫过没有用 .limit() 收尾。
        not: () => Promise.resolve(apply()),
        limit: () => Promise.resolve(apply()),
      }
      return chain
    },
  }
  return { client: client as unknown as SupabaseClient, filtersFor: (t) => filters[t] ?? [] }
}

describe('谁会被扫 —— 名单判据', () => {
  it('在服务中 + 填了网址 的才进名单，网址两边空白会被削掉', async () => {
    const fake = fakeSupabase({
      clients: {
        data: [
          { id: CTS, domain: '  ctstours.co.nz ', client_status: 'active' },
          { id: OZTOP, domain: 'oztopbuildingsupplies.com.au', client_status: 'active' },
        ],
        error: null,
      },
    })
    const r = await loadSnapshotRoster(fake.client)
    expect(r.ok && r.entries).toEqual([
      { clientId: CTS, domain: 'ctstours.co.nz' },
      { clientId: OZTOP, domain: 'oztopbuildingsupplies.com.au' },
    ])
  })

  it('🔴 已流失的客户不许进名单 —— 进了就是每周替他白付钱', async () => {
    const fake = fakeSupabase({
      clients: {
        data: [
          { id: CTS, domain: 'ctstours.co.nz', client_status: 'active' },
          { id: OZTOP, domain: 'oztopbuildingsupplies.com.au', client_status: 'churned' },
        ],
        error: null,
      },
    })
    const r = await loadSnapshotRoster(fake.client)
    expect(r.ok && r.entries).toEqual([{ clientId: CTS, domain: 'ctstours.co.nz' }])
    // 判据本身也钉住：过滤条件必须真的发给了数据库，不是靠假件巧合
    expect(fake.filtersFor('clients')).toContainEqual(['client_status', 'active'])
  })

  it('网址是空串 / 纯空白 / 不是字符串 的一律不进名单 —— 拿它去扫等于白花钱', async () => {
    const fake = fakeSupabase({
      clients: {
        data: [
          { id: CTS, domain: '', client_status: 'active' },
          { id: CTS, domain: '   ', client_status: 'active' },
          { id: CTS, domain: 123, client_status: 'active' },
          { id: '', domain: 'x.co.nz', client_status: 'active' },
        ],
        error: null,
      },
    })
    const r = await loadSnapshotRoster(fake.client)
    expect(r.ok && r.entries).toEqual([])
  })

  it('🔴 查名单失败必须报出来，不许当成「今天没人要扫」', async () => {
    const fake = fakeSupabase({ clients: { data: null, error: { message: 'boom' } } })
    expect(await loadSnapshotRoster(fake.client)).toEqual({ ok: false, reason: 'boom' })
  })
})

describe('防重复扣费闸 —— 这是真闸，不是事件去重', () => {
  it('最近扫过 → 跳过，一次外部调用都不发生', async () => {
    const fake = fakeSupabase({
      flywheel_metrics: {
        data: [{ client_id: CTS, flywheel: 'seo', source: SEO_WEEKLY_PAID_SOURCE, measured_at: '2026-09-06T00:00:00Z' }],
        error: null,
      },
    })
    const r = await recentlySnapshotted(fake.client, CTS, new Date('2026-09-07T00:00:00Z'))
    expect(r.skip).toBe(true)
    expect(r.reason).toBe('snapshotted_recently')
  })

  it('最近没扫过 → 放行', async () => {
    const fake = fakeSupabase({ flywheel_metrics: { data: [], error: null } })
    const r = await recentlySnapshotted(fake.client, CTS, new Date('2026-09-07T00:00:00Z'))
    expect(r).toEqual({ skip: false, reason: null, lastAt: null })
  })

  it('🔴 查不出来必须往「不花钱」的方向倒 —— 反过来写就是数据库一抽风全员多付一轮', async () => {
    const fake = fakeSupabase({ flywheel_metrics: { data: null, error: { message: 'db down' } } })
    const r = await recentlySnapshotted(fake.client, CTS)
    expect(r.skip).toBe(true)
    expect(r.reason).toContain('lookup_failed')
  })

  it('🔴 只看这个客户、只看 SEO —— 条件漏一个就会拿别人的数据当自己扫过了', async () => {
    const fake = fakeSupabase({
      flywheel_metrics: {
        data: [{ client_id: OZTOP, flywheel: 'seo', source: SEO_WEEKLY_PAID_SOURCE, measured_at: '2026-09-06T00:00:00Z' }],
        error: null,
      },
    })
    const r = await recentlySnapshotted(fake.client, CTS, new Date('2026-09-07T00:00:00Z'))
    expect(r.skip).toBe(false)
    expect(fake.filtersFor('flywheel_metrics')).toContainEqual(['client_id', CTS])
    expect(fake.filtersFor('flywheel_metrics')).toContainEqual(['flywheel', 'seo'])
    expect(fake.filtersFor('flywheel_metrics')).toContainEqual(['source', SEO_WEEKLY_PAID_SOURCE])
  })

  it('🔴 每天回拉的谷歌 / GA4 数据和博客篇数都不算「扫过」—— 2026-09 三周全被它骗成 skipped', async () => {
    const fake = fakeSupabase({
      flywheel_metrics: {
        data: [
          { client_id: CTS, flywheel: 'seo', source: 'gsc_pullback', measured_at: '2026-09-06T17:02:41Z' },
          { client_id: CTS, flywheel: 'seo', source: 'ga4_pullback', measured_at: '2026-09-06T17:02:43Z' },
          { client_id: CTS, flywheel: 'seo', source: 'blog_posts', measured_at: '2026-09-06T00:00:00Z' },
        ],
        error: null,
      },
    })
    const r = await recentlySnapshotted(fake.client, CTS, new Date('2026-09-07T00:00:00Z'))
    expect(r).toEqual({ skip: false, reason: null, lastAt: null })
  })

  it('间隔小于一周 —— 否则会把下一次正常的周更也挡掉', () => {
    expect(MIN_HOURS_BETWEEN_SNAPSHOTS).toBeLessThan(7 * 24)
    expect(MIN_HOURS_BETWEEN_SNAPSHOTS).toBeGreaterThan(5 * 24)
  })
})

describe('周编号必须按新西兰时间算', () => {
  it('🔴 定时器那一刻（NZ 周一 05:15 = UTC 周日 17:15）算出来的必须是「本周」', () => {
    // 按 UTC 算的话这一刻是周日、属于上一周 —— 回执上的周编号会整整落后一周
    const trigger = new Date('2026-09-06T17:15:00Z') // NZ 2026-09-07 05:15，周一
    const laterSameNzMonday = new Date('2026-09-07T00:00:00Z') // NZ 同一个周一 12:00
    expect(isoWeekKey(trigger)).toBe(isoWeekKey(laterSameNzMonday))
  })

  it('🔴 同一个新西兰工作日内，周编号不许变 —— 变了 Inngest 的去重就整天拦不住', () => {
    const sameNzDay = [
      '2026-09-06T17:15:00Z', // NZ 周一 05:15
      '2026-09-06T23:00:00Z', // NZ 周一 11:00
      '2026-09-07T00:00:00Z', // NZ 周一 12:00（UTC 已跨日）
      '2026-09-07T10:59:00Z', // NZ 周一 22:59
    ].map((t) => isoWeekKey(new Date(t)))
    expect(new Set(sameNzDay).size).toBe(1)
  })

  it('同一周的任意一天算同一周，跨周必须变', () => {
    const mon = new Date('2026-09-06T17:15:00Z') // NZ 周一
    const sun = new Date('2026-09-13T10:00:00Z') // NZ 同周周日 22:00
    const nextMon = new Date('2026-09-13T17:15:00Z') // NZ 下周一
    expect(isoWeekKey(mon)).toBe(isoWeekKey(sun))
    expect(isoWeekKey(mon)).not.toBe(isoWeekKey(nextMon))
  })

  it('跨年周 / 第 53 周不出错，且都被 payload 校验接受', () => {
    const cases: [string, string][] = [
      ['2026-12-31T00:00:00Z', '2026-W53'],
      ['2027-01-04T00:00:00Z', '2027-W01'],
    ]
    for (const [ts, expected] of cases) {
      const wk = isoWeekKey(new Date(ts))
      expect(wk, ts).toBe(expected)
      expect(parseSnapshotDue({ client_id: CTS, domain: 'x.co.nz', week_key: wk }).ok).toBe(true)
    }
  })

  it('去重键 = 客户 + 周：同客户同周一致，换客户或换周就变', () => {
    const wk = isoWeekKey(new Date('2026-09-06T17:15:00Z'))
    expect(snapshotEventId(CTS, wk)).toBe(snapshotEventId(CTS, wk))
    expect(snapshotEventId(CTS, wk)).not.toBe(snapshotEventId(OZTOP, wk))
    expect(snapshotEventId(CTS, wk)).not.toBe(snapshotEventId(CTS, '2026-W40'))
  })
})

describe('派单条子 fail-closed —— 后面就是花钱的调用', () => {
  const wk = '2026-W37'
  it('合法条子放行', () => {
    expect(parseSnapshotDue({ client_id: CTS, domain: 'ctstours.co.nz', week_key: wk })).toEqual({
      ok: true,
      value: { client_id: CTS, domain: 'ctstours.co.nz', week_key: wk },
    })
  })

  it('🔴 客户 id 不是 uuid / 网址空 / 周编号不合法 → 一律拒，不许「缺了当默认值继续」', () => {
    const bad = [
      null,
      'not-an-object',
      { client_id: 'nope', domain: 'x.co.nz', week_key: wk },
      { client_id: CTS, domain: '  ', week_key: wk },
      { client_id: CTS, domain: 'x.co.nz', week_key: '2026-W00' },
      { client_id: CTS, domain: 'x.co.nz', week_key: '2026-W54' },
      { client_id: CTS, domain: 'x.co.nz' },
    ]
    for (const raw of bad) expect(parseSnapshotDue(raw).ok, JSON.stringify(raw)).toBe(false)
  })
})

describe('回执必须说实话', () => {
  const due = { client_id: CTS, domain: 'ctstours.co.nz', week_key: '2026-W37' } as const

  it('成功：写了几行如实报，并标明这条链路不对外发布任何东西', async () => {
    const r = await snapshotOneClient(due, async () => [{}, {}, {}], NEVER_SKIP, new Date('2026-09-07T00:00:00Z'))
    expect(r.status).toBe('completed')
    expect(r.metrics_written).toBe(3)
    expect(r.provider_calls_max).toBe(2)
    expect(r.no_publish).toBe(true)
    expect(r.created_at).toBe('2026-09-07T00:00:00.000Z')
  })

  it('🔴 一行都没写 → 是 no_data 不是 completed（数据源整段失灵长这样，混进成功里会被显示成健康）', async () => {
    const r = await snapshotOneClient(due, async () => [], NEVER_SKIP)
    expect(r.status).toBe('no_data')
    expect(r.error).toBe('no_metrics_written')
  })

  it('🔴 被闸拦下 → skipped，且花费必须报 0（报 2 就是凭空多记一笔账）', async () => {
    let called = false
    const r = await snapshotOneClient(
      due,
      async () => {
        called = true
        return [{}]
      },
      async () => ({ skip: true, reason: 'snapshotted_recently' }),
    )
    expect(r.status).toBe('skipped')
    expect(r.provider_calls_max).toBe(0)
    expect(called, '闸拦下了却还是调了外部接口 = 闸没起作用').toBe(false)
  })

  it('🔴 失败也要出回执、也要如实记花费 —— 钱已经花了，报 0 是骗人', async () => {
    const r = await snapshotOneClient(
      due,
      async () => {
        throw new Error('dataforseo 429')
      },
      NEVER_SKIP,
    )
    expect(r.status).toBe('failed')
    expect(r.error).toBe('dataforseo 429')
    expect(r.metrics_written).toBe(0)
    expect(r.provider_calls_max).toBe(2)
  })

  it('🔴 失败不许往外抛 —— 抛出去 Inngest 会重试，等于再付一次钱', async () => {
    await expect(
      snapshotOneClient(
        due,
        async () => {
          throw new Error('boom')
        },
        NEVER_SKIP,
      ),
    ).resolves.toBeDefined()
  })
})

describe('对外契约（改了会连累别人）', () => {
  it('事件名是云端专属、业务可读', () => {
    expect(FLYWHEEL_SEO_SNAPSHOT_DUE_EVENT).toBe('flywheel/seo.snapshot.due')
  })

  it('🔴 花费上限钉死成 2，不许拿常量跟自己比', () => {
    // 第一版写的是 expect(r.provider_calls).toBe(PROVIDER_CALLS_PER_CLIENT) —— 自己等于自己，
    // 复审把 2 改成 1，全套 604 条全绿。这里钉死字面量：
    // 2 = getDomainMetrics 内部那两个接口（domain_rank_overview + backlinks/summary），
    // 那边加第三个接口时这条会红，提醒同步改。
    expect(PROVIDER_CALLS_PER_CLIENT).toBe(2)
  })

  it('🔴 周期跟周编号必须用同一个时区，否则同一天能被扫两轮', () => {
    expect(FLYWHEEL_SEO_WEEKLY_CRON.split(/\s+/)).toHaveLength(5)
    expect(FLYWHEEL_SEO_WEEKLY_CRON.split(/\s+/)[4], '定时器必须是周一').toBe('1')
    expect(FLYWHEEL_SEO_WEEKLY_TZ).toBe('Pacific/Auckland')
    // 触发时刻按 cron 的时区解释，必须落在新西兰的周一
    const nzWeekday = new Intl.DateTimeFormat('en-NZ', {
      timeZone: FLYWHEEL_SEO_WEEKLY_TZ,
      weekday: 'long',
    }).format(new Date('2026-09-06T17:15:00Z'))
    expect(nzWeekday).toBe('Monday')
  })
})
