/**
 * page-stories — publish photo/video Stories and read them back.
 *
 * These tests lock the multi-step Graph flows (photo upload → photo_stories,
 * video start → upload → finish), the shared failure classification that
 * mirrors `publishPagePhotoPost`, request-body/header shape, token redaction,
 * input validation, the upload_url allow-list, and the read-back shape.
 *
 * Every function is injectable, so we drive them with a scripted fetcher and
 * never touch the real network.
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


describe('publishPagePhotoStory — two-step upload then attach', () => {
  it('uploads an unpublished photo then attaches it to photo_stories', async () => {
    const { fetcher, calls } = fakeFetch([
      { ok: true, body: { id: 'photo1' } },
      { ok: true, body: { post_id: 'post1' } },
    ])

    const result = await publishPagePhotoStory({
      pageId: PAGE,
      pageAccessToken: TOKEN,
      imageUrl: 'https://x/img.jpg',
      fetcher,
    })

    expect(result.postId).toBe('post1')
    expect(calls).toHaveLength(2)

    expect(calls[0].url).toBe(`${GRAPH_BASE}/${PAGE}/photos`)
    const uploadBody = JSON.parse(String(calls[0].init?.body))
    expect(uploadBody.url).toBe('https://x/img.jpg')
    expect(uploadBody.published).toBe(false)

    expect(calls[1].url).toBe(`${GRAPH_BASE}/${PAGE}/photo_stories`)
    const attachBody = JSON.parse(String(calls[1].init?.body))
    expect(attachBody.photo_id).toBe('photo1')
  })

  it('step 1 400 with a Graph error body = rejected, and no second call', async () => {
    const { fetcher, calls } = fakeFetch([
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
    expect(calls).toHaveLength(1)
  })

  it('step 2 network failure = unknown, and exactly two calls (no retry)', async () => {
    const { fetcher, calls } = fakeFetch([
      { ok: true, body: { id: 'photo1' } },
      { throws: new TypeError('fetch failed') },
    ])

    const error = await publishPagePhotoStory({
      pageId: PAGE,
      pageAccessToken: TOKEN,
      imageUrl: 'https://x/img.jpg',
      fetcher,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PagePublishError)
    expect((error as PagePublishError).certainty).toBe('unknown')
    expect(calls).toHaveLength(2)
  })

  it('step 2 2xx without a post_id = unknown', async () => {
    const { fetcher } = fakeFetch([
      { ok: true, body: { id: 'photo1' } },
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
  })

  it('a 2xx carrying an error body = unknown', async () => {
    const { fetcher } = fakeFetch([
      { ok: true, status: 200, body: { error: { message: 'weird', code: 1 } } },
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
})

describe('publishPagePhotoStory — failure classification', () => {
  async function failure(response: ScriptedResponse): Promise<PagePublishError> {
    const { fetcher } = fakeFetch([response])
    const error = await publishPagePhotoStory({
      pageId: PAGE,
      pageAccessToken: TOKEN,
      imageUrl: 'https://x/img.jpg',
      fetcher,
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PagePublishError)
    return error as PagePublishError
  }

  it('HTTP 429 = rate_limited', async () => {
    const error = await failure({ ok: false, status: 429, body: { error: { message: 'slow down' } } })
    expect(error.certainty).toBe('rate_limited')
  })

  it('Graph error code 4 = rate_limited', async () => {
    const error = await failure({ ok: false, status: 400, body: { error: { message: 'limit', code: 4 } } })
    expect(error.certainty).toBe('rate_limited')
  })

  it('Graph error code 1 = unknown', async () => {
    const error = await failure({ ok: false, status: 400, body: { error: { message: 'unknown error', code: 1 } } })
    expect(error.certainty).toBe('unknown')
  })

  it('Graph error code 2 = unknown', async () => {
    const error = await failure({ ok: false, status: 400, body: { error: { message: 'unavailable', code: 2 } } })
    expect(error.certainty).toBe('unknown')
  })
})

describe('publishPagePhotoStory — the access token never leaks into errors', () => {
  it('step 1 400 error message does not contain the token', async () => {
    const { fetcher } = fakeFetch([
      { ok: false, status: 400, body: { error: { message: 'bad', code: 100 } } },
    ])

    const error = await publishPagePhotoStory({
      pageId: PAGE,
      pageAccessToken: TOKEN,
      imageUrl: 'https://x/img.jpg',
      fetcher,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PagePublishError)
    expect((error as PagePublishError).message).not.toContain(TOKEN)
  })

  it('network error message does not contain the token', async () => {
    const { fetcher } = fakeFetch([
      { throws: new TypeError('fetch failed') },
    ])

    const error = await publishPagePhotoStory({
      pageId: PAGE,
      pageAccessToken: TOKEN,
      imageUrl: 'https://x/img.jpg',
      fetcher,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PagePublishError)
    expect((error as PagePublishError).message).not.toContain(TOKEN)
  })
})

describe('publishPageVideoStory — start, upload, finish', () => {
  const UPLOAD_URL = 'https://rupload.facebook.com/x'
  const VIDEO_URL = 'https://x/video.mp4'

  it('runs start → upload → finish in order and returns the post id', async () => {
    const { fetcher, calls } = fakeFetch([
      { ok: true, body: { video_id: 'v1', upload_url: UPLOAD_URL } },
      { ok: true, body: {} },
      { ok: true, body: { post_id: 'post1' } },
    ])

    const result = await publishPageVideoStory({
      pageId: PAGE,
      pageAccessToken: TOKEN,
      videoUrl: VIDEO_URL,
      fetcher,
    })

    expect(result.postId).toBe('post1')
    expect(calls).toHaveLength(3)

    expect(calls[0].url).toBe(`${GRAPH_BASE}/${PAGE}/video_stories`)
    const startBody = JSON.parse(String(calls[0].init?.body))
    expect(startBody.upload_phase).toBe('start')

    expect(calls[1].url).toBe(UPLOAD_URL)
    const headers = calls[1].init?.headers as Record<string, string>
    expect(headers.file_url).toBe(VIDEO_URL)

    expect(calls[2].url).toBe(`${GRAPH_BASE}/${PAGE}/video_stories`)
    const finishBody = JSON.parse(String(calls[2].init?.body))
    expect(finishBody.upload_phase).toBe('finish')
    expect(finishBody.video_id).toBe('v1')
  })

  it('a failed start means no later call happens', async () => {
    const { fetcher, calls } = fakeFetch([
      { ok: false, status: 400, body: { error: { message: 'bad', code: 100 } } },
    ])

    const error = await publishPageVideoStory({
      pageId: PAGE,
      pageAccessToken: TOKEN,
      videoUrl: VIDEO_URL,
      fetcher,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PagePublishError)
    expect(calls).toHaveLength(1)
  })

  it('a failed upload means finish is never called', async () => {
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
    expect(calls).toHaveLength(2)
  })
})

describe('listPageStories — read-back', () => {
  it('builds the url with fields and since/until as unix seconds', async () => {
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

    expect(calls).toHaveLength(1)
    const url = new URL(calls[0].url)
    expect(url.origin + url.pathname).toBe(`${GRAPH_BASE}/${PAGE}/stories`)
    expect(url.searchParams.get('fields')).toBe('post_id,status,creation_time,media_type,media_id,url')
    expect(url.searchParams.get('since')).toBe(String(Math.floor(since.getTime() / 1000)))
    expect(url.searchParams.get('until')).toBe(String(Math.floor(until.getTime() / 1000)))
  })

  it('an empty data list returns []', async () => {
    const { fetcher } = fakeFetch([{ ok: true, body: { data: [] } }])
    const result = await listPageStories({ pageId: PAGE, pageAccessToken: TOKEN, fetcher })
    expect(result.stories).toEqual([])
  })

  it('maps a story row to camelCase fields, including ARCHIVED status', async () => {
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

  it('a Graph error is surfaced as a PagePublishError', async () => {
    const { fetcher } = fakeFetch([
      { ok: false, status: 400, body: { error: { message: 'bad', code: 100 } } },
    ])

    const error = await listPageStories({
      pageId: PAGE,
      pageAccessToken: TOKEN,
      fetcher,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PagePublishError)
  })
})

describe('timeoutMs — abort signal wiring', () => {
  it('sets an AbortSignal on the request when timeoutMs is provided', async () => {
    const { fetcher, calls } = fakeFetch([
      { ok: true, body: { id: 'photo1' } },
      { ok: true, body: { post_id: 'post1' } },
    ])

    await publishPagePhotoStory({
      pageId: PAGE,
      pageAccessToken: TOKEN,
      imageUrl: 'https://x/img.jpg',
      timeoutMs: 1000,
      fetcher,
    })

    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal)
    expect(calls[1].init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('leaves the signal undefined when timeoutMs is not provided', async () => {
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
})

