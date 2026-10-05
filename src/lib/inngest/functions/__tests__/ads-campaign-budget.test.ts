import { describe, expect, it, vi } from 'vitest'
import {
  ADS_CAMPAIGN_BUDGET_DECREASE_FN_ID,
  createAdsCampaignBudgetDecreaseFunction,
} from '../ads-campaign-budget'
import { ADS_CAMPAIGN_BUDGET_DECREASE_REQUESTED } from '../../ads-events'
import { cloudFunctions } from '../index'

type Fn = ReturnType<typeof createAdsCampaignBudgetDecreaseFunction>
function optsOf(fn: Fn) {
  return (fn as unknown as { opts: { triggers?: { event?: string }[]; retries?: number; concurrency?: { limit: number } } }).opts
}
function handlerOf(fn: Fn) {
  return (fn as unknown as { fn: (args: unknown) => Promise<unknown> }).fn
}

describe('ads campaign budget Inngest workflow', () => {
  it('is registered as a cloud function and handles only the business event', () => {
    const fn = cloudFunctions.find((candidate) => candidate.id() === ADS_CAMPAIGN_BUDGET_DECREASE_FN_ID)
    expect(fn).toBeDefined()
    expect(optsOf(fn as Fn).triggers?.[0]?.event).toBe(ADS_CAMPAIGN_BUDGET_DECREASE_REQUESTED)
    expect(optsOf(fn as Fn).retries).toBe(1)
  })

  it('runs the persisted client/run pair inside a durable Inngest step', async () => {
    const execute = vi.fn(async (_clientId: string, runId: string) => ({
      status: 'succeeded' as const,
      action_run_id: runId,
      receipt_id: 'receipt-1',
    }))
    const fn = createAdsCampaignBudgetDecreaseFunction(execute)
    const handler = handlerOf(fn)
    const step = { run: vi.fn(async (_name: string, work: () => Promise<unknown>) => work()) }

    const result = await handler({
      event: { data: { client_id: 'aaaaaaaa-0000-4000-8000-000000000000', action_run_id: 'bbbbbbbb-0000-4000-8000-000000000000' } },
      step,
    })

    expect(result).toEqual({ status: 'succeeded', action_run_id: 'bbbbbbbb-0000-4000-8000-000000000000', receipt_id: 'receipt-1' })
    expect(step.run).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledWith('aaaaaaaa-0000-4000-8000-000000000000', 'bbbbbbbb-0000-4000-8000-000000000000')
  })

  it('does not run on a malformed event', async () => {
    const execute = vi.fn()
    const handler = handlerOf(createAdsCampaignBudgetDecreaseFunction(execute))
    const step = { run: vi.fn() }

    const result = await handler({ event: { data: { client_id: 'not-a-client', action_run_id: 'run' } }, step })

    expect(result).toEqual({ status: 'invalid_payload' })
    expect(step.run).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })
})
