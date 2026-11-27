import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/meta/token-manager', () => ({ getStoredPageToken: vi.fn(async () => 'test-page-token') }))
import { assertBrandMatches, encodeIdemTag, facebookReelAdapter, promoteReelToPublished, videoStateFromReadback } from './facebook-reel-adapter'

afterEach(() => vi.unstubAllGlobals())

describe('assertBrandMatches(防把 A 客户的片发到 B 客户主页)', () => {
  it('页名包含品牌 → 放行', () => {
    expect(() => assertBrandMatches('MagicLab Academy', 'MagicLab')).not.toThrow()
    expect(() => assertBrandMatches('CTS Tours', 'CTS Tours')).not.toThrow()
  })

  it('忽略 Pty Ltd / 大小写 / 符号', () => {
    expect(() => assertBrandMatches('Oztop Building Supplies Pty Ltd', 'oztop building supplies')).not.toThrow()
  })

  it('页名跟品牌完全对不上 → 拦住,绝不发', () => {
    expect(() => assertBrandMatches('CTS Tours', 'MagicLab')).toThrow(/防误发/)
  })

  it('没配期望品牌 / 页名取不到 → 不拦(这道闸是加分项,不该因为缺配置就发不出去)', () => {
    expect(() => assertBrandMatches('CTS Tours', undefined)).not.toThrow()
    expect(() => assertBrandMatches('', 'MagicLab')).not.toThrow()
  })
})

describe('encodeIdemTag(幂等标记必须不可见)', () => {
  it('只产出零宽字符 —— 混进正文不能被客户看见', () => {
    const tag = encodeIdemTag('9d38d511-3e3e-432d-8106-b5a9086409de')
    expect(tag).toMatch(/^[⁣​‌]+$/)
    expect(tag.trim().length).toBeGreaterThan(0)
  })

  it('同一条片每次编出来一样,不同片不一样', () => {
    const a = encodeIdemTag('9d38d511-3e3e-432d-8106-b5a9086409de')
    expect(encodeIdemTag('9d38d511-3e3e-432d-8106-b5a9086409de')).toBe(a)
    expect(encodeIdemTag('3cc6d68d-13d1-4713-85dc-4fbd0e59c815')).not.toBe(a)
  })
})

describe('Facebook Reel 首评', () => {
  it('真发完成后把 CTA 首评写入 Reel，并返回首评 id', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.includes('fields=name')) return Response.json({ name: 'Example Brand' })
      const body = init?.body == null ? new URLSearchParams() : new URLSearchParams(String(init.body))
      if (url.endsWith('/video_reels') && body.get('upload_phase') === 'start') return Response.json({ video_id: 'video-1' })
      if (url.includes('rupload.facebook.com')) return Response.json({ success: true })
      if (url.includes('/comments?')) return Response.json({ data: [] })
      if (url.endsWith('/comments')) return Response.json({ id: 'comment-1' })
      if (url.includes('permalink_url')) return Response.json({ published: true, permalink_url: 'https://facebook.test/reel/video-1' })
      return Response.json({})
    }))

    const result = await facebookReelAdapter.publish({
      videoUrl: 'https://storage.test/reel.mp4',
      caption: 'Discover China',
      firstComment: 'Book now: https://example.test/?utm_source=facebook',
      target: { client_id: 'client-1', page_id: 'page-1', platform: 'facebook' },
      idempotencyTag: 'work-order-1',
      draft: false,
    })

    expect(result.first_comment_id).toBe('comment-1')
    const commentRequest = requests.find(request => request.url.endsWith('/comments') && request.init?.method === 'POST')
    expect(commentRequest).toBeDefined()
    const message = new URLSearchParams(String(commentRequest!.init?.body)).get('message')
    expect(message).toContain('Book now: https://example.test/?utm_source=facebook')
    expect(message).toMatch(/[⁣​‌]+$/)
  })
})

describe('videoStateFromReadback', () => {
  it('published true is the only live confirmation', () => {
    expect(videoStateFromReadback({ published: true })).toBe('PUBLISHED')
    expect(videoStateFromReadback({ published: false })).toBe('DRAFT')
    expect(videoStateFromReadback({})).toBeNull()
    expect(videoStateFromReadback({ published: 'PUBLISHED' })).toBeNull()
  })
})

describe('Facebook Reel finish 回读', () => {
  const target = { client_id: 'client-1', page_id: 'page-1', platform: 'facebook' as const }
  const publishArgs = { videoUrl: 'https://storage.test/reel.mp4', caption: 'Discover China', target, idempotencyTag: 'work-order-1' }

  function stubFinish(published: boolean | undefined) {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('fields=name')) return Response.json({ name: 'Example Brand' })
      const body = init?.body == null ? new URLSearchParams() : new URLSearchParams(String(init.body))
      if (url.endsWith('/video_reels') && body.get('upload_phase') === 'start') return Response.json({ video_id: 'video-1' })
      if (url.includes('rupload.facebook.com')) return Response.json({ success: true })
      if (url.endsWith('/video_reels') && body.get('upload_phase') === 'finish') return Response.json({ success: true })
      if (url.includes('fields=published')) return Response.json(published === undefined ? {} : { published, permalink_url: 'https://facebook.test/reel/video-1' })
      return Response.json({})
    }))
  }

  it('草稿请求且回读 published=false → 记 DRAFT,不发首评', async () => {
    stubFinish(false)
    const result = await facebookReelAdapter.publish({ ...publishArgs, draft: true, firstComment: 'Book now' })
    expect(result.video_state).toBe('DRAFT')
    expect(result.first_comment_id).toBeUndefined()
  })

  it('真发请求但回读一直不是 published=true → 抛错,不当已发布', async () => {
    stubFinish(false)
    await expect(facebookReelAdapter.publish({ ...publishArgs, draft: false })).rejects.toThrow(/未确认/)
  })

  it('回读没有 published 字段 → 抛错', async () => {
    stubFinish(undefined)
    await expect(facebookReelAdapter.publish({ ...publishArgs, draft: true })).rejects.toThrow(/未确认|没有回读|回读/)
  })

  it('对账命中后按回读的 published 盖戳', async () => {
    const tag = encodeIdemTag('work-order-1')
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('fields=name')) return Response.json({ name: 'Example Brand' })
      if (url.includes('/video_reels?')) {
        return Response.json({ data: [{ id: 'video-9', description: `hello${tag}`, updated_time: '2026-10-18T00:00:00+0000' }] })
      }
      if (url.includes('fields=published')) return Response.json({ published: false, permalink_url: 'https://facebook.test/reel/video-9' })
      return Response.json({})
    }))
    const found = await facebookReelAdapter.findExisting({ target, idempotencyTag: 'work-order-1' })
    expect(found?.video_state).toBe('DRAFT')
    expect(found?.video_id).toBe('video-9')
    expect(found?.published_at).toBe('2026-10-18T00:00:00.000Z')
  })
})

describe('promoteReelToPublished 草稿转正', () => {
  const target = { client_id: 'client-1', page_id: 'page-1', platform: 'facebook' as const }

  it('翻 published=true 并回读确认,绝不重喊 finish', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.includes('fields=name')) return Response.json({ name: 'Example Brand' })
      if (url.includes('fields=published,from')) return Response.json({ published: false, from: { id: 'page-1' } })
      if (url.includes('fields=published')) {
        return Response.json({ published: true, permalink_url: 'https://facebook.test/reel/video-1' })
      }
      if (url.endsWith('/video-1') && init?.method === 'POST') return Response.json({ success: true })
      return Response.json({})
    }))

    const result = await promoteReelToPublished({ target, videoId: 'video-1' })

    expect(result.video_state).toBe('PUBLISHED')
    expect(result.video_id).toBe('video-1')
    expect(result.permalink).toBe('https://facebook.test/reel/video-1')

    expect(requests.some(request => request.url.endsWith('/video_reels'))).toBe(false)

    const postRequest = requests.find(request => request.url.endsWith('/video-1') && request.init?.method === 'POST')
    expect(postRequest).toBeDefined()
    const body = new URLSearchParams(String(postRequest!.init?.body))
    expect(body.get('published')).toBe('true')
  })

  it('POST 没返回 success → 抛错(回读即便 published=true 也不放行)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('fields=name')) return Response.json({ name: 'Example Brand' })
      if (url.includes('fields=published,from')) return Response.json({ published: false, from: { id: 'page-1' } })
      if (url.includes('fields=published')) {
        return Response.json({ published: true, permalink_url: 'https://facebook.test/reel/video-1' })
      }
      if (url.endsWith('/video-1')) return Response.json({ success: false })
      return Response.json({})
    }))

    await expect(promoteReelToPublished({ target, videoId: 'video-1' })).rejects.toThrow(/success/)
  })

  it('回读 published 不是 true → 抛错(失败即抛,绝不吞)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('fields=name')) return Response.json({ name: 'Example Brand' })
      if (url.includes('fields=published,from')) return Response.json({ published: false, from: { id: 'page-1' } })
      if (url.includes('fields=published')) return Response.json({ published: false })
      if (url.endsWith('/video-1')) return Response.json({ success: true })
      return Response.json({})
    }))

    await expect(promoteReelToPublished({ target, videoId: 'video-1' })).rejects.toThrow()
  })

  it('转正前发现视频不属于本页 → 防误发拦截,绝不 POST', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.includes('fields=name')) return Response.json({ name: 'Example Brand' })
      if (url.includes('fields=published,from')) return Response.json({ published: false, from: { id: 'other-page' } })
      return Response.json({})
    }))

    await expect(promoteReelToPublished({ target, videoId: 'video-1' })).rejects.toThrow(/防误发/)
    expect(requests.some(request => request.url.endsWith('/video-1') && request.init?.method === 'POST')).toBe(false)
  })

  it('转正前发现已经是 published → 跳过 POST,直接返回 PUBLISHED', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.includes('fields=name')) return Response.json({ name: 'Example Brand' })
      if (url.includes('fields=published,from')) return Response.json({ published: true, from: { id: 'page-1' } })
      if (url.includes('fields=published')) {
        return Response.json({ published: true, permalink_url: 'https://facebook.test/reel/video-1' })
      }
      return Response.json({})
    }))

    const result = await promoteReelToPublished({ target, videoId: 'video-1' })

    expect(result.video_state).toBe('PUBLISHED')
    expect(requests.some(request => request.url.endsWith('/video-1') && request.init?.method === 'POST')).toBe(false)
  })

  it('回读前两次 published=false,第三次 true → 重试后成功', async () => {
    let readBackCount = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('fields=name')) return Response.json({ name: 'Example Brand' })
      if (url.includes('fields=published,from')) return Response.json({ published: false, from: { id: 'page-1' } })
      if (url.includes('fields=published')) {
        readBackCount++
        if (readBackCount < 3) return Response.json({ published: false })
        return Response.json({ published: true, permalink_url: 'https://facebook.test/reel/video-1' })
      }
      if (url.endsWith('/video-1') && init?.method === 'POST') return Response.json({ success: true })
      return Response.json({})
    }))

    const result = await promoteReelToPublished({ target, videoId: 'video-1' })

    expect(result.video_state).toBe('PUBLISHED')
    expect(readBackCount).toBe(3)
  })
})
