import { describe, expect, it, vi } from 'vitest'
import {
  READBACK_WEEKLY_CRON, READBACK_WEEKLY_EVENT, READBACK_WEEKLY_FUNCTION_ID, READBACK_WEEKLY_JOB, createReadbackWeeklyFunction, type ReadbackWeeklyDeps,
} from '../cloud-social-readback-weekly'
import { CLOUD_FN_PREFIX } from '../../client'
import { CRON_REGISTRY } from '@/lib/cron/registry'
import type { ReelReadbackItem } from '@/lib/social/reel-readback/report'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

type Fn = ReturnType<typeof createReadbackWeeklyFunction>
const opts = (fn: Fn) => Reflect.get(fn, 'opts') as { id?: string; triggers?: { cron?: string; event?: string }[]; retries?: number; concurrency?: { limit?: number } }
const handler = (fn: Fn) => Reflect.get(fn, 'fn') as (a: { event: unknown; step: unknown }) => Promise<{ status: string; as_of: string; clients: Array<{ client_id: string; error: string | null; counts: { measured: number }; suggestion: { status: string } | null }>; failures: string[]; no_publish: boolean; trigger: string }>
const step = () => ({ run: vi.fn(async (_id: string, fn: () => Promise<unknown> | unknown) => fn()) })

const item = (i: number, value: number): ReelReadbackItem => ({
  action_id: `a${i}`, work_order_id: `w${i}`, title: `t${i}`, template: 'postcard', pillar: null, permalink: null, published_at: '2026-11-10T00:00:00Z', status: 'measured', note: null,
  likes: { kind: 'value', value }, comments: { kind: 'value', value: 0 }, shares: { kind: 'value', value: 0 }, engagement: { kind: 'value', value },
})

function deps(over: Partial<ReadbackWeeklyDeps> = {}): ReadbackWeeklyDeps {
  return {
    now: () => new Date('2026-11-08T18:10:00Z'),
    listClients: vi.fn(async () => [{ id: 'c1', config: {} }, { id: 'c2', config: {} }]),
    load: vi.fn(async () => ({ items: [item(1, 5), item(2, 6)], unmatched: 0 })),
    startRun: vi.fn(async () => 'run-1'),
    finishRun: vi.fn(async () => undefined),
    ...over,
  }
}

describe('social readback weekly function', () => {
  it('is registered: weekly Monday cron + event, never retries, one at a time, in the cron registry', () => {
    const o = opts(createReadbackWeeklyFunction(deps()))
    expect(o.id).toBe(`${CLOUD_FN_PREFIX}social-readback-weekly`)
    expect(o.id).toBe(READBACK_WEEKLY_FUNCTION_ID)
    expect(o.triggers?.[0]?.cron).toBe(READBACK_WEEKLY_CRON)
    expect(o.triggers?.[1]?.event).toBe(READBACK_WEEKLY_EVENT)
    expect(o.retries).toBe(0)
    expect(o.concurrency?.limit).toBe(1)
    expect(CRON_REGISTRY.find((e) => e.jobName === READBACK_WEEKLY_JOB)).toMatchObject({ scheduler: 'inngest', logsRuns: true, schedule: '10 6 * * 1' })
  })

  it('cron reads every client, writes one receipt row, too few reels = no advice, never publishes', async () => {
    const d = deps()
    const out = await handler(createReadbackWeeklyFunction(d))({ event: { name: 'inngest/scheduled.timer', data: {} }, step: step() })
    expect(out).toMatchObject({ status: 'done', as_of: '2026-11-09', no_publish: true, failures: [], trigger: 'cron' })
    expect(out.clients.map((c) => [c.client_id, c.counts.measured, c.suggestion?.status])).toEqual([['c1', 2, 'not_enough_data'], ['c2', 2, 'not_enough_data']])
    expect(d.finishRun).toHaveBeenCalledTimes(1)
  })

  it('one client failing to read is reported and does not stop the others', async () => {
    const d = deps({ load: vi.fn(async (id: string) => { if (id === 'c1') throw new Error('db down'); return { items: [], unmatched: 0 } }) })
    const out = await handler(createReadbackWeeklyFunction(d))({ event: { name: 'inngest/scheduled.timer', data: {} }, step: step() })
    expect(out.clients[0]).toMatchObject({ client_id: 'c1', error: 'db down', suggestion: null })
    expect(out.failures).toEqual(['c1:db down'])
    expect(vi.mocked(d.finishRun).mock.calls[0][0]).toMatchObject({ failed: 1, completed: 1 })
  })

  it('an unreadable client list is a failure, not a silent empty run', async () => {
    const d = deps({ listClients: vi.fn(async () => { throw new Error('clients down') }) })
    const out = await handler(createReadbackWeeklyFunction(d))({ event: { name: 'inngest/scheduled.timer', data: {} }, step: step() })
    expect(out.status).toBe('list_failed')
    expect(out.failures[0]).toContain('clients down')
  })

  it('a manual event reads just that client', async () => {
    const d = deps()
    const out = await handler(createReadbackWeeklyFunction(d))({ event: { name: READBACK_WEEKLY_EVENT, data: { clientId: 'c9', asOf: '2026-11-12' } }, step: step() })
    expect(out).toMatchObject({ trigger: 'event', as_of: '2026-11-12' })
    expect(out.clients.map((c) => c.client_id)).toEqual(['c9'])
    expect(d.listClients).not.toHaveBeenCalled()
  })
})
