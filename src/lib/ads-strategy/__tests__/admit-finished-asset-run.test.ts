import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const mocks = vi.hoisted(() => ({
  registered: vi.fn(),
  accounts: vi.fn(),
  token: vi.fn(),
  upload: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/meta/campaign-ownership', () => ({ getRegisteredAccountIds: mocks.registered }))
vi.mock('@/lib/meta/client-ad-accounts', () => ({ getClientAdAccounts: mocks.accounts }))
vi.mock('@/lib/meta/token-manager', () => ({ getMetaTokenForClient: mocks.token }))
vi.mock('@/lib/meta/asset-upload', () => ({ uploadVideoToMeta: mocks.upload }))

import { admitAssetBeforeAccept } from '../admit-finished-asset-run'

const ACCOUNT = 'act_1234567890'

function db(row: Record<string, unknown>) {
  const updates: unknown[] = []
  let reads = 0
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  for (const method of ['select', 'eq', 'in', 'maybeSingle']) builder[method] = chain
  builder.update = (payload: unknown) => { updates.push(payload); return builder }
  ;(builder as { then: unknown }).then = (resolve: (value: { data: unknown; error: null }) => unknown) => {
    reads += 1
    const data = reads === 1 ? row : [{ id: 'wo-1' }]
    return resolve({ data, error: null })
  }
  return { client: { from: () => builder } as unknown as SupabaseClient, updates }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://files.example.test'
  delete process.env.ME_CREATIVE_POOL_META_UPLOAD
  mocks.registered.mockResolvedValue({ ids: [ACCOUNT] })
  mocks.accounts.mockResolvedValue([{ adAccountId: ACCOUNT, label: null, isPrimary: true }])
  mocks.token.mockResolvedValue('tok')
  mocks.upload.mockResolvedValue({ ok: true, asset: { kind: 'video', videoId: '555' } })
})

describe('admitAssetBeforeAccept', () => {
  it('uploads the finished file and remembers the video id without writing the pool', async () => {
    const { client, updates } = db({
      id: 'wo-1',
      client_id: 'c-1',
      status: 'in_review',
      brief: { remotion: { deliverable: 'asset_only' } },
      output: { video_path: 'renders/c-1/wo-1/final.mp4' },
      review_ref: {},
    })
    const result = await admitAssetBeforeAccept(client, 'wo-1')
    expect(result).toEqual({ ok: true, action: 'uploaded', videoId: '555', accountId: ACCOUNT })
    expect(mocks.upload).toHaveBeenCalledWith(
      ACCOUNT,
      'https://files.example.test/storage/v1/object/public/content-factory/renders/c-1/wo-1/final.mp4',
      'tok',
      'asset wo-1',
    )
    expect(mocks.upload.mock.calls[0][2]).toBe('tok')
    expect(JSON.stringify(updates[0])).toContain('account_upload')
    expect(JSON.stringify(updates[0])).not.toContain('tok')
  })

  it('does not upload a render path that belongs to another order', async () => {
    const { client } = db({
      id: 'wo-1',
      client_id: 'c-1',
      status: 'in_review',
      brief: { remotion: { deliverable: 'asset_only' } },
      output: { video_path: 'renders/other/wo-9/final.mp4' },
      review_ref: {},
    })
    const result = await admitAssetBeforeAccept(client, 'wo-1')
    expect(result.ok).toBe(false)
    expect(mocks.upload).not.toHaveBeenCalled()
  })
})
