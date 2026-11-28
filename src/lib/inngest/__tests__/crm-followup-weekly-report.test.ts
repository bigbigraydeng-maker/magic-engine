/** Weekly follow-up report: Inngest wiring, the recipient gate and the run. Content is tested in `crm/followup-progress/__tests__`. */
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
  createFollowupWeeklyReportFunction,
  runFollowupWeeklyReport,
  weeklyReportPaused,
  weekKey,
  PAUSED_REASON,
  WEEKLY_REPORT_CRON,
  WEEKLY_REPORT_JOB,
  WEEKLY_REPORT_RECIPIENTS,
  WEEKLY_REPORT_TZ,
  type WeeklyReportDeps,
  type WeeklyReportStep,
} from '../functions/crm-followup-weekly-report'
import { cloudFunctions } from '../functions'
import { CLOUD_FN_PREFIX } from '../client'
import { CRON_REGISTRY } from '@/lib/cron/registry'
import { emptyCounts } from '@/lib/crm/followup-progress/groups'
import type { FollowupProgressDetail } from '@/lib/crm/followup-progress/load'
import type { SupabaseClient } from '@supabase/supabase-js'

type Fn = ReturnType<typeof createFollowupWeeklyReportFunction>
function optsOf(fn: Fn) {
  return (fn as Fn & { opts: { id?: string; triggers?: { cron?: string }[]; onFailure?: (ctx: { event: { ts?: number; data: unknown }; error: Error }) => Promise<void> } }).opts
}

function fakeStep() {
  const ids: string[] = []
  const step: WeeklyReportStep = {
    run: async <T,>(id: string, fn: () => Promise<T>): Promise<T> => {
      ids.push(id)
      return JSON.parse(JSON.stringify(await fn())) as T
    },
  }
  return { ids, step }
}

const CTS = 'c0000000-0000-0000-0000-000000000000'
const NOW = new Date('2026-11-29T19:00:00Z') // Monday 30 Nov 08:00 NZDT

function detail(): FollowupProgressDetail {
  const counts = emptyCounts()
  counts.total = 3
  counts.inScope = 3
  counts.groups.new_lead = 2
  counts.groups.awaiting_reply = 1
  return {
    clientId: CTS, at: NOW.toISOString(), counts,
    week: { guestsContactedByStaff: 3, guestsWhoReplied: 2, newEnquiries: 5, movedToQualified: 1, newBookings: 0, takenByAi: 0 },
    verdicts: new Map([['g1', { inScope: true, group: 'new_lead' }], ['g2', { inScope: true, group: 'new_lead' }], ['g3', { inScope: true, group: 'awaiting_reply' }]]),
    dates: new Map([['g1', { lastEnquiryAt: '2026-11-27T00:00:00Z', lastGuestMessageAt: null, lastStaffAt: null }], ['g2', { lastEnquiryAt: '2026-11-28T00:00:00Z', lastGuestMessageAt: null, lastStaffAt: null }], ['g3', { lastEnquiryAt: null, lastGuestMessageAt: '2026-11-26T00:00:00Z', lastStaffAt: null }]]),
  }
}

const send = vi.fn(async (p: { recipients: string[]; idempotencyKey?: string }) => ({ sent: true, recipients: p.recipients, messageId: 'msg-1' }))

function deps(over: Partial<WeeklyReportDeps> = {}): WeeklyReportDeps {
  return {
    supabase: {} as SupabaseClient,
    loadClientName: vi.fn(async () => 'CTS Tours'),
    loadProgress: vi.fn(async () => detail()),
    loadHistory: vi.fn(async () => []),
    loadNames: vi.fn(async () => new Map<string, string | null>([['g1', 'Secret Guest One'], ['g2', 'Secret Guest Two'], ['g3', 'Secret Guest Three']])),
    countAiReady: vi.fn(async () => 216),
    send: send as unknown as WeeklyReportDeps['send'],
    env: {},
    ...over,
  }
}

beforeEach(() => {
  startCronRunId.mockClear()
  finish.mockClear()
  failOpenCronRuns.mockClear()
  send.mockClear()
})

describe('the recipient gate', () => {
  it('the report goes to exactly the two mailboxes the PM named, for one client', () => {
    expect(WEEKLY_REPORT_RECIPIENTS).toEqual({ [CTS]: ['hello@magicengine.cloud', 'info@ctstours.co.nz'] })
    expect(Object.isFrozen(WEEKLY_REPORT_RECIPIENTS)).toBe(true)
    expect(Object.isFrozen(WEEKLY_REPORT_RECIPIENTS[CTS])).toBe(true)
  })

  it('the brake is the literal string true only', () => {
    expect(weeklyReportPaused({ FOLLOWUP_WEEKLY_REPORT_PAUSED: 'true' })).toBe(true)
    expect(weeklyReportPaused({ FOLLOWUP_WEEKLY_REPORT_PAUSED: '1' })).toBe(false)
    expect(weeklyReportPaused({})).toBe(false)
  })
})

describe('wiring', () => {
  it('runs on Monday morning in the client time zone and is registered', () => {
    const fn = createFollowupWeeklyReportFunction(deps())
    expect(optsOf(fn).triggers?.[0]?.cron).toBe(`TZ=${WEEKLY_REPORT_TZ} ${WEEKLY_REPORT_CRON}`)
    expect(WEEKLY_REPORT_CRON).toBe('0 8 * * 1')
    expect(cloudFunctions.some((f) => optsOf(f as Fn).id === `${CLOUD_FN_PREFIX}${WEEKLY_REPORT_JOB}`)).toBe(true)
    const row = CRON_REGISTRY.find((r) => r.jobName === WEEKLY_REPORT_JOB)
    expect(row).toMatchObject({ schedule: WEEKLY_REPORT_CRON, scheduler: 'inngest', logsRuns: true })
  })

  it('closes a run left open when retries run out', async () => {
    await optsOf(createFollowupWeeklyReportFunction(deps())).onFailure?.({ event: { ts: 1_800_000_000_000, data: {} }, error: new Error('boom') })
    expect(failOpenCronRuns).toHaveBeenCalledWith(WEEKLY_REPORT_JOB, expect.stringContaining('boom'), { startedBefore: new Date(1_800_000_000_000) })
  })
})

describe('the run', () => {
  it('reads, sends one email to the table recipients with a per-week key, and keeps a receipt without any guest', async () => {
    const { ids, step } = fakeStep()
    const receipt = await runFollowupWeeklyReport(step, deps(), NOW)
    expect(ids).toEqual(['log-start', `read-${CTS}`, `send-${CTS}`, 'log-finish'])
    expect(send).toHaveBeenCalledTimes(1)
    const call = send.mock.calls[0][0]
    expect(call.recipients).toEqual(['hello@magicengine.cloud', 'info@ctstours.co.nz'])
    expect(call.idempotencyKey).toBe(`${WEEKLY_REPORT_JOB}:${CTS}:week-of-2026-11-30`)
    expect(receipt.results[0]).toMatchObject({ client_id: CTS, client_name: 'CTS Tours', in_scope: 3, new_leads: 2, awaiting_reply: 1, ai_ready: 216, sent: true, no_publish: false, provider_message_id: 'msg-1', recipients: ['hello@magicengine.cloud', 'info@ctstours.co.nz'] })
    expect(JSON.stringify(receipt)).not.toContain('Secret Guest')
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ processed: 1, completed: 1, failed: 0 }))
  })

  it('paused: reads and receipts, sends nothing, and it is not a failure', async () => {
    const { ids, step } = fakeStep()
    const receipt = await runFollowupWeeklyReport(step, deps({ env: { FOLLOWUP_WEEKLY_REPORT_PAUSED: 'true' } }), NOW)
    expect(send).not.toHaveBeenCalled()
    expect(ids).not.toContain(`send-${CTS}`)
    expect(receipt.results[0]).toMatchObject({ sent: false, no_publish: true, reason: PAUSED_REASON, new_leads: 2 })
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ completed: 0, failed: 0 }))
  })

  it('a failed read sends nothing and counts as failed', async () => {
    const { step } = fakeStep()
    const receipt = await runFollowupWeeklyReport(step, deps({ loadProgress: vi.fn(async () => { throw new Error('read broke') }) }), NOW)
    expect(send).not.toHaveBeenCalled()
    expect(receipt.results[0]).toMatchObject({ sent: false, no_publish: true, reason: 'read broke' })
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ failed: 1 }))
  })

  it('a send that did not go out throws inside its step (so it is retried), then is recorded as failed with the reason', async () => {
    let attempts = 0
    const step: WeeklyReportStep = { run: async <T,>(_id: string, fn: () => Promise<T>): Promise<T> => JSON.parse(JSON.stringify(await fn())) as T }
    const refuse = vi.fn(async (p: { recipients: string[] }) => { attempts += 1; return { sent: false, reason: 'mail service down', recipients: p.recipients } })
    const receipt = await runFollowupWeeklyReport(step, deps({ send: refuse as unknown as WeeklyReportDeps['send'] }), NOW)
    expect(attempts).toBe(1)
    expect(receipt.results[0]).toMatchObject({ sent: false, no_publish: true, reason: 'mail service down', new_leads: 2 })
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ completed: 0, failed: 1 }))
  })

  it('one key per client per week: the same on every day of the week, new the next Monday', () => {
    const k = (iso: string) => weekKey(CTS, new Date(iso))
    expect(k('2026-11-29T19:00:00Z')).toBe(k('2026-12-03T05:00:00Z')) // Mon 30 Nov 08:00 and Thu 3 Dec 18:00 NZDT
    expect(k('2026-11-29T10:00:00Z')).toContain('week-of-2026-11-23') // still Sunday 29 Nov 23:00 NZDT
    expect(k('2026-12-06T19:00:00Z')).toContain('week-of-2026-12-07')
  })

  it('the AI count failing to read does not lose the report: it is left out', async () => {
    const { step } = fakeStep()
    const receipt = await runFollowupWeeklyReport(step, deps({ countAiReady: vi.fn(async () => { throw new Error('nope') }) }), NOW)
    expect(receipt.results[0]).toMatchObject({ sent: true, ai_ready: null })
  })
})
