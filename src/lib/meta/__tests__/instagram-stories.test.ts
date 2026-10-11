/**
 * instagram-stories — create a media container, poll its status, and publish it.
 *
 * These tests lock the three independent Graph calls (create container, read
 * status, publish container) and the shared failure classification that mirrors
 * `publishPagePhotoPost`. Every function is injectable, so we drive them with a
 * scripted fetcher and never touch the real network.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createIgStoryContainer, getIgContainerStatus, publishIgContainer } from '../instagram-stories'
import { PagePublishError } from '../page-posts'
import { GRAPH_BASE } from '../graph-base'

const IG = '17841400000000000'
const TOKEN = 'ig-access-token'
const CONTAINER = 'container1'

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

let fetchSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch')
})

afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})

describe('createIgStoryContainer — image', () => {
  it('POSTs a STORIES image container and returns the container id', async () => {
    const { fetcher, calls } = fakeFetch([{ ok: true, body: { id: 'c1' } }])

    const result = await createIgStoryContainer({
      igUserId: IG,
      accessToken: TOKEN,
      media: { kind: 'image', imageUrl: 'https://x/img.jpg' },
      fetcher,
    })

    expect(result.containerId).toBe('c1')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${GRAPH_BASE}/${IG}/media`)

    const body = JSON.parse(String(calls[0].init?.body))
    expect(body.media_type).toBe('STORIES')
    expect(body.image_url).toBe('https://x/img.jpg')
    expect(body.access_token).toBe(TOKEN)
    expect(body.video_url).toBeUndefined()
  })
})

describe('createIgStoryContainer — video', () => {
  it('POSTs a STORIES video container with video_url and no image_url', async () => {
    const { fetcher, calls } = fakeFetch([{ ok: true, body: { id: 'c1' } }])

    await createIgStoryContainer({
      igUserId: IG,
      accessToken: TOKEN,
      media: { kind: 'video', videoUrl: 'https://x/video.mp4' },
      fetcher,
    })

    const body = JSON.parse(String(calls[0].init?.body))
    expect(body.media_type).toBe('STORIES')
    expect(body.video_url).toBe('https://x/video.mp4')
    expect(body.image_url).toBeUndefined()
  })
})

describe('createIgStoryContainer — failure classification', () => {
  async function failure(response: ScriptedResponse): Promise<PagePublishError> {
    const { fetcher } = fakeFetch([response])
    const error = await createIgStoryContainer({
      igUserId: IG,
      accessToken: TOKEN,
      media: { kind: 'image', imageUrl: 'https://x/img.jpg' },
      fetcher,
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PagePublishError)
    return error as PagePublishError
  }

  it('2xx without an id = unknown', async () => {
    const error = await failure({ ok: true, body: {} })
    expect(error.certainty).toBe('unknown')
  })

  it('400 with a Graph error body code 100 = rejected', async () => {
    const error = await failure({ ok: false, status: 400, body: { error: { message: 'bad', code: 100 } } })
    expect(error.certainty).toBe('rejected')
  })

  it('network throw = unknown', async () => {
    const error = await failure({ throws: new TypeError('fetch failed') })
    expect(error.certainty).toBe('unknown')
  })

  it('HTTP 429 = rate_limited', async () => {
    const error = await failure({ ok: false, status: 429, body: { error: { message: 'slow down' } } })
    expect(error.certainty).toBe('rate_limited')
  })

  it('Graph error code 1 = unknown', async () => {
    const error = await failure({ ok: false, status: 400, body: { error: { message: 'unknown error', code: 1 } } })
    expect(error.certainty).toBe('unknown')
  })

  it('a 2xx carrying an error body = unknown', async () => {
    const error = await failure({ ok: true, status: 200, body: { error: { message: 'weird', code: 1 } } })
    expect(error.certainty).toBe('unknown')
  })
})

describe('getIgContainerStatus — read-back', () => {
  it('GETs the container with fields=status_code and returns IN_PROGRESS without throwing', async () => {
    const { fetcher, calls } = fakeFetch([{ ok: true, body: { status_code: 'IN_PROGRESS' } }])

    const result = await getIgContainerStatus({
      containerId: CONTAINER,
      accessToken: TOKEN,
      fetcher,
    })

    expect(result.statusCode).toBe('IN_PROGRESS')
    expect(calls).toHaveLength(1)
    const url = new URL(calls[0].url)
    expect(url.origin + url.pathname).toBe(`${GRAPH_BASE}/${CONTAINER}`)
    expect(url.searchParams.get('fields')).toBe('status_code')
  })

  it('returns FINISHED as-is', async () => {
    const { fetcher } = fakeFetch([{ ok: true, body: { status_code: 'FINISHED' } }])
    const result = await getIgContainerStatus({ containerId: CONTAINER, accessToken: TOKEN, fetcher })
    expect(result.statusCode).toBe('FINISHED')
  })

  it('returns null when status_code is absent', async () => {
    const { fetcher } = fakeFetch([{ ok: true, body: {} }])
    const result = await getIgContainerStatus({ containerId: CONTAINER, accessToken: TOKEN, fetcher })
    expect(result.statusCode).toBeNull()
  })

  it('a Graph error is surfaced as a PagePublishError', async () => {
    const { fetcher } = fakeFetch([
      { ok: false, status: 400, body: { error: { message: 'bad', code: 100 } } },
    ])

    const error = await getIgContainerStatus({
      containerId: CONTAINER,
      accessToken: TOKEN,
      fetcher,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PagePublishError)
  })
})

describe('publishIgContainer — publish', () => {
  it('POSTs media_publish with creation_id and returns the media id', async () => {
    const { fetcher, calls } = fakeFetch([{ ok: true, body: { id: 'm1' } }])

    const result = await publishIgContainer({
      igUserId: IG,
      accessToken: TOKEN,
      containerId: CONTAINER,
      fetcher,
    })

    expect(result.mediaId).toBe('m1')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${GRAPH_BASE}/${IG}/media_publish`)

    const body = JSON.parse(String(calls[0].init?.body))
    expect(body.creation_id).toBe(CONTAINER)
  })

  it('2xx without an id = unknown, and exactly one call (no retry)', async () => {
    const { fetcher, calls } = fakeFetch([{ ok: true, body: {} }])

    const error = await publishIgContainer({
      igUserId: IG,
      accessToken: TOKEN,
      containerId: CONTAINER,
      fetcher,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PagePublishError)
    expect((error as PagePublishError).certainty).toBe('unknown')
    expect(calls).toHaveLength(1)
  })

  it('network throw = unknown, and exactly one call (no retry)', async () => {
    const { fetcher, calls } = fakeFetch([{ throws: new TypeError('fetch failed') }])

    const error = await publishIgContainer({
      igUserId: IG,
      accessToken: TOKEN,
      containerId: CONTAINER,
      fetcher,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PagePublishError)
    expect((error as PagePublishError).certainty).toBe('unknown')
    expect(calls).toHaveLength(1)
  })
})

describe('the access token never leaks into errors', () => {
  it('createIgStoryContainer 400 error message does not contain the token', async () => {
    const { fetcher } = fakeFetch([
      { ok: false, status: 400, body: { error: { message: 'bad', code: 100 } } },
    ])

    const error = await createIgStoryContainer({
      igUserId: IG,
      accessToken: TOKEN,
      media: { kind: 'image', imageUrl: 'https://x/img.jpg' },
      fetcher,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PagePublishError)
    expect((error as PagePublishError).message).not.toContain(TOKEN)
  })

  it('createIgStoryContainer network error message does not contain the token', async () => {
    const { fetcher } = fakeFetch([{ throws: new TypeError('fetch failed') }])

    const error = await createIgStoryContainer({
      igUserId: IG,
      accessToken: TOKEN,
      media: { kind: 'image', imageUrl: 'https://x/img.jpg' },
      fetcher,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PagePublishError)
    expect((error as PagePublishError).message).not.toContain(TOKEN)
  })

  it('getIgContainerStatus error message does not contain the token', async () => {
    const { fetcher } = fakeFetch([
      { ok: false, status: 400, body: { error: { message: 'bad', code: 100 } } },
    ])

    const error = await getIgContainerStatus({
      containerId: CONTAINER,
      accessToken: TOKEN,
      fetcher,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PagePublishError)
    expect((error as PagePublishError).message).not.toContain(TOKEN)
  })

  it('publishIgContainer error message does not contain the token', async () => {
    const { fetcher } = fakeFetch([
      { ok: false, status: 400, body: { error: { message: 'bad', code: 100 } } },
    ])

    const error = await publishIgContainer({
      igUserId: IG,
      accessToken: TOKEN,
      containerId: CONTAINER,
      fetcher,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PagePublishError)
    expect((error as PagePublishError).message).not.toContain(TOKEN)
  })
})

describe('timeoutMs — abort signal wiring', () => {
  it('sets an AbortSignal on createIgStoryContainer when timeoutMs is provided', async () => {
    const { fetcher, calls } = fakeFetch([{ ok: true, body: { id: 'c1' } }])

    await createIgStoryContainer({
      igUserId: IG,
      accessToken: TOKEN,
      media: { kind: 'image', imageUrl: 'https://x/img.jpg' },
      timeoutMs: 1000,
      fetcher,
    })

    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('leaves the signal undefined on createIgStoryContainer when timeoutMs is not provided', async () => {
    const { fetcher, calls } = fakeFetch([{ ok: true, body: { id: 'c1' } }])

    await createIgStoryContainer({
      igUserId: IG,
      accessToken: TOKEN,
      media: { kind: 'image', imageUrl: 'https://x/img.jpg' },
      fetcher,
    })

    expect(calls[0].init?.signal).toBeUndefined()
  })

  it('sets an AbortSignal on publishIgContainer when timeoutMs is provided', async () => {
    const { fetcher, calls } = fakeFetch([{ ok: true, body: { id: 'm1' } }])

    await publishIgContainer({
      igUserId: IG,
      accessToken: TOKEN,
      containerId: CONTAINER,
      timeoutMs: 1000,
      fetcher,
    })

    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('leaves the signal undefined on publishIgContainer when timeoutMs is not provided', async () => {
    const { fetcher, calls } = fakeFetch([{ ok: true, body: { id: 'm1' } }])

    await publishIgContainer({
      igUserId: IG,
      accessToken: TOKEN,
      containerId: CONTAINER,
      fetcher,
    })

    expect(calls[0].init?.signal).toBeUndefined()
  })
})
