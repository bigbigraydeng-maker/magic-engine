import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ exchange: vi.fn(), access: vi.fn(), save: vi.fn(), guard: vi.fn() }))
vi.mock('@/lib/platform-oauth/connection-guard', () => ({ checkSocialAccountAvailable: mocks.guard }))
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
  mocks.guard.mockResolvedValue('ok')
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

  it('persists after the guard says ok, checking this client + tiktok + the returned account', async () => {
    await GET(request())
    expect(mocks.guard).toHaveBeenCalledWith('test-client', 'tiktok', 'test-account')
    expect(mocks.save).toHaveBeenCalledTimes(1)
  })
  it('refuses an account already attached to another client, without saying whose', async () => {
    mocks.guard.mockResolvedValue('account_in_use')
    const response = await GET(request())
    const location = response.headers.get('location') ?? ''
    expect(location).toContain('/clients/test-client/settings?tab=connect&tiktok=needs_team_check')
    expect(location).not.toMatch(/other|client_id|test-account/)
    expect(mocks.save).not.toHaveBeenCalled()
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
  })
  it('refuses a second, different account for the same client', async () => {
    mocks.guard.mockResolvedValue('has_other_account')
    const response = await GET(request())
    expect(response.headers.get('location')).toContain('tiktok=has_other_account')
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('fails closed when the guard itself errors', async () => {
    mocks.guard.mockRejectedValue(new Error('db down'))
    const response = await GET(request())
    expect(response.headers.get('location')).toContain('tiktok=save_failed')
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('maps a unique-index race (23505) to needs_team_check', async () => {
    mocks.save.mockRejectedValue(Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }))
    const response = await GET(request())
    expect(response.headers.get('location')).toContain('tiktok=needs_team_check')
  })
  it('maps any other save error to save_failed instead of a 500', async () => {
    mocks.save.mockRejectedValue(new Error('boom'))
    const response = await GET(request())
    expect(response.headers.get('location')).toContain('tiktok=save_failed')
  })
})
