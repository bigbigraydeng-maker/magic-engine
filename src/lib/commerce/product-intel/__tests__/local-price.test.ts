import { describe, it, expect } from 'vitest'
import { normalizeLocalMarket, summariseListings } from '../local-price'
import type { LocalListing } from '../local-price'
import { scoreCandidate } from '../score'
import type { CostAssumptions } from '../landed-cost'
import type { Measured, ProductCandidate } from '../types'

const AT = '2026-08-16T00:00:00.000Z'
const SOURCE = 'Google 商品块 · NZ · "portable blender"'

function listing(overrides: Partial<LocalListing> = {}): LocalListing {
  return {
    title: 'Ninja Blast Portable Blender',
    price: 59.99,
    currency: 'NZD',
    seller: 'Briscoes',
    url: null,
    ...overrides,
  }
}

/** 实测价位（NZ / portable blender，2026-08-16）。 */
function realBand(): LocalListing[] {
  return [
    listing({ price: 59.99, seller: 'Briscoes' }),
    listing({ price: 34.99, seller: 'PB Tech' }),
    listing({ price: 119, seller: 'Harvey Norman New Zealand' }),
    listing({ price: 49, seller: 'NutriBullet New Zealand' }),
    listing({ price: 58, seller: 'JB Hi-Fi' }),
  ]
}

describe('summariseListings', () => {
  it('数不同商家，大小写与空白不算两家', () => {
    const stats = summariseListings([
      listing({ seller: 'PB Tech' }),
      listing({ seller: ' pb tech ' }),
      listing({ seller: 'Briscoes' }),
    ])
    expect(stats.distinctSellers).toBe(2)
    expect(stats.usableCount).toBe(3)
  })

  it('🔴 非 NZD 的条目被剔除，而且**必须报出剔了几条**', () => {
    const stats = summariseListings([
      listing({ price: 59.99, currency: 'NZD' }),
      listing({ price: 47.45, currency: 'AUD', seller: 'Amazon AU' }),
      listing({ price: 30, currency: 'USD', seller: 'Amazon US' }),
    ])
    expect(stats.usableCount).toBe(1)
    expect(stats.droppedNonNzd).toBe(2)
    expect(stats.maxPrice).toBe(59.99)
  })

  it('价格非正数不参与', () => {
    const stats = summariseListings([listing({ price: 0 }), listing({ price: -5 })])
    expect(stats.usableCount).toBe(0)
    expect(stats.minPrice).toBeNull()
  })

  it('卖家名为 null 的条目算价格但不算商家', () => {
    const stats = summariseListings([
      listing({ seller: null }), listing({ seller: null }), listing({ seller: 'PB Tech' }),
    ])
    expect(stats.usableCount).toBe(3)
    expect(stats.distinctSellers).toBe(1)
  })
})

describe('normalizeLocalMarket', () => {
  it('≥3 个商家 → 给中位价，来源里写明几条几家', () => {
    const evidence = normalizeLocalMarket(realBand(), 'NZ', SOURCE, AT)
    expect(evidence.medianPriceNzd.value).toBe(58)
    expect(evidence.listingCount.value).toBe(5)
    expect(evidence.medianPriceNzd.source).toContain('5 条 / 5 个商家')
  })

  it('🔴 只有 2 个商家 → 中位价必须是 null，不许给一个看着很确定的数', () => {
    const thin = [
      listing({ price: 40, seller: 'PB Tech' }),
      listing({ price: 60, seller: 'PB Tech' }),
      listing({ price: 50, seller: 'Briscoes' }),
    ]
    const evidence = normalizeLocalMarket(thin, 'NZ', SOURCE, AT)
    expect(evidence.medianPriceNzd.value).toBeNull()
    expect(evidence.medianPriceNzd.source).toContain('不足以定价')
    // 条目数照报 —— 「有几条」和「够不够定价」是两件事。
    expect(evidence.listingCount.value).toBe(3)
  })

  it('🔴 一条都没有 → 中位价 null、条目数 0，不抛错', () => {
    const evidence = normalizeLocalMarket([], 'NZ', SOURCE, AT)
    expect(evidence.medianPriceNzd.value).toBeNull()
    expect(evidence.listingCount.value).toBe(0)
  })

  it('🔴 倾销一律 null（不是 false）—— 填 false 会让一票否决闸假装通过', () => {
    const evidence = normalizeLocalMarket(realBand(), 'NZ', SOURCE, AT)
    expect(evidence.hasDumping.value).toBeNull()
    expect(evidence.hasDumping.value).not.toBe(false)
    expect(evidence.hasDumping.source).toContain('Trade Me')
  })

  it('🔴 中位价标 derived 不是 observed —— 这是关联商品的价格带，不是单品售价', () => {
    const evidence = normalizeLocalMarket(realBand(), 'NZ', SOURCE, AT)
    expect(evidence.medianPriceNzd.provenance).toBe('derived')
    expect(evidence.listingCount.provenance).toBe('observed')
  })

  it('🔴 非 NZD 不参与中位数，也不折算', () => {
    const mixed = [
      ...realBand(),
      listing({ price: 999, currency: 'AUD', seller: 'Amazon AU' }),
      listing({ price: 888, currency: 'USD', seller: 'Amazon US' }),
    ]
    const evidence = normalizeLocalMarket(mixed, 'NZ', SOURCE, AT)
    // 中位数与纯 NZD 那批一致，说明外币那两条没混进来。
    expect(evidence.medianPriceNzd.value).toBe(58)
    expect(evidence.listingCount.value).toBe(5)
  })

  it('偶数条取中间两个的均值', () => {
    const four = [
      listing({ price: 10, seller: 'A' }),
      listing({ price: 20, seller: 'B' }),
      listing({ price: 30, seller: 'C' }),
      listing({ price: 40, seller: 'D' }),
    ]
    expect(normalizeLocalMarket(four, 'NZ', SOURCE, AT).medianPriceNzd.value).toBe(25)
  })
})

// ─── 接进判定：这一段盯的是「接上之后判定真的动了」，不是各闸自己的逻辑 ───

const ASSUMPTIONS: Omit<CostAssumptions, 'chargeableWeightKg'> = {
  fxUsdToNzd: 1.6981,
  freightNzdPerKg: 2.0,
  importLevyNzd: 2.21,
  dutyRatePct: 0,
  domesticDeliveryNzd: 3.99,
  paymentFeePct: 2.9,
  paymentFeeFixedNzd: 0.3,
  gstRatePct: 15,
  asOf: '2026-08-16',
}

function m<T>(value: T | null): Measured<T> {
  return { value, provenance: 'observed', source: 'test', collectedAt: AT }
}

/** 搭电宝一体机 —— 2026-08-16 实扫，证据最硬的那个候选。 */
function jumpStarter(localListings: readonly LocalListing[]): ProductCandidate {
  return {
    source: {
      provider: 'tiktok_shop_us',
      sourceProductId: 'p1',
      sourceUrl: 'https://www.tiktok.com/shop/pdp/p1',
      runId: 'run1',
      collectedAt: AT,
    },
    title: 'Jump Starter + Inflator',
    retailPriceUsd: m(42.99),
    cumulativeSold: m(333_210),
    rating: m(4.6),
    imageUrl: 'https://example.test/a.jpg',
    chargeableWeightKg: m(1.2),
    sourcing: {
      medianUnitCostUsd: { value: 18.84, provenance: 'derived', source: 'test', collectedAt: AT },
      matchCount: m(25),
      minOrderQty: m(1),
      topSuppliers: ['Zhejiang Test Co., Ltd.'],
    },
    localMarket: normalizeLocalMarket(localListings, 'NZ', SOURCE, AT),
    demand: [
      { market: 'AU', monthlySearches: m(12_100), trajectory: m('rising' as const), cpcUsd: m(1.13), competition: m<number>(null) },
      { market: 'NZ', monthlySearches: m(2_400), trajectory: m('rising' as const), cpcUsd: m(0.32), competition: m<number>(null) },
    ],
  }
}

/** 5 家零售商，中位 NZ$129.9。 */
function healthyBand(): LocalListing[] {
  return [
    listing({ price: 99, seller: 'Supercheap Auto NZ' }),
    listing({ price: 119, seller: 'Repco' }),
    listing({ price: 129.9, seller: 'PB Tech' }),
    listing({ price: 149, seller: 'Sydney Tools NZ' }),
    listing({ price: 189, seller: 'MightyApe.co.nz' }),
  ]
}

describe('本地价污染校验：本地中位远超美国售价 = 品类词混错品类', () => {
  // 实测数字：cat water fountain 混入庭院喷泉，本地 NZ$1659.5，美国 US$41.97（23×）。
  function pollutedFountain(medianNzd: number): ProductCandidate {
    const c = jumpStarter(healthyBand())
    return {
      ...c,
      retailPriceUsd: m(41.97),
      localMarket: normalizeLocalMarket(
        // 5 家不同商家都报高价 → 中位过闸，但价本身是错品类拉爆的。
        [41.97, medianNzd, medianNzd, medianNzd, medianNzd].map((p, i) =>
          listing({ price: p, seller: `Shop${i}` })),
        'NZ', SOURCE, AT,
      ),
    }
  }

  it('🔴 本地中位是美国售价的 23× → unit_economics 判 UNKNOWN，不冒充毛利', () => {
    const g = scoreCandidate(pollutedFountain(1659.5), ASSUMPTIONS)
      .gates.find((x) => x.gate === 'unit_economics')!
    expect(g.outcome).toBe('UNKNOWN')
    expect(g.reason).toContain('高价错品类')
    expect(g.reason).toContain('23.3×')
  })

  it('🔴 污染候选整体判不了，不进「值得测/观察」', () => {
    expect(scoreCandidate(pollutedFountain(1659.5), ASSUMPTIONS).verdict).toBe('UNKNOWN')
  })

  it('本地价合理（1.9× 榨汁杯）不受影响，正常判定', () => {
    const blender = {
      ...jumpStarter(healthyBand()),
      retailPriceUsd: m(15.86),
      localMarket: normalizeLocalMarket(
        [45, 48, 50.14, 52, 55].map((p, i) => listing({ price: p, seller: `Shop${i}` })),
        'NZ', SOURCE, AT,
      ),
    }
    const g = scoreCandidate(blender, ASSUMPTIONS)
      .gates.find((x) => x.gate === 'unit_economics')!
    expect(g.outcome).not.toBe('UNKNOWN')   // 1.9× 远低于 4× 上限，正常算
    expect(g.reason).not.toContain('错品类')
  })
})

describe('接进判定', () => {
  it('拿到本地价带后，毛利闸走完整模型并通过（不再退回粗筛）', () => {
    const scored = scoreCandidate(jumpStarter(healthyBand()), ASSUMPTIONS)
    const gate = scored.gates.find((g) => g.gate === 'unit_economics')!
    expect(gate.outcome).toBe('PASS')
    expect(gate.reason).toContain('本地售价 NZ$129.90')
    expect(gate.reason).toContain('需要转化率')
    // 走了完整模型就不会再出现粗筛的措辞。
    expect(gate.reason).not.toContain('粗筛')
  })

  it('🔴 倾销未检测 → 判定停在 WATCH，**不许**是 TEST_NOW', () => {
    const scored = scoreCandidate(jumpStarter(healthyBand()), ASSUMPTIONS)
    expect(scored.verdict).toBe('WATCH')
    expect(scored.gates.find((g) => g.gate === 'no_local_dumping')?.outcome).toBe('UNKNOWN')
  })

  it('🔴 有本地价但判不了倾销时，如实说明价与条数，不谎报「没查本地」', () => {
    const gate = scoreCandidate(jumpStarter(healthyBand()), ASSUMPTIONS)
      .gates.find((g) => g.gate === 'no_local_dumping')!
    expect(gate.reason).toContain('本地 5 条在售')
    expect(gate.reason).toContain('NZ$129.90')
    expect(gate.reason).not.toContain('没查本地在售情况')
  })

  it('🔴 价带太薄（2 家）→ 毛利闸判 UNKNOWN，**不是 FAIL**（否则就是误杀）', () => {
    const thin = [
      listing({ price: 99, seller: 'Repco' }),
      listing({ price: 129.9, seller: 'PB Tech' }),
    ]
    const scored = scoreCandidate(jumpStarter(thin), ASSUMPTIONS)
    const gate = scored.gates.find((g) => g.gate === 'unit_economics')!
    expect(gate.outcome).toBe('UNKNOWN')
    expect(gate.outcome).not.toBe('FAIL')
    expect(gate.reason).toContain('新西兰售价')
    expect(scored.verdict).toBe('UNKNOWN')
  })

  it('本地价带压得极低时，毛利转负 → 毛利闸 FAIL，整体 REJECT', () => {
    const crushed = [
      listing({ price: 24, seller: 'Repco' }),
      listing({ price: 26, seller: 'PB Tech' }),
      listing({ price: 28, seller: 'Briscoes' }),
    ]
    const scored = scoreCandidate(jumpStarter(crushed), ASSUMPTIONS)
    expect(scored.gates.find((g) => g.gate === 'unit_economics')?.outcome).toBe('FAIL')
    expect(scored.verdict).toBe('REJECT')
  })
})
