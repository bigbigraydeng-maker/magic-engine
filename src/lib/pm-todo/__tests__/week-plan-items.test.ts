import { describe, expect, it } from 'vitest'

import { weekPlanSubject } from '@/lib/social/weekly-plan/approval'
import { targetWeek } from '@/lib/social/week-pack/cadence'

import { buildWeekPlanApprovalTodoItems } from '../week-plan-items'

const CLIENT = '11111111-1111-4111-8111-111111111111'
const NOW = new Date('2026-11-05T00:00:00.000Z')
const WEEK = targetWeek(NOW)

describe('week plan approval todos', () => {
  it('surfaces one 本周包等你批 item for the target week', () => {
    const items = buildWeekPlanApprovalTodoItems(
      [{ clientId: CLIENT, subjectKey: weekPlanSubject(CLIENT, WEEK.weekStart), runId: 'r1' }],
      () => '示例客户',
      NOW,
    )
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'week_plan_needs_approval',
      client_id: CLIENT,
      what: '本周包等你批',
    })
    expect(items[0].href).toContain('/daily-plan?tab=overview')
  })

  it('ignores pending cards for another week', () => {
    const items = buildWeekPlanApprovalTodoItems(
      [{ clientId: CLIENT, subjectKey: weekPlanSubject(CLIENT, '2020-01-06'), runId: 'r1' }],
      () => '示例客户',
      NOW,
    )
    expect(items).toEqual([])
  })
})
