/**
 * TDD — P21.1 模型分层路由
 * RED 阶段：model-router.ts 和 MODEL_HAIKU 尚未实现，测试全部应 FAIL
 */

import { describe, it, expect } from 'vitest'
import { routeModel, calcCost, type ModelTier } from './model-router'
import { MODEL_SONNET, MODEL_HAIKU } from '../anthropic/client'

describe('routeModel', () => {
  it('strategy tier 返回 Sonnet 配置', () => {
    const cfg = routeModel('strategy')
    expect(cfg.model).toBe(MODEL_SONNET)
    expect(cfg.priceInputPerM).toBe(3.0)
    expect(cfg.priceOutputPerM).toBe(15.0)
  })

  it('production tier 返回 Haiku 配置', () => {
    const cfg = routeModel('production')
    expect(cfg.model).toBe(MODEL_HAIKU)
    // Haiku 定价低于 Sonnet
    expect(cfg.priceInputPerM).toBeLessThan(3.0)
    expect(cfg.priceOutputPerM).toBeLessThan(15.0)
  })

  it('production 比 strategy 便宜（核心分层承诺）', () => {
    const strategy = routeModel('strategy')
    const production = routeModel('production')
    expect(production.priceInputPerM).toBeLessThan(strategy.priceInputPerM)
    expect(production.priceOutputPerM).toBeLessThan(strategy.priceOutputPerM)
  })

  it('无效 tier 抛出 Error', () => {
    expect(() => routeModel('unknown' as ModelTier)).toThrow(/invalid model tier/i)
  })
})

describe('calcCost', () => {
  it('strategy tier：1M input + 1M output = $18', () => {
    // Sonnet: $3/MTok in + $15/MTok out = $18
    expect(calcCost('strategy', 1_000_000, 1_000_000)).toBeCloseTo(18.0, 6)
  })

  it('production tier：1M input + 1M output = $4.8', () => {
    // Haiku: $0.80/MTok in + $4/MTok out = $4.8
    expect(calcCost('production', 1_000_000, 1_000_000)).toBeCloseTo(4.8, 6)
  })

  it('production 成本低于 strategy（等量 token）', () => {
    const s = calcCost('strategy', 100_000, 50_000)
    const p = calcCost('production', 100_000, 50_000)
    expect(p).toBeLessThan(s)
  })

  it('零 token 成本为 0', () => {
    expect(calcCost('strategy', 0, 0)).toBe(0)
    expect(calcCost('production', 0, 0)).toBe(0)
  })
})

describe('MODEL_HAIKU 常量', () => {
  it('是非空字符串', () => {
    expect(typeof MODEL_HAIKU).toBe('string')
    expect(MODEL_HAIKU.length).toBeGreaterThan(0)
  })

  it('与 MODEL_SONNET 不同', () => {
    expect(MODEL_HAIKU).not.toBe(MODEL_SONNET)
  })

  it('包含 "haiku"（大小写不敏感）', () => {
    expect(MODEL_HAIKU.toLowerCase()).toContain('haiku')
  })
})
