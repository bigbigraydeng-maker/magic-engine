import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

vi.mock('@/lib/platform-oauth/vocabulary', () => ({
  decryptToken: vi.fn((v: string) => {
    if (v === 'enc:BAD') throw new Error('decrypt failed')
    return v.replace(/^enc:/, '')
  }),
}))

import { supabaseAdmin } from '@/lib/supabase'
import {
  extractWebhookPhoneNumberIds,
  chooseWebhookSecret,
  MAX_WEBHOOK_PHONE_NUMBER_IDS,
} from '../app-secret'

type Row = { phone_number_id: string; app_secret_enc: string; status?: string }

type QueryRecord = {
  table: string
  inArgs: [string, string[]] | null
  eqArgs: [string, string] | null
}

const queryRecords: QueryRecord[] = []

function makeFromMock(
  result: { data: Row[] | null; error: unknown } | (() => never),
) {
  return (table: string) => {
    const record: QueryRecord = { table, inArgs: null, eqArgs: null }
    queryRecords.push(record)
    const chain = {
      select: () => chain,
      in: (column: string, values: string[]) => {
        record.inArgs = [column, values]
        if (typeof result === 'function') {
          return Promise.resolve(result())
        }
        return Promise.resolve(result)
      },
    }
    return chain
  }
}

function bodyWithIds(ids: string[]): string {
  return JSON.stringify({
    entry: [
      {
        changes: ids.map((id) => ({
          value: { metadata: { phone_number_id: id } },
        })),
      },
    ],
  })
}

function bodyWithRawMetadata(metadata: unknown): string {
  return JSON.stringify({
    entry: [{ changes: [{ value: { metadata } }] }],
  })
}

beforeEach(() => {
  queryRecords.length = 0
  vi.clearAllMocks()
})

describe('extractWebhookPhoneNumberIds', () => {
  it('extracts a normal single id', () => {
    expect(extractWebhookPhoneNumberIds(bodyWithIds(['12345']))).toEqual({
      ok: true,
      ids: ['12345'],
    })
  })

  it('dedupes the same id twice', () => {
    expect(extractWebhookPhoneNumberIds(bodyWithIds(['12345', '12345']))).toEqual({
      ok: true,
      ids: ['12345'],
    })
  })

  it('collects two different ids', () => {
    expect(extractWebhookPhoneNumberIds(bodyWithIds(['111', '222']))).toEqual({
      ok: true,
      ids: ['111', '222'],
    })
  })

  it('returns [] when metadata is missing', () => {
    const body = JSON.stringify({
      entry: [{ changes: [{ value: {} }] }],
    })
    expect(extractWebhookPhoneNumberIds(body)).toEqual({ ok: true, ids: [] })
  })

  it('returns [] on invalid JSON', () => {
    expect(extractWebhookPhoneNumberIds('not json')).toEqual({
      ok: true,
      ids: [],
    })
  })

  it('returns [] when root is a JSON array', () => {
    expect(extractWebhookPhoneNumberIds('[1,2,3]')).toEqual({
      ok: true,
      ids: [],
    })
  })

  it('returns [] when entry is not an array', () => {
    const body = JSON.stringify({ entry: 'nope' })
    expect(extractWebhookPhoneNumberIds(body)).toEqual({ ok: true, ids: [] })
  })

  it('rejects a numeric phone_number_id', () => {
    expect(extractWebhookPhoneNumberIds(bodyWithRawMetadata({ phone_number_id: 123 }))).toEqual({
      ok: false,
      reason: 'malformed_number',
    })
  })

  it('rejects null phone_number_id', () => {
    expect(extractWebhookPhoneNumberIds(bodyWithRawMetadata({ phone_number_id: null }))).toEqual({
      ok: false,
      reason: 'malformed_number',
    })
  })

  it('rejects empty string phone_number_id', () => {
    expect(extractWebhookPhoneNumberIds(bodyWithRawMetadata({ phone_number_id: '' }))).toEqual({
      ok: false,
      reason: 'malformed_number',
    })
  })

  it('rejects letters', () => {
    expect(extractWebhookPhoneNumberIds(bodyWithRawMetadata({ phone_number_id: 'abc' }))).toEqual({
      ok: false,
      reason: 'malformed_number',
    })
  })

  it('rejects leading whitespace', () => {
    expect(extractWebhookPhoneNumberIds(bodyWithRawMetadata({ phone_number_id: ' 123' }))).toEqual({
      ok: false,
      reason: 'malformed_number',
    })
  })

  it('rejects 33 digits', () => {
    const tooLong = '1'.repeat(33)
    expect(extractWebhookPhoneNumberIds(bodyWithRawMetadata({ phone_number_id: tooLong }))).toEqual({
      ok: false,
      reason: 'malformed_number',
    })
  })

  it('rejects 21 distinct valid ids', () => {
    const ids = Array.from({ length: 21 }, (_, i) => String(i + 1))
    expect(extractWebhookPhoneNumberIds(bodyWithIds(ids))).toEqual({
      ok: false,
      reason: 'too_many_numbers',
    })
  })

  it('accepts exactly 20 distinct ids', () => {
    const ids = Array.from({ length: MAX_WEBHOOK_PHONE_NUMBER_IDS }, (_, i) =>
      String(i + 1),
    )
    expect(extractWebhookPhoneNumberIds(bodyWithIds(ids))).toEqual({
      ok: true,
      ids,
    })
  })
})

describe('chooseWebhookSecret', () => {
  it('returns env for empty ids without querying', async () => {
    const fromMock = vi.fn()
    vi.mocked(supabaseAdmin.from).mockImplementation(fromMock as never)
    const result = await chooseWebhookSecret([])
    expect(result).toEqual({ kind: 'env' })
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('returns env when no rows match', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation(
      makeFromMock({ data: [], error: null }) as never,
    )
    const result = await chooseWebhookSecret(['111'])
    expect(result).toEqual({ kind: 'env' })
  })

  it('returns route with the decrypted secret for one id', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation(
      makeFromMock({
        data: [{ phone_number_id: '111', app_secret_enc: 'enc:SECRET' }],
        error: null,
      }) as never,
    )
    const result = await chooseWebhookSecret(['111'])
    expect(result).toEqual({ kind: 'route', secret: 'SECRET' })
  })

  it('returns route when two ids share the same secret', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation(
      makeFromMock({
        data: [
          { phone_number_id: '111', app_secret_enc: 'enc:SECRET' },
          { phone_number_id: '222', app_secret_enc: 'enc:SECRET' },
        ],
        error: null,
      }) as never,
    )
    const result = await chooseWebhookSecret(['111', '222'])
    expect(result).toEqual({ kind: 'route', secret: 'SECRET' })
  })

  it('rejects mixed_apps when two ids have different secrets', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation(
      makeFromMock({
        data: [
          { phone_number_id: '111', app_secret_enc: 'enc:AAA' },
          { phone_number_id: '222', app_secret_enc: 'enc:BBB' },
        ],
        error: null,
      }) as never,
    )
    const result = await chooseWebhookSecret(['111', '222'])
    expect(result).toEqual({ kind: 'reject', reason: 'mixed_apps' })
  })

  it('rejects mixed_apps when only one of two ids has a row', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation(
      makeFromMock({
        data: [{ phone_number_id: '111', app_secret_enc: 'enc:SECRET' }],
        error: null,
      }) as never,
    )
    const result = await chooseWebhookSecret(['111', '222'])
    expect(result).toEqual({ kind: 'reject', reason: 'mixed_apps' })
  })

  it('ignores rows with empty app_secret_enc', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation(
      makeFromMock({
        data: [{ phone_number_id: '111', app_secret_enc: '' }],
        error: null,
      }) as never,
    )
    const result = await chooseWebhookSecret(['111'])
    expect(result).toEqual({ kind: 'env' })
  })

  it('rejects decrypt_failed when decrypt throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(supabaseAdmin.from).mockImplementation(
      makeFromMock({
        data: [{ phone_number_id: '111', app_secret_enc: 'enc:BAD' }],
        error: null,
      }) as never,
    )
    const result = await chooseWebhookSecret(['111'])
    expect(result).toEqual({ kind: 'reject', reason: 'decrypt_failed' })
    const logged = errorSpy.mock.calls.flat().join(' ')
    expect(logged).not.toContain('enc:BAD')
    expect(logged).not.toContain('BAD')
    errorSpy.mockRestore()
  })

  it('returns lookup_failed when the query returns an error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(supabaseAdmin.from).mockImplementation(
      makeFromMock({ data: null, error: { message: 'boom' } }) as never,
    )
    const result = await chooseWebhookSecret(['111'])
    expect(result).toEqual({ kind: 'lookup_failed', tableMissing: false })
    const logged = errorSpy.mock.calls.flat().join(' ')
    expect(logged).not.toContain('boom')
    errorSpy.mockRestore()
  })

  it('returns lookup_failed when the query throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(supabaseAdmin.from).mockImplementation(
      makeFromMock(() => {
        throw new Error('network down')
      }) as never,
    )
    const result = await chooseWebhookSecret(['111'])
    expect(result).toEqual({ kind: 'lookup_failed', tableMissing: false })
    const logged = errorSpy.mock.calls.flat().join(' ')
    expect(logged).not.toContain('network down')
    errorSpy.mockRestore()
  })

  it('queries the right table and filters', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation(
      makeFromMock({ data: [], error: null }) as never,
    )
    await chooseWebhookSecret(['111', '222'])
    expect(queryRecords).toHaveLength(1)
    expect(queryRecords[0].table).toBe('whatsapp_app_credentials')
    expect(queryRecords[0].inArgs).toEqual(['phone_number_id', ['111', '222']])
  })
})

describe('chooseWebhookSecret — table missing, disabled rows, empty secrets', () => {
  it.each(['42P01', 'PGRST205'])('error code %s → lookup_failed with tableMissing true', async (code) => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(supabaseAdmin.from).mockImplementation(
      makeFromMock({ data: null, error: { code, message: 'relation does not exist' } }) as never,
    )
    expect(await chooseWebhookSecret(['111'])).toEqual({ kind: 'lookup_failed', tableMissing: true })
    errorSpy.mockRestore()
  })

  it('a disabled row is refused, not handed to the env secret', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation(
      makeFromMock({
        data: [{ phone_number_id: '111', app_secret_enc: 'enc:S1', status: 'disabled' }],
        error: null,
      }) as never,
    )
    expect(await chooseWebhookSecret(['111'])).toEqual({ kind: 'reject', reason: 'disabled_number' })
  })

  it('a disabled row among otherwise active ones is still refused', async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation(
      makeFromMock({
        data: [
          { phone_number_id: '111', app_secret_enc: 'enc:S1', status: 'active' },
          { phone_number_id: '222', app_secret_enc: 'enc:S1', status: 'disabled' },
        ],
        error: null,
      }) as never,
    )
    expect(await chooseWebhookSecret(['111', '222'])).toEqual({ kind: 'reject', reason: 'disabled_number' })
  })

  it('a secret that decrypts to an empty string is rejected (an empty HMAC key is forgeable)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(supabaseAdmin.from).mockImplementation(
      makeFromMock({ data: [{ phone_number_id: '111', app_secret_enc: 'enc:' }], error: null }) as never,
    )
    expect(await chooseWebhookSecret(['111'])).toEqual({ kind: 'reject', reason: 'decrypt_failed' })
    errorSpy.mockRestore()
  })
})
