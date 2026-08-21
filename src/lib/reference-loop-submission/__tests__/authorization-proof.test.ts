import { afterEach, describe, expect, it } from 'vitest'
import type { GrowthJsonValue } from '@/lib/growth'
import { verifyConfiguredReferenceLoopAuthorizationProof } from '@/lib/reference-loop-authorization-proof'
import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'
import { createHmac } from 'node:crypto'

const payload: GrowthJsonValue = {
  client_id: 'client-a',
  validation_passed: true,
  authorized_action: { page_url: 'https://example.nz/', intents: [] },
}
const originalSecret = process.env.REFERENCE_LOOP_AUTHORIZATION_HMAC_KEY

function sign(secret: string, value: GrowthJsonValue): string {
  return `hmac-sha256:${createHmac('sha256', secret)
    .update(canonicalHashOfInput(value)).digest('hex')}`
}

afterEach(() => {
  if (originalSecret === undefined) delete process.env.REFERENCE_LOOP_AUTHORIZATION_HMAC_KEY
  else process.env.REFERENCE_LOOP_AUTHORIZATION_HMAC_KEY = originalSecret
})

describe('Reference Loop authorization proof', () => {
  it('verifies only the exact canonical payload signed with the same secret', () => {
    const secret = 'proof-secret-a-that-is-longer-than-thirty-two-bytes'
    process.env.REFERENCE_LOOP_AUTHORIZATION_HMAC_KEY = secret
    const proof = sign(secret, payload)

    expect(verifyConfiguredReferenceLoopAuthorizationProof(payload, proof)).toBe(true)
    expect(verifyConfiguredReferenceLoopAuthorizationProof(
      { ...payload, validation_passed: false }, proof,
    )).toBe(false)
  })

  it('rejects a proof signed by a different server secret', () => {
    const signerSecret = 'proof-secret-a-that-is-longer-than-thirty-two-bytes'
    process.env.REFERENCE_LOOP_AUTHORIZATION_HMAC_KEY =
      'proof-secret-b-that-is-longer-than-thirty-two-bytes'

    expect(verifyConfiguredReferenceLoopAuthorizationProof(
      payload, sign(signerSecret, payload),
    )).toBe(false)
  })

  it('rejects malformed proofs and undersized keys', () => {
    process.env.REFERENCE_LOOP_AUTHORIZATION_HMAC_KEY = 'too-short'
    expect(verifyConfiguredReferenceLoopAuthorizationProof(payload, 'not-a-proof')).toBe(false)
    expect(verifyConfiguredReferenceLoopAuthorizationProof(
      payload, sign('too-short', payload),
    )).toBe(false)
  })
})
