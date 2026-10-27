import { describe, expect, it, vi } from 'vitest'
import {
  acceptUploadedVideoId,
  accountUploadReceipt,
  admitFinishedAsset,
  creativePoolUploadEnabled,
  factoryPublicVideoUrl,
  pickPrimaryAdAccount,
  reusableVideoId,
  type AdmitDeps,
  type AdmitWorkOrder,
} from '../admit-finished-asset'

const ACCOUNT = 'act_1234567890'
const OTHER = 'act_1098765432'

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
    ...over,
  }
  return { d, upload, remember, token }
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

describe('admitFinishedAsset', () => {
  it('ignores orders that are not material waiting for review', async () => {
    const { d, upload } = deps()
    const skipped = await admitFinishedAsset(order({ assetOnly: false }), d)
    const archived = await admitFinishedAsset(order({ status: 'archived' }), d)
    expect(skipped).toMatchObject({ action: 'not_material' })
    expect(archived).toMatchObject({ action: 'not_material' })
    expect(upload).not.toHaveBeenCalled()
  })

  it('skips upload when the switch is off', async () => {
    const { d, upload, remember } = deps({ uploadEnabled: false })
    const result = await admitFinishedAsset(order(), d)
    expect(result).toEqual({ ok: true, action: 'upload_disabled' })
    expect(upload).not.toHaveBeenCalled()
    expect(remember).not.toHaveBeenCalled()
  })

  it('uploads to the primary account and returns the video id without writing the pool', async () => {
    const { d, upload, remember } = deps()
    const result = await admitFinishedAsset(order(), d)
    expect(result).toEqual({ ok: true, action: 'uploaded', videoId: '555', accountId: ACCOUNT })
    expect(upload).toHaveBeenCalledWith(
      ACCOUNT,
      'https://files.example.test/storage/v1/object/public/content-factory/renders/c-1/wo-1/final.mp4',
      'tok',
      'asset wo-1',
    )
    expect(remember).toHaveBeenCalledWith('555', ACCOUNT)
  })

  it('does not remember a non-numeric video id', async () => {
    const { d, remember } = deps({ upload: vi.fn(async () => ({ ok: true as const, videoId: 'clip.mp4' })) })
    const result = await admitFinishedAsset(order(), d)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(422)
    expect(remember).not.toHaveBeenCalled()
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
    expect(result).toMatchObject({ ok: true, action: 'uploaded', videoId: '555', accountId: ACCOUNT })
    expect(upload).not.toHaveBeenCalled()
    expect(token).not.toHaveBeenCalled()
  })

  it('stops before remembering when Meta rejects the upload', async () => {
    const { d, remember } = deps({ upload: vi.fn(async () => ({ ok: false as const, error: 'HTTP 500' })) })
    const result = await admitFinishedAsset(order(), d)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(502)
    expect(remember).not.toHaveBeenCalled()
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

  it('reads a stored upload receipt', () => {
    const ref = { meta_video_source: 'account_upload', meta_video_id: '555', meta_video_account: ACCOUNT }
    expect(accountUploadReceipt(ref)).toEqual({ videoId: '555', accountId: ACCOUNT })
    expect(accountUploadReceipt({ ...ref, meta_video_source: 'hand' })).toBeNull()
    expect(accountUploadReceipt(null)).toBeNull()
  })

  it('reuses a receipt only for this account and this uploader', () => {
    const ref = { meta_video_source: 'account_upload', meta_video_id: '555', meta_video_account: ACCOUNT }
    expect(reusableVideoId(ref, ACCOUNT)).toBe('555')
    expect(reusableVideoId(ref, OTHER)).toBeNull()
    expect(reusableVideoId({ ...ref, meta_video_source: 'hand' }, ACCOUNT)).toBeNull()
  })
})
