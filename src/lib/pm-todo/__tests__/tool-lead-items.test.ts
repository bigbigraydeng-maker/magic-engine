/**
 * 工具实验室留资 → 今日待办（工具实验室共用库整理 · 验收条件②下游消费）。
 *
 * `website_lead_events`（cta_key='tool_signup'）以前写完没人读；这里验证两种留资
 * （已存在客户的自助开通 / 匿名访客留邮箱）都能各自下发出正确的一条待办。
 */
import { describe, expect, it, vi } from 'vitest'
import { pushToolLeadItems } from '../tool-lead-items'
import { assertAbsoluteHref, type ManualItem } from '../manual-items'
import type { ClientRow } from '../client-roster'

const CLIENT_A = 'aaaaaaaa-0000-0000-0000-000000000001'
const now = new Date('2026-09-28T00:00:00Z')

/**
 * 假的 `website_lead_events` 查询。
 *
 * 形状不是猜的：**已核实**生产侧 `pushToolLeadItems`（../tool-lead-items.ts）对 supabase
 * 只用这一条链 —— `.from().select().eq().gte()`，止步于 `.gte()`、直接拿 `{ data, error }`，
 * 没有 `.order()`。多一个方法这个假对象都不需要，少一个测试会当场炸（"the read failing" 那条
 * 用例已跑，见文件末）。这里的强转只是把「够用的假对象」对齐 `SupabaseClient` 的形参类型，
 * 不是拿它掩盖形状不符。
 */
function fakeSupabase(rows: unknown[] | null, error: { message: string } | null = null) {
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.gte = vi.fn(async () => ({ data: rows, error }))
  return { from: vi.fn(() => chain) } as unknown as Parameters<typeof pushToolLeadItems>[0]
}

async function run(rows: unknown[] | null, clients = new Map<string, ClientRow>(), error: { message: string } | null = null): Promise<ManualItem[]> {
  const items: ManualItem[] = []
  await pushToolLeadItems(fakeSupabase(rows, error), items, clients, now)
  return items
}

describe('pushToolLeadItems', () => {
  it('an ads-check signup (existing client) → one item pointing at that client, with its real name', async () => {
    const clients = new Map<string, ClientRow>([[CLIENT_A, { id: CLIENT_A, name: 'Client A', domain: null }]])
    const items = await run(
      [{ id: 'e-1', destination: 'ads-check', created_at: now.toISOString(), metadata: { client_id: CLIENT_A } }],
      clients,
    )
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('tool_lead_needs_followup')
    expect(items[0].client_id).toBe(CLIENT_A)
    expect(items[0].client_name).toBe('Client A')
    expect(items[0].what).toContain('Facebook 广告体检')
    expect(items[0].href).toBe(`https://app.magicengine.com.au/dashboard/clients/${CLIENT_A}`)
    expect(() => assertAbsoluteHref(items[0])).not.toThrow()
  })

  it('a client id with no matching roster row still gets an item, labelled unknown rather than silently dropped', async () => {
    const items = await run([{ id: 'e-1', destination: 'ads-check', created_at: now.toISOString(), metadata: { client_id: CLIENT_A } }])
    expect(items).toHaveLength(1)
    expect(items[0].client_name).toBe('未知客户')
  })

  it('a site-check report signup (anonymous, has an email) → one infra-scoped item naming the email to follow up with', async () => {
    const items = await run([
      { id: 'e-2', destination: 'site-check', created_at: now.toISOString(), metadata: { lead_id: 'lead-1', url: 'https://acme.com/', email: 'a@b.com' } },
    ])
    expect(items).toHaveLength(1)
    expect(items[0].client_id).toBe('infra')
    expect(items[0].what).toContain('a@b.com')
    expect(items[0].what).toContain('https://acme.com/')
    expect(items[0].how).toContain('a@b.com')
    expect(() => assertAbsoluteHref(items[0])).not.toThrow()
  })

  it('mixed rows in one digest → one item per row, each routed correctly', async () => {
    const clients = new Map<string, ClientRow>([[CLIENT_A, { id: CLIENT_A, name: 'Client A', domain: null }]])
    const items = await run(
      [
        { id: 'e-1', destination: 'ads-check', created_at: now.toISOString(), metadata: { client_id: CLIENT_A } },
        { id: 'e-2', destination: 'site-check', created_at: now.toISOString(), metadata: { lead_id: 'lead-1', email: 'a@b.com' } },
      ],
      clients,
    )
    expect(items).toHaveLength(2)
    expect(items.map((i) => i.client_id).sort()).toEqual([CLIENT_A, 'infra'].sort())
  })

  it('the read failing → no items, and it never throws (a broken query must not take down the whole digest)', async () => {
    await expect(run(null, new Map(), { message: 'down' })).resolves.toEqual([])
  })

  it('no rows in the last 24h → no items', async () => {
    await expect(run([])).resolves.toEqual([])
  })
})
