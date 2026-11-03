import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  leadGraphBackoffMs,
  leadGraphDelay,
  metaGraphRateLimited,
  pauseIfGraphUsageHot,
  readGraphThrottleHints,
} from '../lead-graph-rate-limit'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('metaGraphRateLimited', () => {
  it('treats 429, the known codes, and the 80000 block as a throttle', () => {
    expect(metaGraphRateLimited(429, 'nope')).toBe(true)
    expect(metaGraphRateLimited(400, '{"error":{"code":4}}')).toBe(true)
    expect(metaGraphRateLimited(400, '{"error":{"code":17}}')).toBe(true)
    expect(metaGraphRateLimited(400, '{"error":{"code":32}}')).toBe(true)
    expect(metaGraphRateLimited(400, '{"error":{"code":613}}')).toBe(true)
    expect(metaGraphRateLimited(400, '{"error":{"code":80004}}')).toBe(true)
  })

  it('does not retry a field error or a plain 400', () => {
    expect(metaGraphRateLimited(400, '{"error":{"code":100,"is_transient":true}}')).toBe(false)
    expect(metaGraphRateLimited(403, '{"error":{"message":"boom"}}')).toBe(false)
    expect(metaGraphRateLimited(400, 'boom')).toBe(false)
  })
})

describe('leadGraphBackoffMs', () => {
  it('doubles from one second and caps a long hint at eight seconds', () => {
    expect(leadGraphBackoffMs(1, {})).toBe(1000)
    expect(leadGraphBackoffMs(2, {})).toBe(2000)
    expect(leadGraphBackoffMs(3, {})).toBe(4000)
    expect(leadGraphBackoffMs(1, { retryAfterSeconds: 2 })).toBe(2000)
    expect(leadGraphBackoffMs(1, { retryAfterSeconds: 3600 })).toBe(8000)
    expect(leadGraphBackoffMs(1, { regainAccessMinutes: 60 })).toBe(8000)
  })
})

describe('readGraphThrottleHints', () => {
  it('reads Retry-After and the usage headers', () => {
    const hints = readGraphThrottleHints({
      get(name: string) {
        if (name === 'retry-after') return '2'
        if (name === 'x-business-use-case-usage') {
          return JSON.stringify({ ads: [{ call_count: 91, estimated_time_to_regain_access: 5 }] })
        }
        return null
      },
    })
    expect(hints).toEqual({ retryAfterSeconds: 2, regainAccessMinutes: 5, usagePercent: 91 })
  })

  it('ignores a missing or unreadable header', () => {
    expect(readGraphThrottleHints(undefined)).toEqual({
      retryAfterSeconds: null,
      regainAccessMinutes: null,
      usagePercent: null,
    })
    expect(readGraphThrottleHints({ get: () => 'not-json' }).usagePercent).toBeNull()
  })
})

describe('pauseIfGraphUsageHot', () => {
  it('pauses once the usage reaches 90', async () => {
    const sleep = vi.spyOn(leadGraphDelay, 'sleep').mockResolvedValue()
    await pauseIfGraphUsageHot(89)
    expect(sleep).not.toHaveBeenCalled()
    await pauseIfGraphUsageHot(90)
    expect(sleep).toHaveBeenCalledWith(1000)
  })
})
