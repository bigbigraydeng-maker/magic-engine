import { describe, it, expect } from 'vitest'
import type { ManualItem } from '../manual-item-types'
import type { WeeklyLoopManualTask } from '@/lib/social/weekly-loop/run'
import {
  WEEKLY_LOOP_TODO_KIND,
  buildWeeklyLoopTodoItems,
  pushWeeklyLoopItems,
  readDeliveredTasks,
  type WeeklyLoopRunRow,
} from '../social-weekly-loop-items'

type Code = WeeklyLoopManualTask['code']

function task(code: Code): WeeklyLoopManualTask {
  return { code, what: `what ${code}`, how: 'how', href: 'https://app.example.test/x' }
}

function receipt(
  clientId: string,
  mode: 'dry_run' | 'write',
  tasks: WeeklyLoopManualTask[],
  delivered: boolean = mode === 'write',
): Record<string, unknown> {
  return {
    kind: 'client_run',
    client_id: clientId,
    mode,
    manual_tasks_delivered: delivered,
    manual_tasks: tasks,
  }
}

function row(startedAt: string, summary: unknown): WeeklyLoopRunRow {
  return { started_at: startedAt, summary }
}

const nameOf = (id: string): string => `name-${id}`

describe('readDeliveredTasks', () => {
  it('reads a write-mode delivered receipt', () => {
    const got = readDeliveredTasks(receipt('c1', 'write', [task('zero_eligible')]))
    expect(got).not.toBeNull()
    expect(got?.clientId).toBe('c1')
    expect(got?.tasks).toHaveLength(1)
  })

  it('rejects dry_run and undelivered receipts', () => {
    expect(readDeliveredTasks(receipt('c1', 'dry_run', [task('zero_eligible')]))).toBeNull()
    expect(readDeliveredTasks(receipt('c1', 'write', [task('zero_eligible')], false))).toBeNull()
  })

  it('ignores null and fan_out summaries', () => {
    expect(readDeliveredTasks(null)).toBeNull()
    expect(readDeliveredTasks({ kind: 'fan_out', status: 'disabled' })).toBeNull()
  })
})

describe('buildWeeklyLoopTodoItems', () => {
  it('turns two tasks into two items', () => {
    const items = buildWeeklyLoopTodoItems(
      [row('2025-01-02T00:00:00Z', receipt('c1', 'write', [task('zero_eligible'), task('all_filtered')]))],
      nameOf,
    )
    expect(items).toHaveLength(2)
    for (const item of items) {
      expect(item.kind).toBe(WEEKLY_LOOP_TODO_KIND)
      expect(item.client_id).toBe('c1')
      expect(item.client_name).toBe('name-c1')
      expect(item.how).toBe('how')
      expect(item.href).toBe('https://app.example.test/x')
    }
    expect(items[0].what).toBe('what zero_eligible')
    expect(items[1].what).toBe('what all_filtered')
  })

  it('🔴 skips dry_run and undelivered receipts', () => {
    const dry = buildWeeklyLoopTodoItems(
      [row('2025-01-02T00:00:00Z', receipt('c1', 'dry_run', [task('zero_eligible')]))],
      nameOf,
    )
    expect(dry).toHaveLength(0)
    const undelivered = buildWeeklyLoopTodoItems(
      [row('2025-01-02T00:00:00Z', receipt('c1', 'write', [task('zero_eligible')], false))],
      nameOf,
    )
    expect(undelivered).toHaveLength(0)
  })

  it('only the newest write receipt per client counts', () => {
    const newerEmpty = buildWeeklyLoopTodoItems(
      [
        row('2025-01-03T00:00:00Z', receipt('c1', 'write', [])),
        row('2025-01-02T00:00:00Z', receipt('c1', 'write', [task('zero_eligible')])),
      ],
      nameOf,
    )
    expect(newerEmpty).toHaveLength(0)

    const dryThenWrite = buildWeeklyLoopTodoItems(
      [
        row('2025-01-03T00:00:00Z', receipt('c1', 'dry_run', [task('zero_eligible')])),
        row('2025-01-02T00:00:00Z', receipt('c1', 'write', [task('all_filtered')])),
      ],
      nameOf,
    )
    expect(dryThenWrite).toHaveLength(1)
    expect(dryThenWrite[0].what).toBe('what all_filtered')
  })

  it('handles two clients independently', () => {
    const items = buildWeeklyLoopTodoItems(
      [
        row('2025-01-03T00:00:00Z', receipt('c1', 'write', [task('zero_eligible')])),
        row('2025-01-03T00:00:00Z', receipt('c2', 'write', [task('all_filtered')])),
      ],
      nameOf,
    )
    expect(items).toHaveLength(2)
    const ids = items.map(i => i.client_id).sort()
    expect(ids).toEqual(['c1', 'c2'])
  })

  it('drops malformed tasks and ignores junk summaries', () => {
    const malformed = [
      { code: 'zero_eligible', what: 'w', how: 'h' }, // missing href
      { code: 'not_a_code', what: 'w', how: 'h', href: 'https://x' }, // unknown code
      task('all_filtered'),
    ]
    const items = buildWeeklyLoopTodoItems(
      [
        row('2025-01-03T00:00:00Z', receipt('c1', 'write', malformed as unknown as WeeklyLoopManualTask[])),
        row('2025-01-02T00:00:00Z', null),
        row('2025-01-01T00:00:00Z', { kind: 'fan_out', status: 'disabled' }),
      ],
      nameOf,
    )
    expect(items).toHaveLength(1)
    expect(items[0].what).toBe('what all_filtered')
  })
})

interface FakeChain {
  from: (table: string) => FakeChain
  select: (cols: string) => FakeChain
  eq: (col: string, val: string) => FakeChain
  gte: (col: string, val: string) => FakeChain
  order: (col: string, opts: { ascending: boolean }) => FakeChain
  limit: (n: number) => Promise<{ data: unknown; error: { message: string } | null }>
}

function fakeSupabase(
  result: { data: unknown; error: { message: string } | null },
  calls: Array<{ method: string; args: unknown[] }>,
): FakeChain {
  const chain: FakeChain = {
    from: (...args) => {
      calls.push({ method: 'from', args })
      return chain
    },
    select: (...args) => {
      calls.push({ method: 'select', args })
      return chain
    },
    eq: (...args) => {
      calls.push({ method: 'eq', args })
      return chain
    },
    gte: (...args) => {
      calls.push({ method: 'gte', args })
      return chain
    },
    order: (...args) => {
      calls.push({ method: 'order', args })
      return chain
    },
    limit: (...args) => {
      calls.push({ method: 'limit', args })
      return Promise.resolve(result)
    },
  }
  return chain
}

describe('pushWeeklyLoopItems', () => {
  it('pushes items from the newest write receipt', async () => {
    const calls: Array<{ method: string; args: unknown[] }> = []
    const fake = fakeSupabase(
      {
        data: [row('2025-01-03T00:00:00Z', receipt('c1', 'write', [task('zero_eligible')]))],
        error: null,
      },
      calls,
    )
    const items: ManualItem[] = []
    await pushWeeklyLoopItems(fake as never, items, nameOf, new Date('2025-01-04T00:00:00Z'))
    expect(items).toHaveLength(1)
    expect(items[0].client_id).toBe('c1')
    const eqCall = calls.find(c => c.method === 'eq')
    expect(eqCall?.args).toEqual(['job_name', 'social-weekly-draft'])
  })

  it('pushes one infra item when the query errors', async () => {
    const calls: Array<{ method: string; args: unknown[] }> = []
    const fake = fakeSupabase({ data: null, error: { message: 'boom' } }, calls)
    const items: ManualItem[] = []
    await pushWeeklyLoopItems(fake as never, items, nameOf, new Date('2025-01-04T00:00:00Z'))
    expect(items).toHaveLength(1)
    expect(items[0].client_id).toBe('infra')
  })
})
