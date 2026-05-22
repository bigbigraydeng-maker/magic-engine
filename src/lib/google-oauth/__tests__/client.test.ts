/**
 * Tests for src/lib/google-oauth/client.ts — OAuth state token signing.
 *
 * Focus: buildState / verifyState round-trip and the `flow` field the OAuth
 * callback reads to decide where to return the user (admin dashboard vs the
 * public /connect page). Backward-compat is covered too: a pre-flow state
 * (signed before `flow` existed) must still verify, defaulting to 'admin',
 * so authorisations in flight across a deploy are not broken.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { createHmac } from 'crypto'
import { buildState, verifyState } from '../client'

const SECRET = 'test-google-client-secret'
const CLIENT_ID = '11111111-2222-3333-4444-555555555555'

beforeAll(() => {
  process.env.GOOGLE_CLIENT_SECRET = SECRET
})

/** Re-implements the module's signing scheme to forge legacy / expired states. */
function forgeState(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = createHmac('sha256', SECRET).update(encoded).digest('base64url')
  return `${encoded}.${sig}`
}

describe('buildState / verifyState — round-trip', () => {
  it('defaults flow to admin when not specified', () => {
    expect(verifyState(buildState(CLIENT_ID))).toEqual({
      clientId: CLIENT_ID,
      flow: 'admin',
    })
  })

  it('preserves flow=connect through the round-trip', () => {
    expect(verifyState(buildState(CLIENT_ID, 'connect'))).toEqual({
      clientId: CLIENT_ID,
      flow: 'connect',
    })
  })

  it('preserves an explicit flow=admin', () => {
    expect(verifyState(buildState(CLIENT_ID, 'admin'))).toEqual({
      clientId: CLIENT_ID,
      flow: 'admin',
    })
  })
})

describe('verifyState — rejection cases', () => {
  it('rejects a malformed state with no separator', () => {
    expect(verifyState('not-a-valid-state')).toBeNull()
  })

  it('rejects a state signed with the wrong secret (forgery)', () => {
    const encoded = Buffer.from(
      JSON.stringify({ clientId: CLIENT_ID, flow: 'admin', exp: Date.now() + 60_000 }),
    ).toString('base64url')
    const forgedSig = createHmac('sha256', 'wrong-secret')
      .update(encoded)
      .digest('base64url')
    expect(verifyState(`${encoded}.${forgedSig}`)).toBeNull()
  })

  it('rejects an expired state', () => {
    expect(
      verifyState(
        forgeState({ clientId: CLIENT_ID, flow: 'connect', exp: Date.now() - 1000 }),
      ),
    ).toBeNull()
  })
})

describe('verifyState — backward compatibility', () => {
  it('treats a pre-flow state (no flow field) as admin', () => {
    const legacy = forgeState({ clientId: CLIENT_ID, exp: Date.now() + 60_000 })
    expect(verifyState(legacy)).toEqual({ clientId: CLIENT_ID, flow: 'admin' })
  })

  it('normalises an unrecognised flow value to admin', () => {
    const weird = forgeState({
      clientId: CLIENT_ID,
      flow: 'garbage',
      exp: Date.now() + 60_000,
    })
    expect(verifyState(weird)).toEqual({ clientId: CLIENT_ID, flow: 'admin' })
  })
})
