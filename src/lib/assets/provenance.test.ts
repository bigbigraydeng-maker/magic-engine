import { describe, it, expect } from 'vitest'
import {
  ASSET_SOURCES,
  FDE_UPLOAD_SOURCES,
  SOURCE_LABELS,
  canBackRealPrice,
  isAssetSource,
  isAssetOwnership,
  normaliseSource,
  canAssetBackRealPrice,
  posterHasPrice,
  readPosterLineage,
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

const PARENT_ID = 'a1b2c3d4-0000-4000-8000-000000000001'
const lineage = (over: Record<string, unknown> = {}) => ({
  recipe_id: 'tour_poster_v1',
  recipe_version: 1,
  source_asset_id: PARENT_ID,
  has_price: true,
  text_lines: ['China Panorama', 'From $6,999'],
  cost_usd: 0.038,
  provider_request_id: 'req-1',
  created_at: '2026-11-15T00:00:00.000Z',
  ...over,
})
const signed = { verified_by: 'fde@me.test', verified_at: '2026-11-15T01:00:00.000Z' }
const unsigned = { verified_by: null, verified_at: null }

describe('readPosterLineage —— 严格读海报血统', () => {
  it('读出完整血统（老记录没有 next_depart_on → null）', () => {
    expect(readPosterLineage({ poster: lineage() })).toEqual({ ...lineage(), next_depart_on: null })
    expect(readPosterLineage({ poster: lineage({ next_depart_on: '2027-03-15' }) })?.next_depart_on).toBe('2027-03-15')
  })

  it('next_depart_on 只认 YYYY-MM-DD 或 null', () => {
    expect(readPosterLineage({ poster: lineage({ next_depart_on: '15 March 2027' }) })).toBeNull()
    expect(readPosterLineage({ poster: lineage({ next_depart_on: null }) })).not.toBeNull()
  })

  it('不是对象 / 没有 poster 键 → null', () => {
    for (const vm of [null, undefined, 'x', [], {}, { poster: null }, { poster: [] }]) {
      expect(readPosterLineage(vm)).toBeNull()
    }
  })

  it('任一字段不合格就不当海报', () => {
    const bad: Array<Record<string, unknown>> = [
      { recipe_id: '' },
      { recipe_version: 0 },
      { recipe_version: 1.5 },
      { source_asset_id: 'not-a-uuid' },
      { has_price: 'yes' },
      { text_lines: [1] },
      { cost_usd: -1 },
      { cost_usd: Number.NaN },
      { provider_request_id: 5 },
      { created_at: 'yesterday' },
    ]
    for (const over of bad) expect(readPosterLineage({ poster: lineage(over) })).toBeNull()
  })

  it('cost_usd / provider_request_id 允许为 null', () => {
    expect(readPosterLineage({ poster: lineage({ cost_usd: null, provider_request_id: null }) })).not.toBeNull()
  })

  it('posterHasPrice 只对带价格的合格海报为真', () => {
    expect(posterHasPrice({ poster: lineage() })).toBe(true)
    expect(posterHasPrice({ poster: lineage({ has_price: false }) })).toBe(false)
    expect(posterHasPrice({ poster: lineage({ source_asset_id: 'bad' }) })).toBe(false)
    expect(posterHasPrice(null)).toBe(false)
  })
})

describe('canAssetBackRealPrice —— AI 海报新规矩', () => {
  const poster = (sig: typeof signed | typeof unsigned) => ({
    source: 'ai_generated',
    ...sig,
    vision_metadata: { poster: lineage() },
  })

  it('签过字 + 原图能打真价 → 能背书', () => {
    expect(canAssetBackRealPrice(poster(signed), 'client_verified')).toBe(true)
    expect(canAssetBackRealPrice(poster(signed), 'fde_shot')).toBe(true)
  })

  it('没签字 → 背不了', () => {
    expect(canAssetBackRealPrice(poster(unsigned), 'client_verified')).toBe(false)
    expect(canAssetBackRealPrice({ ...poster(signed), verified_at: 'garbage' }, 'fde_shot')).toBe(false)
    expect(canAssetBackRealPrice({ ...poster(signed), verified_by: '  ' }, 'fde_shot')).toBe(false)
  })

  it('原图被降级 / 查不到 → 签过字也背不了', () => {
    for (const parent of ['client_provided', 'ai_generated', 'unknown', null, undefined]) {
      expect(canAssetBackRealPrice(poster(signed), parent)).toBe(false)
    }
  })

  it('海报自己被误标成 client_verified 也不认，照样要原图 + 签字', () => {
    expect(canAssetBackRealPrice({ ...poster(unsigned), source: 'client_verified' }, 'client_verified')).toBe(false)
  })

  it('不是海报：跟 canBackRealPrice 完全一致（签字 / 原图都不起作用）', () => {
    for (const source of ASSET_SOURCES) {
      const row = { source, ...signed, vision_metadata: { scene: 'x' } }
      expect(canAssetBackRealPrice(row, 'client_verified')).toBe(canBackRealPrice(source))
    }
    expect(canAssetBackRealPrice({ source: 'ai_generated', ...signed, vision_metadata: null }, 'fde_shot')).toBe(false)
  })
})
