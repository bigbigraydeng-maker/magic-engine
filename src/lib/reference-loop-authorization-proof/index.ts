import { createHmac, timingSafeEqual } from 'node:crypto'
import type { GrowthJsonValue } from '@/lib/growth'
import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'

const MIN_SECRET_BYTES = 32

function payloadDigest(secret: Buffer, payload: GrowthJsonValue): Buffer {
  return createHmac('sha256', secret)
    .update(canonicalHashOfInput(payload))
    .digest()
}

function proofForSecret(secretValue: string, payload: GrowthJsonValue): string | null {
  const secret = Buffer.from(secretValue, 'utf8')
  if (secret.byteLength < MIN_SECRET_BYTES) return null
  return `hmac-sha256:${payloadDigest(secret, payload).toString('hex')}`
}

/** Verification-only production entrypoint. This module never exports an env-backed signer. */
export function verifyConfiguredReferenceLoopAuthorizationProof(
  payload: GrowthJsonValue,
  proof: unknown,
): boolean {
  const secret = process.env.REFERENCE_LOOP_AUTHORIZATION_HMAC_KEY
  if (!secret || typeof proof !== 'string' || !/^hmac-sha256:[0-9a-f]{64}$/.test(proof)) {
    return false
  }
  const expectedProof = proofForSecret(secret, payload)
  if (!expectedProof) return false
  const provided = Buffer.from(proof.slice('hmac-sha256:'.length), 'hex')
  const expected = Buffer.from(expectedProof.slice('hmac-sha256:'.length), 'hex')
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}
