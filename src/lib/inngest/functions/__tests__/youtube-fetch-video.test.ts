import { describe, expect, it, vi } from 'vitest'
import { fetchFactoryVideo } from '../youtube-publish'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co'
const video = (over: ResponseInit = {}) =>
  new Response('xx', { status: 200, headers: { 'content-type': 'video/mp4' }, ...over })

describe('fetchFactoryVideo', () => {
  it.each(['http://proj.supabase.co/a.mp4', 'https://evil.example.com/a.mp4', 'https://169.254.169.254/x'])(
    'refuses %s without fetching',
    async (url) => {
      const f = vi.fn()
      await expect(fetchFactoryVideo(url, f)).rejects.toThrow('host not allowed')
      expect(f).not.toHaveBeenCalled()
    },
  )
  it('refuses non-video content and oversize declared length', async () => {
    await expect(
      fetchFactoryVideo('https://proj.supabase.co/a', vi.fn().mockResolvedValue(video({ headers: { 'content-type': 'text/html' } }))),
    ).rejects.toThrow('not a video')
    await expect(
      fetchFactoryVideo('https://proj.supabase.co/a', vi.fn().mockResolvedValue(video({ headers: { 'content-type': 'video/mp4', 'content-length': '999999999999' } }))),
    ).rejects.toThrow('too large')
  })
  it('does not follow redirects and returns the blob for a factory video', async () => {
    const f = vi.fn().mockResolvedValue(video())
    const blob = await fetchFactoryVideo('https://proj.supabase.co/a.mp4', f)
    expect(blob.size).toBe(2)
    expect(f.mock.calls[0][1]).toMatchObject({ redirect: 'error' })
  })
})
