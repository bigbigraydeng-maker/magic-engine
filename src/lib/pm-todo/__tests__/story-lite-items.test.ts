/**
 * Story 自动发布待办的取数行为测试（草稿）。
 *
 * 这里最容易出的错不是「判错」，是**查错了还看不出来**：
 * 查一张不存在的表、漏带过滤条件、把「查询报错」和「没查到」混成同一个空结果 ——
 * 都会安静地返回空待办，测试照样绿。
 *
 * 所以假 supabase 按**表**建模、真的执行过滤条件，没建模的表直接 throw；
 * 并且记录有没有人调用过写操作（insert / update / delete），一旦调用就炸。
 */

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { pushStoryLiteItems } from '../story-lite-items'
import type { ManualItem } from '../manual-item-types'

type Row = Record<string, unknown>

interface FakeOptions {
  items?: Row[]
  packs?: Row[]
  failOn?: 'story_items' | 'story_packs'
}

/**
 * 按表建模的假 supabase。
 * - 两张表的 builder 都可 await（resolve {data, error}），并真的执行 eq / in / is / not / gt / lt。
 * - 没建模的表 throw —— 查错表必须炸。
 * - insert / update / delete 一律 throw —— 这个模块只读。
 */
function makeSupabase(opts: FakeOptions): SupabaseClient {
  const tables: Record<string, Row[]> = {
    story_items: opts.items ?? [],
    story_packs: opts.packs ?? [],
  }

  const from = (table: string) => {
    if (!(table in tables)) throw new Error(`测试没有给 ${table} 建模，说明代码查了意料之外的表`)
    const rows = tables[table]
    const eqFilters: Array<[string, unknown]> = []
    const inFilters: Array<[string, unknown[]]> = []
    let gtFilter: { col: string; val: string } | null = null
    let ltFilter: { col: string; val: string } | null = null
    let isNullCol: string | null = null
    let notNullCol: string | null = null

    const matched = () =>
      rows.filter((r) => {
        if (gtFilter) {
          const cell = r[gtFilter.col]
          if (typeof cell !== 'string' || cell <= gtFilter.val) return false
        }
        if (ltFilter) {
          const cell = r[ltFilter.col]
          if (typeof cell !== 'string' || cell >= ltFilter.val) return false
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
    builder.gt = (col: string, val: string) => {
      gtFilter = { col, val }
      return builder
    }
    builder.lt = (col: string, val: string) => {
      ltFilter = { col, val }
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
    builder.insert = () => {
      throw new Error('story-lite-items 只读，不许 insert')
    }
    builder.update = () => {
      throw new Error('story-lite-items 只读，不许 update')
    }
    builder.delete = () => {
      throw new Error('story-lite-items 只读，不许 delete')
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

function item(overrides: {
  client_id?: string
  status?: string
  slot_at?: string
  reason_code?: string | null
  last_check_at?: string | null
  claimed_at?: string | null
  pack_id?: string
}): Row {
  return {
    client_id: overrides.client_id ?? CLIENT,
    status: overrides.status ?? 'PENDING',
    slot_at: overrides.slot_at ?? `${TODAY}T00:00:00Z`,
    reason_code: overrides.reason_code ?? null,
    last_check_at: overrides.last_check_at ?? null,
    claimed_at: overrides.claimed_at ?? null,
    pack_id: overrides.pack_id ?? 'pack-1',
  }
}

function pack(overrides: {
  id?: string
  client_id?: string
  authorized_at?: string | null
  expires_at?: string | null
  revoked_at?: string | null
}): Row {
  return {
    id: overrides.id ?? 'pack-1',
    client_id: overrides.client_id ?? CLIENT,
    authorized_at: overrides.authorized_at === undefined ? '2026-10-07T00:00:00Z' : overrides.authorized_at,
    expires_at: overrides.expires_at === undefined ? '2026-12-31T00:00:00Z' : overrides.expires_at,
    revoked_at: overrides.revoked_at ?? null,
  }
}

const LIVE = { live: true }
const DRY = { live: false }

describe('pushStoryLiteItems —— 不确定有没有发出去', () => {
  it('UNKNOWN_OUTCOME → 一条 story_unknown_outcome，what 带客户名和条数', async () => {
    const db = makeSupabase({ items: [item({ status: 'UNKNOWN_OUTCOME' })] })
    const items: ManualItem[] = []
    await pushStoryLiteItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('story_unknown_outcome')
    expect(items[0].client_id).toBe(CLIENT)
    expect(items[0].client_name).toBe(CLIENT_NAME)
    expect(items[0].what).toContain(CLIENT_NAME)
    expect(items[0].what).toContain('1 条 Story')
    expect(items[0].what).toContain('不确定')
    expect(items[0].how).toContain('Facebook 主页')
    expect(items[0].href).toContain(`/dashboard/clients/${CLIENT}`)
  })

  it('🔴 还在 36 小时内的「不确定」→ 出待办；超过 36 小时（Story 早已消失）→ 不再提醒', async () => {
    // NOW = 2026-10-08T01:00Z
    const recent = makeSupabase({ items: [item({ status: 'UNKNOWN_OUTCOME', slot_at: '2026-10-06T20:00:00Z' })] }) // 29 小时前
    const itemsRecent: ManualItem[] = []
    await pushStoryLiteItems(recent, itemsRecent, NOW, nameOf, LIVE)
    expect(itemsRecent).toHaveLength(1)
    expect(itemsRecent[0].kind).toBe('story_unknown_outcome')

    const old = makeSupabase({ items: [item({ status: 'UNKNOWN_OUTCOME', slot_at: `${OLD}T00:00:00Z` })] })
    const itemsOld: ManualItem[] = []
    await pushStoryLiteItems(old, itemsOld, NOW, nameOf, LIVE)
    expect(itemsOld).toHaveLength(0)
  })

  it('同一客户多条 → 只出一条，列出所有时间', async () => {
    const db = makeSupabase({
      items: [
        item({ status: 'UNKNOWN_OUTCOME', slot_at: `${TODAY}T00:00:00Z` }),
        item({ status: 'UNKNOWN_OUTCOME', slot_at: `${TODAY}T06:00:00Z` }),
      ],
    })
    const items: ManualItem[] = []
    await pushStoryLiteItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('2 条 Story')
  })

  it('两个客户各一条', async () => {
    const db = makeSupabase({
      items: [
        item({ client_id: CLIENT, status: 'UNKNOWN_OUTCOME' }),
        item({ client_id: OTHER, status: 'UNKNOWN_OUTCOME' }),
      ],
    })
    const items: ManualItem[] = []
    await pushStoryLiteItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(2)
    const ids = items.map((i) => i.client_id).sort()
    expect(ids).toEqual([CLIENT, OTHER].sort())
  })
})

describe('pushStoryLiteItems —— 没发出去', () => {
  it('FAILED → 一条 story_stalled，what 说「Facebook 拒绝了这条」', async () => {
    const db = makeSupabase({ items: [item({ status: 'FAILED' })] })
    const items: ManualItem[] = []
    await pushStoryLiteItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('story_stalled')
    expect(items[0].what).toContain('Facebook 拒绝了这条')
  })

  it('MISSED → stalled，what 说「发布时间已过，没有补发」', async () => {
    const db = makeSupabase({ items: [item({ status: 'MISSED' })] })
    const items: ManualItem[] = []
    await pushStoryLiteItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('story_stalled')
    expect(items[0].what).toContain('发布时间已过，没有补发')
  })

  it('BLOCKED → stalled，what 带原因代码', async () => {
    const db = makeSupabase({ items: [item({ status: 'BLOCKED', reason_code: 'MISSING_MEDIA' })] })
    const items: ManualItem[] = []
    await pushStoryLiteItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('story_stalled')
    expect(items[0].what).toContain('MISSING_MEDIA')
  })

  it('同一客户多条 → 只出一条，列出所有时间和原因', async () => {
    const db = makeSupabase({
      items: [
        item({ status: 'FAILED', slot_at: `${TODAY}T00:00:00Z` }),
        item({ status: 'MISSED', slot_at: `${TODAY}T06:00:00Z` }),
      ],
    })
    const items: ManualItem[] = []
    await pushStoryLiteItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('2 条 Story')
    expect(items[0].what).toContain('Facebook 拒绝了这条')
    expect(items[0].what).toContain('发布时间已过，没有补发')
  })

  it('🔴 超过 14 天的旧失败 → 不再产生待办', async () => {
    const db = makeSupabase({ items: [item({ status: 'FAILED', slot_at: `${OLD}T00:00:00Z` })] })
    const items: ManualItem[] = []
    await pushStoryLiteItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(0)
  })

  it('PENDING / SENT / CLAIMED → 不出待办', async () => {
    const db = makeSupabase({
      items: [
        item({ status: 'PENDING' }),
        item({ status: 'SENT' }),
        item({ status: 'CLAIMED' }),
      ],
    })
    const items: ManualItem[] = []
    await pushStoryLiteItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(0)
  })
})

describe('pushStoryLiteItems —— 不确定窗口按抢占时间算', () => {
  it('🔴 计划时间已超 36 小时、但刚被转成不确定（抢占时间在窗口内）→ 照样报', async () => {
    const db = makeSupabase({
      packs: [pack({})],
      items: [item({ status: 'UNKNOWN_OUTCOME', slot_at: '2026-10-05T00:00:00Z', claimed_at: '2026-10-07T20:00:00Z' })],
    })
    const items: ManualItem[] = []
    await pushStoryLiteItems(db, items, NOW, nameOf, LIVE)
    expect(items.map((i) => i.kind)).toContain('story_unknown_outcome')
  })
})

describe('pushStoryLiteItems —— 人为撤下的不算「没发出去」', () => {
  it('原因代码以 PM_REMOVED 开头的被拦条目不进「没发出去」提醒；别的被拦照常提醒', async () => {
    const removed = makeSupabase({
      packs: [pack({})],
      items: [item({ status: 'BLOCKED', slot_at: `${TODAY}T20:00:00Z`, reason_code: 'PM_REMOVED_20261014 PM 决定撤下' })],
    })
    const items: ManualItem[] = []
    await pushStoryLiteItems(removed, items, NOW, nameOf, LIVE)
    expect(items.filter((i) => i.kind === 'story_stalled')).toHaveLength(0)

    const real = makeSupabase({
      packs: [pack({})],
      items: [item({ status: 'BLOCKED', slot_at: `${TODAY}T20:00:00Z`, reason_code: 'FILE_CHANGED' })],
    })
    const items2: ManualItem[] = []
    await pushStoryLiteItems(real, items2, NOW, nameOf, LIVE)
    expect(items2.filter((i) => i.kind === 'story_stalled')).toHaveLength(1)
  })
})

describe('pushStoryLiteItems —— 看门狗：授权了却什么都没发生', () => {
  it('已授权、到点超过 1 小时、PENDING 且没有检查记录 → 一条 story_unarmed', async () => {
    const db = makeSupabase({
      packs: [pack({})],
      items: [item({ status: 'PENDING', slot_at: '2026-10-07T00:00:00Z', last_check_at: null })],
    })
    const items: ManualItem[] = []
    await pushStoryLiteItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('story_unarmed')
    expect(items[0].client_id).toBe(CLIENT)
    expect(items[0].what).toContain('发布器根本没跑起来')
  })

  it('发布器活着（最近 30 分钟内写过检查记录）→ 不报', async () => {
    const db = makeSupabase({
      packs: [pack({})],
      items: [item({ status: 'PENDING', slot_at: '2026-10-07T00:00:00Z', last_check_at: '2026-10-08T00:45:00Z' })],
    })
    const items: ManualItem[] = []
    await pushStoryLiteItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(0)
  })

  it('🔴 发布器跑过一次再死掉（检查记录是 2 小时前的）→ 照样报', async () => {
    const db = makeSupabase({
      packs: [pack({})],
      items: [item({ status: 'PENDING', slot_at: '2026-10-07T00:00:00Z', last_check_at: '2026-10-07T23:00:00Z' })],
    })
    const items: ManualItem[] = []
    await pushStoryLiteItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('story_unarmed')
  })

  it('🔴 卡在 CLAIMED（扫描抢占后挂了）且发布器已停 → 报', async () => {
    const db = makeSupabase({
      packs: [pack({})],
      items: [item({ status: 'CLAIMED', slot_at: '2026-10-07T00:00:00Z', last_check_at: null })],
    })
    const items: ManualItem[] = []
    await pushStoryLiteItems(db, items, NOW, nameOf, LIVE)
    expect(items.map((i) => i.kind)).toContain('story_unarmed')
  })

  it('到点还不到 1 小时 → 不报（给发布器一点时间）', async () => {
    const db = makeSupabase({
      packs: [pack({})],
      items: [item({ status: 'PENDING', slot_at: '2026-10-08T00:30:00Z', last_check_at: null })],
    })
    const items: ManualItem[] = []
    await pushStoryLiteItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(0)
  })

  it('已撤销的周包 → 不报', async () => {
    const db = makeSupabase({
      packs: [pack({ revoked_at: '2026-10-07T00:00:00Z' })],
      items: [item({ status: 'PENDING', slot_at: '2026-10-07T00:00:00Z', last_check_at: null })],
    })
    const items: ManualItem[] = []
    await pushStoryLiteItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(0)
  })

  it('🔴 周包已过期但条目还卡着 → 照样报（发布器整周没跑，告警不能跟着消失）', async () => {
    const db = makeSupabase({
      packs: [pack({ expires_at: '2026-10-01T00:00:00Z' })],
      items: [item({ status: 'PENDING', slot_at: '2026-10-07T00:00:00Z', last_check_at: null })],
    })
    const items: ManualItem[] = []
    await pushStoryLiteItems(db, items, NOW, nameOf, LIVE)
    expect(items.map((i) => i.kind)).toContain('story_unarmed')
  })

  it('🔴 周包已过期、条目演练时检查过（检查记录较旧）→ 不报（否则演练包过期后天天误报）', async () => {
    const db = makeSupabase({
      packs: [pack({ expires_at: '2026-10-07T12:00:00Z' })],
      items: [item({ status: 'PENDING', slot_at: '2026-10-07T00:00:00Z', last_check_at: '2026-10-07T06:00:00Z' })],
    })
    const items: ManualItem[] = []
    await pushStoryLiteItems(db, items, NOW, nameOf, LIVE)
    expect(items.map((i) => i.kind)).not.toContain('story_unarmed')
  })

  it('未授权的周包 → 不报', async () => {
    const db = makeSupabase({
      packs: [pack({ authorized_at: null })],
      items: [item({ status: 'PENDING', slot_at: '2026-10-07T00:00:00Z', last_check_at: null })],
    })
    const items: ManualItem[] = []
    await pushStoryLiteItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(0)
  })

  it('演练模式（live=false）→ what 里说明是演练模式', async () => {
    const db = makeSupabase({
      packs: [pack({})],
      items: [item({ status: 'PENDING', slot_at: '2026-10-07T00:00:00Z', last_check_at: null })],
    })
    const items: ManualItem[] = []
    await pushStoryLiteItems(db, items, NOW, nameOf, DRY)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('story_unarmed')
    expect(items[0].what).toContain('演练模式')
  })

  it('正式模式（live=true）→ what 里说没有任何发布或演练记录', async () => {
    const db = makeSupabase({
      packs: [pack({})],
      items: [item({ status: 'PENDING', slot_at: '2026-10-07T00:00:00Z', last_check_at: null })],
    })
    const items: ManualItem[] = []
    await pushStoryLiteItems(db, items, NOW, nameOf, LIVE)
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('没有任何发布或演练记录')
  })
})

describe('pushStoryLiteItems —— 读失败与只读', () => {
  it('story_items 读取出错 → 直接 reject，前缀正确', async () => {
    const db = makeSupabase({ failOn: 'story_items' })
    const items: ManualItem[] = []
    await expect(pushStoryLiteItems(db, items, NOW, nameOf, LIVE)).rejects.toThrow('story-lite-items:')
  })

  it('story_packs 读取出错 → 直接 reject，前缀正确', async () => {
    const db = makeSupabase({ failOn: 'story_packs' })
    const items: ManualItem[] = []
    await expect(pushStoryLiteItems(db, items, NOW, nameOf, LIVE)).rejects.toThrow('story-lite-items:')
  })

  it('查了没建模的表 → throw', async () => {
    const db = makeSupabase({})
    const broken = {
      from: (table: string) => {
        if (table !== 'story_packs') {
          throw new Error(`测试没有给 ${table} 建模，说明代码查了意料之外的表`)
        }
        return (db as unknown as { from: (t: string) => unknown }).from(table)
      },
    } as unknown as SupabaseClient
    const items: ManualItem[] = []
    await expect(pushStoryLiteItems(broken, items, NOW, nameOf, LIVE)).rejects.toThrow('测试没有给')
  })

  it('🔴 全程不调用 insert / update / delete', async () => {
    const db = makeSupabase({
      packs: [pack({})],
      items: [
        item({ status: 'UNKNOWN_OUTCOME' }),
        item({ status: 'FAILED' }),
        item({ status: 'PENDING', slot_at: '2026-10-07T00:00:00Z', last_check_at: null }),
      ],
    })
    const items: ManualItem[] = []
    await pushStoryLiteItems(db, items, NOW, nameOf, LIVE)
    expect(items.length).toBeGreaterThan(0)
  })
})
