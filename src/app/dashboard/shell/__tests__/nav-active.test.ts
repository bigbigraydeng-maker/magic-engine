import { describe, expect, it } from 'vitest'
import { swapClientInPath } from '../nav-active'

describe('swapClientInPath', () => {
  it('keeps the suffix when switching clients', () => {
    expect(swapClientInPath('/dashboard/clients/a/ads-health', 'b')).toBe(
      '/dashboard/clients/b/ads-health',
    )
  })

  it('falls back to client home when not in a client subtree', () => {
    expect(swapClientInPath('/dashboard/today', 'b')).toBe('/dashboard/clients/b')
  })
})
