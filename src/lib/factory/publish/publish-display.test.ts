import { describe, expect, it } from 'vitest'
import { sanitizeFailReason, toPublishedView } from './publish-display'

describe('sanitizeFailReason', () => {
  it('strips access_token, urls, long tokens and truncates', () => {
    expect(sanitizeFailReason('boom access_token=EAAfaketokenfaketokenfaketoken1234 end')).toBe(
      'boom access_token=[已隐藏] end',
    )
    expect(sanitizeFailReason('see https://x.test/a?b=1 now')).toBe('see [链接] now')
    expect(sanitizeFailReason('{"url":"https://x.test/a","code":190}')).toBe('{"url":"[链接]","code":190}')
    expect(sanitizeFailReason('VideoUploadProcessingFailedException 400')).toBe('VideoUploadProcessingFailedException 400')
    expect(sanitizeFailReason('tok abcdefghijklmnopqrstuvwxyz0123456789abcdefgh done')).toBe(
      'tok [已隐藏] done',
    )
    expect(sanitizeFailReason('x EAAfaketokenfaketoken1 y')).toBe('x [已隐藏] y')
    expect(sanitizeFailReason('bad storage/v1/object/public/f/a.mp4 fbtrace_id":"AbC123"')).toBe('bad [路径] fbtrace_id=[已隐藏]"')
    const long = sanitizeFailReason('ab '.repeat(200))
    expect(long.length).toBe(201)
    expect(long.endsWith('…')).toBe(true)
    expect(sanitizeFailReason('   ')).toBe('发布失败(原因未记录)')
    expect(sanitizeFailReason('视频 URL 不可达 (404)')).toBe('视频 URL 不可达 (404)')
  })
})

describe('toPublishedView', () => {
  it('normalizes permalinks and whitelists keys', () => {
    expect(toPublishedView({ permalink: '/reel/123/' })).toEqual({
      video_state: null,
      permalink: 'https://www.facebook.com/reel/123/',
      published_at: null,
      provisional: false,
    })
    expect(toPublishedView({ provisional: true, video_id: 'v' })?.provisional).toBe(true)
    expect(toPublishedView({ permalink: 'https://evil.test/reel/1/' })?.permalink).toBe(null)
    expect(toPublishedView({ permalink: 'https://u:pw@www.facebook.com/x' })?.permalink).toBe(null)
    expect(toPublishedView({ video_state: 'DRAFT' })?.video_state).toBe('DRAFT')
    expect(toPublishedView({ video_state: 'PUBLISHED' })?.video_state).toBe('PUBLISHED')
    expect(
      toPublishedView({
        video_state: 'PUBLISHED',
        permalink: 'https://www.facebook.com/reel/1/',
        published_at: '2024-01-01T00:00:00Z',
        page_id: 'p',
        video_id: 'v',
        event_ids: ['e'],
        first_comment_id: 'c',
      }),
    ).toEqual({
      video_state: 'PUBLISHED',
      permalink: 'https://www.facebook.com/reel/1/',
      published_at: '2024-01-01T00:00:00Z',
      provisional: false,
    })
  })

  it('rejects bad permalinks, states and inputs', () => {
    expect(toPublishedView({ permalink: 'javascript:alert(1)' })?.permalink).toBe(null)
    expect(toPublishedView({ permalink: 'http://x.test/a' })?.permalink).toBe(null)
    expect(toPublishedView({ video_state: 'garbage' })?.video_state).toBe(null)
    expect(toPublishedView(null)).toBe(null)
    expect(toPublishedView('x')).toBe(null)
    expect(toPublishedView([])).toBe(null)
  })
})
