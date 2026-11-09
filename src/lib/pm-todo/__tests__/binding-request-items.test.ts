/**
 * 客户交了广告账户号 → 今日待办（AD-SEC-3）。
 *
 * 钉铁律 3 下半：客户提交必须进同一个管道，三件套齐全，href 绝对网址；
 * FDE 已处理（保存 / 忽略）过的不再冒出来。
 */
import { describe, it, expect } from 'vitest'
import { makeBindingFakeDb, asSupabaseClient, type FakeDb } from '@/lib/meta/__tests__/binding-fake-db'
import { pushBindingRequestItems } from '../binding-request-items'
import { assertAbsoluteHref, type ManualItem } from '../manual-items'

const A = 'aaaaaaaa-0000-0000-0000-000000000001'
const B = 'bbbbbbbb-0000-0000-0000-000000000002'
const now = new Date()
const iso = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString()

async function run(db: FakeDb, ids = [A, B]): Promise<ManualItem[]> {
  const items: ManualItem[] = []
  const supabase = asSupabaseClient(makeBindingFakeDb(db))
  await pushBindingRequestItems(supabase, items, ids, now, id => (id === A ? 'Client A' : 'Client B'))
  return items
}

const row = (client_id: string, outcome: string, created_at: string, extra: Record<string, unknown> = {}) => ({
  id: `${client_id}-${created_at}`, client_id, binding_kind: 'meta_ad_account', outcome, created_at,
  actor_email: 'owner@a.test', requested_value: null, ...extra,
})

describe('ad_account_binding_requested', () => {
  it('客户提交未处理 → 一条待办，三件套齐全，链接直达设置页', async () => {
    const items = await run({ client_binding_audit: [row(A, 'requested_by_client', iso(10), { requested_value: 'act_3333333333' })] })

    expect(items).toHaveLength(1)
    const [item] = items
    expect(item.kind).toBe('ad_account_binding_requested')
    expect(item.client_name).toBe('Client A')
    expect(item.what).toContain('act_3333333333')
    expect(item.how).toContain('核实')
    expect(item.href).toBe(`https://app.magicengine.com.au/dashboard/clients/${A}/settings`)
    expect(() => assertAbsoluteHref(item)).not.toThrow()
  })

  it('提交之后 FDE 保存过或忽略过 → 不再下发', async () => {
    const items = await run({
      client_binding_audit: [
        row(A, 'requested_by_client', iso(30), { requested_value: 'act_3333333333' }),
        row(A, 'applied', iso(20), { action: 'bind' }),
        row(B, 'requested_by_client', iso(30), { requested_value: 'act_4444444444' }),
        row(B, 'request_dismissed', iso(20)),
      ],
    })
    expect(items).toHaveLength(0)
  })

  it('FDE 处理过之后客户又交了新号 → 重新下发', async () => {
    const items = await run({
      client_binding_audit: [
        row(A, 'request_dismissed', iso(30)),
        row(A, 'requested_by_client', iso(5), { requested_value: 'act_5555555555' }),
      ],
    })
    expect(items.map(i => i.what)).toEqual([expect.stringContaining('act_5555555555')])
  })

  it('FDE 清空了绑定（applied + clear）不算处理过客户交的号 → 仍然下发', async () => {
    const items = await run({
      client_binding_audit: [
        row(A, 'requested_by_client', iso(30), { requested_value: 'act_3333333333', action: 'request' }),
        row(A, 'applied', iso(20), { action: 'clear' }),
      ],
    })
    expect(items).toHaveLength(1)
  })

  it('被拒类审计行（rejected_*）不算「已处理」', async () => {
    const items = await run({
      client_binding_audit: [
        row(A, 'requested_by_client', iso(30), { requested_value: 'act_3333333333' }),
        row(A, 'rejected_graph', iso(20)),
      ],
    })
    expect(items).toHaveLength(1)
  })

  it('超过 30 天的提交 → 过期不再提醒', async () => {
    const items = await run({
      client_binding_audit: [row(A, 'requested_by_client', iso(31 * 24 * 60), { requested_value: 'act_3333333333' })],
    })
    expect(items).toHaveLength(0)
  })

  it('不在活跃客户名单里的客户 → 不下发', async () => {
    const items = await run(
      { client_binding_audit: [row(B, 'requested_by_client', iso(10), { requested_value: 'act_3333333333' })] },
      [A],
    )
    expect(items).toHaveLength(0)
  })
})
