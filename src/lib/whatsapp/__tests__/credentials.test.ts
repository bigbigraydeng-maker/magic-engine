import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const maybeSingleMock = vi.fn()
const eqMock = vi.fn()
const selectMock = vi.fn()
const fromMock = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => fromMock(table),
  },
}))

vi.mock('@/lib/platform-oauth/vocabulary', () => ({
  decryptToken: (value: string) => {
    if (value === 'enc:BAD') {
      throw new Error('decrypt failed')
    }
    if (value.startsWith('enc:')) {
      return value.slice('enc:'.length)
    }
    return value
  },
}))

import { resolveWhatsAppCredentials } from '../credentials'

const CLIENT_ID = 'client-1'
const NUMBER_ID = '15551234567'

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  delete process.env.WHATSAPP_ACCESS_TOKEN
  delete process.env.WHATSAPP_PHONE_NUMBER_ID

  maybeSingleMock.mockReset()
  eqMock.mockReset()
  selectMock.mockReset()
  fromMock.mockReset()

  eqMock.mockImplementation(() => ({
    eq: eqMock,
    maybeSingle: maybeSingleMock,
  }))
  selectMock.mockImplementation(() => ({
    eq: eqMock,
  }))
  fromMock.mockImplementation(() => ({
    select: selectMock,
  }))
})

afterEach(() => {
  process.env = originalEnv
  vi.restoreAllMocks()
})

describe('resolveWhatsAppCredentials', () => {
  it('uses the connection token when an active row exists', async () => {
    maybeSingleMock.mockResolvedValue({
      data: { status: 'active', access_token_enc: 'enc:conn-token' },
      error: null,
    })

    const result = await resolveWhatsAppCredentials(CLIENT_ID, NUMBER_ID)

    expect(result).toEqual({
      ok: true,
      credentials: {
        accessToken: 'conn-token',
        phoneNumberId: NUMBER_ID,
        source: 'connection',
      },
    })

    expect(fromMock).toHaveBeenCalledWith('platform_oauth_connections')
    expect(selectMock).toHaveBeenCalledWith('status, access_token_enc')
    expect(eqMock).toHaveBeenCalledWith('client_id', CLIENT_ID)
    expect(eqMock).toHaveBeenCalledWith('provider', 'whatsapp')
    expect(eqMock).toHaveBeenCalledWith('account_id', NUMBER_ID)
  })

  it('rejects a revoked row and never falls back to env', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'env-token'
    process.env.WHATSAPP_PHONE_NUMBER_ID = NUMBER_ID

    maybeSingleMock.mockResolvedValue({
      data: { status: 'revoked', access_token_enc: 'enc:conn-token' },
      error: null,
    })

    const result = await resolveWhatsAppCredentials(CLIENT_ID, NUMBER_ID)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe(
        '这个号码的 WhatsApp 授权已停用，不能发送，请重新连接',
      )
    }
    expect(JSON.stringify(result)).not.toContain('env-token')
    expect(JSON.stringify(result)).not.toContain('conn-token')
  })

  it('rejects when decryption fails and never falls back to env', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'env-token'
    process.env.WHATSAPP_PHONE_NUMBER_ID = NUMBER_ID

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    maybeSingleMock.mockResolvedValue({
      data: { status: 'active', access_token_enc: 'enc:BAD' },
      error: null,
    })

    const result = await resolveWhatsAppCredentials(CLIENT_ID, NUMBER_ID)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe(
        '这个号码的 WhatsApp 令牌读不出来，不能发送，请重新连接',
      )
    }
    expect(JSON.stringify(result)).not.toContain('env-token')

    const logged = errorSpy.mock.calls.map((call) => call.join(' ')).join(' ')
    expect(logged).not.toContain('env-token')
    expect(logged).not.toContain('enc:BAD')
    expect(logged).not.toContain('conn-token')
  })

  it('falls back to env when no row exists and env matches', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'env-token'
    process.env.WHATSAPP_PHONE_NUMBER_ID = NUMBER_ID

    maybeSingleMock.mockResolvedValue({ data: null, error: null })

    const result = await resolveWhatsAppCredentials(CLIENT_ID, NUMBER_ID)

    expect(result).toEqual({
      ok: true,
      credentials: {
        accessToken: 'env-token',
        phoneNumberId: NUMBER_ID,
        source: 'env',
      },
    })
  })

  it('rejects when no row exists and env number differs', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'env-token'
    process.env.WHATSAPP_PHONE_NUMBER_ID = '19998887777'

    maybeSingleMock.mockResolvedValue({ data: null, error: null })

    const result = await resolveWhatsAppCredentials(CLIENT_ID, NUMBER_ID)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe(
        '这个客户的 WhatsApp 号码跟当前配置的发送号码不一致，已阻止发送（避免用别的客户号码发给客人）',
      )
    }
  })

  it('rejects when no row exists and env is unset', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null })

    const result = await resolveWhatsAppCredentials(CLIENT_ID, NUMBER_ID)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('WhatsApp 授权未配置，无法发送')
    }
  })

  it('falls back to env when the query returns an error', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'env-token'
    process.env.WHATSAPP_PHONE_NUMBER_ID = NUMBER_ID

    maybeSingleMock.mockResolvedValue({
      data: null,
      error: { message: 'db down' },
    })

    const result = await resolveWhatsAppCredentials(CLIENT_ID, NUMBER_ID)

    expect(result).toEqual({
      ok: true,
      credentials: {
        accessToken: 'env-token',
        phoneNumberId: NUMBER_ID,
        source: 'env',
      },
    })
  })

  it('rejects when the query throws and env is missing', async () => {
    maybeSingleMock.mockRejectedValue(new Error('boom'))

    const result = await resolveWhatsAppCredentials(CLIENT_ID, NUMBER_ID)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('WhatsApp 授权未配置，无法发送')
    }
  })

  it('never logs the token on decrypt failure', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    maybeSingleMock.mockResolvedValue({
      data: { status: 'active', access_token_enc: 'enc:BAD' },
      error: null,
    })

    await resolveWhatsAppCredentials(CLIENT_ID, NUMBER_ID)

    const logged = errorSpy.mock.calls.map((call) => call.join(' ')).join(' ')
    expect(logged).toBe('[whatsapp/credentials] token decrypt failed')
  })
})
