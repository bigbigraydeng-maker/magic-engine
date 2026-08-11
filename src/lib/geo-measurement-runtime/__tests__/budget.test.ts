/**
 * GEO Measurement Runtime —— 预算 preflight（Issue #874 / WP04）
 */

import { describe, it, expect } from 'vitest'
import { preflightGeoBudget } from '../budget'

describe('preflightGeoBudget', () => {
  it('剩余额度足够时通过', () => {
    const result = preflightGeoBudget({ authorizedUsd: 10 }, 2, 3)
    expect(result).toEqual({ ok: true, remainingUsd: 8 })
  })

  it('下一步成本超过剩余授权额度时拒绝', () => {
    const result = preflightGeoBudget({ authorizedUsd: 10 }, 9, 2)
    expect(result.ok).toBe(false)
  })

  it('下一步成本是 NaN 时拒绝（不知道成本上界就不许调用）', () => {
    const result = preflightGeoBudget({ authorizedUsd: 10 }, 0, NaN)
    expect(result.ok).toBe(false)
  })

  it('下一步成本是 Infinity 时拒绝', () => {
    const result = preflightGeoBudget({ authorizedUsd: 10 }, 0, Infinity)
    expect(result.ok).toBe(false)
  })

  it('下一步成本是负数时拒绝', () => {
    const result = preflightGeoBudget({ authorizedUsd: 10 }, 0, -1)
    expect(result.ok).toBe(false)
  })

  it('授权额度本身非法（负数）时拒绝', () => {
    const result = preflightGeoBudget({ authorizedUsd: -5 }, 0, 1)
    expect(result.ok).toBe(false)
  })

  it('恰好等于剩余额度时通过（边界值不拒绝合法调用）', () => {
    const result = preflightGeoBudget({ authorizedUsd: 10 }, 7, 3)
    expect(result).toEqual({ ok: true, remainingUsd: 3 })
  })
})
