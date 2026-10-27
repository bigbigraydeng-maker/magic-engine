// After 马良 looks at a material-only render, run the other two checks and pool a pass.

import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { runAssetDualReview, type DualReviewReceipt } from '@/lib/factory/asset-dual-review-run'
import { supabaseDualReviewIo } from '@/lib/factory/asset-dual-review-store'

export const ASSET_DUAL_REVIEW_EVENT = 'factory.asset_dual_review.ready' as const

const uuidLike = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)

const payloadSchema = z.object({
  client_id: uuidLike,
  work_order_id: uuidLike,
})

export interface AssetDualReviewDeps {
  run: (input: { workOrderId: string; clientId: string }) => Promise<DualReviewReceipt>
}

function invalidPayload(): DualReviewReceipt {
  return { applicable: false, passed: false, pooled: false, status: 'invalid_payload' }
}

export function createAssetDualReviewFunction(deps: AssetDualReviewDeps) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}asset-dual-review`,
      name: 'Asset dual review: picture, official-site facts, and music, then pool material-only orders',
      retries: 0,
      concurrency: { limit: 1, key: 'event.data.client_id' },
    },
    { event: ASSET_DUAL_REVIEW_EVENT },
    async ({ event, step }): Promise<DualReviewReceipt> => {
      const parsed = payloadSchema.safeParse(event.data)
      if (!parsed.success) return invalidPayload()
      return step.run('dual-review', () => deps.run({
        clientId: parsed.data.client_id,
        workOrderId: parsed.data.work_order_id,
      }))
    },
  )
}

export const assetDualReview = createAssetDualReviewFunction({
  run: (input) => runAssetDualReview(supabaseDualReviewIo(supabaseAdmin), input),
})
