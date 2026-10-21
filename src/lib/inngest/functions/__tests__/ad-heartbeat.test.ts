/**
 * The hourly ad heartbeat function: wiring and run-log behaviour. The sweep's own
 * rules are covered in `ads-strategy/heartbeat/__tests__/`; here the sweep is a stub
 * so only scheduling, retries, the receipt event and the run log are on trial.
 * (`.opts` / `.fn` bridging is the same one the other function tests use.)
 */
import { describe, expect, it, vi } from 'vitest'
import {
  AD_HEARTBEAT_CRON,
  AD_HEARTBEAT_FUNCTION_ID,
  createAdHeartbeatFunction,
} from '../ad-heartbeat'
import { CLOUD_FN_PREFIX } from '../../client'
import { CRON_REGISTRY } from '@/lib/cron/registry'
import { AD_HEARTBEAT_JOB, type HeartbeatReceipt } from '@/lib/ads-strategy/heartbeat/run'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/workflows/inngest-event', () => ({ sendInngestEvent: vi.fn() }))

type Fn = ReturnType<typeof createAdHeartbeatFunction>
const optsOf = (fn: Fn) =>
  (fn as unknown as {
    opts: { id?: string; triggers?: { cron?: string }[]; retries?: number; concurrency?: { limit?: number } }
  }).opts
const handlerOf = (fn: Fn) => (fn as unknown as { fn: (args: unknown) => Promise<unknown> }).fn
const fakeStep = () => ({ run: vi.fn(async (_id: string, fn: () => Promise<unknown> | unknown) => fn()) })

function makeReceipt(overrides: Partial<HeartbeatReceipt> = {}): HeartbeatReceipt {
  return {
    request_id: 'req-1',
    job: AD_HEARTBEAT_JOB,
    mode: 'dry',
    started_at: '2026-10-21T00:00:00.000Z',
    finished_at: '2026-10-21T00:00:01.000Z',
    cost_usd: 0,
    no_publish: true,
    clients_checked: 1,
    accounts_checked: 2,
    table_missing: false,
    rounds: [
      {
        client_id: 'client-1',
        accounts: [
          {
            ad_account_id: 'act_1',
            status: 'ok',
            call_count: 4,
            alarms: [],
            observations: [],
            wrote_state: true,
            alarms_inserted: 0,
            alarms_updated: 0,
            alarms_resolved: 0,
            merged_summary: null,
            skipped_reason: null,
          },
          {
            ad_account_id: 'act_2',
            status: 'read_failed',
            call_count: 1,
            alarms: [],
            observations: [],
            wrote_state: true,
            alarms_inserted: 0,
            alarms_updated: 0,
            alarms_resolved: 0,
            merged_summary: null,
            skipped_reason: null,
          },
        ],
      },
    ],
    purged: 0,
    ...overrides,
  }
}

function build(run: () => Promise<HeartbeatReceipt>) {
  const startRun = vi.fn(async () => 'run-1')
  const finishRun = vi.fn(
    async (_input: { runId: string; startedAt: number; receipt?: HeartbeatReceipt; error?: string }) => undefined,
  )
  const emit = vi.fn(async (_receipt: HeartbeatReceipt) => undefined)
  const fn = createAdHeartbeatFunction({ run, startRun, finishRun, emit })
  return { fn, startRun, finishRun, emit }
}

describe('ad-heartbeat function', () => {
  it('🔴 is scheduled hourly at minute 5 in New Zealand time, never retries, never overlaps', () => {
    const { fn } = build(async () => makeReceipt())
    const opts = optsOf(fn)
    expect(opts.id).toBe(`${CLOUD_FN_PREFIX}ad-heartbeat`)
    expect(opts.triggers?.[0]?.cron).toBe(AD_HEARTBEAT_CRON)
    expect(AD_HEARTBEAT_CRON).toBe('TZ=Pacific/Auckland 5 * * * *')
    expect(opts.retries).toBe(0)
    expect(opts.concurrency?.limit).toBe(1)
  })

  it('🔴 cron 登记表里有它：由 Inngest 调度、写运行记录，周期跟上面的常量是同一个（去掉 TZ 前缀）——没登记 = 它哪天安静地不跑时没人喊', () => {
    const entry = CRON_REGISTRY.find(e => e.jobName === AD_HEARTBEAT_JOB)
    expect(entry).toMatchObject({
      scheduler: 'inngest',
      logsRuns: true,
      service: `inngest:${AD_HEARTBEAT_FUNCTION_ID}`,
    })
    expect(entry?.schedule).toBe(AD_HEARTBEAT_CRON.replace(/^TZ=\S+\s+/, ''))
  })

  it('runs the sweep inside steps, emits the receipt, and closes the run log with it', async () => {
    const receipt = makeReceipt()
    const { fn, startRun, finishRun, emit } = build(async () => receipt)
    const step = fakeStep()
    const out = await handlerOf(fn)({ step })

    expect(startRun).toHaveBeenCalledTimes(1)
    expect(step.run.mock.calls.map(c => c[0])).toEqual(['start-run', 'heartbeat', 'emit-receipt', 'finish-run'])
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit.mock.calls[0][0]).toBe(receipt)
    expect(finishRun).toHaveBeenCalledTimes(1)
    expect(finishRun.mock.calls[0][0]).toMatchObject({ runId: 'run-1', receipt })
    expect(out).toEqual({ mode: 'dry', accounts_checked: 2, table_missing: false })
  })

  it('🔴 a failing sweep closes the run log with the error FIRST, emits nothing, then fails the run loudly', async () => {
    const { fn, finishRun, emit } = build(async () => {
      throw new Error('boom')
    })
    await expect(handlerOf(fn)({ step: fakeStep() })).rejects.toThrow('ad-heartbeat failed: boom')
    expect(emit).not.toHaveBeenCalled()
    expect(finishRun).toHaveBeenCalledTimes(1)
    expect(finishRun.mock.calls[0][0]).toMatchObject({ runId: 'run-1', error: 'boom' })
    expect(finishRun.mock.calls[0][0].receipt).toBeUndefined()
  })

  it('🔴 is registered in cloudFunctions — an unregistered function never runs and nobody notices', async () => {
    const { cloudFunctions } = await import('../index')
    const { adHeartbeat } = await import('../ad-heartbeat')
    expect(cloudFunctions).toContain(adHeartbeat)
  })
})
