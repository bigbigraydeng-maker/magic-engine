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

function seedBase() {
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
}

describe('prescription launch check store plan filtering', () => {
  beforeEach(() => {
    db.tables = {}
    db.inserts = []
    db.ranges = []
    db.selects = []
  })

  it('uses an archived plan that has an approved_at', async () => {
    seedBase()
    db.tables.marketing_plans = [{
      client_id: 'client-1',
      status: 'archived',
      approved_at: '2019-12-01T00:00:00.000Z',
      plan_data: { promo: { goal_id: 'goal-1' } },
    }]
    const receipt = await runPrescriptionLaunchCheck(new Date('2026-11-02T00:00:00.000Z'))
    expect(receipt.outcomes_written).toBeGreaterThan(0)
  })

  it('ignores a draft plan', async () => {
    seedBase()
    db.tables.marketing_plans = [{
      client_id: 'client-1',
      status: 'draft',
      approved_at: '2019-12-01T00:00:00.000Z',
      plan_data: { promo: { goal_id: 'goal-1' } },
    }]
    const receipt = await runPrescriptionLaunchCheck(new Date('2026-11-02T00:00:00.000Z'))
    expect(receipt.outcomes_written).toBe(0)
  })

  it('ignores an approved plan without an approved_at', async () => {
    seedBase()
    db.tables.marketing_plans = [{
      client_id: 'client-1',
      status: 'approved',
      approved_at: null,
      plan_data: { promo: { goal_id: 'goal-1' } },
    }]
    const receipt = await runPrescriptionLaunchCheck(new Date('2026-11-02T00:00:00.000Z'))
    expect(receipt.outcomes_written).toBe(0)
  })
})
