/**
 * Tests for src/lib/google-oauth/service-account.ts — extracted from
 * src/lib/gsc/client.ts so GA4/GSC/Sheets share one JWT-minting path.
 *
 * Focus: the minted JWT actually carries the *caller's* scope (not a
 * hardcoded one — that was the whole point of extracting this), and
 * loadServiceAccount() fails closed on bad input instead of throwing.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { generateKeyPairSync } from 'crypto'
import { loadServiceAccount, mintServiceAccountToken } from '../service-account'

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const [, payloadB64] = jwt.split('.')
  return JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
}

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS
})

describe('mintServiceAccountToken', () => {
  it('signs a JWT carrying the caller-supplied scope, not a fixed one', async () => {
    let sentAssertion = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        sentAssertion = new URLSearchParams(init.body as string).get('assertion') ?? ''
        return { ok: true, json: async () => ({ access_token: 'fake-token-123' }) } as Response
      }),
    )

    const token = await mintServiceAccountToken(
      { private_key: privateKey, client_email: 'svc@example.iam.gserviceaccount.com' },
      'https://www.googleapis.com/auth/spreadsheets.readonly',
    )

    expect(token).toBe('fake-token-123')
    const payload = decodeJwtPayload(sentAssertion)
    expect(payload.scope).toBe('https://www.googleapis.com/auth/spreadsheets.readonly')
    expect(payload.iss).toBe('svc@example.iam.gserviceaccount.com')
    expect(payload.aud).toBe('https://oauth2.googleapis.com/token')
  })

  it('throws when Google rejects the token exchange', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 }) as Response))

    await expect(
      mintServiceAccountToken(
        { private_key: privateKey, client_email: 'svc@example.iam.gserviceaccount.com' },
        'https://www.googleapis.com/auth/webmasters.readonly',
      ),
    ).rejects.toThrow('401')
  })
})

describe('loadServiceAccount', () => {
  it('returns null when the env var is unset', () => {
    expect(loadServiceAccount()).toBeNull()
  })

  it('returns null on malformed JSON instead of throwing', () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS = '{not json'
    expect(loadServiceAccount()).toBeNull()
  })

  it('returns null when required fields are missing', () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS = JSON.stringify({ client_email: 'x@y.com' })
    expect(loadServiceAccount()).toBeNull()
  })

  it('parses a well-formed credential', () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS = JSON.stringify({
      private_key: 'pk',
      client_email: 'svc@example.com',
    })
    expect(loadServiceAccount()).toEqual({ private_key: 'pk', client_email: 'svc@example.com' })
  })
})
