import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ exchange: vi.fn(), access: vi.fn(), save: vi.fn() }))
vi.mock('@/lib/auth/client-access', () => ({ requireDashboardClientAccess: mocks.access }))
vi.mock('@/lib/platform-oauth/connection-store', () => ({ upsertConnection: mocks.save }))
vi.mock('@/lib/tiktok-oauth/client', () => ({
  TIKTOK_STATE_COOKIE: 'me_tiktok_oauth_state',
  TIKTOK_SCOPES: ['user.info.basic', 'video.publish'],
  verifyState: () => ({ clientId: 'test-client' }),
  exchangeCode: mocks.exchange,
  fetchDisplayName: vi.fn().mockResolvedValue('Test Creator'),
}))
import { GET } from '../route'
function request(cookie = true) {
  return new NextRequest('https://example.test/api/auth/tiktok/callback?code=test-code&state=test-state', {
    headers: cookie ? { cookie: 'me_tiktok_oauth_state=test-state' } : {},
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.access.mockResolvedValue({ ok: true })
  mocks.exchange.mockResolvedValue({ accessToken: 'test', refreshToken: 'test', openId: 'test-account', expiresIn: 100, scopes: ['user.info.basic', 'video.publish'] })
})
describe('TikTok OAuth callback safeguards', () => {
  it('returns a trusted cancellation to the same client without exchange or persistence', async () => {
    const response = await GET(new NextRequest('https://example.test/api/auth/tiktok/callback?error=access_denied&state=test-state', {
      headers: { cookie: 'me_tiktok_oauth_state=test-state' },
    }))
    expect(response.headers.get('location')).toContain('/clients/test-client/settings?tab=connect&tiktok=denied')
    expect(mocks.exchange).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
  })
  it('does not trust cancellation without its browser state cookie', async () => {
    const response = await GET(new NextRequest('https://example.test/api/auth/tiktok/callback?error=access_denied&state=test-state'))
    expect(response.headers.get('location')).not.toContain('/clients/test-client/')
    expect(mocks.access).not.toHaveBeenCalled()
    expect(mocks.exchange).not.toHaveBeenCalled()
  })
  it('rejects another browser before exchanging a code', async () => {
    const response = await GET(request(false))
    expect(response.headers.get('location')).toContain('bad_state')
    expect(mocks.exchange).not.toHaveBeenCalled()
  })
  it('rejects revoked client access before exchanging a code', async () => {
    mocks.access.mockResolvedValue({ ok: false })
    await GET(request())
    expect(mocks.exchange).not.toHaveBeenCalled()
  })
  it('does not persist an incomplete grant', async () => {
    mocks.exchange.mockResolvedValue({ openId: 'test-account', scopes: ['user.info.basic'] })
    const response = await GET(request())
    expect(response.headers.get('location')).toContain('missing_scopes')
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('persists actual grants and clears the browser state cookie', async () => {
    const response = await GET(request())
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'test-account', scopes: ['user.info.basic', 'video.publish'] }))
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
  })
})
