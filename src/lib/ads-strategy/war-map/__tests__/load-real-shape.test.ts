/**
 * war-map 读数据层（loadWarMapInput）用真实形状的行跑一遍：内存里的假查询层，里面灌的是 CTS 在 2026-10-20 读到的真实行
 * （绑定表 2 行、账户/观众池/广告组/系列快照、各账户最新数据日）。用来证明：账户清单以绑定表为准、没快照也列出来、
 * 读绑定表失败会抛错而不是吞掉、起跑日只看在用账户。数据结构来自审查员的只读探针。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>
const db = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, errors: {} as Record<string, string> }))

vi.mock('@/lib/supabase', () => {
  const cmp = (a: unknown, b: unknown): number => {
    if (typeof a === 'number' && typeof b === 'number') return a - b
    const as = String(a ?? ''), bs = String(b ?? '')
    const iso = /^\d{4}-\d{2}-\d{2}T/
    if (iso.test(as) && iso.test(bs)) return Date.parse(as) - Date.parse(bs)
    return as < bs ? -1 : as > bs ? 1 : 0
  }
  class Q {
    private filters: Array<(r: Row) => boolean> = []
    private orders: Array<[string, boolean]> = []
    private lim: number | null = null
    private rng: [number, number] | null = null
    private single = false
    constructor(private table: string) {}
    select(_c?: string) { return this }
    eq(c: string, v: unknown) { this.filters.push(r => r[c] === v); return this }
    in(c: string, vs: unknown[]) { this.filters.push(r => vs.includes(r[c])); return this }
    gte(c: string, v: unknown) { this.filters.push(r => cmp(r[c], v) >= 0); return this }
    lte(c: string, v: unknown) { this.filters.push(r => cmp(r[c], v) <= 0); return this }
    order(c: string, o?: { ascending?: boolean }) { this.orders.push([c, o?.ascending !== false]); return this }
    limit(n: number) { this.lim = n; return this }
    range(a: number, b: number) { this.rng = [a, b]; return this }
    maybeSingle() { this.single = true; return this }
    then(res: (v: { data: unknown; error: { message: string } | null }) => unknown, rej?: (e: unknown) => unknown) {
      if (db.errors[this.table]) return Promise.resolve({ data: null, error: { message: db.errors[this.table] } }).then(res, rej)
      let rows: Row[] = (db.tables[this.table] ?? []).map((r, i): Row => ({ id: String(i).padStart(6, '0'), ...r })).filter(r => this.filters.every(f => f(r)))
      rows = rows.sort((x, y) => {
        for (const [c, asc] of this.orders) { const d = cmp(x[c], y[c]); if (d !== 0) return asc ? d : -d }
        return 0
      })
      if (this.rng) rows = rows.slice(this.rng[0], this.rng[1] + 1)
      if (this.lim !== null) rows = rows.slice(0, this.lim)
      return Promise.resolve({ data: this.single ? (rows[0] ?? null) : rows, error: null }).then(res, rej)
    }
  }
  return { supabaseAdmin: { from: (t: string) => new Q(t) } }
})
vi.mock('@/lib/ads-strategy/config', () => ({
  loadAdStrategyConfigWithSource: async () => ({ source: 'fallback', config: { creative_pool: [] } }),
}))

import { baseSpec } from '@/lib/marketing-plan/promo/__tests__/fixtures'
import { loadWarMapInput } from '../load'
import { buildWarMap } from '../build'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const OFFICIAL = 'act_2202695063810470' // entity_name "CTS", status 1; bound label "CTStours 官方账户（ThruPlay）"
const PERSONAL = 'act_2775766642787274' // entity_name "Pengyu Deng", status 3; bound label "主账户"
const NOW = new Date('2026-10-20T08:50:00.000Z') // NZ 10/20 21:50

const pools: Array<[string, string, string, number, string, string]> = [
  ['120248216748520307', 'CTS - Video viewers 50% - 36', PERSONAL, 44500, '2026-10-19T12:31:23.530Z', 'ENGAGEMENT'],
  ['52549838527273', '类似受众 (NZ, 1%) - CTS · LIST ·', OFFICIAL, 32500, '2026-10-19T12:31:23.530Z', 'LOOKALIKE'],
  ['120248339511170307', 'CTS - ThruPlay viewers - 365', PERSONAL, 28100, '2026-10-19T12:31:23.530Z', 'ENGAGEMENT'],
  ['52551185747273', 'CTS · 看过任意CTS视频50% · 365d · ', OFFICIAL, 8500, '2026-10-19T12:31:23.530Z', 'ENGAGEMENT'],
  ['120249785429270307', '【对照实验】看过任意CTS视频50% · 365d · ', PERSONAL, 8400, '2026-10-19T12:31:23.530Z', 'ENGAGEMENT'],
  ['120248216832520307', 'CTS - FB Page engaged - 365d', PERSONAL, 2700, '2026-10-19T12:31:23.530Z', 'ENGAGEMENT'],
  ['120248216782430307', 'CTS - Leadform opened not su', PERSONAL, 1800, '2026-10-19T12:31:23.530Z', 'ENGAGEMENT'],
  ['52558282065673', 'CTS · 排除 · 已付定金+不再联系+即将出行 · ', OFFICIAL, 1000, '2026-10-20T00:31:17.175Z', 'CUSTOM'],
  ['6971567517469', '公共主页互动客户', OFFICIAL, 1000, '2026-10-19T12:31:23.530Z', 'ENGAGEMENT'],
  ['120248216826450307', 'CTS - Leadform submitted - 9', PERSONAL, 1000, '2026-10-19T12:31:23.530Z', 'ENGAGEMENT'],
  ['120249781975610307', '【对照实验】GC 北京+上海视频看完95% · 365d', PERSONAL, 1000, '2026-10-19T12:31:23.530Z', 'ENGAGEMENT'],
  ['52549822861673', 'CTS · LIST · fb+newsletter ·', OFFICIAL, 1000, '2026-10-19T12:31:23.530Z', 'CUSTOM'],
  ['52549865359073', 'CTS · VIDEO · 看过50% · 365d', OFFICIAL, 1000, '2026-10-19T12:31:23.530Z', 'ENGAGEMENT'],
  ['52551117275273', 'CTS · GC 北京+上海视频看完95% · 365d', OFFICIAL, 1000, '2026-10-19T12:31:23.530Z', 'ENGAGEMENT'],
  ['52556259932073', 'CTS · 看过上海团视频50% · 30d · 202', OFFICIAL, 1000, '2026-10-19T12:31:23.530Z', 'ENGAGEMENT'],
  ['120248216872180307', '类似受众 (1%) - CTS - Leadform s', PERSONAL, -1, '2026-10-19T12:31:23.530Z', 'LOOKALIKE'],
]

// [level, entity_id, campaign_id, effective_status, capture_reason, captured_at, account]
type SnapSeed = [string, string, string | null, string, string, string, string]
const officialSnaps: SnapSeed[] = [
  // NEW since the last review: campaign + 2 adsets turned ACTIVE, first seen at the 06:31Z snapshot (NZ 19:31 on 10/20)
  ['campaign', '52558131445673', '52558131445673', 'ACTIVE', 'first_seen', '2026-10-20T06:31:36.950Z', OFFICIAL],
  ['adset', '52558131506073', '52558131445673', 'ACTIVE', 'first_seen', '2026-10-20T06:31:36.950Z', OFFICIAL],
  ['adset', '52558131509673', '52558131445673', 'ACTIVE', 'first_seen', '2026-10-20T06:31:36.950Z', OFFICIAL],
  // everything else in the official account is PAUSED / gone
  ['adset', '52549857906273', '52549857862873', 'PAUSED', 'daily', '2026-10-19T12:31:23.530Z', OFFICIAL],
  ['adset', '52549843017273', '52549839818273', 'PAUSED', 'daily', '2026-10-19T12:31:23.530Z', OFFICIAL],
  ['adset', '52556260262673', '52556260145273', 'PAUSED', 'daily', '2026-10-19T12:31:23.530Z', OFFICIAL],
  ['adset', '52556260276873', '52556260145273', 'PAUSED', 'daily', '2026-10-19T12:31:23.530Z', OFFICIAL],
  ['adset', '52551117304473', '52551117286873', 'PAUSED', 'daily', '2026-10-19T12:31:23.530Z', OFFICIAL],
  ['adset', '52551118124873', '52551118114073', 'PAUSED', 'daily', '2026-10-19T12:31:23.530Z', OFFICIAL],
  ['adset', '52551621921273', null, 'NOT_RETURNED', 'disappeared', '2026-10-20T00:31:17.175Z', OFFICIAL],
  ['campaign', '52549857862873', '52549857862873', 'PAUSED', 'changed', '2026-10-20T00:31:17.175Z', OFFICIAL],
  ['campaign', '52551117286873', '52551117286873', 'PAUSED', 'changed', '2026-10-20T00:31:17.175Z', OFFICIAL],
  ['campaign', '52551118114073', '52551118114073', 'PAUSED', 'changed', '2026-10-20T00:31:17.175Z', OFFICIAL],
  ['campaign', '52557922885873', '52557922885873', 'PAUSED', 'daily', '2026-10-19T12:31:23.530Z', OFFICIAL],
  ['campaign', '52557922870873', '52557922870873', 'PAUSED', 'daily', '2026-10-19T12:31:23.530Z', OFFICIAL],
  ['campaign', '52556260145273', '52556260145273', 'PAUSED', 'daily', '2026-10-19T12:31:23.530Z', OFFICIAL],
  ['campaign', '52549839818273', '52549839818273', 'PAUSED', 'daily', '2026-10-19T12:31:23.530Z', OFFICIAL],
]
// Personal (debt-suspended) account: 3 adsets under ACTIVE campaigns are still switched "on" in settings.
// Earliest in-window row approximated as the first daily row of the 30-day window (real aggregate: first daily ACTIVE row 2026-09-20 12:31Z).
const personalSnaps: SnapSeed[] = [
  ['adset', '120247480862400307', '120247480862390307', 'ACTIVE', 'daily', '2026-09-20T12:31:17.888Z', PERSONAL],
  ['adset', '120247480862400307', '120247480862390307', 'ACTIVE', 'daily', '2026-10-19T12:31:23.530Z', PERSONAL],
  ['adset', '120248220094190307', '120248220094200307', 'ACTIVE', 'daily', '2026-09-20T12:31:17.888Z', PERSONAL],
  ['adset', '120248220094190307', '120248220094200307', 'ACTIVE', 'daily', '2026-10-19T12:31:23.530Z', PERSONAL],
  ['adset', '120248221094190307', '120248221094180307', 'ACTIVE', 'daily', '2026-09-20T12:31:17.888Z', PERSONAL],
  ['adset', '120248221094190307', '120248221094180307', 'ACTIVE', 'daily', '2026-10-19T12:31:23.530Z', PERSONAL],
  ['campaign', '120247480862390307', '120247480862390307', 'ACTIVE', 'daily', '2026-09-20T12:31:17.888Z', PERSONAL],
  ['campaign', '120247480862390307', '120247480862390307', 'ACTIVE', 'daily', '2026-10-19T12:31:23.530Z', PERSONAL],
  ['campaign', '120248220094200307', '120248220094200307', 'ACTIVE', 'daily', '2026-09-20T12:31:17.888Z', PERSONAL],
  ['campaign', '120248220094200307', '120248220094200307', 'ACTIVE', 'daily', '2026-10-19T12:31:23.530Z', PERSONAL],
  ['campaign', '120248221094180307', '120248221094180307', 'ACTIVE', 'daily', '2026-09-20T12:31:17.888Z', PERSONAL],
  ['campaign', '120248221094180307', '120248221094180307', 'ACTIVE', 'daily', '2026-10-19T12:31:23.530Z', PERSONAL],
]

function seed(): void {
  const snapRows = (s: SnapSeed[]): Row[] => s.map(([level, entity_id, campaign_id, effective_status, capture_reason, captured_at, ad_account_id]) => ({
    client_id: CLIENT, level, entity_id, campaign_id, effective_status, capture_reason, captured_at, ad_account_id, entity_name: null,
  }))
  db.errors = {}
  db.tables = {
    client_meta_ad_accounts: [
      { client_id: CLIENT, ad_account_id: PERSONAL, label: '主账户', is_primary: true },
      { client_id: CLIENT, ad_account_id: OFFICIAL, label: 'CTStours 官方账户（ThruPlay）', is_primary: false },
    ],
    clients: [{ id: CLIENT, meta_ad_account_id: PERSONAL }],
    ad_entity_snapshots: [
      { client_id: CLIENT, level: 'account', ad_account_id: OFFICIAL, entity_id: OFFICIAL, entity_name: 'CTS', account_status: 1, timezone_name: 'Pacific/Auckland', capture_reason: 'daily', captured_at: '2026-10-19T12:31:23.530Z' },
      { client_id: CLIENT, level: 'account', ad_account_id: PERSONAL, entity_id: PERSONAL, entity_name: 'Pengyu Deng', account_status: 3, timezone_name: 'Pacific/Auckland', capture_reason: 'daily', captured_at: '2026-10-19T12:31:23.530Z' },
      ...pools.map(([entity_id, entity_name, ad_account_id, audience_count_lower, captured_at, audience_subtype]) => ({
        client_id: CLIENT, level: 'audience', entity_id, entity_name, ad_account_id, audience_count_lower, audience_subtype,
        audience_rule_events: [] as string[], capture_reason: 'daily', captured_at,
      })),
      ...snapRows(officialSnaps),
      ...snapRows(personalSnaps),
    ],
    ad_daily_insights: [
      { client_id: CLIENT, ad_account_id: OFFICIAL, level: 'adset', entity_id: 'x1', entity_name: 'x', insight_date: '2026-09-22', spend: 0, frequency_7d: null, fetched_at: '2026-10-07T17:01:36.082Z' },
      { client_id: CLIENT, ad_account_id: PERSONAL, level: 'adset', entity_id: 'x2', entity_name: 'x', insight_date: '2026-10-10', spend: 0, frequency_7d: null, fetched_at: '2026-10-16T17:02:35.649Z' },
      // campaign rows inside the 9/16-9/22 window (one row per campaign, spend = 7-day sum), from production
      { client_id: CLIENT, ad_account_id: PERSONAL, level: 'campaign', entity_id: '120247480862390307', entity_name: 'CTS — Lead Form — Reborn — 20260624', insight_date: '2026-09-22', spend: 266, frequency_7d: null, fetched_at: '2026-10-16T17:02:27.803Z' },
      { client_id: CLIENT, ad_account_id: PERSONAL, level: 'campaign', entity_id: '120248220094200307', entity_name: 'CTS - Retargeting - Warm - 20260707', insight_date: '2026-09-22', spend: 238, frequency_7d: null, fetched_at: '2026-10-16T17:02:27.803Z' },
      { client_id: CLIENT, ad_account_id: OFFICIAL, level: 'campaign', entity_id: '52551621883873', entity_name: '圣诞团-奥克兰 · 私信 · 20260916', insight_date: '2026-09-22', spend: 140, frequency_7d: 1.724011, fetched_at: '2026-10-07T17:01:33.503Z' },
      { client_id: CLIENT, ad_account_id: OFFICIAL, level: 'campaign', entity_id: '52551621884873', entity_name: '圣诞团-基督城 · 私信 · 20260916', insight_date: '2026-09-20', spend: 108, frequency_7d: null, fetched_at: '2026-10-07T17:01:33.503Z' },
      { client_id: CLIENT, ad_account_id: OFFICIAL, level: 'campaign', entity_id: '52552481390273', entity_name: 'Christmas-ThruPlay-Awareness-2026092', insight_date: '2026-09-22', spend: 13, frequency_7d: 1.180943, fetched_at: '2026-10-07T17:01:33.503Z' },
    ],
  }
}

async function run() {
  const input = await loadWarMapInput(CLIENT, NOW)
  return { input, view: buildWarMap(input) }
}

describe('loadWarMapInput · 真实形状的行（CTS 2026-10-20 08:50Z）', () => {
  beforeEach(seed)

  it('A. normal: bound table is the list, joined to snapshots', async () => {
    const { input, view } = await run()
    expect(input.accounts).toHaveLength(2)
    expect(input.runningSince).toBe('2026-10-20') // official's new ACTIVE campaign; personal's older ACTIVE rows must NOT leak in
    expect(input.clocks.dataDay).toBe('2026-09-22')
  })

  it('B. bound table empty -> falls back to clients.meta_ad_account_id', async () => {
    db.tables.client_meta_ad_accounts = []
    const { input } = await run()
    expect(input.accounts.map(a => a.adAccountId)).toEqual([PERSONAL])
  })

  it('C. bound account with no snapshot -> listed with label, status null, capturedAt null ("已绑定，暂无数据")', async () => {
    db.tables.ad_entity_snapshots = (db.tables.ad_entity_snapshots ?? []).filter(r => !(r.level === 'account' && r.ad_account_id === OFFICIAL))
    const { input } = await run()
    const row = input.accounts.find(a => a.adAccountId === OFFICIAL)
    expect(row).toMatchObject({ name: 'CTStours 官方账户（ThruPlay）', statusCode: null, capturedAt: null })
  })

  it('D. read error on the bound table -> loader throws (not swallowed)', async () => {
    db.errors.client_meta_ad_accounts = 'boom'
    await expect(loadWarMapInput(CLIENT, NOW)).rejects.toThrow(/读绑定广告账户失败：boom/)
  })

  it('E. bound table empty AND legacy column empty -> no accounts, clocks fall back to client-wide', async () => {
    db.tables.client_meta_ad_accounts = []
    db.tables.clients = [{ id: CLIENT, meta_ad_account_id: null }]
    const { input } = await run()
    expect(input.accounts).toHaveLength(0)
    expect(input.clocks.dataDay).toBe('2026-10-10')
  })

  it('F. unprefixed ids in the bound table still join to act_ snapshots', async () => {
    db.tables.client_meta_ad_accounts = [
      { client_id: CLIENT, ad_account_id: '2202695063810470', label: 'x', is_primary: true },
    ]
    const { input } = await run()
    expect(input.accounts[0]).toMatchObject({ adAccountId: OFFICIAL, name: 'CTS', statusCode: 1 })
  })

  it('G. hidden_from_ad_health on the personal account -> only the official account is listed', async () => {
    db.tables.client_meta_ad_accounts = (db.tables.client_meta_ad_accounts ?? []).map(r =>
      r.ad_account_id === PERSONAL ? { ...r, hidden_from_ad_health: true } : { ...r, hidden_from_ad_health: false },
    )
    const { input } = await run()
    expect(input.accounts).toHaveLength(1)
    expect(input.accounts[0]).toMatchObject({ adAccountId: OFFICIAL, name: 'CTS', statusCode: 1 })
  })

  it('H. all bound accounts hidden -> no accounts, no fallback to the legacy column', async () => {
    db.tables.client_meta_ad_accounts = (db.tables.client_meta_ad_accounts ?? []).map(r => ({ ...r, hidden_from_ad_health: true }))
    const { input } = await run()
    expect(input.accounts).toHaveLength(0)
  })

  it('I. hidden personal account -> its pools, pool history and campaign rows are dropped too', async () => {
    db.tables.client_meta_ad_accounts = (db.tables.client_meta_ad_accounts ?? []).map(r =>
      r.ad_account_id === PERSONAL ? { ...r, hidden_from_ad_health: true } : { ...r, hidden_from_ad_health: false },
    )
    const { input } = await run()
    expect(input.accounts.map(a => a.adAccountId)).toEqual([OFFICIAL])
    // 44,500 的大池子、8,400 的对照实验池子都在 PERSONAL 上，必须消失
    expect(input.audiences.length).toBeGreaterThan(0)
    expect(input.audiences.every(a => a.adAccountId === OFFICIAL)).toBe(true)
    expect(input.audiences.some(a => a.id === '120248216748520307')).toBe(false)
    expect(input.audiences.some(a => a.id === '120249785429270307')).toBe(false)
    const personalAudienceIds = new Set(pools.filter(p => p[2] === PERSONAL).map(p => p[0]))
    expect(input.audienceHistory.length).toBeGreaterThan(0)
    expect(input.audienceHistory.some(h => personalAudienceIds.has(h.audienceId))).toBe(false)
    expect(input.campaigns.length).toBeGreaterThan(0)
    expect(input.campaigns.every(c => c.adAccountId === OFFICIAL)).toBe(true)
  })

  it('K. 计划所挂目标的最新处方（含草稿）变成一行；别的目标和别的客户不算', async () => {
    db.tables.marketing_plans = [{
      client_id: CLIENT,
      status: 'draft',
      updated_at: '2026-10-20T01:00:00.000Z',
      plan_data: { promo: baseSpec({ goal_id: 'goal-1' }) },
    }]
    db.tables.goals = [{ id: 'goal-1', client_id: CLIENT, title: '目标甲', budget_currency: 'NZD' }]
    db.tables.prescriptions = [
      {
        id: 'old', client_id: CLIENT, goal_id: 'goal-1', status: 'approved', version: 1,
        agent_name: '旧的', created_at: '2026-10-01T00:00:00.000Z',
        content: { summary: '旧', phases: [], kpi_targets: [], budget_allocation: [] },
      },
      {
        id: 'new', client_id: CLIENT, goal_id: 'goal-1', status: 'draft', version: 2,
        agent_name: '开方人甲', created_at: '2026-10-19T00:00:00.000Z',
        content: {
          summary: '新',
          phases: [{
            phase_number: 1, name: '准备', duration_weeks: 1,
            actions: [
              { id: 'a1', title: '动作一', description: '', fix_type: 'fde_manual', module: 'manual' },
              { id: 'a2', title: '动作二', description: '', fix_type: 'fde_manual', module: 'manual' },
              { id: 'a3', title: '自动', description: '', fix_type: 'me_auto', module: 'ads_intelligence' },
            ],
          }],
          kpi_targets: [],
          budget_allocation: [],
        },
      },
      {
        id: 'other', client_id: CLIENT, goal_id: 'goal-9', status: 'draft', version: 9,
        agent_name: '别人', created_at: '2026-10-20T00:00:00.000Z', content: { summary: '', phases: [], kpi_targets: [] },
      },
    ]
    const { input, view } = await run()
    expect(input.plan?.goalTitle).toBe('目标甲')
    expect(input.plan?.prescriptionLine).toBe('处方 v2 · 草稿 · 2 条人工动作')
    expect(view.prescriptionLine).toBe('处方 v2 · 草稿 · 2 条人工动作')
  })

  it('L. 处方读失败时计划和阶段仍在，处方那一行留空', async () => {
    db.tables.marketing_plans = [{
      client_id: CLIENT, status: 'draft', updated_at: '2026-10-20T01:00:00.000Z',
      plan_data: { promo: baseSpec({ goal_id: 'goal-1' }) },
    }]
    db.tables.goals = [{ id: 'goal-1', client_id: CLIENT, title: '目标甲', budget_currency: 'NZD' }]
    db.errors.prescriptions = 'boom'
    const input = await loadWarMapInput(CLIENT, NOW)
    expect(input.plan).toMatchObject({
      status: 'draft',
      goalTitle: '目标甲',
      prescriptionLine: null,
      phases: [
        { name: '阶段 1', startDate: '2026-11-01', endDate: '2026-11-14' },
        { name: '阶段 2', startDate: '2026-11-15', endDate: '2026-11-30' },
      ],
    })
  })

  it('J. control: nothing hidden -> pools and campaigns from both accounts are present', async () => {
    const { input } = await run()
    expect(input.accounts).toHaveLength(2)
    expect(new Set(input.audiences.map(a => a.adAccountId))).toEqual(new Set([PERSONAL, OFFICIAL]))
    expect(new Set(input.campaigns.map(c => c.adAccountId))).toEqual(new Set([PERSONAL, OFFICIAL]))
    const personalAudienceIds = new Set(pools.filter(p => p[2] === PERSONAL).map(p => p[0]))
    expect(input.audienceHistory.some(h => personalAudienceIds.has(h.audienceId))).toBe(true)
  })
})
