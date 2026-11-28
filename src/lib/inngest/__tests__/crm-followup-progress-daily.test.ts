/** Daily follow-up progress snapshot: Inngest wiring and the run. Grouping rules are tested in `crm/followup-progress/__tests__`. */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const startCronRunId = vi.fn<(job: string) => Promise<string>>(async () => 'run-1')
const finish = vi.fn<(opts: Record<string, unknown>) => Promise<void>>(async () => {})
const failOpenCronRuns = vi.fn<(job: string, msg: string, opts: unknown) => Promise<number>>(async () => 1)
vi.mock('@/lib/cron/run-logger', () => ({
  startCronRunId: (job: string) => startCronRunId(job),
  cronRunHandle: () => ({ finish: (o: Record<string, unknown>) => finish(o) }),
  startCronRun: vi.fn(),
  failOpenCronRuns: (job: string, msg: string, opts: unknown) => failOpenCronRuns(job, msg, opts),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

import {
  createFollowupProgressDailyFunction,
  runFollowupProgressDaily,
  FOLLOWUP_PROGRESS_CRON,
  FOLLOWUP_PROGRESS_JOB,
  FOLLOWUP_PROGRESS_TZ,
  type FollowupProgressDeps,
  type FollowupProgressStep,
} from '../functions/crm-followup-progress-daily'
import { cloudFunctions } from '../functions'
import { CLOUD_FN_PREFIX } from '../client'
import { CRON_REGISTRY } from '@/lib/cron/registry'
import { emptyCounts } from '@/lib/crm/followup-progress/groups'
import type { FollowupProgressDetail, WeekActivity } from '@/lib/crm/followup-progress/load'
import type { SupabaseClient } from '@supabase/supabase-js'

type Fn = ReturnType<typeof createFollowupProgressDailyFunction>
function optsOf(fn: Fn) {
  return (fn as Fn & { opts: { id?: string; triggers?: { cron?: string }[]; retries?: number; onFailure?: (ctx: { event: { ts?: number; data: unknown }; error: Error }) => Promise<void> } }).opts
}

function fakeStep() {
  const ids: string[] = []
  const step: FollowupProgressStep = {
    run: async <T,>(id: string, fn: () => Promise<T>): Promise<T> => {
      ids.push(id)
      return JSON.parse(JSON.stringify(await fn())) as T
    },
  }
  return { ids, step }
}

const NOW = new Date('2026-11-27T17:30:00Z')
const WEEK: WeekActivity = { guestsContactedByStaff: 3, guestsWhoReplied: 2, newEnquiries: 5, movedToQualified: 1, newBookings: 0, takenByAi: 4 }

function detail(clientId: string, cold: number): FollowupProgressDetail {
  const counts = emptyCounts()
  counts.total = cold
  counts.inScope = cold
  counts.groups.cold = cold
  return { clientId, at: NOW.toISOString(), counts, week: WEEK, verdicts: new Map([['guest-1', { inScope: true, group: 'cold' }]]) }
}

function deps(over: Partial<FollowupProgressDeps> = {}): FollowupProgressDeps {
  return {
    supabase: {} as SupabaseClient,
    loadClients: vi.fn(async () => [{ id: 'a', name: 'A' }, { id: 'b', name: null }]),
    loadProgress: vi.fn(async (_sb: SupabaseClient, clientId: string) => detail(clientId, clientId === 'a' ? 7 : 2)),
    ...over,
  }
}

beforeEach(() => {
  startCronRunId.mockClear()
  finish.mockClear()
  failOpenCronRuns.mockClear()
})

describe('wiring', () => {
  it('runs every morning in the client time zone and is registered', () => {
    const fn = createFollowupProgressDailyFunction(deps())
    expect(optsOf(fn).id).toBe(`${CLOUD_FN_PREFIX}${FOLLOWUP_PROGRESS_JOB}`)
    expect(optsOf(fn).triggers?.[0]?.cron).toBe(`TZ=${FOLLOWUP_PROGRESS_TZ} ${FOLLOWUP_PROGRESS_CRON}`)
    expect(cloudFunctions.some((f) => optsOf(f as Fn).id === `${CLOUD_FN_PREFIX}${FOLLOWUP_PROGRESS_JOB}`)).toBe(true)
    const row = CRON_REGISTRY.find((r) => r.jobName === FOLLOWUP_PROGRESS_JOB)
    expect(row?.schedule).toBe(FOLLOWUP_PROGRESS_CRON)
    expect(row?.scheduler).toBe('inngest')
    expect(row?.logsRuns).toBe(true)
  })

  it('closes a run left open when retries run out', async () => {
    const fn = createFollowupProgressDailyFunction(deps())
    await optsOf(fn).onFailure?.({ event: { ts: 1_800_000_000_000, data: {} }, error: new Error('boom') })
    expect(failOpenCronRuns).toHaveBeenCalledWith(FOLLOWUP_PROGRESS_JOB, expect.stringContaining('boom'), { startedBefore: new Date(1_800_000_000_000) })
  })
})

describe('the run', () => {
  it('keeps counts for every client, one step each, and sends nothing', async () => {
    const { ids, step } = fakeStep()
    const receipt = await runFollowupProgressDaily(step, deps(), NOW)
    expect(ids).toEqual(['log-start', 'load-clients', 'snapshot-a', 'snapshot-b', 'log-finish'])
    expect(receipt.clients_scanned).toBe(2)
    expect(receipt.clients_ok).toBe(2)
    expect(receipt.results.map((r) => r.counts?.groups.cold)).toEqual([7, 2])
    expect(receipt.results.every((r) => r.no_publish === true)).toBe(true)
    expect(receipt.results[0].week).toEqual(WEEK)
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ processed: 2, completed: 2, failed: 0 }))
  })

  it('the receipt holds no guest: no ids, names, emails or phones', async () => {
    const { step } = fakeStep()
    const receipt = await runFollowupProgressDaily(step, deps(), NOW)
    const text = JSON.stringify(receipt)
    expect(text).not.toContain('guest-1')
    expect(text).not.toContain('verdicts')
  })

  it('one client failing to read does not lose the other, and counts as failed', async () => {
    const { step } = fakeStep()
    const d = deps({ loadProgress: vi.fn(async (_sb: SupabaseClient, clientId: string) => { if (clientId === 'a') throw new Error('read broke'); return detail(clientId, 2) }) })
    const receipt = await runFollowupProgressDaily(step, d, NOW)
    expect(receipt.results[0]).toMatchObject({ client_id: 'a', ok: false, reason: 'read broke', no_publish: true })
    expect(receipt.results[0].counts).toBeUndefined()
    expect(receipt.results[1].ok).toBe(true)
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ processed: 2, completed: 1, failed: 1 }))
  })

  it('a failed client list closes the run as failed and throws so Inngest retries', async () => {
    const { step } = fakeStep()
    const d = deps({ loadClients: vi.fn(async () => { throw new Error('no clients') }) })
    await expect(runFollowupProgressDaily(step, d, NOW)).rejects.toThrow('no clients')
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('no clients') }))
  })
})
