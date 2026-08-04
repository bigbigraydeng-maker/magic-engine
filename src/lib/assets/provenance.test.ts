import { describe, it, expect } from 'vitest'
import {
  ASSET_SOURCES,
  FDE_UPLOAD_SOURCES,
  SOURCE_LABELS,
  canBackRealPrice,
  isAssetSource,
  isAssetOwnership,
  normaliseSource,
} from './provenance'

describe('canBackRealPrice —— 真价红线', () => {
  it('只有「已确认的客户实拍」和「我们拍的」能打真价', () => {
    const allowed = ASSET_SOURCES.filter(canBackRealPrice)
    expect(allowed).toEqual(['client_verified', 'fde_shot'])
  })

  it('上传链接进来的未核实素材打不了真价 —— 链接可无限转发，可能是网图', () => {
    expect(canBackRealPrice('client_provided')).toBe(false)
  })

  it('AI 生成和图库素材打不了真价', () => {
    expect(canBackRealPrice('ai_generated')).toBe(false)
    expect(canBackRealPrice('stock')).toBe(false)
  })

  it('空值/未知值一律打不了真价（宁可漏，不可错）', () => {
    expect(canBackRealPrice(null)).toBe(false)
    expect(canBackRealPrice(undefined)).toBe(false)
    expect(canBackRealPrice('')).toBe(false)
    expect(canBackRealPrice('client_verifiedX')).toBe(false)
    expect(canBackRealPrice('unknown')).toBe(false)
  })
})

describe('normaliseSource', () => {
  it('合法值原样返回', () => {
    for (const s of ASSET_SOURCES) expect(normaliseSource(s)).toBe(s)
  })

  it('认不出的一律降级 unknown，而不是报错挡住上传', () => {
    expect(normaliseSource('nonsense')).toBe('unknown')
    expect(normaliseSource(null)).toBe('unknown')
    expect(normaliseSource(123)).toBe('unknown')
    expect(normaliseSource({ source: 'fde_shot' })).toBe('unknown')
  })

  it('降级结果永远打不了真价 —— 攻击者传垃圾值提不了权', () => {
    expect(canBackRealPrice(normaliseSource('client_verified '))).toBe(false)
    expect(canBackRealPrice(normaliseSource('CLIENT_VERIFIED'))).toBe(false)
  })
})

describe('FDE 上传可选项', () => {
  it('不含 client_verified —— 那个只能走确认通道升级，带审计签名', () => {
    expect(FDE_UPLOAD_SOURCES).not.toContain('client_verified')
  })

  it('全部是合法来源', () => {
    for (const s of FDE_UPLOAD_SOURCES) expect(isAssetSource(s)).toBe(true)
  })
})

describe('取值守卫', () => {
  it('每个来源都有中文说明，界面不会漏字', () => {
    for (const s of ASSET_SOURCES) expect(SOURCE_LABELS[s]).toBeTruthy()
  })

  it('归属只有两个值', () => {
    expect(isAssetOwnership('client_exclusive')).toBe(true)
    expect(isAssetOwnership('industry_shared')).toBe(true)
    expect(isAssetOwnership('public')).toBe(false)
  })
})
