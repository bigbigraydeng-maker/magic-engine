/**
 * The Resend connector for ME's automated mail. What must never happen:
 *  - a client's mail goes out with ME's system key (the SDK does that by itself when handed an empty key);
 *  - an unclear outcome (timeout, 409, 429, 5xx, network) is reported as "rejected", which would free the guest for a
 *    second, different mail;
 *  - a malformed request reaches the provider.
 * Timeouts are tested with real timers and a short budget, not a fake clock.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  RESEND_API_BASE_URL,
  RESEND_SEND_TIMEOUT_MS,
  classifyResendError,
  createResendEmailPort,
  readResendAccountKey,
  resendAccountKeyEnvName,
  resendRequestProblem,
  type ResendClientLike,
  type ResendEmailRequest,
} from '../resend-email'

const KEY = 're_test_abcdefghijklmnop'
const SEND_ID = '2f6f1c1e-0000-4000-8000-000000000001'

function request(over: Partial<ResendEmailRequest> = {}): ResendEmailRequest {
  return {
    account: 'cts',
    from: 'Baker Gu <baker@news.example.co.nz>',
    to: 'guest@example.com',
    replyTo: 'info@example.co.nz',
    subject: 'Welcome to our tours',
    text: 'Kia ora Amy,\n\nThank you for your interest.',
    headers: {
      'List-Unsubscribe': '<https://app.example.com/api/u/token>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
    idempotencyKey: `ts:${SEND_ID}`,
    tags: [{ name: 'triggered_send_id', value: SEND_ID }],
    attempt: 'first',
    ...over,
  }
}

const envWith =
  (values: Record<string, string | undefined>) =>
  (name: string): string | undefined =>
    values[name]

function clientReturning(result: () => Promise<unknown>) {
  const send = vi.fn<ResendClientLike['emails']['send']>(async () => result())
  const client: ResendClientLike = { emails: { send } }
  const createClient = vi.fn((_key: string) => client)
  return { send, createClient }
}

const sentOk = () => Promise.resolve({ data: { id: 'msg_123' }, error: null, headers: null })

describe('the account key', () => {
  it('maps an account label to its own variable, and refuses the system account and malformed labels', () => {
    expect(resendAccountKeyEnvName('cts')).toBe('RESEND_API_KEY_CTS')
    expect(resendAccountKeyEnvName('nal_2')).toBe('RESEND_API_KEY_NAL_2')
    for (const bad of ['system', 'CTS', 'c-ts', '', '2cts', 'a'.repeat(32), 'cts '])
      expect(resendAccountKeyEnvName(bad)).toBeNull()
  })

  it('reads only the account variable, never the system key', () => {
    const env = vi.fn(envWith({ RESEND_API_KEY: KEY, RESEND_API_KEY_CTS: undefined }))
    expect(readResendAccountKey('cts', env)).toMatchObject({ ok: false, code: 'no_account_key' })
    expect(env.mock.calls.map((c) => c[0])).toEqual(['RESEND_API_KEY_CTS'])
  })

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['blank', '   '],
    ['not a Resend key', 'sk_live_abcdefghijk'],
    ['too short', 're_abc'],
    ['has a space inside', 're_abc defghijkl'],
  ])('treats a %s key as no key at all', (_label, value) => {
    expect(readResendAccountKey('cts', envWith({ RESEND_API_KEY_CTS: value }))).toMatchObject({ ok: false, code: 'no_account_key' })
  })

  it('accepts a well-formed key and trims a pasted line break', () => {
    expect(readResendAccountKey('cts', envWith({ RESEND_API_KEY_CTS: ` ${KEY}\n` }))).toEqual({
      ok: true,
      key: KEY,
      envName: 'RESEND_API_KEY_CTS',
    })
  })
})

describe('sending', () => {
  it('never creates a client (which would fall back to the system key) when the account key is missing', async () => {
    const { createClient, send } = clientReturning(sentOk)
    const port = createResendEmailPort({ env: envWith({ RESEND_API_KEY: KEY }), createClient })
    expect(await port.send(request())).toMatchObject({ kind: 'not_attempted', code: 'no_account_key' })
    expect(createClient).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('refuses the system account even when the system key is set', async () => {
    const { createClient } = clientReturning(sentOk)
    const port = createResendEmailPort({ env: envWith({ RESEND_API_KEY: KEY, RESEND_API_KEY_SYSTEM: KEY }), createClient })
    expect(await port.send(request({ account: 'system' }))).toMatchObject({ kind: 'not_attempted', code: 'invalid_account' })
    expect(createClient).not.toHaveBeenCalled()
  })

  it('builds the client with exactly the account key and sends the frozen payload with the idempotency key', async () => {
    const { createClient, send } = clientReturning(sentOk)
    const port = createResendEmailPort({ env: envWith({ RESEND_API_KEY_CTS: `${KEY}\n` }), createClient })
    const outcome = await port.send(request())
    expect(outcome).toEqual({ kind: 'sent', messageId: 'msg_123' })
    expect(createClient).toHaveBeenCalledWith(KEY)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]).toEqual([
      {
        from: 'Baker Gu <baker@news.example.co.nz>',
        to: ['guest@example.com'],
        replyTo: 'info@example.co.nz',
        subject: 'Welcome to our tours',
        text: 'Kia ora Amy,\n\nThank you for your interest.',
        headers: {
          'List-Unsubscribe': '<https://app.example.com/api/u/token>',
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
        tags: [{ name: 'triggered_send_id', value: SEND_ID }],
      },
      { idempotencyKey: `ts:${SEND_ID}` },
    ])
  })

  it('passes html only when there is html', async () => {
    const { createClient, send } = clientReturning(sentOk)
    const port = createResendEmailPort({ env: envWith({ RESEND_API_KEY_CTS: KEY }), createClient })
    await port.send(request({ html: '<p>Kia ora</p>' }))
    expect(send.mock.calls[0][0]).toMatchObject({ html: '<p>Kia ora</p>', text: 'Kia ora Amy,\n\nThank you for your interest.' })
  })

  it('reads a definite 4xx refusal as rejected, without passing on the provider message', async () => {
    const { createClient } = clientReturning(() =>
      Promise.resolve({
        data: null,
        error: { statusCode: 422, name: 'validation_error', message: 'guest@example.com is not valid' },
        headers: null,
      }),
    )
    const port = createResendEmailPort({ env: envWith({ RESEND_API_KEY_CTS: KEY }), createClient })
    const outcome = await port.send(request())
    expect(outcome).toEqual({ kind: 'rejected', code: 'validation_error', status: 422 })
    expect(JSON.stringify(outcome)).not.toContain('@')
  })

  it.each([
    ['401 our key is wrong', { statusCode: 401, name: 'missing_api_key' }],
    ['403 our key or sending domain is not allowed', { statusCode: 403, name: 'invalid_from_address' }],
    ['404', { statusCode: 404, name: 'not_found' }],
    ['409 concurrent request with the same key', { statusCode: 409, name: 'concurrent_idempotent_requests' }],
    ['409 same key, different payload', { statusCode: 409, name: 'invalid_idempotent_request' }],
    ['429 rate limit', { statusCode: 429, name: 'rate_limit_exceeded' }],
    ['500', { statusCode: 500, name: 'internal_server_error' }],
    ['network failure (the SDK reports no status)', { statusCode: null, name: 'application_error' }],
  ])('reads %s as an unknown outcome, never as a refusal', async (_label, error) => {
    const { createClient } = clientReturning(() => Promise.resolve({ data: null, error, headers: null }))
    const port = createResendEmailPort({ env: envWith({ RESEND_API_KEY_CTS: KEY }), createClient })
    expect((await port.send(request())).kind).toBe('unknown')
  })

  it('a replay refused as a bad request is unknown, not rejected', async () => {
    const { createClient } = clientReturning(() =>
      Promise.resolve({ data: null, error: { statusCode: 422, name: 'validation_error', message: 'x' }, headers: null }),
    )
    const port = createResendEmailPort({ env: envWith({ RESEND_API_KEY_CTS: KEY }), createClient })
    expect(await port.send(request({ attempt: 'replay' }))).toEqual({ kind: 'unknown', code: 'validation_error', status: 422 })
  })

  it('reads a 2xx without a message id as unknown', async () => {
    const { createClient } = clientReturning(() => Promise.resolve({ data: {}, error: null, headers: null }))
    const port = createResendEmailPort({ env: envWith({ RESEND_API_KEY_CTS: KEY }), createClient })
    expect(await port.send(request())).toEqual({ kind: 'unknown', code: 'no_message_id', status: null })
  })

  it('reads a malformed response as unknown', async () => {
    const { createClient } = clientReturning(() => Promise.resolve('not an object'))
    const port = createResendEmailPort({ env: envWith({ RESEND_API_KEY_CTS: KEY }), createClient })
    expect(await port.send(request())).toEqual({ kind: 'unknown', code: 'malformed_response', status: null })
  })

  it('reads a thrown error (async or sync) as unknown', async () => {
    const asyncThrow = clientReturning(() => Promise.reject(new Error('socket hang up')))
    const port1 = createResendEmailPort({ env: envWith({ RESEND_API_KEY_CTS: KEY }), createClient: asyncThrow.createClient })
    expect(await port1.send(request())).toEqual({ kind: 'unknown', code: 'exception', status: null })

    const syncClient: ResendClientLike = {
      emails: {
        send: () => {
          throw new Error('boom')
        },
      },
    }
    const port2 = createResendEmailPort({ env: envWith({ RESEND_API_KEY_CTS: KEY }), createClient: () => syncClient })
    expect(await port2.send(request())).toEqual({ kind: 'unknown', code: 'exception', status: null })
  })

  it('stops waiting after the time budget and reports unknown (real timers)', async () => {
    let settleLate: ((value: unknown) => void) | undefined
    const { createClient } = clientReturning(
      () =>
        new Promise((resolve) => {
          settleLate = resolve
        }),
    )
    const port = createResendEmailPort({ env: envWith({ RESEND_API_KEY_CTS: KEY }), createClient, timeoutMs: 30 })
    const started = Date.now()
    expect(await port.send(request())).toEqual({ kind: 'unknown', code: 'timeout', status: null })
    expect(Date.now() - started).toBeGreaterThanOrEqual(25)
    // The request may still finish after we stopped waiting: that must not surface anywhere.
    settleLate?.({ data: { id: 'msg_late' }, error: null, headers: null })
    await new Promise((r) => setTimeout(r, 10))
  })

  it('a request that fails late, after the budget, raises no unhandled rejection', async () => {
    const { createClient } = clientReturning(
      () => new Promise((_resolve, reject) => setTimeout(() => reject(new Error('late')), 40)),
    )
    const port = createResendEmailPort({ env: envWith({ RESEND_API_KEY_CTS: KEY }), createClient, timeoutMs: 10 })
    expect((await port.send(request())).kind).toBe('unknown')
    await new Promise((r) => setTimeout(r, 60))
  })

  it('a client that cannot be created means nothing was sent', async () => {
    const port = createResendEmailPort({
      env: envWith({ RESEND_API_KEY_CTS: KEY }),
      createClient: () => {
        throw new Error('no')
      },
    })
    expect(await port.send(request())).toMatchObject({ kind: 'not_attempted', code: 'client_init_failed' })
  })

  it('waits 15 seconds by default', () => {
    expect(RESEND_SEND_TIMEOUT_MS).toBe(15_000)
  })
})

describe('classifyResendError', () => {
  it.each([400, 422])('%i on a first attempt is a refusal (the request was bad, nothing was sent)', (statusCode) => {
    expect(classifyResendError({ statusCode, name: 'validation_error' }, 'first').kind).toBe('rejected')
  })

  it.each([400, 422, 401, 403])('%i on a replay is unknown: it cannot prove the first attempt did not go out', (statusCode) => {
    expect(classifyResendError({ statusCode, name: 'validation_error' }, 'replay').kind).toBe('unknown')
  })

  it.each([401, 403, 404])('%i is our own key or account problem, never the guest refusing: unknown, status passed on', (statusCode) => {
    expect(classifyResendError({ statusCode, name: 'invalid_api_key' }, 'first')).toEqual({ kind: 'unknown', code: 'invalid_api_key', status: statusCode })
  })

  it.each([
    ['409', { statusCode: 409, name: 'invalid_idempotent_request' }],
    ['429', { statusCode: 429, name: 'daily_quota_exceeded' }],
    ['502', { statusCode: 502, name: 'application_error' }],
    ['no status', { name: 'application_error' }],
    ['status as text', { statusCode: '400', name: 'validation_error' }],
    ['not an object', 'boom'],
    ['null', null],
  ])('%s is unknown', (_label, error) => {
    expect(classifyResendError(error, 'first').kind).toBe('unknown')
  })

  it('keeps only a well-formed provider code', () => {
    expect(classifyResendError({ statusCode: 400, name: 'Bad <name>' }, 'first')).toEqual({ kind: 'rejected', code: 'unknown_error', status: 400 })
  })
})

const BAD_REQUESTS: Array<[string, Partial<ResendEmailRequest>]> = [
  ['a sender without an address', { from: 'Baker Gu' }],
  ['a display name with a comma', { from: 'Gu, Baker <baker@news.example.co.nz>' }],
  ['a sender with a line break', { from: 'Baker\r\nBcc: x@y.com <baker@news.example.co.nz>' }],
  ['two recipients', { to: 'guest@example.com, other@example.com' }],
  ['a recipient with a line break', { to: 'guest@example.com\r\nBcc: x@y.com' }],
  ['a reply-to that is not an address', { replyTo: 'info' }],
  ['an empty subject', { subject: '  ' }],
  ['a multi-line subject', { subject: 'Hi\nBcc: x@y.com' }],
  ['an empty text', { text: ' ' }],
  ['an empty html', { html: ' ' }],
  ['a header injection', { headers: { 'X-Note': 'a\r\nBcc: x@y.com' } }],
  ['a reserved header', { headers: { Bcc: 'x@y.com' } }],
  ['a malformed header name', { headers: { 'X Note': 'a' } }],
  ['too many headers', { headers: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`X-H${i}`, 'v'])) }],
  ['a tag with a space', { tags: [{ name: 'triggered_send_id', value: 'a b' }] }],
  ['an empty idempotency key', { idempotencyKey: '' }],
  ['an idempotency key with a space', { idempotencyKey: 'ts: 1' }],
]

describe('checks before anything is sent', () => {
  it.each(BAD_REQUESTS)('refuses %s without calling the provider', async (_label, over) => {
    expect(resendRequestProblem(request(over))).not.toBeNull()
    const { createClient, send } = clientReturning(sentOk)
    const port = createResendEmailPort({ env: envWith({ RESEND_API_KEY_CTS: KEY }), createClient })
    const outcome = await port.send(request(over))
    expect(outcome).toMatchObject({ kind: 'not_attempted', code: 'invalid_request' })
    expect(createClient).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(JSON.stringify(outcome)).not.toContain('guest@example.com')
  })

  it('accepts a bare sender address and the normal request', () => {
    expect(resendRequestProblem(request())).toBeNull()
    expect(resendRequestProblem(request({ from: 'baker@news.example.co.nz' }))).toBeNull()
  })
})

describe('the real default wiring (real SDK, fake network)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  function captureFetch() {
    const calls: Array<{ url: string; authorization: string | null }> = []
    const fetchFake = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), authorization: new Headers(init?.headers).get('Authorization') })
      return new Response(JSON.stringify({ id: 'msg_real_wiring' }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchFake)
    return { calls, fetchFake }
  }

  it('sends with the account key to the pinned provider address, whatever RESEND_BASE_URL says', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_system_key_aaaaaaaa')
    vi.stubEnv('RESEND_API_KEY_CTS', 're_cts_key_bbbbbbbbbb')
    vi.stubEnv('RESEND_BASE_URL', 'https://elsewhere.example')
    const { calls } = captureFetch()
    expect(await createResendEmailPort().send(request())).toEqual({ kind: 'sent', messageId: 'msg_real_wiring' })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${RESEND_API_BASE_URL}/emails`)
    expect(calls[0].authorization).toBe('Bearer re_cts_key_bbbbbbbbbb')
  })

  it('with the account key missing, nothing at all is sent (the SDK would have used the system key)', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_system_key_aaaaaaaa')
    vi.stubEnv('RESEND_API_KEY_CTS', '')
    const { fetchFake } = captureFetch()
    expect(await createResendEmailPort().send(request())).toMatchObject({ kind: 'not_attempted', code: 'no_account_key' })
    expect(fetchFake).not.toHaveBeenCalled()
  })
})
