import { describe, expect, it, vi } from 'vitest'
import { cronRunIdFromInngestRun } from '@/lib/cron/run-logger'
import type { SweepReceipt, SweepStatus } from '@/lib/messaging/triggered-send/types'
import {
  TRIGGERED_SEND_DISPATCH_ID,
  TRIGGERED_SEND_DISPATCH_JOB,
  TRIGGERED_SEND_SWEEP_CRON,
  TRIGGERED_SEND_RETRY_CRON,
  TRIGGERED_SEND_SWEEP_ID,
  TRIGGERED_SEND_SWEEP_JOB,
  handleTriggeredSendFailure,
  runDispatch,
  runSweepOrder,
  sweepFinishOpts,
  triggeredSendWelcomeDispatch,
  triggeredSendWelcomeSweep,
  type DispatchDeps,
  type StepTools,
  type SweepRunDeps,
} from '../triggered-send-welcome-sweep'

const CLIENT_A = '11111111-2222-3333-4444-555555555555'
const CLIENT_B = '66666666-7777-8888-9999-aaaaaaaaaaaa'
const RUN_ID = 'run_abc123'
const NOW = new Date('2026-11-02T19:15:00Z') // 08:15 Pacific/Auckland (UTC+13)

interface FakeStep extends StepTools {
  readonly ids: string[]
  readonly sent: Array<{ id: string; events: unknown[] }>
}

function fakeStep(): FakeStep {
  const ids: string[] = []
  const sent: Array<{ id: string; events: unknown[] }> = []
  return {
    ids,
    sent,
    run: async <T>(id: string, fn: () => Promise<T>): Promise<T> => {
      ids.push(id)
      return fn()
    },
    sendEvent: async (id, events) => {
      sent.push({ id, events })
      return null
    },
  }
}

function dispatchDeps(overrides: Partial<DispatchDeps> = {}): {
  deps: DispatchDeps
  startRun: ReturnType<typeof vi.fn>
  finishRun: ReturnType<typeof vi.fn>
} {
  const startRun = vi.fn(async () => undefined)
  const finishRun = vi.fn(async () => undefined)
  const deps: DispatchDeps = {
    startRun,
    finishRun,
    listClients: async () => ({ ok: true, clientIds: [CLIENT_A, CLIENT_B] }),
    now: () => NOW,
    ...overrides,
  }
  return { deps, startRun, finishRun }
}

function receipt(overrides: Partial<SweepReceipt> = {}): SweepReceipt {
  return {
    status: 'swept',
    client_id: CLIENT_A,
    dry_run: false,
    authorization_id: 'auth-1',
    to_decide: 5,
    ignored: 1,
    decided: 4,
    deferred: 1,
    inserted: 4,
    would_send: 2,
    skipped_by_reason: { stale: 2 },
    deferred_by_reason: { dnc_unverifiable: 1 },
    legacy_batches: [],
    no_send: true,
    provider_impact: 'NONE',
    error: null,
    created_at: '2026-11-02T19:15:00.000Z',
    ...overrides,
  }
}

describe('triggered-send-welcome-sweep constants', () => {
  it('uses the cloud prefix and the documented cron', () => {
    expect(TRIGGERED_SEND_DISPATCH_ID.startsWith('cloud-')).toBe(true)
    expect(TRIGGERED_SEND_SWEEP_ID.startsWith('cloud-')).toBe(true)
    expect(TRIGGERED_SEND_SWEEP_CRON).toBe('15 8 * * *')
    expect(TRIGGERED_SEND_RETRY_CRON).toBe('15 10 * * *')
  })

  it('exports both Inngest functions', () => {
    expect(triggeredSendWelcomeDispatch).toBeDefined()
    expect(triggeredSendWelcomeSweep).toBeDefined()
  })
})

describe('runDispatch', () => {
  it('sends one event per client and finishes the run log', async () => {
    const step = fakeStep()
    const { deps, startRun, finishRun } = dispatchDeps()
    const result = await runDispatch(step, deps, RUN_ID)

    expect(result.status).toBe('dispatched')
    expect(result.events_sent).toBe(2)
    expect(result.clients).toBe(2)
    expect(result.no_send).toBe(true)
    expect(result.slot).toBe('2026-11-03T08')
    expect(result.job).toBe(TRIGGERED_SEND_DISPATCH_JOB)

    expect(step.sent).toHaveLength(1)
    expect(step.sent[0].id).toBe('dispatch-sweeps')
    const events = step.sent[0].events as Array<{ id: string }>
    expect(events.map((e) => e.id)).toEqual([
      `triggered_send_sweep:${CLIENT_A}:2026-11-03T08`,
      `triggered_send_sweep:${CLIENT_B}:2026-11-03T08`,
    ])

    const runLogId = cronRunIdFromInngestRun(RUN_ID)
    expect(startRun).toHaveBeenCalledTimes(1)
    expect(startRun).toHaveBeenCalledWith(runLogId)
    expect(finishRun).toHaveBeenCalledTimes(1)
    const [finishId, , opts] = finishRun.mock.calls[0] as [string, number, Record<string, unknown>]
    expect(finishId).toBe(runLogId)
    expect(opts.processed).toBe(2)
    expect(opts.completed).toBe(2)
    expect(opts.failed).toBe(0)
  })

  it('does nothing when there are no clients', async () => {
    const step = fakeStep()
    const { deps, finishRun } = dispatchDeps({ listClients: async () => ({ ok: true, clientIds: [] }) })
    const result = await runDispatch(step, deps, RUN_ID)

    expect(result.status).toBe('nothing_to_do')
    expect(result.events_sent).toBe(0)
    expect(step.sent).toHaveLength(0)
    expect(finishRun).toHaveBeenCalledTimes(1)
    const [, , opts] = finishRun.mock.calls[0] as [string, number, Record<string, unknown>]
    expect(opts.failed).toBe(0)
  })

  it('records a list failure', async () => {
    const step = fakeStep()
    const { deps, finishRun } = dispatchDeps({
      listClients: async () => ({ ok: false, error: 'db down' }),
    })
    const result = await runDispatch(step, deps, RUN_ID)

    expect(result.status).toBe('list_failed')
    expect(result.events_sent).toBe(0)
    expect(result.error).toContain('db down')
    expect(step.sent).toHaveLength(0)
    expect(finishRun).toHaveBeenCalledTimes(1)
    const [, , opts] = finishRun.mock.calls[0] as [string, number, Record<string, unknown>]
    expect(opts.failed).toBe(1)
    expect(String(opts.error)).toContain('db down')
  })
})

describe('runSweepOrder', () => {
  function sweepDeps(sweep: SweepRunDeps['sweep']): {
    deps: SweepRunDeps
    startRun: ReturnType<typeof vi.fn>
    finishRun: ReturnType<typeof vi.fn>
  } {
    const startRun = vi.fn(async () => undefined)
    const finishRun = vi.fn(async () => undefined)
    return {
      deps: { startRun, finishRun, sweep, now: () => NOW },
      startRun,
      finishRun,
    }
  }

  it('returns invalid_payload without any step or log', async () => {
    const step = fakeStep()
    const sweep = vi.fn(async () => receipt())
    const { deps, startRun, finishRun } = sweepDeps(sweep)
    const result = await runSweepOrder(step, deps, { client_id: 'nope' }, RUN_ID)

    expect(result).toEqual({ status: 'invalid_payload', reason: expect.any(String) })
    expect(step.ids).toHaveLength(0)
    expect(startRun).not.toHaveBeenCalled()
    expect(finishRun).not.toHaveBeenCalled()
    expect(sweep).not.toHaveBeenCalled()
  })

  it('defaults a manual payload without dry_run to dryRun true', async () => {
    const step = fakeStep()
    const sweep = vi.fn(async () => receipt())
    const { deps } = sweepDeps(sweep)
    await runSweepOrder(step, deps, { client_id: CLIENT_A, trigger_key: 'welcome' }, RUN_ID)
    expect(sweep).toHaveBeenCalledWith({ clientId: CLIENT_A, dryRun: true })
  })

  it('honours an explicit dry_run false', async () => {
    const step = fakeStep()
    const sweep = vi.fn(async () => receipt())
    const { deps } = sweepDeps(sweep)
    await runSweepOrder(step, deps, { client_id: CLIENT_A, trigger_key: 'welcome', dry_run: false }, RUN_ID)
    expect(sweep).toHaveBeenCalledWith({ clientId: CLIENT_A, dryRun: false })
  })

  it('returns the receipt and finishes the run log with sweepFinishOpts', async () => {
    const step = fakeStep()
    const r = receipt()
    const sweep = vi.fn(async () => r)
    const { deps, startRun, finishRun } = sweepDeps(sweep)
    const result = await runSweepOrder(step, deps, { client_id: CLIENT_A, trigger_key: 'welcome', dry_run: false }, RUN_ID)

    expect(result).


toBe(r)
    const runLogId = cronRunIdFromInngestRun(RUN_ID)
    expect(startRun).toHaveBeenCalledWith(runLogId)
    expect(finishRun).toHaveBeenCalledTimes(1)
    const [finishId, , opts] = finishRun.mock.calls[0] as [string, number, Record<string, unknown>]
    expect(finishId).toBe(runLogId)
    expect(opts).toEqual(sweepFinishOpts(r))
  })
})

describe('sweepFinishOpts', () => {
  it('treats swept as a normal completion', () => {
    const opts = sweepFinishOpts(receipt({ status: 'swept', deferred: 2, to_decide: 5, decided: 3 }))
    expect(opts.processed).toBe(5)
    expect(opts.completed).toBe(3)
    expect(opts.failed).toBe(2)
    expect(opts.error).toBeUndefined()
    expect(opts.summary).toEqual(receipt({ status: 'swept', deferred: 2, to_decide: 5, decided: 3 }))
  })

  it('treats no_open_proposal as a normal completion', () => {
    const opts = sweepFinishOpts(receipt({ status: 'no_open_proposal' }))
    expect(opts.error).toBeUndefined()
  })

  const failing: SweepStatus[] = ['rule_invalid', 'gate_changed', 'mailbox_unreadable', 'read_failed', 'write_failed']
  for (const status of failing) {
    it(`carries the error for ${status}`, () => {
      const r = receipt({ status, error: `boom: ${status}`, deferred: 3 })
      const opts = sweepFinishOpts(r)
      expect(opts.error).toBe(`boom: ${status}`)
      expect(opts.failed).toBe(3)
      expect(opts.summary).toEqual(r)
    })
  }
})

describe('handleTriggeredSendFailure', () => {
  it('returns no_run_id without calling closeRun', async () => {
    const closeRun = vi.fn()
    const result = await handleTriggeredSendFailure(
      { job: TRIGGERED_SEND_SWEEP_JOB, runId: null, message: 'boom', failedAt: NOW },
      closeRun as unknown as typeof import('@/lib/cron/run-logger').finishCronRunIfOpen,
    )
    expect(result).toBe('no_run_id')
    expect(closeRun).not.toHaveBeenCalled()
  })

  it('closes the run log with the retries-exhausted error', async () => {
    const closeRun = vi.fn(async () => 'closed' as const)
    const failedAt = new Date('2026-11-02T19:20:00Z')
    const result = await handleTriggeredSendFailure(
      { job: TRIGGERED_SEND_SWEEP_JOB, runId: RUN_ID, message: 'boom', failedAt },
      closeRun as unknown as typeof import('@/lib/cron/run-logger').finishCronRunIfOpen,
    )
    expect(result).toBe('closed')
    expect(closeRun).toHaveBeenCalledWith(
      TRIGGERED_SEND_SWEEP_JOB,
      cronRunIdFromInngestRun(RUN_ID),
      { processed: 0, completed: 0, failed: 1, error: 'retries exhausted: boom' },
      failedAt,
    )
  })
})

describe('cron registry entries of the shadow run', () => {
  it('watch the morning schedule that the code defines (no hand-copied schedule)', async () => {
    const { CRON_REGISTRY } = await import('@/lib/cron/registry')
    for (const service of [
      'inngest:cloud-triggered-send-welcome-dispatch',
      'inngest:cloud-triggered-send-welcome-sweep',
    ]) {
      const entry = CRON_REGISTRY.find((e) => e.service === service)
      expect(entry, service).toBeDefined()
      expect(entry?.schedule).toBe(TRIGGERED_SEND_SWEEP_CRON)
      expect(entry?.scheduler).toBe('inngest')
      expect(entry?.logsRuns).toBe(true)
    }
    expect(CRON_REGISTRY.find((e) => e.service === 'inngest:cloud-triggered-send-welcome-dispatch')?.jobName).toBe(
      TRIGGERED_SEND_DISPATCH_JOB,
    )
    expect(CRON_REGISTRY.find((e) => e.service === 'inngest:cloud-triggered-send-welcome-sweep')?.jobName).toBe(
      TRIGGERED_SEND_SWEEP_JOB,
    )
  })
})
