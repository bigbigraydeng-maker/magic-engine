/**
 * instagram-stories — create a media container, poll its status, and publish it.
 *
 * These tests lock the three independent Graph calls (create container, read
 * status, publish container) and the shared failure classification that mirrors
 * `publishPagePhotoPost`. Every function is injectable, so we drive them with a
 * scripted fetcher and never touch the real network.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { createIgStoryContainer, getIgContainerStatus, publishIgContainer } from '../instagram-stories'
import { PagePublishError } from '../page-posts'
import { GRAPH_BASE } from '../graph-base'

const IG = '444555666'
const CONTAINER = '777888999'
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

// ---------------------------------------------------------------------------
// A. Token redaction with tokens present on purpose in the fake errors
// ---------------------------------------------------------------------------

describe('A. token redaction with tokens present in fake errors', () => {
  const encoded = encodeURIComponent(TOKEN)

  function assertRedacted(message: string) {
    expect(message).not.toContain(TOKEN)
    expect(message).not.toContain(encoded)
    expect(message).toContain('***')
  }

  it('createIgStoryContainer: thrown network error carrying the token is redacted', async () => {
    const { fetcher } = fakeFetch([
      { throws: new Error(`failed https://graph.facebook.com/x?access_token=${encoded}`) },
    ])

    const error = await createIgStoryContainer({
      igUserId: IG,
      accessToken: TOKEN,
      media: { kind: 'image', imageUrl: 'https://x/img.jpg' },
      fetcher,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PagePublishError)
    assertRedacted((error as PagePublishError).message)
  })

  it('getIgContainerStatus: thrown network error carrying the token is redacted', async () => {
    const { fetcher } = fakeFetch([
      { throws: new Error(`failed https://graph.facebook.com/x?access_token=${encoded}`) },
    ])

    const error = await getIgContainerStatus({
      containerId: CONTAINER,
      accessToken: TOKEN,
      fetcher,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PagePublishError)
    assertRedacted((error as PagePublishError).message)
  })

  it('publishIgContainer: thrown network error carrying the token is redacted', async () => {
    const { fetcher } = fakeFetch([
      { throws: new Error(`failed https://graph.facebook.com/x?access_token=${encoded}`) },
    ])

    const error = await publishIgContainer({
      igUserId: IG,
      accessToken: TOKEN,
      containerId: CONTAINER,
      fetcher,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PagePublishError)
    assertRedacted((error as PagePublishError).message)
  })

  it('createIgStoryContainer: Graph 400 body carrying the token is redacted', async () => {
    const { fetcher } = fakeFetch([
      { ok: false, status: 400, body: { error: { message: `Invalid token ${TOKEN}`, code: 190 } } },
    ])

    const error = await createIgStoryContainer({
      igUserId: IG,
      accessToken: TOKEN,
      media: { kind: 'image', imageUrl: 'https://x/img.jpg' },
      fetcher,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PagePublishError)
    assertRedacted((error as PagePublishError).message)
  })

  it('getIgContainerStatus: Graph 400 body carrying the token is redacted', async () => {
    const { fetcher } = fakeFetch([
      { ok: false, status: 400, body: { error: { message: `Invalid token ${TOKEN}`, code: 190 } } },
    ])

    const error = await getIgContainerStatus({
      containerId: CONTAINER,
      accessToken: TOKEN,
      fetcher,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PagePublishError)
    assertRedacted((error as PagePublishError).message)
  })

  it('publishIgContainer: Graph 400 body carrying the token is redacted', async () => {
    const { fetcher } = fakeFetch([
      { ok: false, status: 400, body: { error: { message: `Invalid token ${TOKEN}`, code: 190 } } },
    ])

    const error = await publishIgContainer({
      igUserId: IG,
      accessToken: TOKEN,
      containerId: CONTAINER,
      fetcher,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PagePublishError)
    assertRedacted((error as PagePublishError).message)
  })
})

// ---------------------------------------------------------------------------
// B. Validation without any fetch call
// ---------------------------------------------------------------------------

describe('B. validation rejects bad input without any fetch call', () => {
  const badIds = ['123/feed', '', 'abc']
  const badUrls = ['', 'http://a.example/x.jpg', 'not a url']

  it('createIgStoryContainer rejects bad igUserId with certainty rejected and 0 calls', async () => {
    for (const igUserId of badIds) {
      const { fetcher, calls } = fakeFetch([])
      const error = await createIgStoryContainer({
        igUserId,
        accessToken: TOKEN,
        media: { kind: 'image', imageUrl: 'https://x/img.jpg' },
        fetcher,
      }).catch((e: unknown) => e)

      expect(error).toBeInstanceOf(PagePublishError)
      expect((error as PagePublishError).certainty).toBe('rejected')
      expect(calls).toHaveLength(0)
    }
  })

  it('publishIgContainer rejects bad igUserId with certainty rejected and 0 calls', async () => {
    for (const igUserId of badIds) {
      const { fetcher, calls } = fakeFetch([])
      const error = await publishIgContainer({
        igUserId,
        accessToken: TOKEN,
        containerId: CONTAINER,
        fetcher,
      }).catch((e: unknown) => e)

      expect(error).toBeInstanceOf(PagePublishError)
      expect((error as PagePublishError).certainty).toBe('rejected')
      expect(calls).toHaveLength(0)
    }
  })

  it('getIgContainerStatus rejects bad containerId with certainty rejected and 0 calls', async () => {
    for (const containerId of badIds) {
      const { fetcher, calls } = fakeFetch([])
      const error = await getIgContainerStatus({
        containerId,
        accessToken: TOKEN,
        fetcher,
      }).catch((e: unknown) => e)

      expect(error).toBeInstanceOf(PagePublishError)
      expect((error as PagePublishError).certainty).toBe('rejected')
      expect(calls).toHaveLength(0)
    }
  })

  it('publishIgContainer rejects bad containerId with certainty rejected and 0 calls', async () => {
    for (const containerId of badIds) {
      const { fetcher, calls } = fakeFetch([])
      const error = await publishIgContainer({
        igUserId: IG,
        accessToken: TOKEN,
        containerId,
        fetcher,
      }).catch((e: unknown) => e)

      expect(error).toBeInstanceOf(PagePublishError)
      expect((error as PagePublishError).certainty).toBe('rejected')
      expect(calls).toHaveLength(0)
    }
  })

  it('createIgStoryContainer rejects bad image urls with certainty rejected and 0 calls', async () => {
    for (const imageUrl of badUrls) {
      const { fetcher, calls } = fakeFetch([])
      const error = await createIgStoryContainer({
        igUserId: IG,
        accessToken: TOKEN,
        media: { kind: 'image', imageUrl },
        fetcher,
      }).catch((e: unknown) => e)

      expect(error).toBeInstanceOf(PagePublishError)
      expect((error as PagePublishError).certainty).toBe('rejected')
      expect(calls).toHaveLength(0)
    }
  })

  it('createIgStoryContainer rejects bad video urls with certainty rejected and 0 calls', async () => {
    for (const videoUrl of badUrls) {
      const { fetcher, calls } = fakeFetch([])
      const error = await createIgStoryContainer({
        igUserId: IG,
        accessToken: TOKEN,
        media: { kind: 'video', videoUrl },
        fetcher,
      }).catch((e: unknown) => e)

      expect(error).toBeInstanceOf(PagePublishError)
      expect((error as PagePublishError).certainty).toBe('rejected')
      expect(calls).toHaveLength(0)
    }
  })
})

// ---------------------------------------------------------------------------
// C. Request shape
// ---------------------------------------------------------------------------

describe('C. request shape', () => {
  it('create body carries access_token and media_type STORIES', async () => {
    const { fetcher, calls } = fakeFetch([{ ok: true, body: { id: 'c1' } }])

    await createIgStoryContainer({
      igUserId: IG,
      accessToken: TOKEN,
      media: { kind: 'image', imageUrl: 'https://x/img.jpg' },
      fetcher,
    })

    const body = JSON.parse(String(calls[0].init?.body))
    expect(body.access_token).toBe(TOKEN)
    expect(body.media_type).toBe('STORIES')
  })

  it('publish body carries creation_id and access_token', async () => {
    const { fetcher, calls } = fakeFetch([{ ok: true, body: { id: 'm1' } }])

    await publishIgContainer({
      igUserId: IG,
      accessToken: TOKEN,
      containerId: CONTAINER,
      fetcher,
    })

    const body = JSON.parse(String(calls[0].init?.body))
    expect(body.creation_id).toBe(CONTAINER)
    expect(body.access_token).toBe(TOKEN)
  })

  it('status GET url contains fields=status_code and is called once', async () => {
    const { fetcher, calls } = fakeFetch([{ ok: true, body: { status_code: 'IN_PROGRESS' } }])

    await getIgContainerStatus({ containerId: CONTAINER, accessToken: TOKEN, fetcher })

    expect(calls).toHaveLength(1)
    const url = new URL(calls[0].url)
    expect(url.searchParams.get('fields')).toBe('status_code')
  })
})

// ---------------------------------------------------------------------------
// D. Failure classes for create/status/publish
// ---------------------------------------------------------------------------

describe('D. failure classes across all three calls', () => {
  function abortError(): Error {
    const error = new Error('aborted')
    error.name = 'AbortError'
    return error
  }

  async function createFailure(response: ScriptedResponse): Promise<PagePublishError> {
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

  async function statusFailure(response: ScriptedResponse): Promise<PagePublishError> {
    const { fetcher } = fakeFetch([response])
    const error = await getIgContainerStatus({
      containerId: CONTAINER,
      accessToken: TOKEN,
      fetcher,
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PagePublishError)
    return error as PagePublishError
  }

  async function publishFailure(response: ScriptedResponse): Promise<PagePublishError> {
    const { fetcher } = fakeFetch([response])
    const error = await publishIgContainer({
      igUserId: IG,
      accessToken: TOKEN,
      containerId: CONTAINER,
      fetcher,
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PagePublishError)
    return error as PagePublishError
  }

  it('create: AbortError = unknown', async () => {
    expect((await createFailure({ throws: abortError() })).certainty).toBe('unknown')
  })

  it('status: AbortError = unknown', async () => {
    expect((await statusFailure({ throws: abortError() })).certainty).toBe('unknown')
  })

  it('publish: AbortError = unknown', async () => {
    expect((await publishFailure({ throws: abortError() })).certainty).toBe('unknown')
  })

  it('create: 429 = rate_limited', async () => {
    const error = await createFailure({ ok: false, status: 429, body: { error: { message: 'slow down' } } })
    expect(error.certainty).toBe('rate_limited')
  })

  it('status: 429 = rate_limited', async () => {
    const error = await statusFailure({ ok: false, status: 429, body: { error: { message: 'slow down' } } })
    expect(error.certainty).toBe('rate_limited')
  })

  it('publish: 429 = rate_limited', async () => {
    const error = await publishFailure({ ok: false, status: 429, body: { error: { message: 'slow down' } } })
    expect(error.certainty).toBe('rate_limited')
  })

  it('create: 400 code 1 = unknown', async () => {
    const error = await createFailure({ ok: false, status: 400, body: { error: { message: 'unknown', code: 1 } } })
    expect(error.certainty).toBe('unknown')
  })

  it('status: 400 code 1 = unknown', async () => {
    const error = await statusFailure({ ok: false, status: 400, body: { error: { message: 'unknown', code: 1 } } })
    expect(error.certainty).toBe('unknown')
  })

  it('publish: 400 code 1 = unknown', async () => {
    const error = await publishFailure({ ok: false, status: 400, body: { error: { message: 'unknown', code: 1 } } })
    expect(error.certainty).toBe('unknown')
  })

  it('create: 2xx without id = unknown', async () => {
    expect((await createFailure({ ok: true, body: {} })).certainty).toBe('unknown')
  })

  it('publish: 2xx without id = unknown', async () => {
    expect((await publishFailure({ ok: true, body: {} })).certainty).toBe('unknown')
  })

  it('publish failure makes exactly one fetch call (no retry)', async () => {
    const { fetcher, calls } = fakeFetch([{ ok: true, body: {} }])

    const error = await publishIgContainer({
      igUserId: IG,
      accessToken: TOKEN,
      containerId: CONTAINER,
      fetcher,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PagePublishError)
    expect(calls).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// E. timeoutMs — abort signal wiring for all three calls
// ---------------------------------------------------------------------------

describe('E. timeoutMs wiring for all three calls', () => {
  it('create: signal set when timeoutMs provided, undefined otherwise', async () => {
    const withTimeout = fakeFetch([{ ok: true, body: { id: 'c1' } }])
    await createIgStoryContainer({
      igUserId: IG,
      accessToken: TOKEN,
      media: { kind: 'image', imageUrl: 'https://x/img.jpg' },
      timeoutMs: 1000,
      fetcher: withTimeout.fetcher,
    })
    expect(withTimeout.calls[0].init?.signal).toBeInstanceOf(AbortSignal)

    const withoutTimeout = fakeFetch([{ ok: true, body: { id: 'c1' } }])
    await createIgStoryContainer({
      igUserId: IG,
      accessToken: TOKEN,
      media: { kind: 'image', imageUrl: 'https://x/img.jpg' },
      fetcher: withoutTimeout.fetcher,
    })
    expect(withoutTimeout.calls[0].init?.signal).toBeUndefined()
  })

  it('status: signal set when timeoutMs provided, undefined otherwise', async () => {
    const withTimeout = fakeFetch([{ ok: true, body: { status_code: 'FINISHED' } }])
    await getIgContainerStatus({
      containerId: CONTAINER,
      accessToken: TOKEN,
      timeoutMs: 1000,
      fetcher: withTimeout.fetcher,
    })
    expect(withTimeout.calls[0].init?.signal).toBeInstanceOf(AbortSignal)

    const withoutTimeout = fakeFetch([{ ok: true, body: { status_code: 'FINISHED' } }])
    await getIgContainerStatus({
      containerId: CONTAINER,
      accessToken: TOKEN,
      fetcher: withoutTimeout.fetcher,
    })
    expect(withoutTimeout.calls[0].init?.signal).toBeUndefined()
  })

  it('publish: signal set when timeoutMs provided, undefined otherwise', async () => {
    const withTimeout = fakeFetch([{ ok: true, body: { id: 'm1' } }])
    await publishIgContainer({
      igUserId: IG,
      accessToken: TOKEN,
      containerId: CONTAINER,
      timeoutMs: 1000,
      fetcher: withTimeout.fetcher,
    })
    expect(withTimeout.calls[0].init?.signal).toBeInstanceOf(AbortSignal)

    const withoutTimeout = fakeFetch([{ ok: true, body: { id: 'm1' } }])
    await publishIgContainer({
      igUserId: IG,
      accessToken: TOKEN,
      containerId: CONTAINER,
      fetcher: withoutTimeout.fetcher,
    })
    expect(withoutTimeout.calls[0].init?.signal).toBeUndefined()
  })
})
