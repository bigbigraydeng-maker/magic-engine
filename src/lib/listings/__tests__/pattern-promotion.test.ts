/**
 * 「几套房才算一条规律」的三个数字 + 升降级顺序。
 *
 * 这里最容易出的错是**顺序**：先判样本数就永远降不下来（被推翻的规律样本只会
 * 更多），于是一条已经被市场打脸的规律会继续指挥下一套房怎么投。
 */

import { describe, expect, it } from 'vitest'
import {
  classifyPattern,
  patternTierLabel,
  PATTERN_MIN_CONFIRMED_LISTINGS,
  PATTERN_MIN_DISTINCT_CLIENTS,
  PATTERN_DEMOTION_STREAK,
} from '../pattern-promotion'

const ok = { confirmedListings: 6, distinctClients: 2, consecutiveReversals: 0 }

describe('三个数字（PM 2026-08-01 拍板）', () => {
  it('6 套 / 2 个客户 / 连续 3 套打脸', () => {
    expect(PATTERN_MIN_CONFIRMED_LISTINGS).toBe(6)
    expect(PATTERN_MIN_DISTINCT_CLIENTS).toBe(2)
    expect(PATTERN_DEMOTION_STREAK).toBe(3)
  })
})

describe('样本够不够', () => {
  it('6 套 + 2 个客户 → 是规律', () => {
    expect(classifyPattern(ok).tier).toBe('general_pattern')
  })

  it('5 套 → 还是待验证，一套单独的经验不是规律', () => {
    expect(classifyPattern({ ...ok, confirmedListings: 5 }).tier).toBe('unverified')
  })

  it('1 套 → 待验证，并说清还差几套', () => {
    const v = classifyPattern({ ...ok, confirmedListings: 1 })
    expect(v.tier).toBe('unverified')
    expect(v.provenance).toContain('还差 5 套')
  })
})

describe('跨不跨客户', () => {
  it('6 套但全来自同一个客户 → 只算「这个客户的规律」', () => {
    const v = classifyPattern({ ...ok, distinctClients: 1 })
    expect(v.tier).toBe('client_pattern')
    expect(v.provenance).toContain('同一个客户')
  })

  it('6 套来自 3 个客户 → 通用规律', () => {
    expect(classifyPattern({ ...ok, distinctClients: 3 }).tier).toBe('general_pattern')
  })
})

describe('连续打脸自动降级', () => {
  it('连续 3 套跟当初想的相反 → 打回待验证，哪怕样本很多', () => {
    const v = classifyPattern({ confirmedListings: 20, distinctClients: 5, consecutiveReversals: 3 })
    expect(v.tier).toBe('unverified')
    expect(v.demoted).toBe(true)
  })

  it('连续 2 套还不降级（3 才是门槛）', () => {
    expect(classifyPattern({ ...ok, consecutiveReversals: 2 }).tier).toBe('general_pattern')
  })

  it('先判打脸再判样本数 —— 顺序反了就永远降不下来', () => {
    const v = classifyPattern({ confirmedListings: 99, distinctClients: 9, consecutiveReversals: 4 })
    expect(v.tier).toBe('unverified')
  })
})

describe('出处', () => {
  it('每一档都带得出「基于 N 套实测」', () => {
    expect(classifyPattern(ok).provenance).toContain('基于 6 套实测')
    expect(classifyPattern({ ...ok, distinctClients: 1 }).provenance).toContain('基于 6 套实测')
    expect(classifyPattern({ ...ok, confirmedListings: 2 }).provenance).toContain('基于 2 套实测')
  })

  it('负数当 0，不会算出「还差 7 套」这种鬼话', () => {
    const v = classifyPattern({ confirmedListings: -3, distinctClients: -1, consecutiveReversals: -1 })
    expect(v.provenance).toContain('基于 0 套实测')
    expect(v.tier).toBe('unverified')
  })
})

describe('label 兜底', () => {
  it('认识的档给中文', () => {
    expect(patternTierLabel('general_pattern')).toBe('规律')
    expect(patternTierLabel('client_pattern')).toBe('这个客户的规律')
  })

  it('不认识的档原样显示，不留白', () => {
    expect(patternTierLabel('brand_new_tier')).toBe('brand_new_tier')
    expect(patternTierLabel(null)).toBe('—')
  })
})
