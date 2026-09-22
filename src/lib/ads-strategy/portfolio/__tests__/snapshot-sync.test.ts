/**
 * 快照同步：共用账户读侧隔离（§14 M9）、每层抓取记录（子牙 B1）、消失判定只在读全时（B2）、
 * 读失败不写、上一行读不到不写。Meta 返回用真实实拉 fixtures；假 supabase 按表建模（不按调用顺序）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import nal from './fixtures/nal-settings.json'

type Row = Record<string, unknown>
const tables: Record<string, Row[]> = {}
const tableErrors: Record<string, { message: string } | null> = {}
const rangeCalls: Array<[number, number]> = []

function query(table: string) {
  const filters: Array<[string, unknown]> = []
  let range: [number, number] | null = null
  const run = () => {
    if (tableErrors[table]) return { data: null, error: tableErrors[table] }
    let rows = (tables[table] ?? []).filter(r => filters.every(([k, v]) => r[k] === v))
    if (range) rows = rows.slice(range[0], range[1] + 1)
    return { data: rows, error: null }
  }
  const builder = {
    select: () => builder,
    eq: (k: string, v: unknown) => { filters.push([k, v]); return builder },
    gte: () => builder,
    not: () => builder,
    in: () => builder,
    order: () => builder,
    limit: () => builder,
    range: (a: number, b: number) => { range = [a, b]; rangeCalls.push([a, b]); return builder },
    then: (resolve: (v: unknown) => unknown) => resolve(run()),
    insert: async (rows: Row[]) => {
      if (tableErrors[`${table}:insert`]) return { error: tableErrors[`${table}:insert`] }
      tables[table] = [...(tables[table] ?? []), ...rows]
      return { error: null }
    },
  }
  return builder
}

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: (t: string) => query(t) } }))
vi.mock('@/lib/meta/token-manager', () => ({ getMetaTokenForClient: async () => 'token' }))

const read = { campaigns: vi.fn(), adsets: vi.fn(), ads: vi.fn(), audiences: vi.fn(), account: vi.fn() }
vi.mock('@/lib/meta/entity-settings', () => ({
  fetchAccountSettings: () => read.account(),
  fetchCampaignSettings: () => read.campaigns(),
  fetchAdsetSettings: () => read.adsets(),
  fetchAdSettings: () => read.ads(),
  fetchCustomAudiences: () => read.audiences(),
}))

import { captureClientSnapshots, dayKeyIn, listSnapshotClients } from '../snapshot-sync'

const ok = <T>(rows: T[]) => ({ rows, complete: true, error: null })
const snapshots = () => tables.ad_entity_snapshots ?? []
const captures = () => tables.ad_snapshot_captures ?? []
const NAL_ACT = 'act_953025114498626'

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(tables)) delete tables[k]
  for (const k of Object.keys(tableErrors)) delete tableErrors[k]
  rangeCalls.length = 0
  read.account.mockResolvedValue(ok([nal.account]))
  read.campaigns.mockResolvedValue(ok(nal.campaigns))
  read.adsets.mockResolvedValue(ok(nal.adsets))
  read.ads.mockResolvedValue(ok(nal.ads))
  read.audiences.mockResolvedValue(ok(nal.audiences))
  tables.client_meta_ad_accounts = [{ client_id: 'client-nal', ad_account_id: NAL_ACT }]
  tables.ad_entity_snapshots = []
  tables.ad_snapshot_captures = []
})

describe('captureClientSnapshots', () => {
  it('独占账户首次抓：五个层级全部记为 first_seen（NAL 实拉：1 账户 + 5 系列 + 7 广告组 + 10 广告 + 1 受众），每层一条抓全记录', async () => {
    const res = await captureClientSnapshots('client-nal', [NAL_ACT], { now: new Date('2026-09-14T00:30:00Z') })
    expect(res.success).toBe(true)
    const count = (level: string) => snapshots().filter(r => r.level === level).length
    expect([count('account'), count('campaign'), count('adset'), count('ad'), count('audience')]).toEqual([1, 5, 7, 10, 1])
    expect(new Set(snapshots().map(r => r.capture_reason))).toEqual(new Set(['first_seen']))
    expect(captures().map(c => [c.level, c.complete, c.rows_written])).toEqual([
      ['account', true, 1], ['campaign', true, 5], ['adset', true, 7], ['ad', true, 10], ['audience', true, 1],
    ])
  })

  it('🔴 M9 共用账户（同账户登记给两个客户）：只写账户级并标 shared_account，不读实体；实体层记 skipped_shared', async () => {
    tables.client_meta_ad_accounts = [
      { client_id: 'client-roman', ad_account_id: 'act_1260456876069575' },
      { client_id: 'client-kiteroa', ad_account_id: '1260456876069575' },
    ]
    const res = await captureClientSnapshots('client-roman', ['act_1260456876069575'])
    expect(res.accounts[0].shared_account).toBe(true)
    expect(res.success).toBe(true)
    expect(snapshots().map(r => r.level)).toEqual(['account'])
    expect(snapshots()[0].shared_account).toBe(true)
    expect(read.campaigns).not.toHaveBeenCalled()
    expect(read.adsets).not.toHaveBeenCalled()
    expect(captures().filter(c => c.level !== 'account').every(c => c.skipped_shared === true && c.complete === false)).toBe(true)
  })

  it('🔴 登记表查询出错 → fail closed：全部当共用处理，只写账户级，整体标失败', async () => {
    tableErrors.client_meta_ad_accounts = { message: 'boom' }
    const res = await captureClientSnapshots('client-nal', [NAL_ACT])
    expect(res.success).toBe(false)
    expect(snapshots().map(r => r.level)).toEqual(['account'])
    expect(read.adsets).not.toHaveBeenCalled()
  })

  it('某一层读到一半失败（已拿到部分行）→ 这一层一行都不写、抓取记录标 incomplete，其它层照写', async () => {
    read.adsets.mockResolvedValue({ rows: nal.adsets.slice(0, 3), complete: false, error: { status: 500, code: 1, message: 'page 2 failed' } })
    const res = await captureClientSnapshots('client-nal', [NAL_ACT])
    expect(res.success).toBe(false)
    expect(snapshots().some(r => r.level === 'adset')).toBe(false)
    expect(snapshots().some(r => r.level === 'campaign')).toBe(true)
    expect(captures().find(c => c.level === 'adset')).toMatchObject({ complete: false, error: 'page 2 failed', rows_written: 0 })
  })

  it('读不到上一行快照 → 本轮一行快照都不写，但抓取记录照写（标 incomplete）', async () => {
    tableErrors.ad_entity_snapshots = { message: 'relation does not exist' }
    const res = await captureClientSnapshots('client-nal', [NAL_ACT])
    expect(res.success).toBe(false)
    expect(tables.ad_entity_snapshots).toEqual([])
    expect(captures().length).toBe(5)
    expect(captures().every(c => c.complete === false)).toBe(true)
  })

  it('账户本身读不到 → 整个账户跳过，五层都记 incomplete', async () => {
    read.account.mockResolvedValue({ rows: [], complete: false, error: { status: 400, code: 190, message: 'token invalid' } })
    const res = await captureClientSnapshots('client-nal', [NAL_ACT])
    expect(res.accounts[0].error).toBe('token invalid')
    expect(snapshots()).toEqual([])
    expect(captures().map(c => c.complete)).toEqual([false, false, false, false, false])
  })

  it('🔴 B2 消失：上一轮有的广告组，这一轮广告组层读全了却没返回 → 记 disappeared；读不全时不判消失', async () => {
    await captureClientSnapshots('client-nal', [NAL_ACT], { now: new Date('2026-09-14T00:30:00Z') })
    const gone = nal.adsets[0] as { id: string }

    read.adsets.mockResolvedValue(ok(nal.adsets.slice(1)))
    await captureClientSnapshots('client-nal', [NAL_ACT], { now: new Date('2026-09-14T03:30:00Z') })
    const disappeared = snapshots().filter(r => r.capture_reason === 'disappeared')
    expect(disappeared.map(r => [r.level, r.entity_id, r.effective_status])).toEqual([['adset', gone.id, 'NOT_RETURNED']])

    // 再抓一轮仍没返回：不重复记
    await captureClientSnapshots('client-nal', [NAL_ACT], { now: new Date('2026-09-14T06:30:00Z') })
    expect(snapshots().filter(r => r.capture_reason === 'disappeared')).toHaveLength(1)

    // 读不全时：另一个广告组没返回也不判消失
    read.adsets.mockResolvedValue({ rows: [], complete: false, error: { status: 500, code: 1, message: 'x' } })
    await captureClientSnapshots('client-nal', [NAL_ACT], { now: new Date('2026-09-14T09:30:00Z') })
    expect(snapshots().filter(r => r.capture_reason === 'disappeared')).toHaveLength(1)
  })

  it('读上一行按 1000 行分页（PostgREST 单次上限），不靠一次 limit(5000)', async () => {
    await captureClientSnapshots('client-nal', [NAL_ACT])
    expect(rangeCalls[0]).toEqual([0, 999])
  })
})

describe('dayKeyIn — 按账户时区切天', () => {
  it('NZ 时区：UTC 2026-09-13 12:30 已是 NZ 9/14；UTC 切天会错成 9/13', () => {
    expect(dayKeyIn('Pacific/Auckland')('2026-09-13T12:30:00Z')).toBe('2026-09-14')
    expect(dayKeyIn(null)('2026-09-13T12:30:00Z')).toBe('2026-09-13')
  })
})

describe('listSnapshotClients — 客户口径（魏征 B1）', () => {
  it('prospect 状态但登记了广告账户的客户（生产 NAL）要抓；archived 不抓', async () => {
    tables.clients = [
      { id: 'nal', name: 'New Asian Logistics', client_status: 'prospect', meta_ad_account_id: NAL_ACT },
      { id: 'kiteroa', name: '30 Kiteroa', client_status: 'archived', meta_ad_account_id: 'act_1260456876069575' },
    ]
    tables.client_meta_ad_accounts = [{ client_id: 'nal', ad_account_id: NAL_ACT }]
    const clients = await listSnapshotClients()
    expect(clients.map(c => c.id)).toEqual(['nal'])
  })
})
