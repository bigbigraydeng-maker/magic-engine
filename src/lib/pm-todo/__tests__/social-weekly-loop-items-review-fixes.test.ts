import { describe, it, expect } from 'vitest'
import type { WeeklyLoopManualTask } from '@/lib/social/weekly-loop/run'
import { buildWeeklyLoopTodoItems, readDeliveredTasks } from '../social-weekly-loop-items'

type Code = WeeklyLoopManualTask['code']

function task(code: Code): WeeklyLoopManualTask {
  return { code, what: `what ${code}`, how: 'how', href: 'https://app.example.test/x' }
}

function row(startedAt: string, summary: unknown): { started_at: string; summary: unknown } {
  return { started_at: startedAt, summary }
}

const nameOf = (id: string): string => `name-${id}`

describe('weekly loop to-do review fixes', () => {
  it('🔴 a newer failed write receipt replaces the older tasks with run_incomplete', () => {
    const items = buildWeeklyLoopTodoItems(
      [
        row('2025-01-03T00:00:00Z', {
          kind: 'client_run',
          client_id: 'c1',
          mode: 'write',
          status: 'failed',
          error: 'db down',
        }),
        row('2025-01-02T00:00:00Z', {
          kind: 'client_run',
          client_id: 'c1',
          mode: 'write',
          manual_tasks_delivered: true,
          manual_tasks: [task('zero_eligible')],
        }),
      ],
      nameOf,
    )
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('本周排期没跑完整')
    expect(items[0].what).toContain('db down')
    expect(items.some(i => i.what === 'what zero_eligible')).toBe(false)
    expect(items[0].href).toContain('/dashboard/clients/c1/content-factory')
  })

  it('a failed receipt that already carries run_incomplete is not duplicated', () => {
    const items = buildWeeklyLoopTodoItems(
      [
        row('2025-01-03T00:00:00Z', {
          kind: 'client_run',
          client_id: 'c1',
          mode: 'write',
          status: 'failed',
          error: 'x',
          manual_tasks_delivered: true,
          manual_tasks: [task('run_incomplete')],
        }),
      ],
      nameOf,
    )
    expect(items).toHaveLength(1)
    expect(items[0].what).toBe('what run_incomplete')
  })

  it('a failed dry_run receipt is ignored', () => {
    const got = readDeliveredTasks({
      kind: 'client_run',
      client_id: 'c1',
      mode: 'dry_run',
      status: 'failed',
      error: 'x',
    })
    expect(got).toBeNull()
  })

  it('run_incomplete is a known task code', () => {
    const got = readDeliveredTasks({
      kind: 'client_run',
      client_id: 'c1',
      mode: 'write',
      status: 'completed',
      manual_tasks_delivered: true,
      manual_tasks: [task('run_incomplete')],
    })
    expect(got?.tasks.map(t => t.code)).toEqual(['run_incomplete'])
  })

  it('failed receipt without error text still yields the task', () => {
    const got = readDeliveredTasks({
      kind: 'client_run',
      client_id: 'c1',
      mode: 'write',
      status: 'failed',
    })
    expect(got?.tasks).toHaveLength(1)
    expect(got?.tasks[0].code).toBe('run_incomplete')
    expect(got?.tasks[0].what).toContain('failed')
  })
})
