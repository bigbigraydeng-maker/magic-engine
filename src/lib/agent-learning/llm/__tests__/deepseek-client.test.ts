import { describe, it, expect, vi } from 'vitest'
import { createDeepSeekClient, costUsd, worstCaseUsd, DEEPSEEK_FLASH_PRICE, DEFAULT_DEEPSEEK_MODEL, type FetchLike } from '@/lib/agent-learning/llm/deepseek-client'

const KEY = 'sk-test-SECRET-123'
const SYSTEM = 'you are a rule extractor'
const USER = 'text to analyse'

type FetchResponse = Awaited<ReturnType<FetchLike>>
type ClientResult = ReturnType<typeof createDeepSeekClient>
type DeepSeekClientValue = Extract<ClientResult, { ok: true }>['value']

function okResponse(envelope: unknown): FetchResponse {
  return { ok: true, status: 200, text: async () => JSON.stringify(envelope) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw)
  if (!isRecord(parsed)) throw new Error('expected a JSON object')
  return parsed
}

function readCall(calls: Array<Parameters<FetchLike>>, index = 0): Parameters<FetchLike> {
  const call = calls[index]
  if (!call) throw new Error(`expected fetch call #${index}`)
  return call
}

function expectNoKeyIn(result: unknown): void {
  expect(JSON.stringify(result)).not.toContain(KEY)
}

function clientWith(
  env: Record<string, string | undefined>,
  fetchDouble: FetchLike,
): DeepSeekClientValue {
  const created = createDeepSeekClient(env, fetchDouble)
  if (!created.ok) throw new Error(`expected client creation to succeed, got ${created.error}`)
  return created.value
}

describe('createDeepSeekClient', () => {
  it('1. fails without an API key and never calls fetch', () => {
    const fetchDouble = vi.fn<FetchLike>(async () => okResponse({}))
    const created = createDeepSeekClient({}, fetchDouble)

    expect(created.ok).toBe(false)
    if (created.ok) throw new Error('expected failure')
    expect(created.error).toBe('deepseek_api_key_missing')
    expectNoKeyIn(created)
    expect(fetchDouble).not.toHaveBeenCalled()
  })

  it('2. uses the default model unless DEEPSEEK_MODEL overrides it', async () => {
    const defaultFetch = vi.fn<FetchLike>(async () => okResponse({ choices: [{ message: { content: '{}' } }] }))
    const defaultClient = clientWith({ DEEPSEEK_API_KEY: KEY }, defaultFetch)
    expect(DEFAULT_DEEPSEEK_MODEL).toBe('deepseek-v4-flash')
    expect(defaultClient.model).toBe(DEFAULT_DEEPSEEK_MODEL)

    const defaultRes = await defaultClient.completeJson({
      system: SYSTEM,
      user: USER,
      maxOutputTokens: 256,
      maxInputTokens: 8000,
    })
    if (!defaultRes.ok) throw new Error('expected ok completion')
    const [, defaultInit] = readCall(defaultFetch.mock.calls)
    expect(parseJsonObject(defaultInit.body).model).toBe(DEFAULT_DEEPSEEK_MODEL)

    const overrideFetch = vi.fn<FetchLike>(async () => okResponse({ choices: [{ message: { content: '{}' } }] }))
    const overrideClient = clientWith({ DEEPSEEK_API_KEY: KEY, DEEPSEEK_MODEL: 'deepseek-flash' }, overrideFetch)
    expect(overrideClient.model).toBe('deepseek-flash')

    const overrideRes = await overrideClient.completeJson({
      system: SYSTEM,
      user: USER,
      maxOutputTokens: 256,
      maxInputTokens: 8000,
    })
    if (!overrideRes.ok) throw new Error('expected ok completion')
    const [, overrideInit] = readCall(overrideFetch.mock.calls)
    expect(parseJsonObject(overrideInit.body).model).toBe('deepseek-flash')
  })

  it('3. posts the expected JSON body and respects DEEPSEEK_BASE_URL', async () => {
    const fetchDouble = vi.fn<FetchLike>(async () => okResponse({ choices: [{ message: { content: '{}' } }] }))
    const client = clientWith({ DEEPSEEK_API_KEY: KEY }, fetchDouble)

    const res = await client.completeJson({
      system: SYSTEM,
      user: USER,
      maxOutputTokens: 512,
      maxInputTokens: 8000,
    })
    if (!res.ok) throw new Error('expected ok completion')

    const [url, init] = readCall(fetchDouble.mock.calls)
    expect(url).toBe('https://api.deepseek.com/chat/completions')
    expect(init.method).toBe('POST')
    expect(init.headers.authorization).toBe(`Bearer ${KEY}`)

    const body = parseJsonObject(init.body)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.max_tokens).toBe(512)
    expect(body.stream).toBe(false)

    const messages = body.messages
    if (!Array.isArray(messages) || messages.length !== 2) throw new Error('expected exactly two messages')
    const [systemMessage, userMessage] = messages
    if (!isRecord(systemMessage) || !isRecord(userMessage)) throw new Error('expected message objects')
    expect(systemMessage.role).toBe('system')
    expect(systemMessage.content).toBe(SYSTEM)
    expect(userMessage.role).toBe('user')
    expect(userMessage.content).toBe(USER)

    const baseFetch = vi.fn<FetchLike>(async () => okResponse({ choices: [{ message: { content: '{}' } }] }))
    const baseClient = clientWith({ DEEPSEEK_API_KEY: KEY, DEEPSEEK_BASE_URL: 'https://x.test/' }, baseFetch)
    const baseRes = await baseClient.completeJson({
      system: SYSTEM,
      user: USER,
      maxOutputTokens: 256,
      maxInputTokens: 8000,
    })
    if (!baseRes.ok) throw new Error('expected ok completion')
    const [baseUrl] = readCall(baseFetch.mock.calls)
    expect(baseUrl).toBe('https://x.test/chat/completions')
  })

  it('4. returns the content and the recorded usage on success', async () => {
    const content = '{"rules":[]}'
    const fetchDouble = vi.fn<FetchLike>(async () =>
      okResponse({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 1000, completion_tokens: 200 },
        model: 'deepseek-v4-flash',
      }),
    )
    const client = clientWith({ DEEPSEEK_API_KEY: KEY }, fetchDouble)

    const res = await client.completeJson({
      system: SYSTEM,
      user: USER,
      maxOutputTokens: 1500,
      maxInputTokens: 8000,
    })
    if (!res.ok) throw new Error('expected ok completion')

    expect(res.value.text).toBe(content)
    expect(res.value.inputTokens).toBe(1000)
    expect(res.value.outputTokens).toBe(200)
    expect(fetchDouble).toHaveBeenCalledTimes(1)
  })

  it('5. falls back to the worst-case token counts when usage is missing', async () => {
    const fetchDouble = vi.fn<FetchLike>(async () => okResponse({ choices: [{ message: { content: '{}' } }] }))
    const client = clientWith({ DEEPSEEK_API_KEY: KEY }, fetchDouble)

    const res = await client.completeJson({
      system: SYSTEM,
      user: USER,
      maxOutputTokens: 1500,
      maxInputTokens: 8000,
    })
    if (!res.ok) throw new Error('expected ok completion')

    expect(res.value.inputTokens).toBe(8000)
    expect(res.value.outputTokens).toBe(1500)
    expect(fetchDouble).toHaveBeenCalledTimes(1)
  })

  it('6. maps HTTP 500 to a safe error without retrying or leaking the key', async () => {
    const fetchDouble = vi.fn<FetchLike>(async () => ({
      ok: false,
      status: 500,
      text: async () => `boom ${KEY}`,
    }))
    const client = clientWith({ DEEPSEEK_API_KEY: KEY }, fetchDouble)

    const res = await client.completeJson({
      system: SYSTEM,
      user: USER,
      maxOutputTokens: 1500,
      maxInputTokens: 8000,
    })

    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected failure')
    expect(res.error).toBe('deepseek_http_500')
    expect(res.error).not.toContain(KEY)
    expect(res.error).not.toContain('boom')
    expectNoKeyIn(res)
    expect(fetchDouble).toHaveBeenCalledTimes(1)
  })

  it('7. reports a timeout when the request is aborted', async () => {
    const hangingFetch: FetchLike = (_url, init) =>
      new Promise<FetchResponse>((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        })
      })
    const fetchDouble = vi.fn<FetchLike>(hangingFetch)
    const client = clientWith({ DEEPSEEK_API_KEY: KEY }, fetchDouble)

    const res = await client.completeJson({
      system: SYSTEM,
      user: USER,
      maxOutputTokens: 1500,
      maxInputTokens: 8000,
      timeoutMs: 20,
    })

    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected failure')
    expect(res.error).toBe('deepseek_timeout')
    expect(res.error).not.toContain(KEY)
    expectNoKeyIn(res)
  })

  it('8. reports a network error without leaking the key', async () => {
    const fetchDouble = vi.fn<FetchLike>(async () => {
      throw new Error(`ECONNRESET ${KEY}`)
    })
    const client = clientWith({ DEEPSEEK_API_KEY: KEY }, fetchDouble)

    const res = await client.completeJson({
      system: SYSTEM,
      user: USER,
      maxOutputTokens: 1500,
      maxInputTokens: 8000,
    })

    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected failure')
    expect(res.error).toBe('deepseek_network_error')
    expect(res.error).not.toContain(KEY)
    expectNoKeyIn(res)
  })

  it('9. rejects malformed envelopes and non-JSON content', async () => {
    const notJsonFetch = vi.fn<FetchLike>(async () => ({
      ok: true,
      status: 200,
      text: async () => 'not json',
    }))
    const notJsonClient = clientWith({ DEEPSEEK_API_KEY: KEY }, notJsonFetch)
    const notJsonRes = await notJsonClient.completeJson({
      system: SYSTEM,
      user: USER,
      maxOutputTokens: 1500,
      maxInputTokens: 8000,
    })
    expect(notJsonRes.ok).toBe(false)
    if (notJsonRes.ok) throw new Error('expected failure')
    expect(notJsonRes.error).toBe('deepseek_bad_response')
    expectNoKeyIn(notJsonRes)

    const nonJsonContentFetch = vi.fn<FetchLike>(async () =>
      okResponse({ choices: [{ message: { content: 'hello' } }] }),
    )
    const nonJsonContentClient = clientWith({ DEEPSEEK_API_KEY: KEY }, nonJsonContentFetch)
    const nonJsonContentRes = await nonJsonContentClient.completeJson({
      system: SYSTEM,
      user: USER,
      maxOutputTokens: 1500,
      maxInputTokens: 8000,
    })
    expect(nonJsonContentRes.ok).toBe(false)
    if (nonJsonContentRes.ok) throw new Error('expected failure')
    expect(nonJsonContentRes.error).toBe('deepseek_non_json_content')
    expectNoKeyIn(nonJsonContentRes)

    const emptyChoicesFetch = vi.fn<FetchLike>(async () => okResponse({ choices: [] }))
    const emptyChoicesClient = clientWith({ DEEPSEEK_API_KEY: KEY }, emptyChoicesFetch)
    const emptyChoicesRes = await emptyChoicesClient.completeJson({
      system: SYSTEM,
      user: USER,
      maxOutputTokens: 1500,
      maxInputTokens: 8000,
    })
    expect(emptyChoicesRes.ok).toBe(false)
    if (emptyChoicesRes.ok) throw new Error('expected failure')
    expect(emptyChoicesRes.error).toBe('deepseek_bad_response')
    expectNoKeyIn(emptyChoicesRes)
  })

  it('10. computes cost and worst-case cost from the price constants', () => {
    expect(costUsd(DEEPSEEK_FLASH_PRICE, { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(1.5, 10)
    expect(worstCaseUsd(DEEPSEEK_FLASH_PRICE, 8000, 1500)).toBeCloseTo(0.0042, 10)
  })

  it('11. thinking is disabled by default (reasoning tokens would eat max_tokens) and can be enabled', async () => {
    const fetchDouble = vi.fn<FetchLike>(async () => okResponse({ choices: [{ message: { content: '{}' } }] }))
    const client = clientWith({ DEEPSEEK_API_KEY: KEY }, fetchDouble)
    await client.completeJson({ system: SYSTEM, user: USER, maxOutputTokens: 100, maxInputTokens: 100 })
    await client.completeJson({ system: SYSTEM, user: USER, maxOutputTokens: 100, maxInputTokens: 100, thinking: 'enabled' })
    const first = parseJsonObject(fetchDouble.mock.calls[0][1].body)
    const second = parseJsonObject(fetchDouble.mock.calls[1][1].body)
    expect(first.thinking).toEqual({ type: 'disabled' })
    expect(second.thinking).toEqual({ type: 'enabled' })
  })

  it('12. empty content with finish_reason length -> deepseek_output_truncated', async () => {
    const fetchDouble = vi.fn<FetchLike>(async () =>
      okResponse({ choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: 'long thoughts' } }] }),
    )
    const client = clientWith({ DEEPSEEK_API_KEY: KEY }, fetchDouble)
    const res = await client.completeJson({ system: SYSTEM, user: USER, maxOutputTokens: 100, maxInputTokens: 100 })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected failure')
    expect(res.error).toBe('deepseek_output_truncated')
    expect(JSON.stringify(res)).not.toContain(KEY)
  })
})
