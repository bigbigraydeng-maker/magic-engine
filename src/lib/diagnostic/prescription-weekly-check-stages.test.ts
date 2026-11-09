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

const NORMAL = {
  ...BASE,
  initiatives: [{
    id: 'i1',
    goal_id: 'g1',
    client_id: 'c1',
    initiative_type: 'demand_generation',
    is_archived: false,
    campaign_ids: [],
    title: '春季获客',
  }],
}

describe('周二复查：阶段读不到 ≠ 没有阶段', () => {
  it('阶段那张表读出错时，标成数据读不到，不算成功或失败，也不写成 0 条阶段', async () => {
    const summary = await runPrescriptionWeeklyCheck(fakeDb(BASE, { initiatives: 'connection reset' }))
    expect(summary.checked).toBe(0)
    expect(summary.outcomes).toHaveLength(1)
    const row = summary.outcomes[0]
    expect(row.result).toBe('unreadable')
    expect(row.progress).toContain('数据读不到')
    expect(row.progress).not.toContain('0 条阶段')
    expect(row.suggestion).not.toContain('目标下还没有阶段')
    expect(row.detail).toContain('数据读不到')
  })

  it('阶段那张表读成功、确实一条都没有时，照实写 0 条阶段', async () => {
    const summary = await runPrescriptionWeeklyCheck(fakeDb(BASE))
    const checked = summary.outcomes.find((row) => row.result === 'checked')
    expect(summary.checked).toBe(1)
    expect(checked?.progress).toContain('目标下现在有 0 条阶段。')
    expect(checked?.progress).not.toContain('数据读不到')
    expect(checked?.suggestion).toContain('目标下还没有阶段')
  })

  it('阶段读成功且确实有阶段时，照实写条数', async () => {
    const summary = await runPrescriptionWeeklyCheck(fakeDb(NORMAL))
    const checked = summary.outcomes.find((row) => row.result === 'checked')
    expect(summary.checked).toBe(1)
    expect(checked?.result).toBe('checked')
    expect(checked?.progress).toContain('目标下现在有 1 条阶段。')
    expect(checked?.progress).not.toContain('数据读不到')
  })

  it('目标表读出错时，挂了目标的标成数据读不到，没挂目标的仍复查', async () => {
    const tables = {
      ...BASE,
      prescriptions: [
        ...BASE.prescriptions,
        { id: 'p2', client_id: 'c1', goal_id: null, status: 'approved', approved_at: '2026-10-21T00:00:00Z' },
      ],
    }
    const summary = await runPrescriptionWeeklyCheck(fakeDb(tables, { goals: 'timeout' }))
    const linked = summary.outcomes.find((row) => row.prescriptionId === 'p1')
    const loose = summary.outcomes.find((row) => row.prescriptionId === 'p2')
    expect(linked?.result).toBe('unreadable')
    expect(linked?.progress).toContain('数据读不到')
    expect(linked?.progress).not.toContain('0 条阶段')
    expect(loose?.result).toBe('checked')
    expect(summary.checked).toBe(1)
  })

  it('待办表读出错时，不写成看板上没有待办，整轮也不抛掉', async () => {
    const summary = await runPrescriptionWeeklyCheck(fakeDb(BASE, { execution_items: 'timeout' }))
    expect(summary.checked).toBe(0)
    expect(summary.outcomes[0].result).toBe('unreadable')
    expect(summary.outcomes[0].progress).toContain('数据读不到')
    expect(summary.outcomes[0].progress).not.toContain('看板上没有挂着')
  })

  it('广告草稿表读出错时，不写成没有草稿', async () => {
    const tables = {
      ...BASE,
      execution_items: [{ id: 'card-1', prescription_id: 'p1', client_id: 'c1', status: 'pending' }],
    }
    const summary = await runPrescriptionWeeklyCheck(fakeDb(tables, { flywheel_actions: 'timeout' }))
    expect(summary.outcomes[0].result).toBe('unreadable')
    expect(summary.outcomes[0].progress).toContain('数据读不到')
    expect(summary.outcomes[0].progress).not.toContain('没有挂到这份方案待办上的广告草稿')
  })

  it('内容工单表读出错时，不写成 0 张工单', async () => {
    const summary = await runPrescriptionWeeklyCheck(fakeDb(BASE, { content_work_orders: 'timeout' }))
    expect(summary.outcomes[0].result).toBe('unreadable')
    expect(summary.outcomes[0].progress).not.toContain('内容工单：在做 0')
    expect(summary.outcomes[0].progress).toContain('数据读不到')
  })

  it('客户名单读出错时，不写成查不到这个客户', async () => {
    const summary = await runPrescriptionWeeklyCheck(fakeDb(BASE, { clients: 'down' }))
    expect(summary.checked).toBe(0)
    expect(summary.outcomes[0].result).toBe('unreadable')
    expect(summary.outcomes[0].progress).toContain('数据读不到')
    expect(summary.outcomes[0].detail).not.toContain('查不到这个客户')
  })

  it('已批准方案那张表读出错时，不当成一份都没有', async () => {
    await expect(runPrescriptionWeeklyCheck(fakeDb(BASE, { prescriptions: 'down' }))).rejects.toThrow(/已批准方案读取失败/)
  })
})
