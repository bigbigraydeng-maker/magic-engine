import { describe, it, expect } from 'vitest'
import { signWebhook, verifyWebhookSignature, computeSignature } from '../providers/webhook-sign'

const SECRET = 'whsec_dGVzdHNlY3JldA==' // "testsecret" base64
const body = JSON.stringify({ id: 'evt_1', type: 'realtime.call.incoming' })
const nowSec = 1_800_000_000

describe('webhook signature (spec §8.2 / §17.1)', () => {
  it('verifies a correctly signed payload', () => {
    const headers = signWebhook(body, SECRET, 'evt_1', nowSec)
    const r = verifyWebhookSignature(body, headers, SECRET, 300, nowSec)
    expect(r.valid).toBe(true)
    expect(r.id).toBe('evt_1')
  })

  it('rejects a tampered body', () => {
    const headers = signWebhook(body, SECRET, 'evt_1', nowSec)
    const r = verifyWebhookSignature(body + 'x', headers, SECRET, 300, nowSec)
    expect(r.valid).toBe(false)
  })

  it('rejects a wrong secret', () => {
    const headers = signWebhook(body, SECRET, 'evt_1', nowSec)
    const r = verifyWebhookSignature(body, headers, 'whsec_d3Jvbmc=', 300, nowSec)
    expect(r.valid).toBe(false)
  })

  it('rejects outside the replay window', () => {
    const headers = signWebhook(body, SECRET, 'evt_1', nowSec)
    const r = verifyWebhookSignature(body, headers, SECRET, 300, nowSec + 10_000)
    expect(r.valid).toBe(false)
    expect(r.reason).toMatch(/replay/)
  })

  it('rejects missing headers', () => {
    const r = verifyWebhookSignature(body, {}, SECRET, 300, nowSec)
    expect(r.valid).toBe(false)
  })

  it('signature is deterministic', () => {
    expect(computeSignature(body, SECRET, 'evt_1', String(nowSec))).toBe(computeSignature(body, SECRET, 'evt_1', String(nowSec)))
  })
})
