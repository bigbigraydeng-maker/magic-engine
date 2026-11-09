import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ access: vi.fn(), admin: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(),
  maybeSingle: vi.fn(), facts: vi.fn() }))
vi.mock('@/lib/auth/client-access', () => ({ requireOnboardingClientAccess: mocks.access }))
vi.mock('@/lib/auth/require-admin', () => ({ requireGlobalAdmin: mocks.admin }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))
vi.mock('@/lib/platform-oauth/connection-store', () => ({ listSocialConnectionFacts: mocks.facts }))
import { GET } from '../route'

const request = () => new NextRequest('http://localhost/api/clients/client-a/social-connections')
const context = { params: { id: 'client-a' } }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.access.mockResolvedValue({ ok: true })
  mocks.admin.mockResolvedValue({ ok: true })
  mocks.from.mockReturnValue({ select: mocks.select })
  mocks.select.mockReturnValue({ eq: mocks.eq })
  mocks.eq.mockReturnValue({ maybeSingle: mocks.maybeSingle })
  mocks.maybeSingle.mockResolvedValue({ data: { instagram_handle: 'registered', facebook_page_url: 'https://facebook.com/example',
    tiktok_handle: 'registered', factory_config: { publish_target: { platform: 'facebook', page_id: '12345' }, hidden: 'secret-note' },
    youtube_channel_id: null, private_extra: 'secret-client-value' }, error: null })
  mocks.facts.mockResolvedValue([])
})

describe('client social facts GET', () => {
  it.each([401, 403, 500])('rejects access failure %s before reading any business data', async status => {
    mocks.access.mockResolvedValue({ ok: false, status, error: 'Access denied' })
    expect((await GET(request(), context)).status).toBe(status)
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.facts).not.toHaveBeenCalled()
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it('scopes both reads to the authorised client and returns explicit safe projections', async () => {
    const response = await GET(request(), context)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.eq).toHaveBeenCalledWith('id', 'client-a')
    expect(mocks.facts).toHaveBeenCalledWith('client-a')
    expect(mocks.select).toHaveBeenCalledWith('instagram_handle,facebook_page_url,tiktok_handle,factory_config,youtube_channel_id')
    const body = await response.json()
    expect(body.channels).toHaveLength(6)
    expect(body.channels[0].targetAccountId).toBe('12345')
    expect(JSON.stringify(body)).not.toContain('secret-')
  })
  it.each(['client', 'connections'])('reports %s lookup failure as unavailable, never as disconnected', async source => {
    if (source === 'client') mocks.maybeSingle.mockResolvedValue({ data: null, error: { message: 'secret-db-error' } })
    else mocks.facts.mockRejectedValue(new Error('secret-db-error'))
    const response = await GET(request(), context)
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.channels).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('secret-')
  })
  it('hides configuration actions from ordinary customer members', async () => {
    mocks.admin.mockResolvedValue({ ok: false, status: 403 })
    expect((await (await GET(request(), context)).json()).canManageConfiguration).toBe(false)
  })
  it.each([null, [], 'damaged'])('keeps malformed factory config %j unset', async factory_config => {
    mocks.maybeSingle.mockResolvedValue({ data: { factory_config }, error: null })
    const body = await (await GET(request(), context)).json()
    expect(body.channels[0].authorization).toBe('target_missing')
  })
  it('does not mistake the inbox Page for the publishing Page', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { factory_config: {}, facebook_page_id: '12345' }, error: null })
    const body = await (await GET(request(), context)).json()
    expect(body.channels[0].targetAccountId).toBeNull()
  })
})
