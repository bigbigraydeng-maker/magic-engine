// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ access: vi.fn(), from: vi.fn(), observation: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/client-access', () => ({ requireDashboardClientAccess: mocks.access }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))
vi.mock('@/lib/reels/youtube-metadata', () => ({ fetchYouTubeObservation: mocks.observation }))
import { GET, POST } from './route'
const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const context = { params: { id: CLIENT } }
function req(input?: unknown) { const body = input && typeof input === 'object' ? { expectedLinks: { youtube: '', tiktok: '', preview: '' }, ...input } : input; return new NextRequest('http://localhost/api/series', { method: body ? 'POST' : 'GET', ...(body ? { body: JSON.stringify(body) } : {}) }) }
function database(config: unknown, ids: unknown[] = [{ id: CLIENT }]) {
  const read = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { factory_config: config }, error: null }) }
  const write = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), filter: vi.fn().mockReturnThis(), select: vi.fn().mockResolvedValue({ data: ids, error: null }) }
  mocks.from.mockReturnValueOnce(read).mockReturnValueOnce(write)
  return { read, write }
}
beforeEach(() => { vi.clearAllMocks(); mocks.from.mockReset(); mocks.access.mockResolvedValue({ ok: true }); mocks.observation.mockResolvedValue({ status: 'ok', views: 12, likes: 1, observedAt: '2026-10-15T00:00:00Z' }) })
describe('client series route', () => {
  it('denies both methods before DB or provider access', async () => {
    mocks.access.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
    expect((await GET(req(), context)).status).toBe(403)
    expect((await POST(req({}), context)).status).toBe(403)
    expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.observation).not.toHaveBeenCalled()
  })
  it('does not leak CTS manifest to another authorised customer', async () => {
    const other = { params: { id: 'another-client' } }
    expect(await (await GET(req(), other)).json()).toEqual({ name: '', episodes: [] })
    expect((await POST(req({ episodeKey: 'shanghai-beyond-skyline', links: {} }), other)).status).toBe(404)
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('shows Winter candidates and reads only linked counters', async () => {
    const { read } = database({ documentary_links: { 'shanghai-beyond-skyline': { youtube: 'https://youtu.be/abcdefghijk', tiktok: '', preview: '' } } })
    const r = await GET(req(), context); const data = await r.json()
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(read.eq).toHaveBeenCalledWith('id', CLIENT)
    expect(data.episodes.filter((e: { series: string }) => e.series.startsWith('Winter'))).toHaveLength(5)
    expect(data.episodes[0].youtube.views).toBe(12)
    expect(data.episodes[1].youtube).toMatchObject({ status: 'unlinked', views: null })
    expect(mocks.observation).toHaveBeenCalledExactlyOnceWith('abcdefghijk')
  })
  it('atomically compares the entire old configuration and preserves other fields', async () => {
    const original = { render: { engine: 'ffmpeg' }, private_setting: true }
    const { write } = database(original)
    const r = await POST(req({ episodeKey: 'winter-jilin-rime', links: { youtube: 'https://youtu.be/abcdefghijk', tiktok: '', preview: '' } }), context)
    expect(r.status).toBe(200)
    expect(write.filter).toHaveBeenCalledWith('factory_config', 'eq', JSON.stringify(original))
    expect(write.eq).toHaveBeenCalledWith('id', CLIENT)
    expect(write.update).toHaveBeenCalledWith({ factory_config: expect.objectContaining(original) })
    expect(await r.json()).toEqual({ ok: true, no_publish: true })
  })
  it('rejects conflicts and handles the null configuration case', async () => {
    const { write } = database(null, [])
    const r = await POST(req({ episodeKey: 'winter-jilin-rime', links: { youtube: '', tiktok: '', preview: '' } }), context)
    expect(write.is).toHaveBeenCalledWith('factory_config', null)
    expect(r.status).toBe(409)
  })

  it('rejects an old editing snapshot after another editor saved the same episode', async () => {
    const emptyLinks = { youtube: '', tiktok: '', preview: '' }
    const first = database({ documentary_links: {} })
    const original = await (await GET(req(), context)).json()
    const expectedLinks = original.episodes.find((e: { key: string }) => e.key === 'winter-jilin-rime').links
    expect(expectedLinks).toEqual(emptyLinks)
    mocks.from.mockReset()
    database({ documentary_links: {} })
    const newLinks = { ...emptyLinks, youtube: 'https://www.youtube.com/watch?v=abcdefghijk' }
    expect((await POST(req({ episodeKey: 'winter-jilin-rime', links: newLinks, expectedLinks }), context)).status).toBe(200)
    mocks.from.mockReset()
    const { write } = database({ documentary_links: { 'winter-jilin-rime': newLinks } })
    expect((await POST(req({ episodeKey: 'winter-jilin-rime', links: { ...emptyLinks, youtube: 'https://youtu.be/zyxwvutsrqp' }, expectedLinks }), context)).status).toBe(409)
    expect(write.update).not.toHaveBeenCalled()
    expect(first.read.eq).toHaveBeenCalledWith('id', CLIENT)
  })
  it('rejects invalid links/unknown episodes before touching DB and reports DB outages', async () => {
    expect((await POST(req({ episodeKey: 'unknown', links: {} }), context)).status).toBe(404)
    expect((await POST(req({ episodeKey: 'winter-jilin-rime', links: { youtube: 'https://evil.test/watch?v=abcdefghijk', tiktok: '', preview: '' } }), context)).status).toBe(400)
    expect(mocks.from).not.toHaveBeenCalled()
    const { read } = database(null); read.single.mockResolvedValue({ data: null, error: { message: 'unavailable' } })
    expect((await GET(req(), context)).status).toBe(503)
  })
})
