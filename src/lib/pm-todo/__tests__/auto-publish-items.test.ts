/**
 * 自动发布待办的取数行为测试。
 *
 * 这里最容易出的错不是「判错」，是**查错了还看不出来**：
 * 查一张不存在的表、漏带过滤条件、把「查询报错」和「没查到」混成同一个空结果 ——
 * 都会安静地返回空待办，测试照样绿。
 *
 * 所以假 supabase 按**表**建模、真的执行过滤条件，没建模的表直接 throw。
 */

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { pushAutoPublishItems } from '../auto-publish-items'
import type { ManualItem } from '../manual-item-types'

type Row = Record<string, unknown>

interface FakeOptions {
  attempts?: Row[]
  auth?: Row[]
  plans?: Row[]
  failOn?: 'daily_plan_auto_publish_attempts' | 'daily_plan_auto_publish_auth' | 'social_plans'
}

/**
 * 按表建模的假 supabase。
 * - 两张表的 builder 都可 await（resolve {data, error}），并真的执行 gte / eq / in / is / not / gt。
 * - 没建模的表 throw —— 查错表必须炸。
 */
function makeSupabase(opts: FakeOptions): SupabaseClient {
  const tables: Record<string, Row[]> = {
    daily_plan_auto_publish_attempts: opts.attempts ?? [],
    daily_plan_auto_publish_auth: opts.auth ?? [],
    social_plans: opts.plans ?? [],
  }

  const from = (table: string) => {
    if (!(table in tables)) throw new Error(`测试没有给 ${table} 建模，说明代码查了意料之外的表`)
    const rows = tables[table]
    const eqFilters: Array<[string, unknown]> = []
    const inFilters: Array<[string, unknown[]]> = []
    let gteFilter: { col: string; val: string } | null = null
    let gtFilter: { col: string; val: string } | null = null
    let isNullCol: string | null = null
    let notNullCol: string | null = null

    const matched = () =>
      rows.filter((r) => {
        if (gteFilter) {
          const cell = r[gteFilter.col]
          if (typeof cell !== 'string' || cell < gteFilter.val) return false
        }
        if (gtFilter) {
          const cell = r[gtFilter.col]
          if (typeof cell !== 'string' || cell <= gtFilter.val) return false
        }
        if (isNullCol !== null) {
          if (r[isNullCol] !== null && r[isNullCol] !== undefined) return false
        }
        if (notNullCol !== null) {
          if (r[notNullCol] === null || r[notNullCol] === undefined) return false
        }
        if (!inFilters.every(([col, vals]) => vals.includes(r[col]))) return false
        return eqFilters.every(([col, val]) => r[col] === val)
      })

    const builder: Record<string, unknown> = {}
    builder.select = () => builder
    builder.order = () => builder
    builder.limit = () => builder
    builder.eq = (col: string, val: unknown) => {
      eqFilters.push([col, val])
      return builder
    }
    builder.in = (col: string, vals: unknown[]) => {
      inFilters.push([col, vals])
      return builder
    }
    builder.gte = (col: string, val: string) => {
      gteFilter = { col, val }
      return builder
    }
    builder.gt = (col: string, val: string) => {
      gtFilter = { col, val }
      return builder
    }
    builder.is = (col: string, _val: null) => {
      isNullCol = col
      return builder
    }
    builder.not = (col: string, _op: string, _val: null) => {
      notNullCol = col
      return builder
    }
    builder.then = (resolve: (v: { data: Row[] | null; error: { message: string } | null }) => unknown) =>
      Promise.resolve(
        opts.failOn === table
          ? { data: null, error: { message: 'boom' } }
          : { data: matched(), error: null },
      ).then(resolve)
    return builder
  }

  return { from } as unknown as SupabaseClient
}

// 2026-10-08 in Pacific/Auckland (UTC+13 in October) → 2026-10-08.
const NOW = new Date('2026-10-08T01:00:00Z')
const TODAY = '2026-10-08'
const TOMORROW = '2026-10-09'
const OLD = '2026-09-01'

const CLIENT = 'client-alpine'
const CLIENT_NAME = 'Alpine Journeys'
const OTHER = 'client-other'
const OTHER_NAME = 'Other Co'

function nameOf(clientId: string): string {
  if (clientId === CLIENT) return CLIENT_NAME
  if (clientId === OTHER) return OTHER_NAME
  return '未知客户'
}

function attempt(overrides: {
  client_id?: string
  date?: string
  status?: string
  reason_code?: string | null
  plan_id?: string
  updated_at?: string
}): Row {
  return {
    client_id: overrides.client_id ?? CLIENT,
    updated_at: overrides.updated_at ?? '2026-10-07T00:00:00Z',
    date: overrides.date ?? TODAY,
    status: overrides.status ?? 'failed_final',
    reason_code: overrides.reason_code ?? null,
    plan_id: overrides.plan_id ?? 'plan-1',
  }
}

function auth(overrides: {
  client_id?: string
  plan_id?: string
  dates?: string[]
  authorized_at?: string
  activated_at?: string | null
  expires_at?: string | null
  revoked_at?: string | null
}): Row {
  return {
    client_id: overrides.client_id ?? CLIENT,
    plan_id: overrides.plan_id ?? 'plan-1',
    dates: overrides.dates ?? [TODAY],
    authorized_at: overrides.authorized_at ?? '2026-10-07T00:00:00Z',
    // `undefined` means "use the default"; an explicit null must stay null (that is the unarmed case)
    activated_at: overrides.activated_at === undefined ? '2026-10-07T00:00:00Z' : overrides.activated_at,
    expires_at: overrides.expires_at === undefined ? '2026-12-31T00:00:00Z' : overrides.expires_at,
    revoked_at: overrides.revoked_at ?? null,
  }
}

const LIVE = { live: true }
const DRY = { live: false }

describe('pushAutoPublishItems —— 自动发布没发出去 / 不知道发没发出去', () => {
  it('failed_final → 一条 auto_publish_stalled，what 带客户名和日期', async () => {
    const db = makeSupabase({ attempts: [attempt({ status: 'failed_final' })] })
    const items: ManualItem[] = []
    await pushAutoPublishItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('auto_publish_stalled')
    expect(items[0].client_id).toBe(CLIENT)
    expect(items[0].client_name).toBe(CLIENT_NAME)
    expect(items[0].what).toContain(CLIENT_NAME)
    expect(items[0].what).toContain(TODAY)
    expect(items[0].what).toContain('多次尝试仍失败')
    expect(items[0].href).toContain(`/dashboard/clients/${CLIENT}`)
  })

  it('missed_window → stalled，what 说「发布时间已过，没有补发」', async () => {
    const db = makeSupabase({ attempts: [attempt({ status: 'missed_window' })] })
    const items: ManualItem[] = []
    await pushAutoPublishItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('auto_publish_stalled')
    expect(items[0].what).toContain('发布时间已过，没有补发')
  })

  it('blocked（非 PRICE_）→ stalled，what 带原因代码', async () => {
    const db = makeSupabase({
      attempts: [attempt({ status: 'blocked', reason_code: 'MISSING_IMAGE' })],
    })
    const items: ManualItem[] = []
    await pushAutoPublishItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('auto_publish_stalled')
    expect(items[0].what).toContain('MISSING_IMAGE')
  })

  it('🔴 同一客户既有「不确定」又有别的失败 → 分成两条，互不遮挡，各写各的日期和原因', async () => {
    const db = makeSupabase({
      attempts: [
        attempt({ status: 'failed_final', date: TODAY }),
        attempt({ status: 'unknown_outcome', date: TOMORROW }),
      ],
    })
    const items: ManualItem[] = []
    await pushAutoPublishItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(2)
    const unknown = items.find(i => i.kind === 'auto_publish_unknown_outcome')
    const stalled = items.find(i => i.kind === 'auto_publish_stalled')
    expect(unknown?.what).toContain('不确定')
    expect(unknown?.what).toContain(TOMORROW)
    expect(unknown?.what).not.toContain(TODAY)
    expect(unknown?.how).toContain('已发出')
    expect(unknown?.how).toContain('没发出')
    expect(stalled?.what).toContain(TODAY)
    expect(stalled?.what).toContain('多次尝试仍失败')
  })

  it('同一客户多条 → 只出一条，列出所有日期', async () => {
    const db = makeSupabase({
      attempts: [
        attempt({ status: 'failed_final', date: TODAY }),
        attempt({ status: 'missed_window', date: TOMORROW }),
      ],
    })
    const items: ManualItem[] = []
    await pushAutoPublishItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain(TODAY)
    expect(items[0].what).toContain(TOMORROW)
  })

  it('两个客户各一条', async () => {
    const db = makeSupabase({
      attempts: [
        attempt({ client_id: CLIENT, status: 'failed_final' }),
        attempt({ client_id: OTHER, status: 'failed_final' }),
      ],
    })
    const items: ManualItem[] = []
    await pushAutoPublishItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(2)
    const ids = items.map((i) => i.client_id).sort()
    expect(ids).toEqual([CLIENT, OTHER].sort())
  })

  it('🔴 blocked 且 reason_code 以 PRICE_ 开头 → 照样出待办（没有别的待办覆盖每日计划里的价格拦截）', async () => {
    const db = makeSupabase({
      attempts: [attempt({ status: 'blocked', reason_code: 'PRICE_FACT_UNVERIFIED' })],
    })
    const items: ManualItem[] = []
    await pushAutoPublishItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('auto_publish_stalled')
    expect(items[0].what).toContain('PRICE_FACT_UNVERIFIED')
  })

  it('blocked 且 reason_code 是 RECALLED → 忽略', async () => {
    const db = makeSupabase({
      attempts: [attempt({ status: 'blocked', reason_code: 'RECALLED' })],
    })
    const items: ManualItem[] = []
    await pushAutoPublishItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(0)
  })

  it('旧日期的「失败 / 时间已过」→ 不再产生待办', async () => {
    const db = makeSupabase({ attempts: [attempt({ status: 'failed_final', date: OLD })] })
    const items: ManualItem[] = []
    await pushAutoPublishItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(0)
  })

  it('🔴 旧日期的「不确定有没有发出去」→ 仍然出待办，直到有人确认（不能悄悄消失）', async () => {
    const db = makeSupabase({ attempts: [attempt({ status: 'unknown_outcome', date: OLD })] })
    const items: ManualItem[] = []
    await pushAutoPublishItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('auto_publish_unknown_outcome')
  })

  it('attempts 读取出错 → 直接 reject，前缀正确', async () => {
    const db = makeSupabase({ failOn: 'daily_plan_auto_publish_attempts' })
    const items: ManualItem[] = []
    await expect(pushAutoPublishItems(db, items, NOW, nameOf, LIVE)).rejects.toThrow(
      'auto-publish-items:',
    )
  })

  it('auth 读取出错 → 直接 reject，前缀正确', async () => {
    const db = makeSupabase({ failOn: 'daily_plan_auto_publish_auth' })
    const items: ManualItem[] = []
    await expect(pushAutoPublishItems(db, items, NOW, nameOf, LIVE)).rejects.toThrow(
      'auto-publish-items:',
    )
  })

  it('查了没建模的表 → throw', async () => {
    const db = makeSupabase({})
    // 把 attempts 表从模型里拿掉，模拟代码查错表。
    const broken = {
      from: (table: string) => {
        if (table !== 'daily_plan_auto_publish_auth') {
          throw new Error(`测试没有给 ${table} 建模，说明代码查了意料之外的表`)
        }
        return (db as unknown as { from: (t: string) => unknown }).from(table)
      },
    } as unknown as SupabaseClient
    const items: ManualItem[] = []
    await expect(pushAutoPublishItems(broken, items, NOW, nameOf, LIVE)).rejects.toThrow(
      '测试没有给',
    )
  })
})

describe('pushAutoPublishItems —— 看门狗：授权了却什么都没发生', () => {
  it('授权超过 2 小时、今天有日期、没有尝试记录 → 一条 auto_publish_unarmed', async () => {
    const db = makeSupabase({
      auth: [auth({ dates: [TODAY], authorized_at: '2026-10-07T00:00:00Z' })],
      attempts: [],
    })
    const items: ManualItem[] = []
    await pushAutoPublishItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('auto_publish_unarmed')
    expect(items[0].client_id).toBe(CLIENT)
    expect(items[0].what).toContain(TODAY)
    expect(items[0].what).toContain('一条发布尝试记录都没有')
  })

  it('授权不到 2 小时 → 不报（给发布器一点时间）', async () => {
    const db = makeSupabase({
      auth: [auth({ dates: [TODAY], authorized_at: '2026-10-08T00:30:00Z' })],
      attempts: [],
    })
    const items: ManualItem[] = []
    await pushAutoPublishItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(0)
  })

  it('今天有尝试记录 → 不报', async () => {
    const db = makeSupabase({
      auth: [auth({ dates: [TODAY], plan_id: 'plan-1' })],
      attempts: [attempt({ plan_id: 'plan-1', date: TODAY, status: 'published' })],
    })
    const items: ManualItem[] = []
    await pushAutoPublishItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(0)
  })

  it('日期不在今天/明天 → 不报', async () => {
    const db = makeSupabase({
      auth: [auth({ dates: [OLD] })],
      attempts: [],
    })
    const items: ManualItem[] = []
    await pushAutoPublishItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(0)
  })

  it('已撤销的授权 → 不报', async () => {
    const db = makeSupabase({
      auth: [auth({ dates: [TODAY], revoked_at: '2026-10-07T00:00:00Z' })],
      attempts: [],
    })
    const items: ManualItem[] = []
    await pushAutoPublishItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(0)
  })

  it('未激活的授权 → 不报', async () => {
    const db = makeSupabase({
      auth: [auth({ dates: [TODAY], activated_at: null })],
      attempts: [],
    })
    const items: ManualItem[] = []
    await pushAutoPublishItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(0)
  })

  it('已过期的授权 → 不报', async () => {
    const db = makeSupabase({
      auth: [auth({ dates: [TODAY], expires_at: '2026-10-01T00:00:00Z' })],
      attempts: [],
    })
    const items: ManualItem[] = []
    await pushAutoPublishItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(0)
  })

  it('演练模式（live=false）→ what 里说明是演练模式', async () => {
    const db = makeSupabase({
      auth: [auth({ dates: [TODAY] })],
      attempts: [],
    })
    const items: ManualItem[] = []
    await pushAutoPublishItems(db, items, NOW, nameOf, DRY)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('auto_publish_unarmed')
    expect(items[0].what).toContain('演练模式')
  })

  it('正式模式（live=true）→ what 里说没有尝试记录', async () => {
    const db = makeSupabase({
      auth: [auth({ dates: [TODAY] })],
      attempts: [],
    })
    const items: ManualItem[] = []
    await pushAutoPublishItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('一条发布尝试记录都没有')
  })

  it('明天有日期、没有尝试记录 → 报', async () => {
    const db = makeSupabase({
      auth: [auth({ dates: [TOMORROW] })],
      attempts: [],
    })
    const items: ManualItem[] = []
    await pushAutoPublishItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain(TOMORROW)
  })

  it('同一客户两个日期都没尝试 → 只出一条，列出两个日期', async () => {
    const db = makeSupabase({
      auth: [auth({ dates: [TODAY, TOMORROW] })],
      attempts: [],
    })
    const items: ManualItem[] = []
    await pushAutoPublishItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain(TODAY)
    expect(items[0].what).toContain(TOMORROW)
  })
})

describe('pushAutoPublishItems —— 记录对不上（墓碑写着已撤回，回执里却有更晚的帖子）', () => {
  const tomb = (over: { date?: string; updated_at?: string } = {}) =>
    attempt({ status: 'blocked', reason_code: 'RECALLED', date: over.date ?? TODAY, updated_at: over.updated_at ?? '2026-10-07T00:00:00Z' })
  const plan = (published: Array<{ date: string; published_at: string }>) => ({ id: 'plan-1', publish_meta: { published } })

  it('墓碑之后回执里又有同一天的帖子 → 一条 auto_publish_record_conflict，带客户名和日期', async () => {
    const db = makeSupabase({ attempts: [tomb()], plans: [plan([{ date: TODAY, published_at: '2026-10-07T05:00:00Z' }])] })
    const items: ManualItem[] = []
    await pushAutoPublishItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('auto_publish_record_conflict')
    expect(items[0].what).toContain(CLIENT_NAME)
    expect(items[0].what).toContain(TODAY)
    expect(items[0].href).toContain(`/dashboard/clients/${CLIENT}`)
  })

  it('回执里的帖子比墓碑更早（正常撤回后原帖已移出）→ 不出待办', async () => {
    const db = makeSupabase({ attempts: [tomb()], plans: [plan([{ date: TODAY, published_at: '2026-10-06T05:00:00Z' }])] })
    const items: ManualItem[] = []
    await pushAutoPublishItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(0)
  })

  it('回执里没有这一天 → 不出待办', async () => {
    const db = makeSupabase({ attempts: [tomb()], plans: [plan([{ date: TOMORROW, published_at: '2026-10-07T05:00:00Z' }])] })
    const items: ManualItem[] = []
    await pushAutoPublishItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(0)
  })

  it('超过 14 天的旧墓碑不再提醒', async () => {
    const db = makeSupabase({ attempts: [tomb({ date: OLD })], plans: [plan([{ date: OLD, published_at: '2026-10-07T05:00:00Z' }])] })
    const items: ManualItem[] = []
    await pushAutoPublishItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(0)
  })

  it('🔴 读回执失败 → 抛错，不能当成「没有冲突」', async () => {
    const db = makeSupabase({ attempts: [tomb()], failOn: 'social_plans' })
    await expect(pushAutoPublishItems(db, [], NOW, nameOf, LIVE)).rejects.toThrow(/receipt read failed/)
  })

  it('同一客户多天冲突合并成一条', async () => {
    const db = makeSupabase({
      attempts: [tomb({ date: TODAY }), tomb({ date: TOMORROW })],
      plans: [plan([
        { date: TODAY, published_at: '2026-10-07T05:00:00Z' },
        { date: TOMORROW, published_at: '2026-10-07T05:00:00Z' },
      ])],
    })
    const items: ManualItem[] = []
    await pushAutoPublishItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain(`${TODAY}、${TOMORROW}`)
  })
})
