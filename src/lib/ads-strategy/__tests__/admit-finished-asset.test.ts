import { describe, expect, it, vi } from 'vitest'
import type { ConfigVersion, CreativePoolEntry } from '../config'
import {
  acceptUploadedVideoId,
  admitFinishedAsset,
  creativePoolUploadEnabled,
  factoryPublicVideoUrl,
  pickPrimaryAdAccount,
  placeWorkOrderCandidate,
  reusableVideoId,
  type AdmitDeps,
  type AdmitWorkOrder,
} from '../admit-finished-asset'

const ACCOUNT = 'act_1234567890'
const OTHER = 'act_1098765432'
const VERSION: ConfigVersion = { exists: true, updatedAt: '2026-10-01T00:00:00.000Z' }

function order(over: Partial<AdmitWorkOrder> = {}): AdmitWorkOrder {
  return {
    id: 'wo-1',
    clientId: 'c-1',
    status: 'in_review',
    assetOnly: true,
    videoPath: 'renders/c-1/wo-1/final.mp4',
    reviewRef: {},
    ...over,
  }
}

function deps(over: Partial<AdmitDeps> = {}) {
  const upload = vi.fn<AdmitDeps['upload']>(async () => ({ ok: true as const, videoId: '555' }))
  const remember = vi.fn<AdmitDeps['remember']>(async () => ({ ok: true as const }))
  const writePool = vi.fn<AdmitDeps['writePool']>(async () => ({ ok: true as const }))
  const token = vi.fn<AdmitDeps['token']>(async () => 'tok')
  const d: AdmitDeps = {
    uploadEnabled: true,
    publicBase: 'https://files.example.test/storage/v1/object/public/content-factory',
    accounts: async () => ({
      ok: true as const,
      accounts: [{ adAccountId: ACCOUNT, isPrimary: true }],
      registeredIds: [ACCOUNT],
    }),
    token,
    upload,
    remember,
    loadPool: async () => ({ ok: true as const, pool: [], version: VERSION }),
    writePool,
    ...over,
  }
  return { d, upload, remember, writePool, token }
}

describe('creative pool upload switch', () => {
  it('defaults on, and 0 turns it off', () => {
    expect(creativePoolUploadEnabled({})).toBe(true)
    expect(creativePoolUploadEnabled({ ME_CREATIVE_POOL_META_UPLOAD: '1' })).toBe(true)
    expect(creativePoolUploadEnabled({ ME_CREATIVE_POOL_META_UPLOAD: '0' })).toBe(false)
  })
})

describe('pickPrimaryAdAccount', () => {
  it('uses the single primary account', () => {
    expect(pickPrimaryAdAccount([
      { adAccountId: OTHER, isPrimary: false },
      { adAccountId: ACCOUNT, isPrimary: true },
    ])).toEqual({ ok: true, adAccountId: ACCOUNT })
  })

  it('uses the only account even when it is not flagged primary', () => {
    expect(pickPrimaryAdAccount([{ adAccountId: ACCOUNT, isPrimary: false }])).toEqual({ ok: true, adAccountId: ACCOUNT })
  })

  it('refuses when there is no account or no unique primary', () => {
    expect(pickPrimaryAdAccount([]).ok).toBe(false)
    expect(pickPrimaryAdAccount([
      { adAccountId: ACCOUNT, isPrimary: false },
      { adAccountId: OTHER, isPrimary: false },
    ]).ok).toBe(false)
  })
})

describe('acceptUploadedVideoId', () => {
  it('accepts a numeric id uploaded to a registered account', () => {
    expect(acceptUploadedVideoId({
      uploadedToAccountId: ACCOUNT,
      registeredAccountIds: [ACCOUNT],
      returnedVideoId: '555',
    })).toEqual({ ok: true, videoId: '555' })
  })

  it('rejects a non-numeric id and an account that is not registered', () => {
    expect(acceptUploadedVideoId({
      uploadedToAccountId: ACCOUNT,
      registeredAccountIds: [ACCOUNT],
      returnedVideoId: 'not-a-video',
    }).ok).toBe(false)
    expect(acceptUploadedVideoId({
      uploadedToAccountId: OTHER,
      registeredAccountIds: [ACCOUNT],
      returnedVideoId: '555',
    }).ok).toBe(false)
  })
})

describe('placeWorkOrderCandidate', () => {
  it('appends a candidate work-order entry and does not approve it', () => {
    const placed = placeWorkOrderCandidate([], 'wo-1', '555')
    expect(placed.changed).toBe(true)
    expect(placed.status).toBe('candidate')
    expect(placed.pool).toEqual([
      { kind: 'work_order', ref: 'wo-1', status: 'candidate', alias_refs: ['555'] },
    ])
  })

  it('keeps an already approved row approved when the video id is unchanged', () => {
    const approved: CreativePoolEntry = {
      kind: 'work_order',
      ref: 'wo-1',
      status: 'approved',
      approved_by: 'a@x.test',
      approved_at: '2026-10-01T00:00:00.000Z',
      alias_refs: ['555'],
    }
    const placed = placeWorkOrderCandidate([approved], 'wo-1', '555')
    expect(placed.changed).toBe(false)
    expect(placed.status).toBe('approved')
    expect(placed.pool[0]).toEqual(approved)
  })

  it('drops the old approval when a new video id is added to an approved work order', () => {
    const approved: CreativePoolEntry = {
      kind: 'work_order',
      ref: 'wo-1',
      status: 'approved',
      approved_by: 'a@x.test',
      approved_at: '2026-10-01T00:00:00.000Z',
      alias_refs: ['111'],
      promo_window: { kind: 'evergreen' },
    }
    const placed = placeWorkOrderCandidate([approved], 'wo-1', '555')
    expect(placed.changed).toBe(true)
    expect(placed.status).toBe('candidate')
    expect(placed.pool).toEqual([{
      kind: 'work_order',
      ref: 'wo-1',
      status: 'candidate',
      alias_refs: ['111', '555'],
      promo_window: { kind: 'evergreen' },
    }])
  })

  it('does not add a second row when the video id is already in the pool', () => {
    const existing: CreativePoolEntry = { kind: 'meta_video', ref: '555', status: 'candidate' }
    const placed = placeWorkOrderCandidate([existing], 'wo-1', '555')
    expect(placed.changed).toBe(false)
    expect(placed.pool).toHaveLength(1)
  })
})

describe('admitFinishedAsset', () => {
  it('ignores orders that are not material waiting for review', async () => {
    const { d, upload } = deps()
    const skipped = await admitFinishedAsset(order({ assetOnly: false }), d)
    const archived = await admitFinishedAsset(order({ status: 'archived' }), d)
    expect(skipped).toMatchObject({ action: 'not_material' })
    expect(archived).toMatchObject({ action: 'not_material' })
    expect(upload).not.toHaveBeenCalled()
  })

  it('skips upload and the pool when the switch is off', async () => {
    const { d, upload, writePool } = deps({ uploadEnabled: false })
    const result = await admitFinishedAsset(order(), d)
    expect(result).toEqual({ ok: true, action: 'upload_disabled' })
    expect(upload).not.toHaveBeenCalled()
    expect(writePool).not.toHaveBeenCalled()
  })

  it('uploads to the primary account and enters the pool as candidate', async () => {
    const { d, upload, remember, writePool } = deps()
    const result = await admitFinishedAsset(order(), d)
    expect(result).toEqual({ ok: true, action: 'pooled', videoId: '555', status: 'candidate' })
    expect(upload).toHaveBeenCalledWith(
      ACCOUNT,
      'https://files.example.test/storage/v1/object/public/content-factory/renders/c-1/wo-1/final.mp4',
      'tok',
      'asset wo-1',
    )
    expect(remember).toHaveBeenCalledWith('555', ACCOUNT)
    const written = writePool.mock.calls[0][0] as CreativePoolEntry[]
    expect(written).toEqual([{ kind: 'work_order', ref: 'wo-1', status: 'candidate', alias_refs: ['555'] }])
    expect(written[0]).not.toHaveProperty('approved_by')
  })

  it('does not upload or archive-side-effect when the video id is not numeric', async () => {
    const { d, remember, writePool } = deps({ upload: vi.fn(async () => ({ ok: true as const, videoId: 'clip.mp4' })) })
    const result = await admitFinishedAsset(order(), d)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(422)
    expect(remember).not.toHaveBeenCalled()
    expect(writePool).not.toHaveBeenCalled()
  })

  it('refuses a path that is not this order’s render file', async () => {
    const { d, upload } = deps()
    const result = await admitFinishedAsset(order({ videoPath: 'https://evil.example/renders/c-1/wo-1/final.mp4' }), d)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(422)
    expect(upload).not.toHaveBeenCalled()
  })

  it('does not upload when the chosen account is not registered to this client', async () => {
    const { d, upload } = deps({
      accounts: async () => ({
        ok: true,
        accounts: [{ adAccountId: OTHER, isPrimary: true }],
        registeredIds: [ACCOUNT],
      }),
    })
    const result = await admitFinishedAsset(order(), d)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
    expect(upload).not.toHaveBeenCalled()
  })

  it('reuses the stored receipt instead of uploading again', async () => {
    const { d, upload, token } = deps()
    const result = await admitFinishedAsset(order({
      reviewRef: { meta_video_source: 'account_upload', meta_video_id: '555', meta_video_account: ACCOUNT },
    }), d)
    expect(result).toMatchObject({ ok: true, action: 'pooled', videoId: '555' })
    expect(upload).not.toHaveBeenCalled()
    expect(token).not.toHaveBeenCalled()
  })

  it('retries the pool write once after a conflict', async () => {
    const writePool = vi.fn<AdmitDeps['writePool']>()
      .mockResolvedValueOnce({ ok: false, conflict: true, error: 'conflict' })
      .mockResolvedValueOnce({ ok: true })
    const { d } = deps({ writePool })
    const result = await admitFinishedAsset(order(), d)
    expect(result).toMatchObject({ ok: true, action: 'pooled' })
    expect(writePool).toHaveBeenCalledTimes(2)
  })

  it('stops before the pool when Meta rejects the upload', async () => {
    const { d, remember, writePool } = deps({ upload: vi.fn(async () => ({ ok: false as const, error: 'HTTP 500' })) })
    const result = await admitFinishedAsset(order(), d)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(502)
    expect(remember).not.toHaveBeenCalled()
    expect(writePool).not.toHaveBeenCalled()
  })
})

describe('url and receipt helpers', () => {
  it('builds only an https render url', () => {
    expect(factoryPublicVideoUrl('renders/c-1/wo-1/final.mp4', 'https://files.example.test/bucket')).toBe(
      'https://files.example.test/bucket/renders/c-1/wo-1/final.mp4',
    )
    expect(factoryPublicVideoUrl('renders/c-1/wo-1/../x.mp4', 'https://files.example.test/bucket')).toBeNull()
    expect(factoryPublicVideoUrl('renders/c-1/wo-1/final.mp4', 'http://files.example.test/bucket')).toBeNull()
  })

  it('reuses a receipt only for this account and this uploader', () => {
    const ref = { meta_video_source: 'account_upload', meta_video_id: '555', meta_video_account: ACCOUNT }
    expect(reusableVideoId(ref, ACCOUNT)).toBe('555')
    expect(reusableVideoId(ref, OTHER)).toBeNull()
    expect(reusableVideoId({ ...ref, meta_video_source: 'hand' }, ACCOUNT)).toBeNull()
  })
})
