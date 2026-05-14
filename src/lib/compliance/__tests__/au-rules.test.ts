/**
 * Tests for src/lib/compliance/au-rules.ts — checkLocalCompliance
 *
 * 覆盖：trades license 缺失检测、AFSL/TGA 敏感词命中、ACCC 全行业措辞、
 * 词边界匹配、行业筛选、disclaimer 与「空 flags ≠ 合规」契约。
 */

import { describe, it, expect } from 'vitest'
import { checkLocalCompliance, AU_COMPLIANCE_RULES } from '../au-rules'

// ---------------------------------------------------------------------------
// 1. Trades licensing — keyword_absent
// ---------------------------------------------------------------------------

describe('checkLocalCompliance — trades licensing', () => {
  it('flags trades 文案缺少 license 号', () => {
    const result = checkLocalCompliance(
      'Fast emergency plumbing across Brisbane. Call us today!',
      'trades_plumbing_electrical',
    )
    const flag = result.flags.find(f => f.ruleId === 'trades-license-number')
    expect(flag).toBeDefined()
    expect(flag!.matchedText).toBeNull()
    expect(flag!.riskLevel).toBe('high')
  })

  it('不 flag 已含 licence 号的 trades 文案', () => {
    const result = checkLocalCompliance(
      'Licensed electrician — Licence No. 123456. Servicing Sydney.',
      'trades_plumbing_electrical',
    )
    expect(result.flags.find(f => f.ruleId === 'trades-license-number')).toBeUndefined()
  })

  it('美式拼写 license 也算已声明', () => {
    const result = checkLocalCompliance(
      'Our electrical license is current. Book now.',
      'trades_plumbing_electrical',
    )
    expect(result.flags.find(f => f.ruleId === 'trades-license-number')).toBeUndefined()
  })

  it('非 trades 行业不跑 trades 规则', () => {
    const result = checkLocalCompliance('Fresh coffee daily.', 'hospitality_restaurant')
    expect(result.flags.find(f => f.ruleId === 'trades-license-number')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 2. Financial services — AFSL
// ---------------------------------------------------------------------------

describe('checkLocalCompliance — financial services (AFSL)', () => {
  it('flags accounting 文案出现 financial planning', () => {
    const result = checkLocalCompliance(
      'We offer expert financial planning for small business owners.',
      'accounting_advisory',
    )
    const flag = result.flags.find(f => f.ruleId === 'financial-advice-afsl')
    expect(flag).toBeDefined()
    expect(flag!.matchedText).toBe('financial planning')
    expect(flag!.source).toContain('ASIC')
  })

  it('纯记账 / 报税文案不触发 AFSL', () => {
    const result = checkLocalCompliance(
      'Bookkeeping and BAS lodgement for tradies. Tax returns done fast.',
      'accounting_advisory',
    )
    expect(result.flags.find(f => f.ruleId === 'financial-advice-afsl')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 3. Health — TGA / AHPRA
// ---------------------------------------------------------------------------

describe('checkLocalCompliance — health therapeutic claims', () => {
  it('flags 牙科文案出现绝对化疗效承诺', () => {
    const result = checkLocalCompliance(
      'Our implants give permanent results — 100% safe, guaranteed results.',
      'dental_clinic',
    )
    const flag = result.flags.find(f => f.ruleId === 'health-therapeutic-claims')
    expect(flag).toBeDefined()
    expect(flag!.riskLevel).toBe('high')
  })

  it('中性牙科文案不触发', () => {
    const result = checkLocalCompliance(
      'General and cosmetic dentistry. Book a check-up with our team.',
      'dental_clinic',
    )
    expect(result.flags.find(f => f.ruleId === 'health-therapeutic-claims')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 4. ACCC / ACL — 全行业
// ---------------------------------------------------------------------------

describe('checkLocalCompliance — ACCC advertising claims (all industries)', () => {
  it('flags 价格优越性声明', () => {
    const result = checkLocalCompliance('We have the lowest price in town.', 'fitness_studio')
    const flag = result.flags.find(f => f.ruleId === 'acl-price-superiority-claims')
    expect(flag).toBeDefined()
    expect(flag!.matchedText).toBe('lowest price')
  })

  it('flags 保证 / 免费类措辞', () => {
    const result = checkLocalCompliance('Sign up free — satisfaction guaranteed!', 'ecommerce_d2c')
    expect(result.flags.find(f => f.ruleId === 'acl-guarantee-free-claims')).toBeDefined()
  })

  it('词边界匹配：free 命中，freedom 不误伤', () => {
    const withFree = checkLocalCompliance('Get a free quote today.', null)
    expect(withFree.flags.find(f => f.ruleId === 'acl-guarantee-free-claims')).toBeDefined()

    const withFreedom = checkLocalCompliance('Financial freedom starts here.', null)
    expect(withFreedom.flags.find(f => f.ruleId === 'acl-guarantee-free-claims')).toBeUndefined()
  })

  it('flags 虚假折扣措辞', () => {
    const result = checkLocalCompliance('Was $999, now only $499 — half price!', null)
    expect(result.flags.find(f => f.ruleId === 'acl-fake-discount')).toBeDefined()
  })

  it('industryCategory=null 仍跑全行业规则，但不跑行业专属规则', () => {
    const result = checkLocalCompliance('Cheapest deals, guaranteed.', null)
    expect(result.flags.some(f => f.category === 'advertising_claims')).toBe(true)
    expect(result.flags.some(f => f.category === 'licensing')).toBe(false)
    expect(result.flags.some(f => f.category === 'financial_services')).toBe(false)
  })

  it('一条规则只报一次（多个敏感词命中不刷屏）', () => {
    const result = checkLocalCompliance('Lowest price AND cheapest AND unbeatable!', null)
    const priceFlags = result.flags.filter(f => f.ruleId === 'acl-price-superiority-claims')
    expect(priceFlags).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 5. 结果契约 — disclaimer / 空 flags ≠ 合规
// ---------------------------------------------------------------------------

describe('checkLocalCompliance — result contract', () => {
  it('总是返回 disclaimer，明确「非合规背书」', () => {
    const result = checkLocalCompliance('Neutral copy with nothing sensitive.', 'legal_services')
    expect(result.disclaimer).toContain('人工复核')
    expect(result.disclaimer).toContain('不构成合规背书')
  })

  it('未命中风险点时 flags 为空，但仍带 disclaimer（空 ≠ 合规）', () => {
    const result = checkLocalCompliance('We sell tiles and timber.', 'building_supplies')
    expect(result.flags).toEqual([])
    expect(result.disclaimer.length).toBeGreaterThan(0)
  })

  it('回显传入的 industryCategory', () => {
    expect(checkLocalCompliance('x', 'dental_clinic').industryCategory).toBe('dental_clinic')
    expect(checkLocalCompliance('x', null).industryCategory).toBeNull()
  })

  it('每条 flag 都带 guidance 与 source（可维护性）', () => {
    const result = checkLocalCompliance(
      'Lowest price guaranteed, free install!',
      'trades_plumbing_electrical',
    )
    expect(result.flags.length).toBeGreaterThan(0)
    for (const flag of result.flags) {
      expect(flag.guidance.length).toBeGreaterThan(0)
      expect(flag.source.length).toBeGreaterThan(0)
      expect(flag.message).toContain('人工复核')
    }
  })
})

// ---------------------------------------------------------------------------
// 6. 规则库自身完整性
// ---------------------------------------------------------------------------

describe('AU_COMPLIANCE_RULES — library integrity', () => {
  it('规则 id 唯一', () => {
    const ids = AU_COMPLIANCE_RULES.map(r => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('覆盖四类要求：licensing / financial / health / advertising', () => {
    const categories = new Set(AU_COMPLIANCE_RULES.map(r => r.category))
    expect(categories).toContain('licensing')
    expect(categories).toContain('financial_services')
    expect(categories).toContain('health_therapeutic')
    expect(categories).toContain('advertising_claims')
  })

  it('每条规则都有非空 patterns / guidance / source', () => {
    for (const rule of AU_COMPLIANCE_RULES) {
      expect(rule.patterns.length).toBeGreaterThan(0)
      expect(rule.guidance.length).toBeGreaterThan(0)
      expect(rule.source.length).toBeGreaterThan(0)
    }
  })
})
