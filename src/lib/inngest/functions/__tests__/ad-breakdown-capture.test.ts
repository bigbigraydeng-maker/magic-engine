/**
 * The daily ad breakdown capture function: wiring and run-log behaviour. The capture's own
 * rules are covered in `ads-strategy/breakdown-stats/__tests__/`; here the capture is a stub
 * so only scheduling, retries, the receipt event and the run log are on trial.
 * (`.opts` / `.fn` bridging is the same one the other function tests use.)
 */
import { describe, expect, it, vi } from 'vitest'
import {
  AD_BREAKDOWN_CRON,
  AD_BREAKDOWN_FUNCTION_ID,
  createAdBreakdownCaptureFunction,
  runProblem,
} from '../ad-breakdown-capture'
import { CLOUD_FN_PREFIX } from '../../client'
import { CRON_REGISTRY } from '@/lib/cron/registry'
import { AD_BREAKDOWN_JOB } from '@/lib/ads-strategy/breakdown-stats/run'
import type { AccountCaptureReceipt, CaptureReceipt } from '@/lib/ads-strategy/breakdown-stats/types'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/workflows/inngest-event', () => ({ sendInngestEvent: vi.fn() }))

type Fn = ReturnType<typeof createAdBreakdownCaptureFunction>
const optsOf = (fn: Fn) =>
  (fn as unknown as {
    opts: { id?: string; triggers?: { cron?: string }[]; retries?: number; concurrency?: { limit?: number } }
  }).opts
const handlerOf = (fn: Fn) => (fn as unknown as { fn: (args: unknown) => Promise<unknown> }).fn
const fakeStep = () => ({ run: vi.fn(async (_id: string, fn: () => Promise<unknown> | unknown) => fn()) })

function makeAccount(overrides: Partial<AccountCaptureReceipt> = {}): AccountCaptureReceipt {
  return {
    client_id: 'client-1',
    ad_account_id: 'act_1',
    status: 'ok',
    since: '2026-10-21',
    until: '2026-10-28',
    backfill: false,
    rows_by_key: { hour_account_tz: 3 },
    rows_skipped: 0,
    rows_merged: 0,
    reconciliation_failures: [],
    error: null,
    ...overrides,
  }
}

function makeReceipt(overrides: Partial<CaptureReceipt> = {}): CaptureReceipt {
  return {
    request_id: 'req-1',
    mode: 'dry',
    started_at: '2026-10-21T06:30:00.000Z',
    finished_at: '2026-10-21T06:30:01.000Z',
    clients_requested: 1,
    accounts_checked: 2,
    accounts: [makeAccount(), makeAccount({ ad_account_id: 'act_2' })],
    cost: 0,
    no_publish: true,
    problems: [],
    ...overrides,
  }
}

function build(run: () => Promise<CaptureReceipt>) {
  const startRun = vi.fn(async () => 'run-1')
  const finishRun = vi.fn(
    async (_input: { runId: string; startedAt: number; receipt?: CaptureReceipt; error?: string; emitError?: string }) => undefined,
  )
  const emit = vi.fn(async (_receipt: CaptureReceipt) => undefined)
  const fn = createAdBreakdownCaptureFunction({ run, startRun, finishRun, emit })
  return { fn, startRun, finishRun, emit }
}

describe('ad-breakdown-capture function', () => {
  it('🔴 is scheduled daily at 06:30 in New Zealand time, never retries, never overlaps', () => {
    const { fn } = build(async () => makeReceipt())
    const opts = optsOf(fn)
    expect(opts.id).toBe(`${CLOUD_FN_PREFIX}ad-breakdown-capture`)
    expect(opts.triggers?.[0]?.cron).toBe(AD_BREAKDOWN_CRON)
    expect(AD_BREAKDOWN_CRON).toBe('TZ=Pacific/Auckland 30 6 * * *')
    expect(opts.retries).toBe(0)
    expect(opts.concurrency?.limit).toBe(1)
  })

  it('🔴 cron 登记表里有它：由 Inngest 调度、写运行记录，周期跟上面的常量是同一个（去掉 TZ 前缀）——没登记 = 它哪天安静地不跑时没人喊', () => {
    const entry = CRON_REGISTRY.find(e => e.jobName === AD_BREAKDOWN_JOB)
    expect(entry).toMatchObject({
      scheduler: 'inngest',
      logsRuns: true,
      service: `inngest:${AD_BREAKDOWN_FUNCTION_ID}`,
    })
    expect(entry?.schedule).toBe(AD_BREAKDOWN_CRON.replace(/^TZ=\S+\s+/, ''))
    expect(entry?.schedule).toBe('30 6 * * *')
  })

  it('runs the capture inside steps, emits the receipt, and closes the run log with it', async () => {
    const receipt = makeReceipt()
    const { fn, startRun, finishRun, emit } = build(async () => receipt)
    const step = fakeStep()
    const out = await handlerOf(fn)({ step })

    expect(startRun).toHaveBeenCalledTimes(1)
    expect(step.run.mock.calls.map(c => c[0])).toEqual(['start-run', 'capture', 'emit-receipt', 'finish-run'])
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit.mock.calls[0][0]).toBe(receipt)
    expect(finishRun).toHaveBeenCalledTimes(1)
    expect(finishRun.mock.calls[0][0]).toMatchObject({ runId: 'run-1', receipt })
    expect(out).toEqual({ mode: 'dry', accounts_checked: 2 })
  })

  it('🔴 a failing capture closes the run log with the error FIRST, emits nothing, then fails the run loudly', async () => {
    const { fn, finishRun, emit } = build(async () => {
      throw new Error('boom')
    })
    await expect(handlerOf(fn)({ step: fakeStep() })).rejects.toThrow('ad-breakdown-capture failed: boom')
    expect(emit).not.toHaveBeenCalled()
    expect(finishRun).toHaveBeenCalledTimes(1)
    expect(finishRun.mock.calls[0][0]).toMatchObject({ runId: 'run-1', error: 'boom' })
    expect(finishRun.mock.calls[0][0].receipt).toBeUndefined()
  })

  it('🔴 a failing receipt emit still closes the run log (no run stuck at "running"), flagged as emit failure', async () => {
    const { fn, finishRun, emit } = build(async () => makeReceipt())
    emit.mockRejectedValueOnce(new Error('inngest down'))
    await handlerOf(fn)({ step: fakeStep() })
    expect(finishRun).toHaveBeenCalledTimes(1)
    expect(finishRun.mock.calls[0][0].emitError).toContain('EMIT_FAILED')
  })

  it('🔴 runProblem: all-failed, live with failures, config problems and emit errors all turn the run red; a healthy run does not', () => {
    expect(runProblem(makeReceipt(), 2, 0)).toBeNull()
    expect(runProblem(makeReceipt({ accounts_checked: 2 }), 0, 2)).toContain('所有被检查的账户都读失败')
    expect(runProblem(makeReceipt({ mode: 'live' }), 1, 1)).toContain('live 模式')
    expect(runProblem(makeReceipt({ mode: 'dry' }), 1, 1)).toBeNull()
    expect(runProblem(makeReceipt({ problems: ['cfg bad'] }), 2, 0)).toContain('cfg bad')
    expect(runProblem(makeReceipt(), 2, 0, 'EMIT_FAILED: x')).toContain('EMIT_FAILED')
    // Review fix: a partial account (incomplete read or spend not reconciled) turns the run red in dry mode too.
    expect(runProblem(makeReceipt({ accounts: [makeAccount({ status: 'partial' })] }), 0, 1)).toContain('对账')
  })

  it('🔴 is registered in cloudFunctions — an unregistered function never runs and nobody notices', async () => {
    const { cloudFunctions } = await import('../index')
    const { adBreakdownCapture } = await import('../ad-breakdown-capture')
    expect(cloudFunctions).toContain(adBreakdownCapture)
  })
})
