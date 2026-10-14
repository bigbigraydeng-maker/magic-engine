import { describe, it, expect } from 'vitest'
import { youtubeUrl, tiktokUrl, previewUrl, validateLinks, mergeLinks } from './model'

describe('series link validation', () => {
  it('canonicalises actual YouTube URLs and only exact video IDs', () => {
    expect(youtubeUrl('https://youtu.be/abcdefghijk?t=4')).toBe('https://www.youtube.com/watch?v=abcdefghijk')
    expect(youtubeUrl('https://www.youtube.com/shorts/abcdefghijk')).toBe('https://www.youtube.com/watch?v=abcdefghijk')
    for (const value of ['https://evil.test/watch?v=abcdefghijk', 'https://youtube.com.evil.test/watch?v=abcdefghijk', 'https://evil.test/youtu.be/abcdefghijk', 'https://youtube.com/watch?v=abcdefghijkextra', 'http://youtu.be/abcdefghijk', 'https://user:pass@youtu.be/abcdefghijk', 'javascript:alert(1)', 'https://youtu.be/abcdefghijk/extra']) expect(youtubeUrl(value)).toBeNull()
  })
  it('requires an actual TikTok video, rather than a profile or redirect', () => {
    expect(tiktokUrl('https://www.tiktok.com/@cts/video/1234567890123456789?x=1')).toBe('https://www.tiktok.com/@cts/video/1234567890123456789')
    expect(tiktokUrl('https://www.tiktok.com/@cts')).toBeNull()
    expect(tiktokUrl('https://www.tiktok.com.evil.test/@cts/video/1234567890123456789')).toBeNull()
  })
  it('rejects local/insecure preview references and accepts empty links', () => {
    for (const u of ['http://cdn.realcdn.net/movie.mp4','https://127.0.0.1/movie.mp4','https://localhost/movie.mp4','https://test.local/movie.mp4','https://user:pass@cdn.realcdn.net/movie.mp4']) expect(previewUrl(u)).toBeNull()
    expect(previewUrl('https://cdn.realcdn.net/movie.mp4')).toBeTruthy()
    expect(validateLinks({ youtube: '', tiktok: '', preview: '' })).toEqual({ youtube: '', tiktok: '', preview: '' })
    expect(validateLinks({ youtube: null })).toBeNull()
  })
  it('preserves unrelated customer settings and other episodes', () => {
    const previous = { render: { engine: 'ffmpeg' }, documentary_links: { old: { youtube: 'old' } } }
    const next = mergeLinks(previous, 'new', { youtube: '', tiktok: '', preview: '' })
    expect(next.render).toEqual(previous.render)
    expect(next.documentary_links).toMatchObject({ old: { youtube: 'old' }, new: { youtube: '' } })
    expect(previous.documentary_links).not.toHaveProperty('new')
  })
})
