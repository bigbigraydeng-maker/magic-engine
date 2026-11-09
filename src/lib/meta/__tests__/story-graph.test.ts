import { describe, expect, it, vi } from 'vitest'
import {
  assertGraphId,
  assertHttpsUrl,
  getGraphJson,
  postGraphJson,
  redactSecrets,
  requestGraph,
} from '../story-graph'
import { PagePublishError } from '../page-posts'

/** Build a typed fetch stub from a vi.fn implementation. */
function makeFetcher(
  impl: (url: string, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return vi.fn(impl) as typeof fetch
}

describe('redactSecrets', () => {
  it('replaces raw and encodeURIComponent forms', () => {
    const secret = 'a/b+c'
    const encoded = encodeURIComponent(secret)
    expect(encoded).toBe('a%2Fb%2Bc')
    const out = redactSecrets(`raw=${secret} enc=${encoded}`, [secret])
    expect(out).toBe('raw=*** enc=***')
  })

  it('replaces multiple secrets', () => {
    const out = redactSecrets('one two three', ['one', 'three'])
    expect(out).toBe('*** two ***')
  })

  it('ignores empty secrets', () => {
    const out = redactSecrets('hello world', ['', 'world'])
    expect(out).toBe('hello ***')
  })

  it('leaves text without secrets unchanged', () => {
    const out = redactSecrets('nothing to hide', ['secret'])
    expect(out).toBe('nothing to hide')
  })

  it('replaces every occurrence', () => {
    const out = redactSecrets('x x x', ['x'])
    expect(out).toBe('*** *** ***')
  })
})

describe('assertGraphId', () => {
  it('accepts a plain decimal id', () => {
    expect(() => assertGraphId('123', 'page id')).not.toThrow()
  })

  it.each(['', 'abc', '12 3', '1/2', '-1'])('rejects %j', (value) => {
    let error: unknown
    try {
      assertGraphId(value, 'page id')
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(PagePublishError)
    expect((error as PagePublishError).certainty).toBe('rejected')
    expect((error as PagePublishError).message).toContain('page id')
  })
})

describe('assertHttpsUrl', () => {
  it('accepts an https url', () => {
    expect(() => assertHttpsUrl('https://a.example/x', 'url')).not.toThrow()
  })

  it.each(['', 'http://a.example', 'ftp://a.example', 'not a url', 'javascript:alert(1)'])(
    'rejects %j',
    (value) => {
      let error: unknown
      try {
        assertHttpsUrl(value, 'url')
      } catch (caught) {
        error = caught
      }
      expect(error).toBeInstanceOf(PagePublishError)
      expect((error as PagePublishError).certainty).toBe('rejected')
    },
  )

  const suffixes = ['facebook.com', 'fbcdn.net']

  it.each([
    'https://rupload.facebook.com/x',
    'https://facebook.com/x',
    'https://x.fbcdn.net/y',
  ])('accepts allowed host %j', (value) => {
    expect(() => assertHttpsUrl(value, 'url', suffixes)).not.toThrow()
  })

  it.each([
    'https://evilfacebook.com/x',
    'https://facebook.com.evil.example/x',
    'https://example.com/x',
  ])('rejects disallowed host %j', (value) => {
    let error: unknown
    try {
      assertHttpsUrl(value, 'url', suffixes)
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(PagePublishError)
    expect((error as PagePublishError).certainty).toBe('rejected')
  })

  it('never echoes the url in the message', () => {
    const url = 'https://example.com/SECRETMARK'
    let error: unknown
    try {
      assertHttpsUrl(url, 'url', suffixes)
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(PagePublishError)
    expect((error as PagePublishError).message).not.toContain('SECRETMARK')
  })
})

describe('requestGraph', () => {
  it('POST sends JSON body and Content-Type, merging custom headers', async () => {
    const fetcher = makeFetcher(async () => new Response('{}', { status: 200 }))
    await requestGraph({
      url: 'https://graph.example/x',
      method: 'POST',
      headers: { Authorization: 'Bearer token' },
      body: { a: 1 },
      label: 'post',
      secrets: [],
      fetcher,
    })
    const mock = fetcher as unknown as ReturnType<typeof vi.fn>
    const init = mock.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ a: 1 }))
    const headers = init.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['Authorization']).toBe('Bearer token')
  })

  it('GET sends no body', async () => {
    const fetcher = makeFetcher(async () => new Response('{}', { status: 200 }))
    await requestGraph({
      url: 'https://graph.example/x',
      method: 'GET',
      label: 'get',
      secrets: [],
      fetcher,
    })
    const mock = fetcher as unknown as ReturnType<typeof vi.fn>
    const init = mock.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
  })

  it('returns the parsed body on success', async () => {
    const fetcher = makeFetcher(
      async () => new Response(JSON.stringify({ id: '42' }), { status: 200 }),
    )
    const result = await requestGraph({
      url: 'https://graph.example/x',
      method: 'GET',
      label: 'get',
      secrets: [],
      fetcher,
    })
    expect(result).toEqual({ id: '42' })
  })

  it('returns {} for a non-JSON body on 200', async () => {
    const fetcher = makeFetcher(async () => new Response('not json', { status: 200 }))
    const result = await requestGraph({
      url: 'https://graph.example/x',
      method: 'GET',
      label: 'get',
      secrets: [],
      fetcher,
    })
    expect(result).toEqual({})
  })

  it('classifies a 400 with a Graph error body as rejected', async () => {
    const fetcher = makeFetcher(
      async () =>
        new Response(JSON.stringify({ error: { message: 'bad', code: 100 } }), {
          status: 400,
        }),
    )
    let error: unknown
    try {
      await requestGraph({
        url: 'https://graph.example/x',
        method: 'GET',
        label: 'get',
        secrets: [],
        fetcher,
      })
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(PagePublishError)
    const publishError = error as PagePublishError
    expect(publishError.certainty).toBe('rejected')
    expect(publishError.httpStatus).toBe(400)
    expect(publishError.graphCode).toBe(100)
  })

  it('classifies a 200 carrying an error body as unknown', async () => {
    const fetcher = makeFetcher(
      async () =>
        new Response(JSON.stringify({ error: { message: 'bad', code: 100 } }), {
          status: 200,
        }),
    )
    let error: unknown
    try {
      await requestGraph({
        url: 'https://graph.example/x',
        method: 'GET',
        label: 'get',
        secrets: [],
        fetcher,
      })
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(PagePublishError)
    expect((error as PagePublishError).certainty).toBe('unknown')
  })

  it('classifies a 500 as unknown', async () => {
    const fetcher = makeFetcher(async () => new Response('oops', { status: 500 }))
    let error: unknown
    try {
      await requestGraph({
        url: 'https://graph.example/x',
        method: 'GET',
        label: 'get',
        secrets: [],
        fetcher,
      })
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(PagePublishError)
    expect((error as PagePublishError).certainty).toBe('unknown')
  })

  it('classifies a thrown fetcher as unknown and redacts secrets', async () => {
    const secret = 'topsecret'
    const fetcher = makeFetcher(async () => {
      throw new Error(`boom ${secret}`)
    })
    let error: unknown
    try {
      await requestGraph({
        url: 'https://graph.example/x',
        method: 'GET',
        label: 'get',
        secrets: [secret],
        fetcher,
      })
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(PagePublishError)
    const publishError = error as PagePublishError
    expect(publishError.certainty).toBe('unknown')
    expect(publishError.message).not.toContain(secret)
    expect(publishError.message).toContain('***')
  })

  it('sets an AbortSignal when timeoutMs is provided', async () => {
    const fetcher = makeFetcher(async () => new Response('{}', { status: 200 }))
    await requestGraph({
      url: 'https://graph.example/x',
      method: 'GET',
      label: 'get',
      secrets: [],
      timeoutMs: 1000,
      fetcher,
    })
    const mock = fetcher as unknown as ReturnType<typeof vi.fn>
    const init = mock.mock.calls[0][1] as RequestInit
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('leaves signal undefined when timeoutMs is not provided', async () => {
    const fetcher = makeFetcher(async () => new Response('{}', { status: 200 }))
    await requestGraph({
      url: 'https://graph.example/x',
      method: 'GET',
      label: 'get',
      secrets: [],
      fetcher,
    })
    const mock = fetcher as unknown as ReturnType<typeof vi.fn>
    const init = mock.mock.calls[0][1] as RequestInit
    expect(init.signal).toBeUndefined()
  })

  it('resolves the default fetcher at call time', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))
    try {
      await requestGraph({
        url: 'https://graph.example/x',
        method: 'GET',
        label: 'get',
        secrets: [],
      })
      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('postGraphJson / getGraphJson', () => {
  it('postGraphJson delegates with method POST', async () => {
    const fetcher = makeFetcher(async () => new Response('{}', { status: 200 }))
    await postGraphJson({
      url: 'https://graph.example/x',
      body: { a: 1 },
      label: 'post',
      secrets: [],
      fetcher,
    })
    const mock = fetcher as unknown as ReturnType<typeof vi.fn>
    const init = mock.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
  })

  it('getGraphJson delegates with method GET', async () => {
    const fetcher = makeFetcher(async () => new Response('{}', { status: 200 }))
    await getGraphJson({
      url: 'https://graph.example/x',
      label: 'get',
      secrets: [],
      fetcher,
    })
    const mock = fetcher as unknown as ReturnType<typeof vi.fn>
    const init = mock.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('GET')
  })
})
