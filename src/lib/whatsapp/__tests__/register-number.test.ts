import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mocks ───────────────────────────────────────────────────────────────────

const upsertConnectionMock = vi.fn()

vi.mock('@/lib/platform-oauth/connection-store', () => ({
  upsertConnection: (...args: unknown[]) => upsertConnectionMock(...args),
}))

vi.mock('@/lib/platform-oauth/vocabulary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/platform-oauth/vocabulary')>()
  return {
    ...actual,
    encryptToken: (value: string) => `enc:${value}`,
  }
})

// ─── Supabase mock: records table, upsert payload, and .eq filters ────────────

type ClientRow = { whatsapp_phone_number_id: string | null }

interface SupabaseCall {
  table: string
  upsertPayload?: Record<string, unknown>
  upsertOptions?: Record<string, unknown>
  eqFilters: Array<[string, unknown]>
}

let calls: SupabaseCall[] = []
let clientRow: ClientRow | null = null
let clientQueryError: { message: string } | null = null
let secretWriteError: { message: string } | null = null

function makeQueryBuilder(table: string) {
  const call: SupabaseCall = { table, eqFilters: [] }
  calls.push(call)

  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      call.eqFilters.push([column, value])
      return builder
    },
    maybeSingle: async () => {
      if (clientQueryError) return { data: null, error: clientQueryError }
      return { data: clientRow, error: null }
    },
    upsert: async (payload: Record<string, unknown>, options?: Record<string, unknown>) => {
      call.upsertPayload = payload
      call.upsertOptions = options
      return { error: secretWriteError }
    },
  }
  return builder
}

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => makeQueryBuilder(table),
  },
}))

// Import AFTER mocks are registered.
import { registerWhatsAppNumber } from '../register-number'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PHONE = '1234567890'
const TOKEN = 'super-secret-token'
const SECRET = 'super-secret-app-secret'

function findCall(table: string): SupabaseCall | undefined {
  return calls.find(c => c.table === table)
}

beforeEach(() => {
  calls = []
  clientRow = { whatsapp_phone_number_id: PHONE }
  clientQueryError = null
  secretWriteError = null
  upsertConnectionMock.mockReset()
  upsertConnectionMock.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('registerWhatsAppNumber', () => {
  it('happy path with secret: stores token and app secret', async () => {
    const result = await registerWhatsAppNumber({
      clientId: 'client-1',
      phoneNumberId: PHONE,
      accessToken: TOKEN,
      appSecret: SECRET,
    })

    expect(result).toEqual({ ok: true, wroteAppSecret: true })

    expect(upsertConnectionMock).toHaveBeenCalledTimes(1)
    const arg = upsertConnectionMock.mock.calls[0][0] as Record<string, unknown>
    expect(arg.provider).toBe('whatsapp')
    expect(arg.accountId).toBe(PHONE)
    expect((arg.tokenExpiry as Date).getTime()).toBeGreaterThan(Date.now())

    const secretCall = findCall('whatsapp_app_credentials')
    expect(secretCall).toBeDefined()
    expect(secretCall?.upsertPayload?.app_secret_enc).toBe(`enc:${SECRET}`)
    expect(secretCall?.upsertOptions).toEqual({ onConflict: 'phone_number_id' })
  })

  it('happy path without secret: secret table never touched', async () => {
    const result = await registerWhatsAppNumber({
      clientId: 'client-1',
      phoneNumberId: PHONE,
      accessToken: TOKEN,
    })

    expect(result).toEqual({ ok: true, wroteAppSecret: false })
    expect(upsertConnectionMock).toHaveBeenCalledTimes(1)
    expect(findCall('whatsapp_app_credentials')).toBeUndefined()
  })

  it('client bound to a different number: fails, nothing written', async () => {
    clientRow = { whatsapp_phone_number_id: '9999999999' }

    const result = await registerWhatsAppNumber({
      clientId: 'client-1',
      phoneNumberId: PHONE,
      accessToken: TOKEN,
      appSecret: SECRET,
    })

    expect(result.ok).toBe(false)
    expect(upsertConnectionMock).not.toHaveBeenCalled()
    expect(findCall('whatsapp_app_credentials')).toBeUndefined()
  })

  it('client row missing: fails', async () => {
    clientRow = null

    const result = await registerWhatsAppNumber({
      clientId: 'client-1',
      phoneNumberId: PHONE,
      accessToken: TOKEN,
    })

    expect(result.ok).toBe(false)
    expect(upsertConnectionMock).not.toHaveBeenCalled()
  })

  it('ownership query error: fails', async () => {
    clientQueryError = { message: 'boom' }

    const result = await registerWhatsAppNumber({
      clientId: 'client-1',
      phoneNumberId: PHONE,
      accessToken: TOKEN,
    })

    expect(result.ok).toBe(false)
    expect(upsertConnectionMock).not.toHaveBeenCalled()
  })

  it.each(['abc', '', '1'.repeat(33)])('invalid number %j: fails', async (bad) => {
    const result = await registerWhatsAppNumber({
      clientId: 'client-1',
      phoneNumberId: bad,
      accessToken: TOKEN,
    })

    expect(result).toEqual({ ok: false, error: 'invalid input' })
    expect(upsertConnectionMock).not.toHaveBeenCalled()
  })

  it('empty token: fails', async () => {
    const result = await registerWhatsAppNumber({
      clientId: 'client-1',
      phoneNumberId: PHONE,
      accessToken: '',
    })

    expect(result).toEqual({ ok: false, error: 'invalid input' })
    expect(upsertConnectionMock).not.toHaveBeenCalled()
  })

  it('upsertConnection throws: fails and secret table not written', async () => {
    upsertConnectionMock.mockRejectedValueOnce(new Error('db down'))

    const result = await registerWhatsAppNumber({
      clientId: 'client-1',
      phoneNumberId: PHONE,
      accessToken: TOKEN,
      appSecret: SECRET,
    })

    expect(result).toEqual({ ok: false, error: 'failed to store token' })
    expect(findCall('whatsapp_app_credentials')).toBeUndefined()
  })

  it('secret write error: fails', async () => {
    secretWriteError = { message: 'nope' }

    const result = await registerWhatsAppNumber({
      clientId: 'client-1',
      phoneNumberId: PHONE,
      accessToken: TOKEN,
      appSecret: SECRET,
    })

    expect(result).toEqual({ ok: false, error: 'token stored but failed to store app secret; rerun to retry (writes are idempotent)' })
  })

  it('never leaks the token or secret in the result or console output', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const okResult = await registerWhatsAppNumber({
      clientId: 'client-1',
      phoneNumberId: PHONE,
      accessToken: TOKEN,
      appSecret: SECRET,
    })
    expect(JSON.stringify(okResult)).not.toContain(TOKEN)
    expect(JSON.stringify(okResult)).not.toContain(SECRET)

    upsertConnectionMock.mockRejectedValueOnce(new Error('db down'))
    const failResult = await registerWhatsAppNumber({
      clientId: 'client-1',
      phoneNumberId: PHONE,
      accessToken: TOKEN,
      appSecret: SECRET,
    })
    expect(JSON.stringify(failResult)).not.toContain(TOKEN)
    expect(JSON.stringify(failResult)).not.toContain(SECRET)

    const allOutput = [...logSpy.mock.calls, ...errSpy.mock.calls, ...warnSpy.mock.calls]
      .flat()
      .map(String)
      .join(' ')
    expect(allOutput).not.toContain(TOKEN)
    expect(allOutput).not.toContain(SECRET)
  })
})
