// @vitest-environment node
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  UNSUBSCRIBE_SECRET_ENV,
  UNSUBSCRIBE_SECRET_PREV_ENV,
  UNSUBSCRIBE_TOKEN_MAX_LENGTH,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  type UnsubscribeTokenPayload,
} from '../unsubscribe-token'

const SECRET = 'test-secret-0123456789-abcdefghijklmnop'
const OTHER = 'other-secret-0123456789-abcdefghijklmnop'
const SEND = '0b0e8a4e-5d7c-4f0e-9a43-2b1f3c4d5e6f'
const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const ISSUED = 1_789_000_000

const PAYLOAD: UnsubscribeTokenPayload = { sendId: SEND, clientId: CLIENT, issuedAt: ISSUED }

function env(values: Record<string, string>) {
  return (name: string): string | undefined => values[name]
}

const WITH_SECRET = env({ [UNSUBSCRIBE_SECRET_ENV]: SECRET })

function sign(payload: UnsubscribeTokenPayload = PAYLOAD, e = WITH_SECRET): string {
  const signed = signUnsubscribeToken(payload, e)
  if (!signed.ok) throw new Error(`could not sign: ${signed.code}`)
  return signed.token
}

/** A token with any JSON payload, signed with the given secret (to probe the decoder past the signature). */
function forge(json: unknown, secret = SECRET): string {
  const part = Buffer.from(JSON.stringify(json), 'utf8').toString('base64url')
  return `${part}.${createHmac('sha256', secret).update(part, 'utf8').digest('base64url')}`
}

describe('signUnsubscribeToken', () => {
  it('signs a token that verifies back to the same send', () => {
    const token = sign()
    expect(verifyUnsubscribeToken(token, WITH_SECRET)).toEqual({ ok: true, payload: PAYLOAD })
  })

  it('carries no address, name or contact: only the version, send, client and issue time', () => {
    const [part] = sign().split('.')
    expect(JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))).toEqual({ v: 1, s: SEND, c: CLIENT, t: ISSUED })
  })

  it('is deterministic for a frozen issue time (a replayed send carries the same link)', () => {
    expect(sign()).toBe(sign())
  })

  it('refuses without a secret, and with a short one (never a default)', () => {
    expect(signUnsubscribeToken(PAYLOAD, env({}))).toEqual({ ok: false, code: 'no_secret' })
    expect(signUnsubscribeToken(PAYLOAD, env({ [UNSUBSCRIBE_SECRET_ENV]: 'short-secret' }))).toEqual({ ok: false, code: 'no_secret' })
    expect(signUnsubscribeToken(PAYLOAD, env({ [UNSUBSCRIBE_SECRET_ENV]: `   ${'x'.repeat(10)}   ` }))).toEqual({ ok: false, code: 'no_secret' })
  })

  it('never signs with the previous secret alone', () => {
    expect(signUnsubscribeToken(PAYLOAD, env({ [UNSUBSCRIBE_SECRET_PREV_ENV]: SECRET }))).toEqual({ ok: false, code: 'no_secret' })
  })

  it('refuses a malformed payload', () => {
    const bad: UnsubscribeTokenPayload[] = [
      { ...PAYLOAD, sendId: 'not-a-uuid' },
      { ...PAYLOAD, sendId: SEND.toUpperCase() },
      { ...PAYLOAD, clientId: '' },
      { ...PAYLOAD, issuedAt: 1.5 },
      { ...PAYLOAD, issuedAt: 1_000 },
      { ...PAYLOAD, issuedAt: 5_000_000_000 },
    ]
    for (const payload of bad) expect(signUnsubscribeToken(payload, WITH_SECRET)).toEqual({ ok: false, code: 'invalid_payload' })
  })
})

describe('verifyUnsubscribeToken', () => {
  it('accepts a token signed with the previous secret during a rotation', () => {
    const old = sign(PAYLOAD, env({ [UNSUBSCRIBE_SECRET_ENV]: OTHER }))
    const rotated = env({ [UNSUBSCRIBE_SECRET_ENV]: SECRET, [UNSUBSCRIBE_SECRET_PREV_ENV]: OTHER })
    expect(verifyUnsubscribeToken(old, rotated)).toEqual({ ok: true, payload: PAYLOAD })
    expect(verifyUnsubscribeToken(sign(), rotated)).toEqual({ ok: true, payload: PAYLOAD })
  })

  it('refuses a token signed with another secret', () => {
    const foreign = sign(PAYLOAD, env({ [UNSUBSCRIBE_SECRET_ENV]: OTHER }))
    expect(verifyUnsubscribeToken(foreign, WITH_SECRET)).toEqual({ ok: false, code: 'bad_signature' })
  })

  it('refuses a token whose payload was changed (another send, another client)', () => {
    const [, signature] = sign().split('.')
    const otherSend = Buffer.from(JSON.stringify({ v: 1, s: '11111111-2222-4333-8444-555555555555', c: CLIENT, t: ISSUED })).toString('base64url')
    expect(verifyUnsubscribeToken(`${otherSend}.${signature}`, WITH_SECRET)).toEqual({ ok: false, code: 'bad_signature' })
  })

  it('refuses a changed signature (one character)', () => {
    const token = sign()
    const last = token.at(-1) === 'A' ? 'B' : 'A'
    expect(verifyUnsubscribeToken(`${token.slice(0, -1)}${last}`, WITH_SECRET)).toEqual({ ok: false, code: 'bad_signature' })
  })

  it('says "no secret" when none is set (the entry answers 503, not "invalid link")', () => {
    expect(verifyUnsubscribeToken(sign(), env({}))).toEqual({ ok: false, code: 'no_secret' })
  })

  it('refuses malformed tokens before any signature work', () => {
    const token = sign()
    const cases = [
      '',
      'abc',
      token.replace('.', ''),
      `${token}.x`,
      `${token}=`,
      `${token.split('.')[0]}.`,
      token.replace(/[A-Za-z]/, '%'),
      `a${'b'.repeat(UNSUBSCRIBE_TOKEN_MAX_LENGTH)}`,
    ]
    for (const t of cases) expect(verifyUnsubscribeToken(t, WITH_SECRET)).toEqual({ ok: false, code: 'malformed' })
  })

  it('refuses a correctly signed payload that is not exactly ours', () => {
    const cases: unknown[] = [
      { v: 2, s: SEND, c: CLIENT, t: ISSUED },
      { v: 1, s: SEND, c: CLIENT, t: ISSUED, extra: 1 },
      { v: 1, s: SEND, c: CLIENT },
      { v: 1, s: SEND.toUpperCase(), c: CLIENT, t: ISSUED },
      { v: 1, s: SEND, c: CLIENT, t: String(ISSUED) },
      { v: 1, s: SEND, c: CLIENT, t: 12 },
      [1, SEND, CLIENT, ISSUED],
      'just a string',
    ]
    for (const json of cases) expect(verifyUnsubscribeToken(forge(json), WITH_SECRET)).toEqual({ ok: false, code: 'malformed' })
  })

  it('accepts the payload keys in any order (the signature, not the layout, is the proof)', () => {
    expect(verifyUnsubscribeToken(forge({ t: ISSUED, c: CLIENT, s: SEND, v: 1 }), WITH_SECRET)).toEqual({ ok: true, payload: PAYLOAD })
  })
})
