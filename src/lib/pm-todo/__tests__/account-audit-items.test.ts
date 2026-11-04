import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from '../manual-item-types'
import { ACCOUNT_AUDIT_TODO_KIND, buildAccountAuditItem, pushAccountAuditItems } from '../account-audit-items'

const receipt = (over: Record<string, unknown> = {}) => ({
  client_id: 'c1', as_of: '2026-11-09', reel_count: 41, error: null,
  metrics: [
    { key: 'D1', label: '模板集中度', status: 'over', value: 'x' },
    { key: 'D2', label: 'BGM 重复', status: 'over', value: 'y' },
    { key: 'D3', label: '改版扎堆', status: 'ok', value: 'z' },
    { key: 'D5', label: '内容柱配比', status: 'not_measured', value: 'w' },
  ],
  findings: [
    { key: 'D1', tier: 'A', what: '模板集中度超线', how: '排期' },
    { key: 'D4', tier: 'C', what: '账号缺「people」这一类内容', how: '开发卡' },
  ],
  ...over,
})

describe('buildAccountAuditItem', () => {
  it('one item per client: what (counts and names), how, href', () => {
    const item = buildAccountAuditItem(receipt(), () => 'CTS')
    expect(item).toMatchObject({ kind: ACCOUNT_AUDIT_TODO_KIND, client_id: 'c1', client_name: 'CTS' })
    expect(item?.what).toContain('2 项超线（模板集中度、BGM 重复）')
    expect(item?.what).toContain('1 项量不出来（内容柱配比）')
    expect(item?.what).toContain('账号缺「people」这一类内容')
    expect(item?.what).not.toContain('模板集中度超线') // tier A is not asked of a person
    expect(item?.what).toContain('这一步还没上线') // the text does not claim a fix that does not exist yet
    expect(item?.what).not.toContain('已自己往后排')
    expect(item?.how).not.toContain('我会自己下单')
    expect(item?.how.length).toBeGreaterThan(20)
    expect(item?.href).toContain('/dashboard/clients/c1/daily-plan')
  })

  it('nothing over and everything measured → no to-do', () => {
    expect(buildAccountAuditItem(receipt({ metrics: [{ key: 'D1', label: 'a', status: 'ok', value: '' }], findings: [] }), () => 'CTS')).toBeNull()
  })

  it('a client whose audit failed raises its own item (a failure is not silence); a malformed receipt raises nothing', () => {
    const failed = buildAccountAuditItem(receipt({ error: 'db down', metrics: [], findings: [] }), () => 'CTS')
    expect(failed?.what).toContain('没跑成')
    expect(failed?.what).toContain('db down')
    expect(failed?.what).toContain('不要当成没问题')
    expect(buildAccountAuditItem(null, () => 'CTS')).toBeNull()
    expect(buildAccountAuditItem({ metrics: [] }, () => 'CTS')).toBeNull()
  })

  it('only not-measured fields still raise one (a blind spot is not a pass)', () => {
    const item = buildAccountAuditItem(receipt({ metrics: [{ key: 'D5', label: '内容柱配比', status: 'not_measured', value: '' }], findings: [] }), () => 'CTS')
    expect(item?.what).toContain('1 项量不出来')
    expect(item?.what).not.toContain('项超线')
  })
})

type Row = { summary: Record<string, unknown>; started_at: string }

/** Minimal fake of supabase.from('cron_run_logs').select().eq().in().gte().order().limit(); records the status filter. */
function fakeDb(rows: Row[] | { error: string }): { db: SupabaseClient; statuses: () => unknown } {
  let statuses: unknown = null
  const chain = {
    select: () => chain, eq: () => chain, gte: () => chain, order: () => chain,
    in: (_c: string, v: unknown) => { statuses = v; return chain },
    limit: () => Promise.resolve('error' in rows ? { data: null, error: { message: rows.error } } : { data: rows, error: null }),
  }
  return { db: { from: () => chain } as unknown as SupabaseClient, statuses: () => statuses }
}

const run = (clients: unknown[], over: Record<string, unknown> = {}): Row => ({ started_at: '2026-11-09T17:00:00Z', summary: { kind: 'tick', status: 'done', clients, ...over } })
const NOW = new Date('2026-11-10T00:00:00Z')

describe('pushAccountAuditItems', () => {
  it('reads partial and failed runs too, so one failing client never silences the others', async () => {
    const { db, statuses } = fakeDb([run([receipt({ client_id: 'bad', error: 'db down', metrics: [], findings: [] }), receipt({ client_id: 'good' })])])
    const items: ManualItem[] = []
    await pushAccountAuditItems(db, items, (id) => id, NOW)
    expect(statuses()).toEqual(['completed', 'partial', 'failed'])
    expect(items.map((i) => i.client_id).sort()).toEqual(['bad', 'good'])
  })

  it('keeps the newest receipt per client: a manual run for one client does not hide the others', async () => {
    const { db } = fakeDb([
      run([receipt({ client_id: 'c1', as_of: '2026-11-10', metrics: [{ key: 'D1', label: '模板集中度', status: 'ok', value: '' }], findings: [] })], { started_at: '2026-11-10T01:00:00Z' }),
      run([receipt({ client_id: 'c1', as_of: '2026-11-09' }), receipt({ client_id: 'c2', as_of: '2026-11-09' })]),
    ])
    const items: ManualItem[] = []
    await pushAccountAuditItems(db, items, (id) => id, NOW)
    expect(items.map((i) => i.client_id)).toEqual(['c2']) // c1's newest receipt is clean; c2 only appears in the older run
  })

  it('a run that could not list clients raises one back-office item', async () => {
    const { db } = fakeDb([run([], { status: 'list_failed' })])
    const items: ManualItem[] = []
    await pushAccountAuditItems(db, items, (id) => id, NOW)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ client_id: 'infra' })
    expect(items[0].what).toContain('没拿到客户名单')
  })

  it('no receipt in the last 8 days → nothing; an unreadable log → one back-office item', async () => {
    const empty: ManualItem[] = []
    await pushAccountAuditItems(fakeDb([]).db, empty, (id) => id, NOW)
    expect(empty).toEqual([])
    const broken: ManualItem[] = []
    await pushAccountAuditItems(fakeDb({ error: 'boom' }).db, broken, (id) => id, NOW)
    expect(broken).toHaveLength(1)
    expect(broken[0].client_id).toBe('infra')
  })
})

