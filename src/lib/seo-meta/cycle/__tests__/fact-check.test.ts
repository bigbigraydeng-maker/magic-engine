// Mocked unit tests for the threshold/fail-closed logic — fast, no network,
// always run in CI. Live-API regression tests against the real Jev endpoint
// live in fact-check.live.test.ts (a separate file, since this one mocks
// '@/lib/jev/client' at module load and vitest mocks can't be selectively
// bypassed within the same file without also affecting module caching).

import { describe, expect, it, vi, beforeEach } from 'vitest'

const callJev = vi.fn()
vi.mock('@/lib/jev/client', () => ({
  callJev: (...a: unknown[]) => callJev(...a),
}))

import { checkFactPreservation } from '../fact-check'

beforeEach(() => {
  callJev.mockReset()
})

describe('checkFactPreservation — threshold + fail-closed logic (mocked)', () => {
  it('score above threshold → consistent:false with a templated reason', async () => {
    callJev.mockResolvedValue({ answers: { contradiction: { noul: 0.83 } } })
    const result = await checkFactPreservation('A', 'B', 'C', 'D')
    expect(result.consistent).toBe(false)
    expect(result.reason).toContain('0.83')
  })

  it('score below threshold → consistent:true with a templated reason', async () => {
    callJev.mockResolvedValue({ answers: { contradiction: { noul: 0.12 } } })
    const result = await checkFactPreservation('A', 'B', 'C', 'D')
    expect(result.consistent).toBe(true)
    expect(result.reason).toContain('0.12')
  })

  it('score exactly at threshold (0.5) counts as a contradiction', async () => {
    callJev.mockResolvedValue({ answers: { contradiction: { noul: 0.5 } } })
    const result = await checkFactPreservation('A', 'B', 'C', 'D')
    expect(result.consistent).toBe(false)
  })

  it('callJev throwing (e.g. missing TYPESAFE_API_KEY, timeout, non-2xx) fails closed', async () => {
    callJev.mockRejectedValue(new Error('TYPESAFE_API_KEY environment variable is not set'))
    const result = await checkFactPreservation('A', 'B', 'C', 'D')
    expect(result.consistent).toBe(false)
    expect(result.reason).toContain('fact-check judge call failed')
  })

  it('malformed/missing answer shape fails closed', async () => {
    callJev.mockResolvedValue({ answers: {} })
    const result = await checkFactPreservation('A', 'B', 'C', 'D')
    expect(result.consistent).toBe(false)
    expect(result.reason).toContain('unparseable')
  })

  it('never surfaces "Jev" or "TypeSafe" in the reason text (client-facing copy rule)', async () => {
    callJev.mockResolvedValue({ answers: { contradiction: { noul: 0.9 } } })
    const result = await checkFactPreservation('A', 'B', 'C', 'D')
    expect(result.reason.toLowerCase()).not.toContain('jev')
    expect(result.reason.toLowerCase()).not.toContain('typesafe')
  })
})
