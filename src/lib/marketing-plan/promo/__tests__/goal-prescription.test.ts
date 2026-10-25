/**
 * 目标下最新处方：任何状态都算，版本最大的赢；币种不发明。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  errors: {} as Record<string, string>,
  usedIn: false,
}))

vi.mock('@/lib/supabase', () => {
  const cmp = (a: unknown, b: unknown): number => {
    if (typeof a === 'number' && typeof b === 'number') return a - b
    return String(a ?? '').localeCompare(String(b ?? ''))
  }
  class Q {
    private filters: Array<(row: Row) => boolean> = []
    private orders: Array<[string, boolean]> = []
    private lim: number | null = null
    constructor(private table: string) {}
    select() { return this }
    eq(column: string, value: unknown) { this.filters.push(row => row[column] === value); return this }
    in() { db.usedIn = true; return this }
    order(column: string, options?: { ascending?: boolean }) {
      this.orders.push([column, options?.ascending !== false])
      return this
    }
    limit(n: number) { this.lim = n; return this }
    maybeSingle() { return this.finish(true) }
    then(resolve: (value: { data: unknown; error: { message: string } | null }) => unknown, reject?: (reason: unknown) => unknown) {
      return this.finish(false).then(resolve, reject)
    }
    private finish(single: boolean) {
      if (db.errors[this.table]) return Promise.resolve({ data: null, error: { message: db.errors[this.table] } })
      let rows = (db.tables[this.table] ?? []).filter(row => this.filters.every(fn => fn(row)))
      rows = [...rows].sort((left, right) => {
        for (const [column, ascending] of this.orders) {
          const diff = cmp(left[column], right[column])
          if (diff !== 0) return ascending ? diff : -diff
        }
        return 0
      })
      if (this.lim !== null) rows = rows.slice(0, this.lim)
      return Promise.resolve({ data: single ? (rows[0] ?? null) : rows, error: null })
    }
  }
  return { supabaseAdmin: { from: (table: string) => new Q(table) } }
})

import { loadLatestGoalPrescription } from '../goal-prescription'

const CLIENT = 'client-1'
const GOAL = 'goal-1'

function action(id: string, title: string, fix: string, module: string) {
  return { id, title, description: `${title}说明`, fix_type: fix, module, dimension: 'ads', phase: 1, effort: 'low', impact: 'low', finding_ids: [] }
}

function content(extra: Record<string, unknown> = {}) {
  return {
    summary: '摘要甲',
    phases: [{
      phase_number: 1,
      name: '准备',
      duration_weeks: 1,
      actions: [
        action('a1', '动作一', 'fde_manual', 'manual'),
        action('a2', '动作二', 'fde_manual', 'seo_engine'),
        action('a3', '自动动作', 'me_auto', 'ads_intelligence'),
      ],
    }],
    kpi_targets: [
      { metric: '线索', current_value: 0, target_value: 10, unit: '条', dimension: 'ads' },
      { metric: '成本', current_value: null, target_value: 12, unit: 'NZD', dimension: 'ads', timeframe: '本周期' },
    ],
    budget_allocation: [{ dimension: 'ads', amount_aud: 100, percentage: 100 }],
    ...extra,
  }
}

function rx(over: Row): Row {
  return {
    id: 'rx', client_id: CLIENT, goal_id: GOAL, status: 'draft', version: 1,
    agent_name: '开方人甲', content: content(), created_at: '2026-10-01T00:00:00.000Z', ...over,
  }
}

beforeEach(() => {
  db.tables = {
    goals: [{ id: GOAL, client_id: CLIENT, budget_currency: 'nzd' }],
    prescriptions: [],
  }
  db.errors = {}
  db.usedIn = false
})

describe('loadLatestGoalPrescription', () => {
  it('版本最大的赢，草稿压过更旧的已批准；人工动作只数手工的', async () => {
    db.tables.prescriptions = [
      rx({ id: 'old', status: 'approved', version: 1, agent_name: '旧的', created_at: '2026-10-02T00:00:00.000Z' }),
      rx({ id: 'new', status: 'draft', version: 2, created_at: '2026-10-03T00:00:00.000Z' }),
      rx({ id: 'other-goal', goal_id: 'goal-9', status: 'draft', version: 9 }),
      rx({ id: 'other-client', client_id: 'client-9', status: 'draft', version: 9 }),
    ]
    const view = await loadLatestGoalPrescription(CLIENT, GOAL)
    expect(view).toMatchObject({
      id: 'new',
      goal_id: GOAL,
      status: 'draft',
      status_label: '草稿',
      version: 2,
      prescriber: '开方人甲',
      summary: '摘要甲',
      manual_action_count: 2,
      line: '处方 v2 · 草稿 · 2 条人工动作',
      currency: 'NZD',
    })
    expect(view?.phases[0]?.actions.filter(item => item.manual).map(item => item.title)).toEqual(['动作一', '动作二'])
    expect(view?.kpis[1]).toMatchObject({ metric: '成本', current_value: null, target_value: 12, unit: 'NZD', timeframe: '本周期' })
    expect(db.usedIn).toBe(false)
  })

  it('最新一版即使是已拒绝也返回，不跳过', async () => {
    db.tables.prescriptions = [
      rx({ id: 'draft', status: 'draft', version: 2 }),
      rx({ id: 'no', status: 'rejected', version: 4, created_at: '2026-10-04T00:00:00.000Z' }),
    ]
    const view = await loadLatestGoalPrescription(CLIENT, GOAL)
    expect(view?.id).toBe('no')
    expect(view?.status_label).toBe('已拒绝')
    expect(view?.line).toBe('处方 v4 · 已拒绝 · 2 条人工动作')
  })

  it('同版本取写入时间更晚的', async () => {
    db.tables.prescriptions = [
      rx({ id: 'early', version: 3, created_at: '2026-10-01T00:00:00.000Z' }),
      rx({ id: 'late', version: 3, status: 'superseded', created_at: '2026-10-05T00:00:00.000Z' }),
    ]
    const view = await loadLatestGoalPrescription(CLIENT, GOAL)
    expect(view?.id).toBe('late')
    expect(view?.status_label).toBe('已被替代')
  })

  it('没有这一行返回 null；目标编号是空的也不查', async () => {
    expect(await loadLatestGoalPrescription(CLIENT, GOAL)).toBeNull()
    expect(await loadLatestGoalPrescription(CLIENT, '  ')).toBeNull()
  })

  it('读处方失败抛错，不当成没有', async () => {
    db.errors.prescriptions = 'boom'
    db.tables.prescriptions = [rx({ id: 'rx-1' })]
    await expect(loadLatestGoalPrescription(CLIENT, GOAL)).rejects.toThrow('读处方失败：boom')
  })

  it('指标单位不是币种、目标也没写币种时，不拿金额字段凑一个币种', async () => {
    db.tables.goals = [{ id: GOAL, client_id: CLIENT, budget_currency: null }]
    db.tables.prescriptions = [rx({
      id: 'rx-1',
      content: content({
        kpi_targets: [{ metric: '线索', current_value: 0, target_value: 3, unit: '条', dimension: 'ads' }],
      }),
    })]
    const view = await loadLatestGoalPrescription(CLIENT, GOAL)
    expect(view?.currency).toBeNull()
    expect(JSON.stringify(view)).not.toMatch(/AUD/)
  })

  it('指标没有币种时用目标上的币种', async () => {
    db.tables.goals = [{ id: GOAL, client_id: CLIENT, budget_currency: 'nzd' }]
    db.tables.prescriptions = [rx({
      id: 'rx-1',
      agent_name: '  ',
      content: { summary: '', phases: [], kpi_targets: [{ metric: '线索', current_value: 0, target_value: 1, unit: '条' }] },
    })]
    const view = await loadLatestGoalPrescription(CLIENT, GOAL)
    expect(view?.currency).toBe('NZD')
    expect(view?.prescriber).toBeNull()
    expect(view?.line).toBe('处方 v1 · 草稿 · 0 条人工动作')
  })

  it('只有 module=manual 也算人工执行', async () => {
    db.tables.prescriptions = [rx({
      id: 'rx-1',
      content: content({
        phases: [{ phase_number: 1, name: '准备', duration_weeks: 1, actions: [action('a', '只标模块', 'third_party', 'manual')] }],
        kpi_targets: [],
      }),
    })]
    const view = await loadLatestGoalPrescription(CLIENT, GOAL)
    expect(view?.manual_action_count).toBe(1)
    expect(view?.phases[0]?.actions[0]?.manual).toBe(true)
  })
})
