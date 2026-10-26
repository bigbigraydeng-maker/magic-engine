/**
 * page-stories hardening — request shape, token redaction, validation, upload_url
 * allow-list, failure classes per step, abort-signal wiring and read-back filtering.
 *
 * Split out of page-stories.test.ts to keep each file under the repo size limit.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { publishPagePhotoStory, publishPageVideoStory, listPageStories } from '../page-stories'
import { PagePublishError } from '../page-posts'
import { GRAPH_BASE } from '../graph-base'

const PAGE = '111222333'
const TOKEN = 'tok/en+1&x'

type ScriptedResponse =
  | { ok: boolean; status?: number; body: unknown }
  | { throws: Error }

interface RecordedCall {
  url: string
  init?: RequestInit
}

/**
 * A fetcher that consumes a scripted list of responses in order and records
 * every call. Each entry is either a JSON response ({ok,status,body}) or a
 * thrown error ({throws}). Real `Response` objects are built so callers can
 * use `.json()` and `.ok` exactly as they would against fetch.
 */
function fakeFetch(responses: ScriptedResponse[]) {
  const calls: RecordedCall[] = []
  let index = 0

  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init })
    const next = responses[index++]
    if (!next) {
      throw new Error(`fakeFetch: no scripted response for call #${index} (${url})`)
    }
    if ('throws' in next) {
      throw next.throws
    }
    const status = next.status ?? (next.ok ? 200 : 400)
    return new Response(JSON.stringify(next.body), { status })
  }

  return { fetcher: fn as typeof fetch, calls }
}

let fetchSpy: MockInstance<typeof fetch>

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch')
})

afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})


describe('request bodies and headers', () => {
  it('photo step 1 body carries url, published:false and access_token', async () => {
    const { fetcher, calls } = fakeFetch([
      { ok: true, body: { id: 'photo1' } },
      { ok: true, body: { post_id: 'post1' } },
    ])

    await publishPagePhotoStory({
      pageId: PAGE,
      pageAccessToken: TOKEN,
      imageUrl: 'https://x/img.jpg',
      fetcher,
    })

    const body = JSON.parse(String(calls[0].init?.body))
    expect(body.url).toBe('https://x/img.jpg')
    expect(body.published).toBe(false)
    expect(body.access_token).toBe(TOKEN)
  })

  it('photo step 2 body carries photo_id and access_token', async () => {
    const { fetcher, calls } = fakeFetch([
      { ok: true, body: { id: 'photo1' } },
      { ok: true, body: { post_id: 'post1' } },
    ])

    await publishPagePhotoStory({
      pageId: PAGE,
      pageAccessToken: TOKEN,
      imageUrl: 'https://x/img.jpg',
      fetcher,
    })

    const body = JSON.parse(String(calls[1].init?.body))
    expect(body.photo_id).toBe('photo1')
    expect(body.access_token).toBe(TOKEN)
  })

  it('video start and finish bodies carry upload_phase and access_token', async () => {
    const { fetcher, calls } = fakeFetch([
      { ok: true, body: { video_id: 'v1', upload_url: 'https://rupload.facebook.com/x' } },
      { ok: true, body: {} },
      { ok: true, body: { post_id: 'post1' } },
    ])

    await publishPageVideoStory({
      pageId: PAGE,
      pageAccessToken: TOKEN,
      videoUrl: 'https://x/video.mp4',
      fetcher,
    })

    const startBody = JSON.parse(String(calls[0].init?.body))
    expect(startBody.upload_phase).toBe('start')
    expect(startBody.access_token).toBe(TOKEN)

    const finishBody = JSON.parse(String(calls[2].init?.body))
    expect(finishBody.upload_phase).toBe('finish')
    expect(finishBody.access_token).toBe(TOKEN)
  })

  it('the upload request carries file_url header and no JSON body', async () => {
    const { fetcher, calls } = fakeFetch([
      { ok: true, body: { video_id: 'v1', upload_url: 'https://rupload.facebook.com/x' } },
      { ok: true, body: {} },
      { ok: true, body: { post_id: 'post1' } },
    ])

    await publishPageVideoStory({
      pageId: PAGE,
      pageAccessToken: TOKEN,
      videoUrl: 'https://x/video.mp4',
      fetcher,
    })

    const headers = calls[1].init?.headers as Record<string, string>
    expect(headers.file_url).toBe('https://x/video.mp4')
    expect(calls[1].init?.body).toBeUndefined()
  })
})

describe('token redaction', () => {
  const encoded = encodeURIComponent(TOKEN)

  it('photo step 1 network error redacts the token', async () => {
    const { fetcher } = fakeFetch([
      { throws: new Error(`connect failed https://graph.facebook.com/x?access_token=${encoded}`) },
    ])

    const error = await publishPagePhotoStory({
      pageId: PAGE,
      pageAccessToken: TOKEN,
      imageUrl: 'https://x/img.jpg',
      fetcher,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PagePublishError)
    const message = (error as PagePublishError).message
    expect(message).not.toContain(TOKEN)
    expect(message).not.toContain(encoded)
    expect(message).toContain('***')
  })

  it('video start network error redacts the token', async () => {
    const { fetcher } = fakeFetch([
      { throws: new Error(`connect failed https://graph.facebook.com/x?access_token=${encoded}`) },
    ])

    const error = await publishPageVideoStory({
      pageId: PAGE,
      pageAccessToken: TOKEN,
      videoUrl: 'https://x/video.mp4',
      fetcher,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PagePublishError)
    const message = (error as PagePublishError).message
    expect(message).not.toContain(TOKEN)
    expect(message).not.toContain(encoded)
    expect(message).toContain('***')
  })

  it('listPageStories network error redacts the token', async () => {
    const { fetcher } = fakeFetch([
      { throws: new Error(`connect failed https://graph.facebook.com/x?access_token=${encoded}`) },
    ])

    const error = await listPageStories({
      pageId: PAGE,
      pageAccessToken: TOKEN,
      fetcher,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PagePublishError)
    const message = (error as PagePublishError).message
    expect(message).not.toContain(TOKEN)
    expect(message).not.toContain(encoded)
    expect(message).toContain('***')
  })

  it('photo step 1 Graph 400 body redacts the token', async () => {
    const { fetcher } = fakeFetch([
      { ok: false, status: 400, body: { error: { message: `Invalid token ${TOKEN}`, code: 190 } } },
    ])

    const error = await publishPagePhotoStory({
      pageId: PAGE,
      pageAccessToken: TOKEN,
      imageUrl: 'https://x/img.jpg',
      fetcher,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PagePublishError)
    const message = (error as PagePublishError).message
    expect(message).not.toContain(TOKEN)
    expect(message).toContain('***')
  })

  it('video upload Graph 400 body redacts the token', async () => {
    const { fetcher } = fakeFetch([
      { ok: true, body: { video_id: 'v1', upload_url: 'https://rupload.facebook.com/x' } },
      { ok: false, status: 400, body: { error: { message: `Invalid token ${TOKEN}`, code: 190 } } },
    ])

    const error = await publishPageVideoStory({
      pageId: PAGE,
      pageAccessToken: TOKEN,
      videoUrl: 'https://x/video.mp4',
      fetcher,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PagePublishError)
    const message = (error as PagePublishError).message
    expect(message).not.toContain(TOKEN)
    expect(message).toContain('***')
  })
})

describe('validation — no fetch is issued', () => {
  const badPageIds = ['123/feed', '', 'abc']
  const badUrls = ['', 'http://a.example/x.jpg', 'not a url']

  it('publishPagePhotoStory rejects bad pageId without fetching', async () => {
    for (const pageId of badPageIds) {
      const { fetcher, calls } = fakeFetch([])
      const error = await publishPagePhotoStory({
        pageId,
        pageAccessToken: TOKEN,
        imageUrl: 'https://x/img.jpg',
        fetcher,
      }).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(PagePublishError)
      expect((error as PagePublishError).certainty).toBe('rejected')
      expect(calls).toHaveLength(0)
    }
  })

  it('publishPageVideoStory rejects bad pageId without fetching', async () => {
    for (const pageId of badPageIds) {
      const { fetcher, calls } = fakeFetch([])
      const error = await publishPageVideoStory({
        pageId,
        pageAccessToken: TOKEN,
        videoUrl: 'https://x/video.mp4',
        fetcher,
      }).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(PagePublishError)
      expect((error as PagePublishError).certainty).toBe('rejected')
      expect(calls).toHaveLength(0)
    }
  })

  it('listPageStories rejects bad pageId without fetching', async () => {
    for (const pageId of badPageIds) {
      const { fetcher, calls } = fakeFetch([])
      const error = await listPageStories({
        pageId,
        pageAccessToken: TOKEN,
        fetcher,
      }).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(PagePublishError)
      expect((error as PagePublishError).certainty).toBe('rejected')
      expect(calls).toHaveLength(0)
    }
  })

  it('publishPagePhotoStory rejects bad imageUrl without fetching', async () => {
    for (const imageUrl of badUrls) {
      const { fetcher, calls } = fakeFetch([])
      const error = await publishPagePhotoStory({
        pageId: PAGE,
        pageAccessToken: TOKEN,
        imageUrl,
        fetcher,
      }).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(PagePublishError)
      expect((error as PagePublishError).certainty).toBe('rejected')
      expect(calls).toHaveLength(0)
    }
  })

  it('publishPageVideoStory rejects bad videoUrl without fetching', async () => {
    for (const videoUrl of badUrls) {
      const { fetcher, calls } = fakeFetch([])
      const error = await publishPageVideoStory({
        pageId: PAGE,
        pageAccessToken: TOKEN,
        videoUrl,
        fetcher,
      }).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(PagePublishError)
      expect((error as PagePublishError).certainty).toBe('rejected')
      expect(calls).toHaveLength(0)
    }
  })
})

describe('video upload_url allow-list', () => {
  it('rejects an off-allow-list upload_url with exactly one call', async () => {
    const { fetcher, calls } = fakeFetch([
      { ok: true, body: { video_id: 'v1', upload_url: 'https://evil.example.com/x' } },
    ])

    const error = await publishPageVideoStory({
      pageId: PAGE,
      pageAccessToken: TOKEN,
      videoUrl: 'https://x/video.mp4',
      fetcher,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PagePublishError)
    expect((error as PagePublishError).certainty).toBe('rejected')
    expect(calls).toHaveLength(1)
  })

  it('rejects a non-https upload_url', async () => {
    const { fetcher, calls } = fakeFetch([
      { ok: true, body: { video_id: 'v1', upload_url: 'http://rupload.facebook.com/x' } },
    ])

    const error = await publishPageVideoStory({
      pageId: PAGE,
      pageAccessToken: TOKEN,
      videoUrl: 'https://x/video.mp4',
      fetcher,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PagePublishError)
    expect((error as PagePublishError).certainty).toBe('rejected')
    expect(calls).toHaveLength(1)
  })

  it('accepts an allow-listed https upload_url', async () => {
    const { fetcher, calls } = fakeFetch([
      { ok: true, body: { video_id: 'v1', upload_url: 'https://rupload.facebook.com/x' } },
      { ok: true, body: {} },
      { ok: true, body: { post_id: 'post1' } },
    ])

    const result = await publishPageVideoStory({
      pageId: PAGE,
      pageAccessToken: TOKEN,
      videoUrl: 'https://x/video.mp4',
      fetcher,
    })

    expect(result.postId).toBe('post1')
    expect(calls).toHaveLength(3)
  })
})

describe('publishPageVideoStory — failure classes', () => {
  const UPLOAD_URL = 'https://rupload.facebook.com/x'
  const VIDEO_URL = 'https://x/video.mp4'

  it('upload step network error = unknown, calls 2, message names the video_id', async () => {
    const { fetcher, calls } = fakeFetch([
      { ok: true, body: { video_id: 'v1', upload_url: UPLOAD_URL } },
      { throws: new TypeError('fetch failed') },
    ])

    const error = await publishPageVideoStory({
      pageId: PAGE,
      pageAccessToken: TOKEN,
      videoUrl: VIDEO_URL,
      fetcher,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PagePublishError)
    expect((error as PagePublishError).certainty).toBe('unknown')
    expect(calls).toHaveLength(2)
    expect((error as PagePublishError).message).toContain('video_id=v1')
  })

  it('upload step 2xx carrying an error body = unknown', async () => {
    const { fetcher } = fakeFetch([
      { ok: true, body: { video_id: 'v1', upload_url: UPLOAD_URL } },
      { ok: true, status: 200, body: { error: { message: 'x' } } },
    ])

    const error = await publishPageVideoStory({
      pageId: PAGE,
      pageAccessToken: TOKEN,
      videoUrl: VIDEO_URL,
      fetcher,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PagePublishError)
    expect((error as PagePublishError).certainty).toBe('unknown')
  })

  it('upload step 400 Graph error = rejected and finish is never called', async () => {
    const { fetcher, calls } = fakeFetch([
      { ok: true, body: { video_id: 'v1', upload_url: UPLOAD_URL } },
      { ok: false, status: 400, body: { error: { message: 'upload failed', code: 100 } } },
    ])

    const error = await publishPageVideoStory({
      pageId: PAGE,
      pageAccessToken: TOKEN,
      videoUrl: VIDEO_URL,
      fetcher,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PagePublishError)
    expect((error as PagePublishError).certainty).toBe('rejected')
    expect(calls).toHaveLength(2)
  })

  it('finish 2xx without post_id = unknown', async () => {
    const { fetcher } = fakeFetch([
      { ok: true, body: { video_id: 'v1', upload_url: UPLOAD_URL } },
      { ok: true, body: {} },
      { ok: true, body: {} },
    ])

    const error = await publishPageVideoStory({
      pageId: PAGE,
      pageAccessToken: TOKEN,
      videoUrl: VIDEO_URL,
      fetcher,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PagePublishError)
    expect((error as PagePublishError).certainty).toBe('unknown')
  })

  it('finish 400 Graph error = rejected and message names the video_id', async () => {
    const { fetcher } = fakeFetch([
      { ok: true, body: { video_id: 'v1', upload_url: UPLOAD_URL } },
      { ok: true, body: {} },
      { ok: false, status: 400, body: { error: { message: 'bad', code: 100 } } },
    ])

    const error = await publishPageVideoStory({
      pageId: PAGE,
      pageAccessToken: TOKEN,
      videoUrl: VIDEO_URL,
      fetcher,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PagePublishError)
    expect((error as PagePublishError).certainty).toBe('rejected')
    expect((error as PagePublishError).message).toContain('video_id=v1')
  })

  it('start 2xx without upload_url = unknown, calls 1', async () => {
    const { fetcher, calls } = fakeFetch([
      { ok: true, body: { video_id: 'v1' } },
    ])

    const error = await publishPageVideoStory({
      pageId: PAGE,
      pageAccessToken: TOKEN,
      videoUrl: VIDEO_URL,
      fetcher,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PagePublishError)
    expect((error as PagePublishError).certainty).toBe('unknown')
    expect(calls).toHaveLength(1)
  })
})

describe('publishPagePhotoStory — additional failure classes', () => {
  it('step 2 400 Graph error = rejected and message names the unpublished photo', async () => {
    const { fetcher } = fakeFetch([
      { ok: true, body: { id: 'photo1' } },
      { ok: false, status: 400, body: { error: { message: 'bad', code: 100 } } },
    ])

    const error = await publishPagePhotoStory({
      pageId: PAGE,
      pageAccessToken: TOKEN,
      imageUrl: 'https://x/img.jpg',
      fetcher,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PagePublishError)
    expect((error as PagePublishError).certainty).toBe('rejected')
    expect((error as PagePublishError).message).toContain('unpublished photo photo1')
  })

  it('step 2 AbortError = unknown', async () => {
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    const { fetcher } = fakeFetch([
      { ok: true, body: { id: 'photo1' } },
      { throws: abort },
    ])

    const error = await publishPagePhotoStory({
      pageId: PAGE,
      pageAccessToken: TOKEN,
      imageUrl: 'https://x/img.jpg',
      fetcher,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PagePublishError)
    expect((error as PagePublishError).certainty).toBe('unknown')
  })

  it('step 1 2xx without id = unknown, calls 1', async () => {
    const { fetcher, calls } = fakeFetch([
      { ok: true, body: {} },
    ])

    const error = await publishPagePhotoStory({
      pageId: PAGE,
      pageAccessToken: TOKEN,
      imageUrl: 'https://x/img.jpg',
      fetcher,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PagePublishError)
    expect((error as PagePublishError).certainty).toBe('unknown')
    expect(calls).toHaveLength(1)
  })

  it('step 1 429 = rate_limited', async () => {
    const { fetcher } = fakeFetch([
      { ok: false, status: 429, body: { error: { message: 'slow down' } } },
    ])

    const error = await publishPagePhotoStory({
      pageId: PAGE,
      pageAccessToken: TOKEN,
      imageUrl: 'https://x/img.jpg',
      fetcher,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PagePublishError)
    expect((error as PagePublishError).certainty).toBe('rate_limited')
  })
})

describe('timeoutMs — every request carries an AbortSignal', () => {
  it('photo both steps carry an AbortSignal when timeoutMs is set', async () => {
    const { fetcher, calls } = fakeFetch([
      { ok: true, body: { id: 'photo1' } },
      { ok: true, body: { post_id: 'post1' } },
    ])

    await publishPagePhotoStory({
      pageId: PAGE,
      pageAccessToken: TOKEN,
      imageUrl: 'https://x/img.jpg',
      timeoutMs: 5000,
      fetcher,
    })

    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal)
    expect(calls[1].init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('video start/upload/finish carry an AbortSignal when timeoutMs is set', async () => {
    const { fetcher, calls } = fakeFetch([
      { ok: true, body: { video_id: 'v1', upload_url: 'https://rupload.facebook.com/x' } },
      { ok: true, body: {} },
      { ok: true, body: { post_id: 'post1' } },
    ])

    await publishPageVideoStory({
      pageId: PAGE,
      pageAccessToken: TOKEN,
      videoUrl: 'https://x/video.mp4',
      timeoutMs: 5000,
      fetcher,
    })

    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal)
    expect(calls[1].init?.signal).toBeInstanceOf(AbortSignal)
    expect(calls[2].init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('listPageStories carries an AbortSignal when timeoutMs is set', async () => {
    const { fetcher, calls } = fakeFetch([{ ok: true, body: { data: [] } }])

    await listPageStories({
      pageId: PAGE,
      pageAccessToken: TOKEN,
      timeoutMs: 5000,
      fetcher,
    })

    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('photo both steps leave the signal undefined when timeoutMs is unset', async () => {
    const { fetcher, calls } = fakeFetch([
      { ok: true, body: { id: 'photo1' } },
      { ok: true, body: { post_id: 'post1' } },
    ])

    await publishPagePhotoStory({
      pageId: PAGE,
      pageAccessToken: TOKEN,
      imageUrl: 'https://x/img.jpg',
      fetcher,
    })

    expect(calls[0].init?.signal).toBeUndefined()
    expect(calls[1].init?.signal).toBeUndefined()
  })

  it('video start/upload/finish leave the signal undefined when timeoutMs is unset', async () => {
    const { fetcher, calls } = fakeFetch([
      { ok: true, body: { video_id: 'v1', upload_url: 'https://rupload.facebook.com/x' } },
      { ok: true, body: {} },
      { ok: true, body: { post_id: 'post1' } },
    ])

    await publishPageVideoStory({
      pageId: PAGE,
      pageAccessToken: TOKEN,
      videoUrl: 'https://x/video.mp4',
      fetcher,
    })

    expect(calls[0].init?.signal).toBeUndefined()
    expect(calls[1].init?.signal).toBeUndefined()
    expect(calls[2].init?.signal).toBeUndefined()
  })

  it('listPageStories leaves the signal undefined when timeoutMs is unset', async () => {
    const { fetcher, calls } = fakeFetch([{ ok: true, body: { data: [] } }])

    await listPageStories({
      pageId: PAGE,
      pageAccessToken: TOKEN,
      fetcher,
    })

    expect(calls[0].init?.signal).toBeUndefined()
  })
})

describe('listPageStories — paging and row filtering', () => {
  it('hasMore is true when paging.next is present', async () => {
    const { fetcher } = fakeFetch([
      { ok: true, body: { data: [], paging: { next: 'https://graph.facebook.com/next' } } },
    ])

    const result = await listPageStories({ pageId: PAGE, pageAccessToken: TOKEN, fetcher })
    expect(result.hasMore).toBe(true)
  })

  it('hasMore is false when paging.next is absent', async () => {
    const { fetcher } = fakeFetch([{ ok: true, body: { data: [] } }])

    const result = await listPageStories({ pageId: PAGE, pageAccessToken: TOKEN, fetcher })
    expect(result.hasMore).toBe(false)
  })

  it('drops an entry without a post_id and issues exactly one GET', async () => {
    const { fetcher, calls } = fakeFetch([
      {
        ok: true,
        body: {
          data: [
            { status: 'PUBLISHED', media_type: 'PHOTO' },
            { post_id: 'post1', status: 'PUBLISHED' },
          ],
        },
      },
    ])

    const result = await listPageStories({ pageId: PAGE, pageAccessToken: TOKEN, fetcher })

    expect(calls).toHaveLength(1)
    expect(result.stories).toHaveLength(1)
    expect(result.stories[0].postId).toBe('post1')
  })

  it('sends since/until as unix seconds', async () => {
    const since = new Date('2026-10-13T00:00:00Z')
    const until = new Date('2026-10-14T00:00:00Z')
    const { fetcher, calls } = fakeFetch([{ ok: true, body: { data: [] } }])

    await listPageStories({
      pageId: PAGE,
      pageAccessToken: TOKEN,
      since,
      until,
      fetcher,
    })

    const url = new URL(calls[0].url)
    expect(url.searchParams.get('since')).toBe(String(Math.floor(since.getTime() / 1000)))
    expect(url.searchParams.get('until')).toBe(String(Math.floor(until.getTime() / 1000)))
  })

  it('returns an ARCHIVED row', async () => {
    const { fetcher } = fakeFetch([
      {
        ok: true,
        body: {
          data: [
            {
              post_id: 'post1',
              status: 'ARCHIVED',
              creation_time: '2026-10-13T00:00:00+0000',
              media_type: 'PHOTO',
              media_id: 'photo1',
              url: 'https://x/story',
            },
          ],
        },
      },
    ])

    const result = await listPageStories({ pageId: PAGE, pageAccessToken: TOKEN, fetcher })

    expect(result.stories).toEqual([
      {
        postId: 'post1',
        status: 'ARCHIVED',
        creationTime: '2026-10-13T00:00:00+0000',
        mediaType: 'PHOTO',
        mediaId: 'photo1',
        url: 'https://x/story',
      },
    ])
  })
})
