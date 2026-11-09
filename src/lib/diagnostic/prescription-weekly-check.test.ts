import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSummary = vi.fn()

vi.mock('@/lib/strategy/initiatives', () => ({
  getExecutionSummaryForGoal: (...args: unknown[]) => mockSummary(...args),
}))

import { runPrescriptionWeeklyCheck } from './prescription-weekly-check'

interface Row { id?: string; status?: string; [key: string]: unknown }

function fakeDb(tables: Record<string, Row[]>) {
  const writes: string[] = []
  const from = (table: string) => {
    const filters: Record<string, unknown> = {}
    const api: Record<string, unknown> = {}
    const self = () => api
    api.select = self
    api.eq = (key: string, value: unknown) => { filters[key] = value; return api }
    api.in = (key: string, value: unknown) => { filters[key] = value; return api }
    api.order = self
    api.limit = self
    api.gte = self
    api.then = (resolve: (value: { data: Row[]; error: null }) => unknown) => {
      let rows = tables[table] ?? []
      if (typeof filters.status === 'string') {
        rows = rows.filter((row) => row.status === filters.status)
      }
      const ids = filters.id ?? filters.prescription_id ?? filters.goal_id ?? filters.execution_item_id
      if (Array.isArray(ids)) {
        const allowed = new Set(ids)
        const column = filters.id ? 'id'
          : filters.prescription_id ? 'prescription_id'
            : filters.goal_id ? 'goal_id'
              : 'execution_item_id'
        rows = rows.filter((row) => allowed.has(String(row[column] ?? '')))
      }
      return resolve({ data: rows, error: null })
    }
    return {
      select: () => api,
      update: () => { writes.push(`update ${table}`); throw new Error(`不应写 ${table}`) },
      insert: () => { writes.push(`insert ${table}`); throw new Error(`不应写 ${table}`) },
      upsert: () => { writes.push(`upsert ${table}`); throw new Error(`不应写 ${table}`) },
      delete: () => { writes.push(`delete ${table}`); throw new Error(`不应写 ${table}`) },
    }
  }
  return { supabase: { from } as never, writes }
}

const SUMMARY = {
  goalId: 'g1',
  initiativeCount: 2,
  totalCampaigns: 1,
  totalActions: 3,
  totalCompleted: 1,
  totalInProgress: 0,
  totalPending: 2,
  totalSkipped: 0,
  aggregateCompletionPct: 33,
  perInitiative: [],
}

beforeEach(() => {
  mockSummary.mockReset()
  mockSummary.mockResolvedValue(SUMMARY)
})

describe('runPrescriptionWeeklyCheck', () => {
  it('只复查最新的已批准方案，不写库，也不把没挂上的广告算进来', async () => {
    const { supabase, writes } = fakeDb({
      prescriptions: [
        { id: 'old', client_id: 'c1', goal_id: 'g1', status: 'approved', approved_at: '2026-10-01T00:00:00Z' },
        { id: 'new', client_id: 'c1', goal_id: 'g1', status: 'approved', approved_at: '2026-10-20T00:00:00Z' },
        { id: 'draft', client_id: 'c1', goal_id: 'g1', status: 'draft', approved_at: null },
        { id: 'demo', client_id: 'c2', goal_id: 'g2', status: 'approved', approved_at: '2026-10-20T00:00:00Z' },
      ],
      clients: [
        { id: 'c1', name: '北岛旅行', client_status: 'active', industry: 'travel' },
        { id: 'c2', name: '演示账号', client_status: 'prospect', industry: 'travel' },
      ],
      goals: [{
        id: 'g1', title: '春季咨询', primary_metric_label: '新增咨询',
        baseline_value: 8, current_value: '12', target_value: 30,
        target_direction: 'increase', current_value_fetched_at: '2026-10-20T00:00:00.000Z',
      }],
      execution_items: [
        { id: 'card-new', prescription_id: 'new', client_id: 'c1', status: 'completed' },
        { id: 'card-old', prescription_id: 'old', client_id: 'c1', status: 'pending' },
      ],
      content_work_orders: [
        { id: 'w1', client_id: 'c1', goal_id: 'g1', status: 'failed' },
        { id: 'w2', client_id: 'c1', goal_id: 'g9', status: 'published' },
      ],
      flywheel_actions: [
        { execution_item_id: 'card-new', client_id: 'c1', action_type: 'ads.create_ad', payload: { status: 'awaiting_approval' } },
        { execution_item_id: 'somewhere-else', client_id: 'c1', action_type: 'ads.create_ad', payload: { status: 'active' } },
      ],
      prescription_outcomes: [],
    })

    const summary = await runPrescriptionWeeklyCheck(supabase)

    expect(writes).toEqual([])
    expect(mockSummary).toHaveBeenCalledTimes(1)
    expect(mockSummary).toHaveBeenCalledWith(supabase, 'g1')
    expect(summary.checked).toBe(1)
    const checked = summary.outcomes.find((row) => row.result === 'checked')
    const skipped = summary.outcomes.find((row) => row.result === 'skipped')
    expect(checked?.prescriptionId).toBe('new')
    expect(checked?.clientName).toBe('北岛旅行')
    expect(checked?.progress).toContain('春季咨询')
    expect(checked?.progress).toContain('已完成 1 件')
    expect(checked?.progress).toContain('卡住 1 张')
    expect(checked?.progress).toContain('等你点头 1 条')
    expect(checked?.progress).not.toContain('已在投 1')
    expect(checked?.progress).not.toContain('一个可执行动作都没排出来')
    expect(checked?.suggestion).toContain('不会自己打开')
    expect(checked?.suggestion).toContain('不会自动重做')
    expect(skipped?.clientId).toBe('c2')
    expect(skipped?.detail).toContain('不是进行中的付费客户')
  })

  it('一份方案的阶段读不到时标成数据读不到，另一份照常复查', async () => {
    const summary = await runTwoGoals((goalId) => (goalId === 'g1' ? null : { ...SUMMARY, goalId }))
    expect(summary.checked).toBe(1)
    const blocked = summary.outcomes.find((row) => row.prescriptionId === 'p1')
    const kept = summary.outcomes.find((row) => row.prescriptionId === 'p2')
    expect(blocked?.result).toBe('unreadable')
    expect(blocked?.progress).toContain('数据读不到')
    expect(blocked?.progress).not.toContain('0 条阶段')
    expect(blocked?.suggestion).not.toContain('目标下还没有阶段')
    expect(kept?.result).toBe('checked')
    expect(kept?.progress).toContain('目标下现在有 2 条阶段')
  })

  it('一份方案的阶段读取抛错时，不中断另一份', async () => {
    const summary = await runTwoGoals((goalId) => {
      if (goalId === 'g1') throw new Error('connection reset')
      return { ...SUMMARY, goalId }
    })
    expect(summary.checked).toBe(1)
    expect(summary.outcomes.find((row) => row.prescriptionId === 'p1')?.result).toBe('unreadable')
    expect(summary.outcomes.find((row) => row.prescriptionId === 'p2')?.result).toBe('checked')
  })
})

function goalRow(id: string, title: string) {
  return {
    id,
    title,
    primary_metric_label: '新增咨询',
    baseline_value: 8,
    current_value: 12,
    target_value: 30,
    target_direction: 'increase',
    current_value_fetched_at: '2026-10-20T00:00:00.000Z',
  }
}

async function runTwoGoals(summaryFor: (goalId: string) => unknown) {
  mockSummary.mockImplementation(async (_client: unknown, goalId: string) => summaryFor(goalId))
  const { supabase } = fakeDb({
    prescriptions: [
      { id: 'p1', client_id: 'c1', goal_id: 'g1', status: 'approved', approved_at: '2026-10-20T00:00:00Z' },
      { id: 'p2', client_id: 'c2', goal_id: 'g2', status: 'approved', approved_at: '2026-10-20T00:00:00Z' },
    ],
    clients: [
      { id: 'c1', name: '甲客户', client_status: 'active', industry: 'travel' },
      { id: 'c2', name: '乙客户', client_status: 'active', industry: 'travel' },
    ],
    goals: [goalRow('g1', '目标甲'), goalRow('g2', '目标乙')],
    execution_items: [],
    content_work_orders: [],
    flywheel_actions: [],
    prescription_outcomes: [],
  })
  return runPrescriptionWeeklyCheck(supabase)
}

describe('周二任务不再开方或批准', () => {
  it('定时入口和复查模块都不调用生成或批准', () => {
    const route = readFileSync(resolve(__dirname, '../../app/api/cron/prescription-weekly/route.ts'), 'utf8')
    const check = readFileSync(resolve(__dirname, './prescription-weekly-check.ts'), 'utf8')
    const old = readFileSync(resolve(__dirname, './auto-prescribe.ts'), 'utf8')
    for (const src of [route, check, old]) {
      expect(src).not.toMatch(/import[^;]*landPrescription/)
      expect(src).not.toMatch(/landPrescription\s*\(/)
      expect(src).not.toMatch(/import[^;]*generatePrescription/)
      expect(src).not.toMatch(/generatePrescription\s*\(/)
      expect(src).not.toMatch(/runAutoPrescribe\s*\(/)
    }
    expect(route).toContain('runPrescriptionWeeklyCheck')
  })
})
