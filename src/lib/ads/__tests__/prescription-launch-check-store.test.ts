import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  inserts: [] as Array<{ table: string; row: Row }>,
  ranges: [] as Array<[number, number]>,
  selects: [] as Array<{ table: string; columns: string }>,
}))

vi.mock('@/lib/ads-strategy/account-timezone', () => ({
  resolveAccountTimezone: async () => 'Pacific/Auckland',
}))

vi.mock('@/lib/supabase', () => {
  class Q {
    private filters: Array<(row: Row) => boolean> = []
    private rng: [number, number] | null = null
    constructor(private table: string) {}
    select(columns: string) {
      db.selects.push({ table: this.table, columns })
      return this
    }
    eq(column: string, value: unknown) {
      this.filters.push(row => row[column] === value)
      return this
    }
    order() { return this }
    range(from: number, to: number) {
      db.ranges.push([from, to])
      this.rng = [from, to]
      return Promise.resolve(this.finish())
    }
    insert(row: Row) {
      db.inserts.push({ table: this.table, row })
      return Promise.resolve({ data: null, error: null })
    }
    update() { return this }
    then(resolve: (value: { data: unknown; error: null }) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve(this.finish()).then(resolve, reject)
    }
    private finish() {
      let rows = (db.tables[this.table] ?? []).filter(row => this.filters.every(fn => fn(row)))
      if (this.rng) rows = rows.slice(this.rng[0], this.rng[1] + 1)
      return { data: rows, error: null }
    }
  }
  return { supabaseAdmin: { from: (table: string) => new Q(table) } }
})

import { runPrescriptionLaunchCheck, supabaseLaunchStore } from '../prescription-launch-check-store'

describe('prescription launch check store', () => {
  beforeEach(() => {
    db.tables = {}
    db.inserts = []
    db.ranges = []
    db.selects = []
  })

  it('stops paging when a page is short, and marks a full cap as partial', async () => {
    db.tables.flywheel_actions = [{ id: 'a', client_id: 'c', action_type: 'ads.create_ad', payload: {} }]
    const short = await supabaseLaunchStore().listAllActions()
    expect(short.partial).toBe(false)
    expect(short.rows).toHaveLength(1)
    expect(db.ranges).toEqual([[0, 499]])

    db.ranges = []
    db.tables.flywheel_actions = Array.from({ length: 5000 }, (_, index) => ({
      id: `a-${index}`,
      client_id: 'c',
      action_type: 'ads.create_ad',
      payload: {},
    }))
    const full = await supabaseLaunchStore().listAllActions()
    expect(full.partial).toBe(true)
    expect(full.rows).toHaveLength(5000)
    expect(db.ranges).toHaveLength(10)
  })

  it('writes the verdict without a new data source or a snapshot row', async () => {
    db.tables.flywheel_actions = [{
      id: 'act-1',
      client_id: 'client-1',
      action_type: 'ads.create_ad',
      payload: {
        status: 'active',
        campaignId: 'camp-1',
        activation: { status: 'executed', authorized_at: '2020-01-01T00:00:00.000Z' },
      },
    }]
    db.tables.marketing_plans = [{
      client_id: 'client-1',
      status: 'approved',
      approved_at: '2019-12-01T00:00:00.000Z',
      plan_data: { promo: { goal_id: 'goal-1' } },
    }]
    db.tables.prescriptions = [{
      id: 'rx-1',
      client_id: 'client-1',
      goal_id: 'goal-1',
      status: 'approved',
      approved_at: '2019-11-01T00:00:00.000Z',
      content: { kpi_targets: [{ metric: '线索', target_value: 1, unit: '条' }] },
    }]
    db.tables.ad_daily_insights = [{
      client_id: 'client-1',
      level: 'campaign',
      entity_id: 'camp-1',
      ad_account_id: 'act_1',
      insight_date: '2020-01-02',
      spend: 5,
      results: 2,
    }]
    db.tables.prescription_cases = [{ id: 'case-1', prescription_id: 'rx-1', created_at: '2020-01-01T00:00:00.000Z' }]
    const receipt = await runPrescriptionLaunchCheck(new Date('2026-11-02T00:00:00.000Z'))
    expect(receipt.outcomes_written).toBeGreaterThan(0)
    expect(db.inserts.every(item => item.table === 'prescription_outcomes')).toBe(true)
    expect(db.inserts.some(item => 'data_source' in item.row || 'actual_value' in item.row)).toBe(false)
    expect(db.tables.ad_entity_snapshots).toBeUndefined()
  })

  it('reads video thruplays separately from results', async () => {
    db.tables.ad_daily_insights = [
      {
        client_id: 'c1', level: 'campaign', entity_id: 'camp',
        insight_date: '2026-10-26', spend: '9.5', results: 0, video_thruplays: 80,
      },
      {
        client_id: 'c1', level: 'campaign', entity_id: 'camp',
        insight_date: '2026-10-27', spend: 0, results: 4, video_thruplays: null,
      },
    ]
    const rows = await supabaseLaunchStore().listInsights('c1', 'camp')
    expect(db.selects).toContainEqual({
      table: 'ad_daily_insights',
      columns: 'insight_date, spend, results, video_thruplays',
    })
    expect(rows).toEqual([
      { insightDate: '2026-10-26', spend: 9.5, results: 0, videoThruplays: 80 },
      { insightDate: '2026-10-27', spend: 0, results: 4, videoThruplays: null },
    ])
  })
})
