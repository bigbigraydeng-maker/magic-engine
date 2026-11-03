import { beforeEach, describe, expect, it, vi } from 'vitest'

const startCronRunId = vi.fn(async (_jobName: string) => 'run-1')
const finish = vi.fn(async (_opts: Record<string, unknown>) => {})
vi.mock('@/lib/cron/run-logger', () => ({
  startCronRunId: (j: string) => startCronRunId(j),
  cronRunHandle: () => ({ finish }),
  startCronRun: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

import { cloudFunctions } from '../functions'
import { CLOUD_FN_PREFIX } from '../client'
import { BAOZHENG_WEEKLY_CRON, BAOZHENG_WEEKLY_TZ, createBaozhengWeeklyFunction } from '../functions/baozheng-weekly'
import { CRON_REGISTRY } from '@/lib/cron/registry'

beforeEach(() => {
  finish.mockClear()
  startCronRunId.mockClear()
})

interface FnInternals {
  opts: { triggers?: { cron?: string }[]; retries?: number; concurrency?: { limit: number } }
  fn: (a: { step: unknown }) => Promise<unknown>
}
/** Inngest keeps triggers / options / handler on the function object (same reading as the libai test). */
function internals(fn: unknown): FnInternals {
  return fn as FnInternals
}
function fakeStep() {
  const ids: string[] = []
  return { ids, step: { run: async (id: string, fn: () => Promise<unknown>) => { ids.push(id); return await fn() } } }
}

describe('registration', () => {
  it('is in cloudFunctions with the cloud- prefix, Wednesday NZ, no retries, one at a time', () => {
    const fn = cloudFunctions.find((f) => f.id() === `${CLOUD_FN_PREFIX}baozheng-weekly`)
    expect(fn).toBeDefined()
    const opts = internals(fn).opts
    expect(opts.triggers?.[0]?.cron).toBe(`TZ=${BAOZHENG_WEEKLY_TZ} ${BAOZHENG_WEEKLY_CRON}`)
    expect(opts.retries).toBe(0)
    expect(opts.concurrency).toEqual({ limit: 1 })
    const dow = BAOZHENG_WEEKLY_CRON.split(' ')[4]
    expect(['5', '6']).not.toContain(dow)
  })

  it('registry entry uses the same schedule', () => {
    const entry = CRON_REGISTRY.find((e) => e.jobName === 'baozheng-weekly')
    expect(entry?.schedule).toBe(BAOZHENG_WEEKLY_CRON)
    expect(entry?.logsRuns).toBe(true)
  })
})

describe('switch off', () => {
  it('writes a skipped run log and never calls the model', async () => {
    const llm = vi.fn()
    const fn = createBaozhengWeeklyFunction({
      db: {} as never,
      llm,
      loadTranscript: vi.fn(),
      now: () => new Date('2026-11-04T21:00:00Z'),
      env: () => ({}),
    })
    const h = fakeStep()
    const receipt = (await internals(fn).fn({ step: h.step })) as { status: string }
    expect(receipt.status).toBe('skipped_disabled')
    expect(llm).not.toHaveBeenCalled()
    expect(h.ids).not.toContain('list-clients')
    const summary = (finish.mock.calls[0]?.[0] as { summary: { skipped: boolean; reasons: string[] } }).summary
    expect(summary.skipped).toBe(true)
    expect(summary.reasons).toEqual(['总开关没开'])
  })
})
