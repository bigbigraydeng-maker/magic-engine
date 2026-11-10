import { describe, expect, it } from 'vitest'
import { executionBoardStats } from '../execution-page-stats'
import type { ItemWithLogs } from '../execution-view-model'

function item(partial: Partial<ItemWithLogs> & Pick<ItemWithLogs, 'id' | 'status'>): ItemWithLogs {
  return {
    logs: [],
    source_kind: 'prescription',
    prescription_id: 'rx',
    ...partial,
  } as ItemWithLogs
}

describe('executionBoardStats', () => {
  it('counts done, open, stuck, and automated', () => {
    const stats = executionBoardStats([
      item({ id: '1', status: 'completed' }),
      item({ id: '2', status: 'pending', content_state: { priority: 'stale' } as ItemWithLogs['content_state'] }),
      item({ id: '3', status: 'in_progress', source_kind: 'flywheel_action', prescription_id: '__autonomous__' }),
    ])
    expect(stats.done).toBe(1)
    expect(stats.open).toBe(2)
    expect(stats.stuck).toBe(1)
    expect(stats.automated).toBe(1)
  })
})
