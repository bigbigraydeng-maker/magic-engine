import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  access: vi.fn(), exchange: vi.fn(), upsert: vi.fn(),
}))
vi.mock('@/lib/auth/client-access', () => ({ requireDashboardClientAccess: mocks.access }))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({
    maybeSingle: vi.fn(async () => ({ data: {
      facebook_page_id: null,
      factory_config: { publish_target: { platform: 'facebook', page_id: '778899' } },
    }, error: null })),
  })) })) })) },
}))
vi.mock('@/lib/platform-oauth/connection-store', () => ({ upsertConnection: mocks.upsert }))
vi.mock('@/lib/meta-oauth/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/meta-oauth/client')>(),
  exchangeCode: mocks.exchange,
  exchangeForLongLivedToken: vi.fn(async () => 'test-long-token'),
  listPagesWithTokens: vi.fn(async () => [{ pageId: '778899', pageName: 'Example Page', pageToken: 'test-page-token' }]),
  listGrantedScopes: vi.fn(async () => ['pages_show_list', 'pages_manage_posts']),
}))

import { GET as connect } from '../route'
import { GET as callback } from '../../callback/route'
import { META_STATE_COOKIE } from '@/lib/meta-oauth/client'

const CLIENT = '11111111-1111-1111-1111-111111111111'
const APP = 'https://me.example'

async function begin() {
  const response = await connect(new NextRequest(`${APP}/api/auth/facebook/connect?client_id=${CLIENT}&intent=publishing`))
  const state = new URL(response.headers.get('location') ?? '').searchParams.get('state') ?? ''
  expect(response.cookies.get(META_STATE_COOKIE)?.value).toBe(state)
  return state
}

function finish(state: string, cookie: string, cancelled = false) {
  const url = new URL(`${APP}/api/auth/facebook/callback`)
  url.searchParams.set('state', state)
  url.searchParams.set(cancelled ? 'error' : 'code', cancelled ? 'access_denied' : 'test-code')
  const request = new NextRequest(url)
  request.cookies.set(META_STATE_COOKIE, cookie)
  return callback(request)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('FACEBOOK_APP_ID', 'test-app')
  vi.stubEnv('FACEBOOK_APP_SECRET', 'test-secret')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', APP)
  mocks.access.mockResolvedValue({ ok: true, user: { id: 'operator-one' } })
  mocks.exchange.mockResolvedValue('test-short-token')
  mocks.upsert.mockResolvedValue(undefined)
})
afterEach(() => vi.unstubAllEnvs())

describe('real connect/callback state and response-cookie boundary (no provider network)', () => {
  it('round-trips a signed browser-bound publishing grant into the precise client and Page', async () => {
    const state = await begin()
    const response = await finish(state, state)
    const location = new URL(response.headers.get('location') ?? '')
    expect(location.pathname).toBe(`/dashboard/clients/${CLIENT}`)
    expect(location.searchParams.get('meta')).toBe('publish_ready')
    expect(response.cookies.get(META_STATE_COOKIE)?.value).toBe('')
    expect(mocks.upsert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ clientId: CLIENT, accountId: '778899', scopes: ['pages_show_list', 'pages_manage_posts'] }))
  })

  it('returns a genuine cancellation to its client without exchanging or writing', async () => {
    const state = await begin()
    const response = await finish(state, state, true)
    const location = new URL(response.headers.get('location') ?? '')
    expect(location.pathname).toBe(`/dashboard/clients/${CLIENT}`)
    expect(location.searchParams.get('meta')).toBe('denied')
    expect(mocks.exchange).not.toHaveBeenCalled()
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('rejects a signed state replayed by a different operator', async () => {
    const state = await begin()
    mocks.access.mockResolvedValue({ ok: true, user: { id: 'operator-two' } })
    const response = await finish(state, state)
    expect(new URL(response.headers.get('location') ?? '').searchParams.get('meta')).toBe('bad_state')
    expect(mocks.exchange).not.toHaveBeenCalled()
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('preserves a newer attempt when an earlier tab returns late', async () => {
    const oldState = await begin()
    const currentState = await begin()
    expect(oldState).not.toBe(currentState)
    const oldResponse = await finish(oldState, currentState)
    expect(oldResponse.headers.get('set-cookie')).toBeNull()
    const response = await finish(currentState, currentState)
    expect(new URL(response.headers.get('location') ?? '').searchParams.get('meta')).toBe('publish_ready')
    expect(mocks.upsert).toHaveBeenCalledTimes(1)
  })
})
