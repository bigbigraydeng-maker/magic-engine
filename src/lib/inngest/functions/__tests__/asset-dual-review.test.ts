import { describe, expect, it, vi } from 'vitest'
import { cloudFunctions } from '../index'
import { CLOUD_FN_PREFIX, WORKER_OWNED_EVENTS } from '../../client'
import {
  ASSET_DUAL_REVIEW_EVENT,
  createAssetDualReviewFunction,
  type AssetDualReviewDeps,
} from '../asset-dual-review'

type Fn = ReturnType<typeof createAssetDualReviewFunction>

function optsOf(fn: Fn) {
  return (fn as unknown as {
    opts: { triggers?: { event?: string }[]; retries?: number; concurrency?: { limit: number; key?: string } }
  }).opts
}

function handlerOf(fn: Fn) {
  return (fn as unknown as { fn: (args: unknown) => Promise<Record<string, unknown>> }).fn
}

describe('asset dual review function', () => {
  it('is registered, does not retry, and does not listen on a worker-owned event', () => {
    const registered = cloudFunctions.find((fn) => fn.id().includes('asset-dual-review'))
    expect(registered?.id().startsWith(CLOUD_FN_PREFIX)).toBe(true)
    const fn = createAssetDualReviewFunction({ run: async () => ({ applicable: false, passed: false, pooled: false, status: 'skipped' }) })
    const opts = optsOf(fn)
    expect(opts.triggers?.[0]?.event).toBe(ASSET_DUAL_REVIEW_EVENT)
    expect(opts.retries).toBe(0)
    expect(opts.concurrency).toMatchObject({ limit: 1, key: 'event.data.client_id' })
    expect((WORKER_OWNED_EVENTS as readonly string[]).includes(ASSET_DUAL_REVIEW_EVENT)).toBe(false)
  })

  it('rejects a bad payload before running the review', async () => {
    const run = vi.fn<AssetDualReviewDeps['run']>(async () => ({ applicable: false, passed: false, pooled: false, status: 'recorded' }))
    const fn = createAssetDualReviewFunction({ run })
    const result = await handlerOf(fn)({
      event: { id: 'evt-1', data: { client_id: 'nope', work_order_id: 'nope' } },
      step: { run: async (_id: string, body: () => unknown) => body() },
    })
    expect(result.status).toBe('invalid_payload')
    expect(run).not.toHaveBeenCalled()
  })

  it('passes the client and the work order to the review', async () => {
    const run = vi.fn<AssetDualReviewDeps['run']>(async () => ({ applicable: true, passed: false, pooled: false, status: 'recorded' }))
    const fn = createAssetDualReviewFunction({ run })
    const clientId = '00000000-0000-4000-8000-000000000001'
    const workOrderId = '00000000-0000-4000-8000-000000000004'
    await handlerOf(fn)({
      event: { id: 'evt-2', data: { client_id: clientId, work_order_id: workOrderId } },
      step: { run: async (_id: string, body: () => unknown) => body() },
    })
    expect(run).toHaveBeenCalledWith({ clientId, workOrderId })
  })
})
