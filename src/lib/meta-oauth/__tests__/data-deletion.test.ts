import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { rpc: mocks.rpc, from: mocks.from },
}))

import {
  appUserHash,
  deletionStatus,
  newConfirmationCode,
  parseSignedRequest,
  processDeletion,
  recordDeletionFailure,
} from '@/lib/meta-oauth/data-deletion'

const SECRET = 'test-secret'

function base64Url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

function sign(payload: object, secret: string): string {
  const encodedPayload = base64Url(JSON.stringify(payload))
  const signature = createHmac('sha256', secret).update(encodedPayload).digest()
  return `${base64Url(signature)}.${encodedPayload}`
}

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    algorithm: 'HMAC-SHA256',
    user_id: '1234567890',
    issued_at: 1_700_000_000,
    ...overrides,
  }
}

const NOW = 1_700_000_100

beforeEach(() => {
  vi.clearAllMocks()
})

describe('parseSignedRequest', () => {
  it('accepts a valid request', () => {
    const result = parseSignedRequest(sign(validPayload(), SECRET), SECRET, NOW)
    expect(result).toEqual({ userId: '1234567890', issuedAt: new Date(1_700_000_000 * 1000) })
  })

  it('rejects a wrong secret', () => {
    expect(parseSignedRequest(sign(validPayload(), SECRET), 'other-secret', NOW)).toBeNull()
  })

  it('rejects a tampered payload', () => {
    const signed = sign(validPayload(), SECRET)
    const encodedPayload = base64Url(JSON.stringify(validPayload({ user_id: '9999999999' })))
    const tampered = `${signed.split('.')[0]}.${encodedPayload}`
    expect(parseSignedRequest(tampered, SECRET, NOW)).toBeNull()
  })

  it('rejects algorithm HS256', () => {
    expect(parseSignedRequest(sign(validPayload({ algorithm: 'HS256' }), SECRET), SECRET, NOW)).toBeNull()
  })

  it('accepts lowercase algorithm', () => {
    const result = parseSignedRequest(sign(validPayload({ algorithm: 'hmac-sha256' }), SECRET), SECRET, NOW)
    expect(result?.userId).toBe('1234567890')
  })

  it('rejects a missing user_id', () => {
    const payload = validPayload()
    delete payload.user_id
    expect(parseSignedRequest(sign(payload, SECRET), SECRET, NOW)).toBeNull()
  })

  it('rejects a non-digit user_id', () => {
    expect(parseSignedRequest(sign(validPayload({ user_id: 'abc' }), SECRET), SECRET, NOW)).toBeNull()
  })

  it('rejects issued_at as a string', () => {
    expect(parseSignedRequest(sign(validPayload({ issued_at: '1700000000' }), SECRET), SECRET, NOW)).toBeNull()
  })

  it('rejects issued_at 10 minutes in the future', () => {
    expect(parseSignedRequest(sign(validPayload({ issued_at: NOW + 600 }), SECRET), SECRET, NOW)).toBeNull()
  })

  it('accepts issued_at 2 minutes in the future', () => {
    const result = parseSignedRequest(sign(validPayload({ issued_at: NOW + 120 }), SECRET), SECRET, NOW)
    expect(result?.issuedAt).toEqual(new Date((NOW + 120) * 1000))
  })

  it('rejects a request older than one day', () => {
    expect(parseSignedRequest(sign(validPayload({ issued_at: NOW - 86_401 }), SECRET), SECRET, NOW)).toBeNull()
  })

  it('accepts a request exactly 23 hours old', () => {
    const result = parseSignedRequest(sign(validPayload({ issued_at: NOW - 82_800 }), SECRET), SECRET, NOW)
    expect(result?.issuedAt).toEqual(new Date((NOW - 82_800) * 1000))
  })

  it('rejects a login signed_request carrying code', () => {
    expect(parseSignedRequest(sign(validPayload({ code: 'abc' }), SECRET), SECRET, NOW)).toBeNull()
  })

  it('rejects a signed_request carrying oauth_token', () => {
    expect(parseSignedRequest(sign(validPayload({ oauth_token: 'abc' }), SECRET), SECRET, NOW)).toBeNull()
  })

  it('rejects an expires in the past', () => {
    expect(parseSignedRequest(sign(validPayload({ expires: NOW - 1 }), SECRET), SECRET, NOW)).toBeNull()
  })

  it('accepts an expires in the future', () => {
    const result = parseSignedRequest(sign(validPayload({ expires: NOW + 3600 }), SECRET), SECRET, NOW)
    expect(result?.userId).toBe('1234567890')
  })

  it('rejects expires as a string', () => {
    expect(parseSignedRequest(sign(validPayload({ expires: String(NOW + 3600) }), SECRET), SECRET, NOW)).toBeNull()
  })

  it('rejects malformed inputs', () => {
    expect(parseSignedRequest('nodot', SECRET, NOW)).toBeNull()
    expect(parseSignedRequest('a.b.c', SECRET, NOW)).toBeNull()
    expect(parseSignedRequest('!!!.!!!', SECRET, NOW)).toBeNull()
    expect(parseSignedRequest(`${base64Url('sig')}.${base64Url('not json')}`, SECRET, NOW)).toBeNull()
    expect(parseSignedRequest(sign(validPayload(), SECRET), '', NOW)).toBeNull()
  })
})

describe('appUserHash', () => {
  it('is a stable 64-char hex digest that differs per id and per secret', () => {
    const hash = appUserHash('1234567890', SECRET)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(appUserHash('1234567890', SECRET)).toBe(hash)
    expect(appUserHash('9999999999', SECRET)).not.toBe(hash)
    expect(appUserHash('1234567890', 'other-secret')).not.toBe(hash)
  })
})

describe('newConfirmationCode', () => {
  it('is 32 base64url chars and unique', () => {
    const code = newConfirmationCode()
    expect(code).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(newConfirmationCode()).not.toBe(code)
  })
})

describe('processDeletion', () => {
  const request = { userId: '1234567890', issuedAt: new Date(1_700_000_000 * 1000) }

  it('calls the rpc and returns the first row', () => {
    mocks.rpc.mockResolvedValue({
      data: [{ confirmation_code: 'CODE', status: 'completed' }],
      error: null,
    })
    return processDeletion(request, SECRET).then((result) => {
      expect(result).toEqual({ confirmationCode: 'CODE', status: 'completed' })
      expect(mocks.rpc).toHaveBeenCalledTimes(1)
      const [name, args] = mocks.rpc.mock.calls[0]
      expect(name).toBe('meta_process_data_deletion')
      expect(args.p_app_user_id).toBe('1234567890')
      expect(args.p_app_user_hash).toBe(appUserHash('1234567890', SECRET))
      expect(args.p_issued_at).toBe(request.issuedAt.toISOString())
      expect(args.p_confirmation).toMatch(/^[A-Za-z0-9_-]{32}$/)
    })
  })

  it('throws on rpc error', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(processDeletion(request, SECRET)).rejects.toThrow('data_deletion_failed')
  })

  it('throws on an unknown status', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ confirmation_code: 'CODE', status: 'weird' }],
      error: null,
    })
    await expect(processDeletion(request, SECRET)).rejects.toThrow('data_deletion_failed')
  })
})

describe('recordDeletionFailure', () => {
  const request = { userId: '1234567890', issuedAt: new Date(1_700_000_000 * 1000) }

  it('inserts a failed row with the hashed id and a confirmation code', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    mocks.from.mockReturnValue({ insert })

    await recordDeletionFailure(request, SECRET)

    expect(mocks.from).toHaveBeenCalledWith('meta_data_deletion_requests')
    const [row] = insert.mock.calls[0]
    expect(row.status).toBe('failed')
    expect(row.app_user_hash).toBe(appUserHash('1234567890', SECRET))
    expect(row.issued_at).toBe(request.issuedAt.toISOString())
    expect(row.confirmation_code).toMatch(/^[A-Za-z0-9_-]{32}$/)
  })

  it('never throws when the insert rejects', async () => {
    const insert = vi.fn().mockRejectedValue(new Error('boom'))
    mocks.from.mockReturnValue({ insert })
    await expect(recordDeletionFailure(request, SECRET)).resolves.toBeUndefined()
  })
})

describe('deletionStatus', () => {
  it('returns null for an invalid code without querying', async () => {
    expect(await deletionStatus('abc')).toBeNull()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('returns the row for a valid code and only looks at settled statuses', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { status: 'no_data', received_at: '2026-09-27T00:00:00.000Z' },
      error: null,
    })
    const inFn = vi.fn().mockReturnValue({ maybeSingle })
    const eq = vi.fn().mockReturnValue({ in: inFn })
    const select = vi.fn().mockReturnValue({ eq })
    mocks.from.mockReturnValue({ select })

    const result = await deletionStatus('A'.repeat(32))
    expect(result).toEqual({ status: 'no_data', receivedAt: '2026-09-27T00:00:00.000Z' })
    expect(mocks.from).toHaveBeenCalledWith('meta_data_deletion_requests')
    expect(inFn).toHaveBeenCalledWith('status', ['completed', 'no_data'])
  })
})
