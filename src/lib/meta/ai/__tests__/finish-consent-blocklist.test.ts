import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'

const mocks = vi.hoisted(() => ({
  exchangeMetaTokenFields: vi.fn(),
  metaGraphGet: vi.fn(),
  requirePilotRevision: vi.fn(),
  requirePilotActive: vi.fn(),
  requireConnectAllowed: vi.fn(),
  upsertConnection: vi.fn(),
  requireNotBlocked: vi.fn(),
}))

vi.mock('../../../meta-oauth/client', () => ({
  exchangeMetaTokenFields: mocks.exchangeMetaTokenFields,
}))

vi.mock('@/lib/meta/graph-read', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/meta/graph-read')>()
  return {
    ...actual,
    metaGraphGet: mocks.metaGraphGet,
  }
})

vi.mock('@/lib/meta/ai/entitlement', () => ({
  requirePilotRevision: mocks.requirePilotRevision,
  requirePilotActive: mocks.requirePilotActive,
  requireConnectAllowed: mocks.requireConnectAllowed,
}))

vi.mock('@/lib/platform-oauth/connection-store', () => ({
  upsertConnection: mocks.upsertConnection,
}))

vi.mock('@/lib/meta/ai/blocklist', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/meta/ai/blocklist')>()
  return {
    ...actual,
    requireNotBlocked: mocks.requireNotBlocked,
  }
})

import { finishAdsConsent } from '../../../meta-oauth/ads-read'
import { MetaReadError } from '../../graph-read'

const CLIENT_ID = '11111111-1111-1111-1111-111111111111'
const PRINCIPAL_ID = '22222222-2222-2222-2222-222222222222'
const REVISION = 'rev-1'

const expectedKey = createHash('sha256').update('meta-ads-user:ads_user:111').digest('hex')

beforeEach(() => {
  vi.clearAllMocks()
  process.env.FACEBOOK_APP_ID = 'app-id'
  process.env.FACEBOOK_APP_SECRET = 'app-secret'
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test'
  process.env.META_ADS_AI_GRAPH_VERSION = 'v21.0'

  mocks.exchangeMetaTokenFields.mockResolvedValue({ token: 't', seconds: 3600 })
  mocks.metaGraphGet.mockImplementation((path: string) => {
    if (path === 'me/permissions') {
      return Promise.resolve({ data: [{ permission: 'ads_read', status: 'granted' }] })
    }
    if (path === 'me') {
      return Promise.resolve({ id: '111' })
    }
    return Promise.reject(new Error(`unexpected path ${path}`))
  })
  mocks.requirePilotRevision.mockResolvedValue(undefined)
  mocks.upsertConnection.mockResolvedValue(undefined)
})

describe('finishAdsConsent blocklist', () => {
  it('refuses a blocked Facebook user and stores nothing', async () => {
    mocks.requireNotBlocked.mockRejectedValue(new MetaReadError('blocked', 403))

    await expect(
      finishAdsConsent('code', CLIENT_ID, PRINCIPAL_ID, REVISION),
    ).rejects.toMatchObject({ code: 'blocked' })

    expect(mocks.requireNotBlocked).toHaveBeenCalledWith('facebook_user', expectedKey)
    expect(mocks.upsertConnection).not.toHaveBeenCalled()
  })

  it('stores the connection when the Facebook user is not blocked', async () => {
    mocks.requireNotBlocked.mockResolvedValue(undefined)

    await expect(
      finishAdsConsent('code', CLIENT_ID, PRINCIPAL_ID, REVISION),
    ).resolves.toBeUndefined()

    expect(mocks.requireNotBlocked).toHaveBeenCalledWith('facebook_user', expectedKey)
    expect(mocks.upsertConnection).toHaveBeenCalledTimes(1)
    expect(mocks.upsertConnection).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'ads_user:111' }),
    )
  })
})
