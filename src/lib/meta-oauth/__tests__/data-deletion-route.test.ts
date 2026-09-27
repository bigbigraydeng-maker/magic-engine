import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  processDeletion: vi.fn(),
}))

vi.mock('@/lib/meta-oauth/data-deletion', async () => {
  const actual = await vi.importActual<typeof import('@/lib/meta-oauth/data-deletion')>(
    '@/lib/meta-oauth/data-deletion'
  )
  return { ...actual, processDeletion: mocks.processDeletion }
})

import { POST } from '@/app/api/meta/data-deletion/route'

const SECRET = 'test-secret'
const USER_ID = '1234567890'

function base64Url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

function signedRequest(userId: string, secret: string): string {
  const encodedPayload = base64Url(
    JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: userId, issued_at: Math.floor(Date.now() / 1000) })
  )
  const signature = createHmac('sha256', secret).update(encodedPayload).digest()
  return `${base64Url(signature)}.${encodedPayload}`
}

function buildRequest(signed: string | null): Request {
  const body = new URLSearchParams()
  if (signed !== null) body.set('signed_request', signed)
  return new Request('https://app.example.test/api/meta/data-deletion', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.FACEBOOK_APP_SECRET = SECRET
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test'
})

describe('POST /api/meta/data-deletion', () => {
  it('processes a valid request', async () => {
    mocks.processDeletion.mockResolvedValue({ confirmationCode: 'CODE', status: 'completed' })
    const response = await POST(buildRequest(signedRequest(USER_ID, SECRET)))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      url: 'https://app.example.test/data-deletion/status?code=CODE',
      confirmation_code: 'CODE',
    })
    expect(mocks.processDeletion).toHaveBeenCalledTimes(1)
    expect(mocks.processDeletion.mock.calls[0][0].userId).toBe(USER_ID)
  })

  it('rejects a bad signature', async () => {
    const response = await POST(buildRequest(signedRequest(USER_ID, 'wrong-secret')))
    expect(response.status).toBe(400)
    expect(mocks.processDeletion).not.toHaveBeenCalled()
  })

  it('rejects a missing field', async () => {
    const response = await POST(buildRequest(null))
    expect(response.status).toBe(400)
    expect(mocks.processDeletion).not.toHaveBeenCalled()
  })

  it('returns 503 when the secret is unset', async () => {
    delete process.env.FACEBOOK_APP_SECRET
    const response = await POST(buildRequest(signedRequest(USER_ID, SECRET)))
    expect(response.status).toBe(503)
    expect(mocks.processDeletion).not.toHaveBeenCalled()
  })

  it('returns 500 without leaking the user id when processing fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.processDeletion.mockRejectedValue(new Error('boom'))
    const response = await POST(buildRequest(signedRequest(USER_ID, SECRET)))
    expect(response.status).toBe(500)
    const logged = errorSpy.mock.calls.flat().join(' ')
    expect(logged).not.toContain(USER_ID)
    errorSpy.mockRestore()
  })
})
