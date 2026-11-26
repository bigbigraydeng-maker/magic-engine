/**
 * Turn one scheduled Reel result into a dispatch receipt.
 * A dry run never claims the publish API was called. A real publish without
 * a stored post id is a failure, not a silent success.
 */
import type { PublishDispatchReceipt } from './receipt'

export interface ReelNoteResult {
  order_id: string
  outcome: string
  reason: string
}

export async function noteReelResults(input: {
  clientId: string
  results: readonly ReelNoteResult[]
  dryRun: boolean
  record: (receipt: PublishDispatchReceipt) => Promise<void>
  loadRef?: (orderId: string) => Promise<{ postId: string; publishedAt: string } | null>
}): Promise<void> {
  for (const row of input.results) await noteOne(input, row)
}

async function noteOne(
  input: {
    clientId: string
    dryRun: boolean
    record: (receipt: PublishDispatchReceipt) => Promise<void>
    loadRef?: (orderId: string) => Promise<{ postId: string; publishedAt: string } | null>
  },
  row: ReelNoteResult,
): Promise<void> {
  const base = { clientId: input.clientId, kind: 'reel_public' as const, subjectRef: row.order_id }
  if (input.dryRun) {
    const rehearsed = row.outcome === 'dry_run_ok' || row.outcome === 'not_due'
    await input.record({
      ...base,
      mode: rehearsed ? 'dry_run' : 'failed',
      postId: null,
      publishedAt: null,
      calledPublishApi: false,
      reason: row.reason || row.outcome,
    })
    return
  }
  if (row.outcome === 'dry_run_ok' || row.outcome === 'not_due') {
    await input.record({ ...base, mode: 'dry_run', postId: null, publishedAt: null, calledPublishApi: false, reason: row.reason || row.outcome })
    return
  }
  if (row.outcome === 'published' || row.outcome === 'synced') {
    const ref = input.loadRef ? await input.loadRef(row.order_id) : null
    if (!ref) {
      await input.record({ ...base, mode: 'failed', postId: null, publishedAt: null, calledPublishApi: true, reason: 'register_missing_ref' })
      return
    }
    await input.record({ ...base, mode: 'registered', postId: ref.postId, publishedAt: ref.publishedAt, calledPublishApi: true, reason: row.outcome })
    return
  }
  await input.record({
    ...base,
    mode: 'failed',
    postId: null,
    publishedAt: null,
    calledPublishApi: false,
    reason: row.reason || row.outcome,
  })
}
