import { describe, expect, it, vi } from 'vitest'
import { collectRecentNonVideoPosts, isVideoContentPost } from './recent-content'

describe('isVideoContentPost', () => {
  it.each(['Reel', 'video', 'short', 'shorts', '讲课式', '短视频'])('hides explicit video format %s', (format) => {
    expect(isVideoContentPost({ format })).toBe(true)
  })

  it('hides a post with a source video URL', () => {
    expect(isVideoContentPost({ source_video_url: 'https://example.test/clip.mp4' })).toBe(true)
  })

  it.each(['YouTube', 'TikTok', 'Instagram Reels'])('hides video-only platform %s', (platform) => {
    expect(isVideoContentPost({ platforms: [platform] })).toBe(true)
  })

  it('keeps ordinary image and text social posts on the dashboard', () => {
    expect(isVideoContentPost({ format: 'feed', platforms: ['Facebook', 'Instagram'] })).toBe(false)
  })
})

describe('collectRecentNonVideoPosts', () => {
  it('keeps paging when the newest page is full of videos', async () => {
    const fetchPage = vi.fn(async (from: number) => {
      if (from === 0) return Array.from({ length: 40 }, (_, i) => ({ id: `video-${i}`, format: '短视频' }))
      return Array.from({ length: 6 }, (_, i) => ({ id: `post-${i}`, format: 'feed' }))
    })

    const result = await collectRecentNonVideoPosts(fetchPage)

    expect(result.map((post) => post.id)).toEqual(['post-0', 'post-1', 'post-2', 'post-3', 'post-4', 'post-5'])
    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(fetchPage).toHaveBeenLastCalledWith(40, 79)
  })

  it('stops when there are no more rows', async () => {
    const fetchPage = vi.fn(async () => [{ id: 'only', format: 'feed' }])
    await expect(collectRecentNonVideoPosts(fetchPage)).resolves.toEqual([{ id: 'only', format: 'feed' }])
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('caps serial reads when recent history contains only videos', async () => {
    const fetchPage = vi.fn(async () => Array.from({ length: 40 }, () => ({ format: 'video' })))
    await expect(collectRecentNonVideoPosts(fetchPage)).resolves.toEqual([])
    expect(fetchPage).toHaveBeenCalledTimes(5)
  })
})
