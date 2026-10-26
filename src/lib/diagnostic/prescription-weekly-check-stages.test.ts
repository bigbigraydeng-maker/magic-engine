/**
 * Weekly check end-to-end with the real execution-summary reader:
 * a failed initiatives read must surface as "stages could not be read",
 * never as "this approved prescription has 0 stages".
 */
import { describe, expect, it } from 'vitest'
import { runPrescriptionWeeklyCheck } from './prescription-weekly-check'

type Row = Record<string, unknown>

function fakeDb(tables: Record<string, Row[]>, errors: Record<string, string> = {}) {
  const from = (table: string) => {
    const filters: Record<string, unknown> = {}
    const api: Record<string, unknown> = {}
    const self = () => api
    api.eq = (key: string, value: unknown) => { filters[key] = value; return api }
    api.in = (key: string, value: unknown) => { filters[key] = value; return api }
    api.order = self
    api.limit = self
    api.then = (resolve: (value: { data: Row[] | null; error: { message: string } | null }) => unknown) => {
      if (errors[table]) return resolve({ data: null, error: { message: errors[table] } })
      const rows = (tables[table] ?? []).filter((row) => Object.entries(filters).every(([key, value]) =>
        Array.isArray(value) ? value.map(String).includes(String(row[key])) : row[key] === value))
      return resolve({ data: rows, error: null })
    }
    return { select: () => api }
  }
  return { from } as never
}

const BASE: Record<string, Row[]> = {
  prescriptions: [
    { id: 'p1', client_id: 'c1', goal_id: 'g1', status: 'approved', approved_at: '2026-10-20T00:00:00Z' },
  ],
  clients: [{ id: 'c1', name: '北岛旅行', client_status: 'active', industry: 'travel' }],
  goals: [{
    id: 'g1', title: '春季咨询', primary_metric_label: '新增咨询',
    baseline_value: 8, current_value: 12, target_value: 30,
    target_direction: 'increase', current_value_fetched_at: '2026-10-20T00:00:00.000Z',
  }],
  initiatives: [],
}

describe('周二复查：阶段读不到 ≠ 没有阶段', () => {
  it('阶段那张表读出错时，人话写「没读出来」，不写成 0 条阶段，也不建议去补阶段', async () => {
    const summary = await runPrescriptionWeeklyCheck(fakeDb(BASE, { initiatives: 'connection reset' }))
    const checked = summary.outcomes.find((row) => row.result === 'checked')
    expect(checked?.progress).toContain('目标下的阶段这周没读出来，不把没读到当成没有。')
    expect(checked?.progress).not.toContain('0 条阶段')
    expect(checked?.suggestion).not.toContain('目标下还没有阶段')
  })

  it('阶段那张表读成功、确实一条都没有时，照实写 0 条阶段', async () => {
    const summary = await runPrescriptionWeeklyCheck(fakeDb(BASE))
    const checked = summary.outcomes.find((row) => row.result === 'checked')
    expect(checked?.progress).toContain('目标下现在有 0 条阶段。')
    expect(checked?.progress).not.toContain('没读出来，不把没读到当成没有')
    expect(checked?.suggestion).toContain('目标下还没有阶段')
  })
})
