import { describe, expect, it, vi } from 'vitest'
import { ADS_O1_BUDGET_SCALE_APPROVED } from '../../ads-events'
import { cloudFunctions } from '../index'
import { ADS_O1_BUDGET_SCALE_FN_ID, createAdsO1BudgetScaleFunction } from '../ads-o1-budget-scale'

type Fn = ReturnType<typeof createAdsO1BudgetScaleFunction>
function optsOf(fn: Fn) {
  return (fn as unknown as { opts: { triggers?: { event?: string }[]; retries?: number; concurrency?: { limit: number; key?: string } } }).opts
}
function handlerOf(fn: Fn) { return (fn as unknown as { fn: (args: unknown) => Promise<unknown> }).fn }

describe('O1 budget-scale Inngest workflow', () => {
  it('is registered and serializes budget actions per client', () => {
    const registered = cloudFunctions.find(fn => fn.id() === ADS_O1_BUDGET_SCALE_FN_ID)
    expect(registered).toBeDefined()
    expect(optsOf(registered as Fn).triggers?.[0]?.event).toBe(ADS_O1_BUDGET_SCALE_APPROVED)
    expect(optsOf(registered as Fn).concurrency).toEqual({ limit: 1, key: 'event.data.client_id' })
  })

  it('resumes the persisted run in a durable step', async () => {
    const execute = vi.fn(async (_deps: unknown, clientId: string, runId: string) => ({
      kind: 'succeeded' as const, run: { id: runId }, decision: null, execution: null, humanReason: null,
    }))
    const fn = createAdsO1BudgetScaleFunction(execute as never)
    const step = { run: vi.fn(async (_name: string, work: () => Promise<unknown>) => work()) }
    const result = await handlerOf(fn)({
      event: { data: { client_id: 'aaaaaaaa-0000-4000-8000-000000000000', action_run_id: 'bbbbbbbb-0000-4000-8000-000000000000' } },
      step,
    })
    expect(result).toEqual({ status: 'succeeded', action_run_id: 'bbbbbbbb-0000-4000-8000-000000000000', reason: null })
    expect(step.run).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledWith(expect.anything(), 'aaaaaaaa-0000-4000-8000-000000000000', 'bbbbbbbb-0000-4000-8000-000000000000')
  })

  it('rejects malformed events before opening an execution step', async () => {
    const execute = vi.fn()
    const step = { run: vi.fn() }
    const result = await handlerOf(createAdsO1BudgetScaleFunction(execute as never))({ event: { data: { client_id: 'bad', action_run_id: 'bad' } }, step })
    expect(result).toEqual({ status: 'invalid_payload' })
    expect(step.run).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })

  it('does not acknowledge a run that is still claimed elsewhere', async () => {
    const execute = vi.fn(async () => ({ kind: 'in_progress' as const, run: { id: 'run-1' }, decision: null, execution: null, humanReason: 'busy' }))
    const handler = handlerOf(createAdsO1BudgetScaleFunction(execute as never))
    const step = { run: vi.fn(async (_name: string, work: () => Promise<unknown>) => work()) }
    await expect(handler({
      event: { data: { client_id: 'aaaaaaaa-0000-4000-8000-000000000000', action_run_id: 'bbbbbbbb-0000-4000-8000-000000000000' } },
      step,
    })).rejects.toThrow('already claimed')
  })
})
