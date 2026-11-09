import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildState, verifyState } from '../tiktok-oauth/client'

afterEach(() => vi.unstubAllEnvs())
describe('TikTok authorization state', () => {
  it('generates distinct state for the same client and time', () => {
    vi.stubEnv('TIKTOK_CLIENT_SECRET', 'test-only-secret')
    const first = buildState('client-one')
    expect(buildState('client-one')).not.toBe(first)
    expect(verifyState(first)).toEqual({ clientId: 'client-one' })
  })
  it('rejects tampering and expiration', () => {
    vi.stubEnv('TIKTOK_CLIENT_SECRET', 'test-only-secret')
    const state = buildState('client-one')
    expect(verifyState(state + 'x')).toBeNull()
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 601_000)
    expect(verifyState(state)).toBeNull()
    vi.restoreAllMocks()
  })
})
