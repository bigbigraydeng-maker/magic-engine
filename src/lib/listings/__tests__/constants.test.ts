/**
 * 枚举常量的测试。
 *
 * 核心断言:这份常量必须跟数据库 CHECK 约束逐字一致
 * (supabase/migrations/20260730145332_listings.sql)。漂了的表现是前端能选、
 * 后端放行、数据库 500 —— 所以取值清单在这里写死一遍当护栏。
 */

import { describe, it, expect } from 'vitest'
import {
  PROPERTY_TYPES,
  PRICE_BANDS,
  LISTING_STATUSES,
  DEFAULT_LISTING_STATUS,
  PROPERTY_TYPE_LABEL,
  PRICE_BAND_LABEL,
  LISTING_STATUS_META,
  PROPERTY_TYPE_OPTIONS,
  PRICE_BAND_OPTIONS,
  LISTING_STATUS_OPTIONS,
  isPropertyType,
  isPriceBand,
  isListingStatus,
  propertyTypeLabel,
  priceBandLabel,
  listingStatusLabel,
  listingStatusMeta,
} from '../constants'

describe('枚举取值跟数据库 CHECK 约束一致', () => {
  it('property_type', () => {
    expect([...PROPERTY_TYPES]).toEqual([
      'house', 'apartment', 'townhouse', 'section', 'new_build', 'other',
    ])
  })

  it('price_band', () => {
    expect([...PRICE_BANDS]).toEqual([
      'under_1m', '1m_1_5m', '1_5m_2m', '2m_3m', '3m_plus', 'undisclosed',
    ])
  })

  it('status', () => {
    expect([...LISTING_STATUSES]).toEqual([
      'prospect', 'live', 'under_offer', 'sold', 'withdrawn',
    ])
  })

  it('默认状态跟数据库 DEFAULT 一致', () => {
    expect(DEFAULT_LISTING_STATUS).toBe('prospect')
  })

  it('withdrawn 必须留着 —— 它是学习用的负样本', () => {
    expect(LISTING_STATUSES).toContain('withdrawn')
  })
})

describe('每个值都有中文 label', () => {
  it('房型', () => {
    for (const t of PROPERTY_TYPES) expect(PROPERTY_TYPE_LABEL[t]?.length).toBeGreaterThan(0)
  })
  it('价格档', () => {
    for (const b of PRICE_BANDS) expect(PRICE_BAND_LABEL[b]?.length).toBeGreaterThan(0)
  })
  it('状态(label + 一句话解释)', () => {
    for (const s of LISTING_STATUSES) {
      expect(LISTING_STATUS_META[s].label.length).toBeGreaterThan(0)
      expect(LISTING_STATUS_META[s].hint.length).toBeGreaterThan(0)
    }
  })
})

describe('类型守卫', () => {
  it('认合法值', () => {
    expect(isPropertyType('house')).toBe(true)
    expect(isPriceBand('2m_3m')).toBe(true)
    expect(isListingStatus('under_offer')).toBe(true)
  })

  it('拒非法值 / 非字符串', () => {
    expect(isPropertyType('castle')).toBe(false)
    expect(isPriceBand('10m_plus')).toBe(false)
    expect(isListingStatus('pending')).toBe(false)
    expect(isPropertyType(null)).toBe(false)
    expect(isPriceBand(42)).toBe(false)
    expect(isListingStatus(undefined)).toBe(false)
  })
})

describe('label 兜底 —— 数据库先加值、前端没跟上时不能炸', () => {
  it('空值显示破折号', () => {
    expect(propertyTypeLabel(null)).toBe('—')
    expect(priceBandLabel(undefined)).toBe('—')
    expect(listingStatusLabel('')).toBe('—')
  })

  it('未知值原样显示,不是 undefined 也不抛', () => {
    expect(propertyTypeLabel('barn')).toBe('barn')
    expect(priceBandLabel('5m_plus')).toBe('5m_plus')
    expect(listingStatusLabel('auction')).toBe('auction')
  })

  it('未知状态拿到的 meta 有可用的 tone,UI 不会拿到 undefined 上色', () => {
    const meta = listingStatusMeta('auction')
    expect(meta.label).toBe('auction')
    expect(meta.tone).toBeTruthy()
  })

  it('已知值走正常 label', () => {
    expect(propertyTypeLabel('house')).toBe(PROPERTY_TYPE_LABEL.house)
    expect(listingStatusLabel('sold')).toBe(LISTING_STATUS_META.sold.label)
  })
})

describe('下拉选项', () => {
  it('数量跟枚举一致,顺序一致', () => {
    expect(PROPERTY_TYPE_OPTIONS.map(o => o.value)).toEqual([...PROPERTY_TYPES])
    expect(PRICE_BAND_OPTIONS.map(o => o.value)).toEqual([...PRICE_BANDS])
    expect(LISTING_STATUS_OPTIONS.map(o => o.value)).toEqual([...LISTING_STATUSES])
  })

  it('每个选项都有中文 label', () => {
    for (const o of [...PROPERTY_TYPE_OPTIONS, ...PRICE_BAND_OPTIONS, ...LISTING_STATUS_OPTIONS]) {
      expect(o.label.length).toBeGreaterThan(0)
    }
  })
})
