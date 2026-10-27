import { describe, expect, it } from 'vitest'
import type { CreativePoolEntry, ConfigVersion } from '@/lib/ads-strategy/config'
import { runAssetDualReview, type AssetOrder, type DualReviewIo } from './asset-dual-review-run'
import type { RemotionMusicClearance } from './remotion-music-options.mjs'

const CLIENT = '00000000-0000-4000-8000-000000000001'
const WO = '00000000-0000-4000-8000-000000000004'
const URL = 'https://example.com/tours'
const PASS_MUSIC: RemotionMusicClearance = {
  verdict: 'pass', reason: '配乐已核无人声', track_id: 'track-1', clean_until_sec: 30,
}

function order(patch: Partial<AssetOrder> = {}): AssetOrder {
  return {
    id: WO,
    clientId: CLIENT,
    status: 'in_review',
    brief: {
      remotion: {
        deliverable: 'asset_only',
        props: { scenes: [{ line: 'Walk the waterfront', sourceUrl: URL, sourceQuote: 'Walk the waterfront at dawn' }] },
      },
    },
    output: { machine_reviewed: true, maliang_check: { status: 'pass', reasons: [] } },
    reviewRef: { kept: true },
    ...patch,
  }
}

function io(seed: Partial<AssetOrder> | null | 'unreadable', pool: CreativePoolEntry[] = []) {
  const writes: Array<{ patch: Record<string, unknown>; expectStatus: string }> = []
  const pools: CreativePoolEntry[][] = []
  let pages = 0
  const version: ConfigVersion = { exists: true, updatedAt: '2026-10-27T00:00:00.000Z' }
  const fake: DualReviewIo = {
    loadOrder: async () => (seed === null || seed === 'unreadable' ? seed : order(seed)),
    loadHosts: async () => ['example.com'],
    readPage: async () => {
      pages += 1
      return 'Walk the waterfront at dawn'
    },
    musicOf: () => PASS_MUSIC,
    loadPool: async () => ({ version, pool }),
    writePool: async (_clientId, next) => {
      pools.push(next)
      return 'ok'
    },
    writeOrder: async (_id, patch, expectStatus) => {
      writes.push({ patch, expectStatus })
      return 'ok'
    },
    now: () => '2026-10-27T01:00:00.000Z',
  }
  return { fake, writes, pools, pages: () => pages }
}

describe('runAssetDualReview', () => {
  it('archives a passing material-only order and approves it in the pool', async () => {
    const harness = io({})
    const receipt = await runAssetDualReview(harness.fake, { clientId: CLIENT, workOrderId: WO })
    expect(receipt).toMatchObject({ applicable: true, passed: true, pooled: true, status: 'pooled' })
    expect(harness.writes[0]?.patch.status).toBe('archived')
    expect(harness.writes[0]?.expectStatus).toBe('in_review')
    const ref = harness.writes[0]?.patch.review_ref as { kept?: boolean; dual_review?: { passed?: boolean } }
    expect(ref.kept).toBe(true)
    expect(ref.dual_review?.passed).toBe(true)
    expect(harness.pools[0]?.find((entry) => entry.ref === WO)).toMatchObject({
      kind: 'work_order', status: 'approved', approved_by: 'ai-dual-review',
    })
    expect(harness.pools[0]?.find((entry) => entry.ref === WO)?.promo_window).toBeUndefined()
    expect(harness.writes.some((write) => write.patch.status === 'approved')).toBe(false)
  })

  it('does not write when the order is not material-only or belongs to someone else', async () => {
    const normal = io({ brief: { remotion: { deliverable: 'reel' } } })
    expect(await runAssetDualReview(normal.fake, { clientId: CLIENT, workOrderId: WO })).toMatchObject({ applicable: false, pooled: false })
    expect(normal.writes).toEqual([])
    const other = io({ clientId: '00000000-0000-4000-8000-000000000099' })
    expect(await runAssetDualReview(other.fake, { clientId: CLIENT, workOrderId: WO })).toMatchObject({ status: 'skipped' })
    expect(other.pools).toEqual([])
  })

  it('records a failed check and leaves the order in review', async () => {
    const harness = io({ output: { machine_reviewed: true, maliang_check: { status: 'fail', reasons: ['错字'] } } })
    const receipt = await runAssetDualReview(harness.fake, { clientId: CLIENT, workOrderId: WO })
    expect(receipt).toMatchObject({ passed: false, pooled: false, status: 'recorded' })
    expect(harness.writes[0]?.patch.status).toBeUndefined()
    expect(harness.writes[0]?.expectStatus).toBe('in_review')
    expect(harness.pools).toEqual([])
  })

  it('does not pool when the official page cannot be read', async () => {
    const harness = io({})
    harness.fake.readPage = async () => null
    const receipt = await runAssetDualReview(harness.fake, { clientId: CLIENT, workOrderId: WO })
    expect(receipt.pooled).toBe(false)
    expect(harness.pools).toEqual([])
    const ref = harness.writes[0]?.patch.review_ref as { dual_review?: { sudongpo?: { reason?: string } } }
    expect(ref.dual_review?.sudongpo?.reason).toBe('读不到')
  })

  it('does not archive when the pool refuses the entry', async () => {
    const harness = io({}, [{ kind: 'work_order', ref: WO, status: 'rejected' }])
    const receipt = await runAssetDualReview(harness.fake, { clientId: CLIENT, workOrderId: WO })
    expect(receipt.status).toBe('pool_blocked')
    expect(harness.writes[0]?.patch.status).toBeUndefined()
    expect(harness.pools).toEqual([])
  })

  it('does not pool when the archive write loses the race', async () => {
    const harness = io({})
    harness.fake.writeOrder = async () => 'conflict'
    const receipt = await runAssetDualReview(harness.fake, { clientId: CLIENT, workOrderId: WO })
    expect(receipt).toMatchObject({ passed: true, pooled: false, status: 'conflict' })
    expect(harness.pools).toEqual([])
  })

  it('finishes the pool write for an order already archived by this review', async () => {
    const harness = io({
      status: 'archived',
      reviewRef: { dual_review: { passed: true, pool: 'pending', reviewer: 'ai-dual-review' } },
    })
    const receipt = await runAssetDualReview(harness.fake, { clientId: CLIENT, workOrderId: WO })
    expect(receipt).toMatchObject({ passed: true, pooled: true })
    expect(harness.pages()).toBe(0)
    expect(harness.pools).toHaveLength(1)
  })

  it('says unreadable when the order itself cannot be read', async () => {
    const harness = io('unreadable')
    const receipt = await runAssetDualReview(harness.fake, { clientId: CLIENT, workOrderId: WO })
    expect(receipt).toMatchObject({ status: 'unreadable', pooled: false })
    expect(harness.writes).toEqual([])
  })

  it('approves the pool row with the uploaded video id after the three gates pass', async () => {
    const harness = io({})
    let uploads = 0
    harness.fake.attachVideo = async () => {
      uploads += 1
      return { ok: true, videoId: '555', accountId: 'act_1' }
    }
    const receipt = await runAssetDualReview(harness.fake, { clientId: CLIENT, workOrderId: WO })
    expect(receipt).toMatchObject({ status: 'pooled', videoId: '555' })
    expect(uploads).toBe(1)
    expect(harness.pools[0]?.find((entry) => entry.ref === WO)).toMatchObject({
      status: 'approved', approved_by: 'ai-dual-review', alias_refs: ['555'],
    })
    const ref = harness.writes[0]?.patch.review_ref as { kept?: boolean; meta_video_id?: string }
    expect(ref.kept).toBe(true)
    expect(ref.meta_video_id).toBe('555')
  })

  it('does not archive when the upload fails', async () => {
    const harness = io({})
    harness.fake.attachVideo = async () => ({ ok: false, error: '成片传到广告账户失败' })
    const receipt = await runAssetDualReview(harness.fake, { clientId: CLIENT, workOrderId: WO })
    expect(receipt).toMatchObject({ pooled: false, status: 'upload_failed' })
    expect(harness.writes[0]?.patch.status).toBeUndefined()
    expect(harness.pools).toEqual([])
  })

  it('still pools a pass when upload is switched off', async () => {
    const harness = io({})
    harness.fake.attachVideo = async () => ({ ok: true, videoId: null, accountId: null })
    const receipt = await runAssetDualReview(harness.fake, { clientId: CLIENT, workOrderId: WO })
    expect(receipt).toMatchObject({ status: 'pooled' })
    expect(receipt.videoId).toBeUndefined()
    expect(harness.pools[0]?.find((entry) => entry.ref === WO)?.alias_refs).toBeUndefined()
    expect(harness.writes[0]?.patch.status).toBe('archived')
  })

  it('uses a video id already stored on an archived pass without uploading again', async () => {
    const harness = io({
      status: 'archived',
      reviewRef: {
        dual_review: { passed: true, pool: 'pending', reviewer: 'ai-dual-review' },
        meta_video_source: 'account_upload',
        meta_video_id: '555',
        meta_video_account: 'act_1',
      },
    })
    let uploads = 0
    harness.fake.attachVideo = async () => {
      uploads += 1
      return { ok: false, error: 'should not upload' }
    }
    const receipt = await runAssetDualReview(harness.fake, { clientId: CLIENT, workOrderId: WO })
    expect(uploads).toBe(0)
    expect(receipt).toMatchObject({ pooled: true, videoId: '555' })
    expect(harness.pools[0]?.find((entry) => entry.ref === WO)?.alias_refs).toEqual(['555'])
  })
})
