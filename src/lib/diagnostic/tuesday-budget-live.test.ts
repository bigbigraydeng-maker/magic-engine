/**
 * Tuesday live reads fail closed when the snapshot table is not there.
 * They do not call Meta and they do not throw.
 */
import { describe, expect, it } from 'vitest'
import { createCapabilities } from '@/lib/capabilities'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import { CLIENT_A, makeFixture } from '@/lib/kernel/__tests__/fixtures'
import { loadTuesdayUnit } from './tuesday-budget-live'

describe('周二督导读现预算', () => {
  it('快照表不在时返回原因，不抛', async () => {
    const f = makeFixture({
      registry: ACTION_REGISTRY,
      capabilities: (sb) => createCapabilities(sb),
      startAt: '2026-11-02T00:00:00.000Z',
    })
    const read = await loadTuesdayUnit(
      f.kernel.supabase,
      CLIENT_A,
      '111',
      'decrease',
      'p1110000-0000-4000-8000-000000000001',
      new Date('2026-11-02T00:00:00.000Z'),
    )
    expect(read).toEqual({ error: '日预算读不到，没有按 0 出卡。' })
  })
})
