import { describe, expect, it, vi } from 'vitest'
import { cronRunIdFromInngestRun } from '@/lib/cron/run-logger'
import { graphGetPage } from '@/lib/microsoft/mail-send-new-prod'
import { createShadowGatePorts } from '@/lib/messaging/triggered-send/shadow-ports-prod'
import type { TriggeredSendRule } from '@/lib/messaging/triggered-send/rule'
import type { ChunkResult, PrepareResult, SweepPlan, SweepReceipt, SweepStatus } from '@/lib/messaging/triggered-send/types'
import { emptySendReceipt, finalizeSend } from '@/lib/messaging/triggered-send/send-sweep'
import type { SendOneResult, SendPlan, SendPrepareResult } from '@/lib/messaging/triggered-send/send-types'
import {
  TRIGGERED_SEND_DISPATCH_ID,
  TRIGGERED_SEND_DISPATCH_JOB,
  TRIGGERED_SEND_SWEEP_CRON,
  TRIGGERED_SEND_RETRY_CRON,
  TRIGGERED_SEND_SWEEP_ID,
  TRIGGERED_SEND_SWEEP_JOB,
  createProdSweepDeps,
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

// The production wiring (createProdSweepDeps) is checked against these two doubles; no other test here touches them.
vi.mock('@/lib/microsoft/mail-send-new-prod', () => ({
  createMailNewStore: vi.fn(() => ({ listActiveMailboxes: vi.fn(async () => []) })),
  graphGetPage: vi.fn(async () => ({ ok: true, json: {} })),
}))
vi.mock('@/lib/messaging/triggered-send/shadow-ports-prod', () => ({
  createShadowGatePorts: vi.fn(() => ({ ports: {}, legacyBatches: () => [] })),
}))

const CLIENT_A = '11111111-2222-3333-4444-555555555555'
const CLIENT_B = '66666666-7777-8888-9999-aaaaaaaaaaaa'
const RUN_ID = 'run_abc123'
const NOW = new Date('2026-11-02T20:00:00Z') // 09:00 Pacific/Auckland on 2026-11-03 (UTC+13)

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
    already_decided: 0,
    deferred: 1,
    inserted: 4,
    would_send: 2,
    skipped_by_reason: { stale: 2 },
    deferred_by_reason: { dnc_unverifiable: 1 },
    deferred_samples: {},
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
    expect(TRIGGERED_SEND_SWEEP_CRON).toBe('0 9 * * *')
    expect(TRIGGERED_SEND_RETRY_CRON).toBe('0 11 * * *')
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
    expect(result.slot).toBe('2026-11-03T09')
    expect(result.job).toBe(TRIGGERED_SEND_DISPATCH_JOB)

    expect(step.sent).toHaveLength(1)
    expect(step.sent[0].id).toBe('dispatch-sweeps')
    const events = step.sent[0].events as Array<{ id: string }>
    expect(events.map((e) => e.id)).toEqual([
      `triggered_send_sweep:${CLIENT_A}:2026-11-03T09`,
      `triggered_send_sweep:${CLIENT_B}:2026-11-03T09`,
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
  const PAYLOAD = { client_id: CLIENT_A, trigger_key: 'welcome', dry_run: false }

  function plan(overrides: Partial<SweepPlan> = {}): SweepPlan {
    return {
      clientId: CLIENT_A, dryRun: false, authorizationId: 'auth-1', sweepDay: '2026-11-03',
      candidateIds: [], staleIds: [], to_decide: 0, ignored: 0, deferred: 0, deferred_by_reason: {},
      status: 'swept', error: null, createdAt: NOW.toISOString(), ...overrides,
    }
  }

  function chunkResult(overrides: Partial<ChunkResult> = {}): ChunkResult {
    return {
      decided: 0, already_decided: 0, deferred: 0, inserted: 0, would_send: 0, skipped_by_reason: {}, deferred_by_reason: {},
      deferred_samples: {}, legacy_batches: [], error: null, error_status: null, ...overrides,
    }
  }

  function sweepDeps(prepared: PrepareResult, overrides: Partial<SweepRunDeps> = {}) {
    const startRun: ReturnType<typeof vi.fn> = vi.fn(async () => undefined)
    const finishRun: ReturnType<typeof vi.fn> = vi.fn(async () => undefined)
    const prepare = vi.fn(async (): Promise<PrepareResult> => prepared)
    const decideChunk = vi.fn(
      async (_args: { plan: SweepPlan; kind: 'candidates' | 'stale'; contactIds: string[] }): Promise<ChunkResult> =>
        chunkResult({ decided: 1 }),
    )
    const finalize = vi.fn((_plan: SweepPlan, results: ChunkResult[]): SweepReceipt =>
      receipt({ decided: results.reduce((n, r) => n + r.decided, 0) }),
    )
    const sendPrepare = vi.fn(async (): Promise<SendPrepareResult> => ({ kind: 'stop', receipt: NOT_ARMED }))
    const sendStale = vi.fn(async (): Promise<SendOneResult[]> => [])
    const sendOne = vi.fn(async (): Promise<SendOneResult> => ({ outcome: 'sent', reason: null, sendId: 'r1', stopRun: false, providerImpact: 'PROVIDER_ACCEPTED' }))
    const deps: SweepRunDeps = { startRun, finishRun, prepare, decideChunk, finalize, sendPrepare, sendStale, sendOne, finalizeSend, now: () => NOW, ...overrides }
    return { deps, startRun, finishRun, prepare, decideChunk, finalize, sendPrepare, sendStale, sendOne }
  }

  const NOT_ARMED = { ...emptySendReceipt('2026-11-02T20:00:00.000Z'), status: 'not_armed' as const }

  it('returns invalid_payload without any step or log', async () => {
    const step = fakeStep()
    const { deps, startRun, finishRun, prepare } = sweepDeps({ kind: 'done', receipt: receipt() })
    const result = await runSweepOrder(step, deps, { client_id: 'nope' }, RUN_ID)

    expect(result).toEqual({ status: 'invalid_payload', reason: expect.any(String) })
    expect(step.ids).toHaveLength(0)
    expect(startRun).not.toHaveBeenCalled()
    expect(finishRun).not.toHaveBeenCalled()
    expect(prepare).not.toHaveBeenCalled()
  })

  it('defaults a manual payload without dry_run to dryRun true', async () => {
    const { deps, prepare } = sweepDeps({ kind: 'done', receipt: receipt() })
    await runSweepOrder(fakeStep(), deps, { client_id: CLIENT_A, trigger_key: 'welcome' }, RUN_ID)
    expect(prepare).toHaveBeenCalledWith({ clientId: CLIENT_A, dryRun: true })
  })

  it('honours an explicit dry_run false', async () => {
    const { deps, prepare } = sweepDeps({ kind: 'done', receipt: receipt() })
    await runSweepOrder(fakeStep(), deps, PAYLOAD, RUN_ID)
    expect(prepare).toHaveBeenCalledWith({ clientId: CLIENT_A, dryRun: false })
  })

  it('finishes straight away when the preparation already has a receipt (nothing to decide)', async () => {
    const step = fakeStep()
    const r = receipt({ status: 'no_open_proposal' })
    const { deps, startRun, finishRun, decideChunk, finalize } = sweepDeps({ kind: 'done', receipt: r })
    const result = await runSweepOrder(step, deps, PAYLOAD, RUN_ID)

    expect(result).toEqual({ ...r, send: NOT_ARMED })
    expect(step.ids).toEqual(['log-start', 'prepare', 'send-prepare', 'log-finish'])
    expect(decideChunk).not.toHaveBeenCalled()
    expect(finalize).not.toHaveBeenCalled()
    const runLogId = cronRunIdFromInngestRun(RUN_ID)
    expect(startRun).toHaveBeenCalledWith(runLogId)
    const [finishId, , opts] = finishRun.mock.calls[0] as [string, number, Record<string, unknown>]
    expect(finishId).toBe(runLogId)
    expect(opts).toEqual(sweepFinishOpts(r, NOT_ARMED))
  })

  it('runs one step per chunk of 4 contacts, stale ones first, with deterministic step ids', async () => {
    const step = fakeStep()
    const p = plan({
      staleIds: ['s1', 's2'],
      candidateIds: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'],
      to_decide: 8,
    })
    const { deps, decideChunk, finalize, finishRun } = sweepDeps({ kind: 'plan', plan: p })
    const result = await runSweepOrder(step, deps, PAYLOAD, RUN_ID)

    expect(step.ids).toEqual(['log-start', 'prepare', 'decide-stale-0', 'decide-candidates-1', 'decide-candidates-2', 'send-prepare', 'log-finish'])
    expect(decideChunk.mock.calls.map((c) => c[0])).toEqual([
      { plan: p, kind: 'stale', contactIds: ['s1', 's2'] },
      { plan: p, kind: 'candidates', contactIds: ['c1', 'c2', 'c3', 'c4'] },
      { plan: p, kind: 'candidates', contactIds: ['c5', 'c6'] },
    ])
    expect(finalize).toHaveBeenCalledTimes(1)
    const [finalPlan, results] = finalize.mock.calls[0] as [SweepPlan, ChunkResult[]]
    expect(finalPlan).toBe(p)
    expect(results).toHaveLength(3)
    expect(result).toMatchObject({ status: 'swept', decided: 3, send: NOT_ARMED })
    const [, , opts] = finishRun.mock.calls[0] as [string, number, Record<string, unknown>]
    expect(opts).toEqual(sweepFinishOpts(result as SweepReceipt, NOT_ARMED))
  })

  it('🔴 real sending runs after the rehearsal: one step to plan, one for the stale guests, one per guest; a stop ends the run', async () => {
    const step = fakeStep()
    const sendPlan: SendPlan = { clientId: CLIENT_A, authorizationId: 'auth-1', sweepDay: '2026-11-03', contactIds: ['g1', 'g2', 'g3'], staleIds: ['old1'], found: 4, createdAt: '2026-11-02T20:00:00.000Z' }
    const stop: SendOneResult = { outcome: 'account_error', reason: 'provider_account_error', sendId: 'r2', stopRun: true, providerImpact: 'NONE' }
    const { deps, sendOne, sendStale, finishRun } = sweepDeps({ kind: 'done', receipt: receipt({ status: 'no_open_proposal' }) }, {
      sendPrepare: vi.fn(async (): Promise<SendPrepareResult> => ({ kind: 'plan', plan: sendPlan })),
    })
    sendOne.mockImplementationOnce(async () => ({ outcome: 'sent', reason: null, sendId: 'r1', stopRun: false, providerImpact: 'PROVIDER_ACCEPTED' }))
    sendOne.mockImplementationOnce(async () => stop)
    const result = await runSweepOrder(step, deps, PAYLOAD, RUN_ID)
    expect(step.ids).toEqual(['log-start', 'prepare', 'send-prepare', 'send-stale', 'send-0', 'send-1', 'log-finish'])
    expect(sendStale).toHaveBeenCalledWith(sendPlan)
    expect(sendOne.mock.calls.map((c) => (c as unknown[])[0])).toEqual([{ plan: sendPlan, contactId: 'g1' }, { plan: sendPlan, contactId: 'g2' }])
    expect(result).toMatchObject({ send: { tried: 2, provider_impact: 'PROVIDER_ACCEPTED', stopped: 'account_error:provider_account_error' } })
    const [, , opts] = finishRun.mock.calls[0] as [string, number, { summary: { send: unknown } }]
    expect(opts.summary.send).toMatchObject({ authorization_id: 'auth-1', by_outcome: { sent: 1, account_error: 1 } })
  })

  it('runs the chunks one after the other, never in parallel', async () => {
    const events: string[] = []
    const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
    let n = 0
    const p = plan({ candidateIds: ['c1', 'c2', 'c3', 'c4', 'c5'], to_decide: 5 })
    const { deps } = sweepDeps({ kind: 'plan', plan: p }, {
      decideChunk: async () => {
        const mine = (n += 1)
        events.push(`start:${mine}`)
        await delay(10)
        events.push(`end:${mine}`)
        return chunkResult()
      },
    })
    await runSweepOrder(fakeStep(), deps, PAYLOAD, RUN_ID)
    expect(events).toEqual(['start:1', 'end:1', 'start:2', 'end:2'])
  })

  it('lets a failing chunk fail the run (Inngest retries that step) and leaves the run log to onFailure', async () => {
    const p = plan({ candidateIds: ['c1'], to_decide: 1 })
    const { deps, finishRun } = sweepDeps({ kind: 'plan', plan: p }, {
      decideChunk: async () => {
        throw new Error('chunk exploded')
      },
    })
    await expect(runSweepOrder(fakeStep(), deps, PAYLOAD, RUN_ID)).rejects.toThrow('chunk exploded')
    expect(finishRun).not.toHaveBeenCalled()
  })
})

describe('sweepFinishOpts', () => {
  it('treats swept as a normal completion', () => {
    const opts = sweepFinishOpts(receipt({ status: 'swept', deferred: 2, to_decide: 5, decided: 3 }))
    expect(opts.processed).toBe(5)
    expect(opts.completed).toBe(3)
    expect(opts.failed).toBe(2)
    expect(opts.error).toBeUndefined()
    expect(opts.summary).toEqual({ ...receipt({ status: 'swept', deferred: 2, to_decide: 5, decided: 3 }), send: null })
  })

  it('counts contacts that already held a row as completed, so processed = completed + failed', () => {
    const opts = sweepFinishOpts(receipt({ status: 'swept', to_decide: 6, decided: 3, already_decided: 2, deferred: 1 }))
    expect(opts).toMatchObject({ processed: 6, completed: 5, failed: 1 })
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
      expect(opts.summary).toEqual({ ...r, send: null })
    })
  }
})

describe('sweepFinishOpts — real sending in the run log', () => {
  const base = { ...emptySendReceipt('2026-11-02T20:00:00.000Z'), authorization_id: 'auth-1' }
  const r = (): SweepReceipt => ({
    status: 'swept', client_id: CLIENT_A, dry_run: false, authorization_id: 'auth-1', to_decide: 0, ignored: 0, decided: 0, already_decided: 0, deferred: 0,
    inserted: 0, would_send: 0, skipped_by_reason: {}, deferred_by_reason: {}, deferred_samples: {}, legacy_batches: [], no_send: true, provider_impact: 'NONE', error: null, created_at: '2026-11-02T20:00:00.000Z',
  })

  it('🔴 once a letter may have gone out, the run says so at the top (no_send false, the provider impact)', () => {
    const opts = sweepFinishOpts(r(), { ...base, tried: 1, by_outcome: { sent: 1 }, provider_impact: 'PROVIDER_ACCEPTED' })
    expect(opts.summary).toMatchObject({ no_send: false, provider_impact: 'PROVIDER_ACCEPTED' })
    expect(opts.error).toBeUndefined()
  })

  it('🔴 switched on but broken (no key, a stop) is an error in the run log; nothing to do is not', () => {
    expect(sweepFinishOpts(r(), { ...base, status: 'no_account_key' }).error).toBe('send: no_account_key')
    expect(sweepFinishOpts(r(), { ...base, stopped: 'account_error:provider_account_error' }).error).toBe('send stopped: account_error:provider_account_error')
    expect(sweepFinishOpts(r(), { ...base, stopped: 'blocked:cap_reached' }).error).toBeUndefined()
    expect(sweepFinishOpts(r(), { ...base, status: 'not_armed' }).error).toBeUndefined()
    expect(sweepFinishOpts(r(), { ...base, status: 'formal_sending_not_enabled' }).error).toBe('send: formal_sending_not_enabled')
  })

  it('a trial whose addresses match nobody, and single letters that went wrong, show in the run log (魏征 R2 P2-丙)', () => {
    expect(sweepFinishOpts(r(), { ...base, found: 0 }).error).toBe('send: no contact carries the trial addresses')
    expect(sweepFinishOpts(r(), { ...base, found: 2, tried: 2, by_outcome: { sent: 1, conflict: 1 } }).error).toBe('send letters: 1 conflict')
    expect(sweepFinishOpts(r(), { ...base, found: 1, tried: 1, by_outcome: { sent: 1 } }).error).toBeUndefined()
  })
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

describe('createProdSweepDeps', () => {
  const RULE: TriggeredSendRule = {
    gate_contract_version: 1,
    audience: { sources: ['meta_lead_form'], max_age_days: 3, min_age: 'previous_local_day' },
    schedule: { timezone: 'Pacific/Auckland' },
    frequency_cap: { max: 2, window_days: 7 },
    consent: { accepted_bases: ['basis'] },
    legacy: { mailchimp_campaign_title_prefix: 'legacy_', excluded_tags: [] },
    human_mail: { required_mailboxes: ['sales@example.org'] },
    recipient_allowlist: null,
  }

  it('measures the step time with a real clock', () => {
    const before = Date.now()
    const reading = createProdSweepDeps().clockMs()
    expect(reading).toBeGreaterThanOrEqual(before)
    expect(reading).toBeLessThanOrEqual(Date.now())
  })

  // A refresh that fails while the rehearsal reads the sales mailbox must not flip that connection to "error":
  // that would stop the sales team's own mail sync until somebody reconnects it.
  it('reads the mailbox without ever marking the connection as errored', async () => {
    createProdSweepDeps().createPorts({ clientId: CLIENT_A, rule: RULE, now: NOW })
    const given = vi.mocked(createShadowGatePorts).mock.calls[0][0]
    await given.graphGetPage('conn-1', '/me/mailFolders/sentitems/messages')
    expect(vi.mocked(graphGetPage)).toHaveBeenCalledWith('conn-1', '/me/mailFolders/sentitems/messages', {
      markErrorOnFailure: false,
    })
  })
})
