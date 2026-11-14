import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { noteReelResults } from './reel-note'
import { loadReelPublishedRef } from './reel-ref'
import type { PublishDispatchReceipt } from './receipt'

describe('noteReelResults', () => {
  it('a dry run records no post id and does not claim a publish call', async () => {
    const receipts: PublishDispatchReceipt[] = []
    await noteReelResults({
      clientId: 'c1',
      dryRun: true,
      results: [{ order_id: 'o1', outcome: 'dry_run_ok', reason: 'all_gates_pass' }],
      record: async (receipt) => { receipts.push(receipt) },
      loadRef: async () => { throw new Error('must not load a ref on a dry run') },
    })
    expect(receipts).toEqual([expect.objectContaining({
      mode: 'dry_run', subjectRef: 'o1', postId: null, calledPublishApi: false,
    })])
  })

  it('a real publish without a stored post id is a failure, not a silent success', async () => {
    const receipts: PublishDispatchReceipt[] = []
    await noteReelResults({
      clientId: 'c1',
      dryRun: false,
      results: [{ order_id: 'o1', outcome: 'published', reason: 'published' }],
      record: async (receipt) => { receipts.push(receipt) },
      loadRef: async () => null,
    })
    expect(receipts[0]).toMatchObject({ mode: 'failed', reason: 'register_missing_ref', calledPublishApi: true, postId: null })
  })

  it('a real publish writes the stored post id and time', async () => {
    const receipts: PublishDispatchReceipt[] = []
    await noteReelResults({
      clientId: 'c1',
      dryRun: false,
      results: [{ order_id: 'o1', outcome: 'published', reason: 'published' }],
      record: async (receipt) => { receipts.push(receipt) },
      loadRef: async () => ({ postId: '55555', publishedAt: '2026-11-10T05:00:00.000Z' }),
    })
    expect(receipts[0]).toMatchObject({
      mode: 'registered',
      postId: '55555',
      publishedAt: '2026-11-10T05:00:00.000Z',
      calledPublishApi: true,
    })
  })

  it('a gate failure on a dry run stays a failure and did not call publish', async () => {
    const receipts: PublishDispatchReceipt[] = []
    await noteReelResults({
      clientId: 'c1',
      dryRun: true,
      results: [{ order_id: 'o1', outcome: 'failed', reason: 'order_missing' }],
      record: async (receipt) => { receipts.push(receipt) },
    })
    expect(receipts[0]).toMatchObject({ mode: 'failed', reason: 'order_missing', calledPublishApi: false })
  })
})

describe('loadReelPublishedRef', () => {
  it('ignores a draft and throws when the read fails', async () => {
    const draft = db({ video_state: 'DRAFT', post_id: '55555', published_at: '2026-11-10T05:00:00.000Z' })
    expect(await loadReelPublishedRef(draft, 'o1')).toBeNull()
    const broken = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'db down' } }) }) }) }),
    } as unknown as SupabaseClient
    await expect(loadReelPublishedRef(broken, 'o1')).rejects.toThrow('db down')
  })

  it('returns the post id and time only for a public reel', async () => {
    const live = db({ video_state: 'PUBLISHED', video_id: '55555', published_at: '2026-11-10T05:00:00.000Z' })
    expect(await loadReelPublishedRef(live, 'o1')).toEqual({ postId: '55555', publishedAt: '2026-11-10T05:00:00.000Z' })
  })
})

function db(ref: Record<string, unknown> | null): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { published_ref: ref }, error: null }) }),
      }),
    }),
  } as unknown as SupabaseClient
}
