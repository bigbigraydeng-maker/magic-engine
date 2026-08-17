import { describe, it, expect } from 'vitest'
import { scoreCandidate, rankCandidates } from '../score'
import type { CostAssumptions } from '../landed-cost'
import type {
  LocalMarketEvidence,
  MarketDemand,
  Measured,
  ProductCandidate,
  SourcingEvidence,
} from '../types'

const AT = '2026-08-16T00:00:00.000Z'

/** PM 2026-08-15 提供的真实费率。 */
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

function demand(
  market: 'AU' | 'NZ',
  searches: number | null,
  trajectory: 'rising' | 'flat' | 'declining' | null,
  cpcUsd: number | null = 0.13,
): MarketDemand {
  return {
    market,
    monthlySearches: m(searches),
    trajectory: m(trajectory),
    cpcUsd: m(cpcUsd),
    competition: m<number>(null),
  }
}

function sourcing(costUsd: number | null): SourcingEvidence {
  return {
    medianUnitCostUsd: { value: costUsd, provenance: 'derived', source: 'test', collectedAt: AT },
    matchCount: m(costUsd === null ? 0 : 25),
    minOrderQty: m(1),
    topSuppliers: ['Zhejiang Test Co., Ltd.'],
  }
}

function localMarket(
  medianPriceNzd: number | null,
  hasDumping: boolean | null,
  listingCount: number | null = 7,
): LocalMarketEvidence {
  return {
    market: 'NZ',
    medianPriceNzd: m(medianPriceNzd),
    listingCount: m(listingCount),
    hasDumping: m(hasDumping),
  }
}

/** 基准 = 候选 #2 搭电宝一体机（2026-08-16 实扫真实数据，证据最硬的一个）。 */
function candidate(over: Partial<ProductCandidate> = {}): ProductCandidate {
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
    sourcing: sourcing(18.84),         // ¥127 ≈ NZ$31.99 ≈ US$18.84
    localMarket: localMarket(129.9, false),
    demand: [demand('AU', 12_100, 'rising', 1.13), demand('NZ', 2_400, 'rising', 0.32)],
    ...over,
  }
}

/** 候选 #1 车载胎压泵 —— 用来盯「倍数低但完整模型可行」这条回归。 */
function tyreInflator(over: Partial<ProductCandidate> = {}): ProductCandidate {
  return candidate({
    title: 'Portable Tyre Inflator',
    retailPriceUsd: m(47.98),
    cumulativeSold: m(178_548),
    chargeableWeightKg: m(0.8),
    sourcing: sourcing(6.08),          // ¥41 ≈ NZ$10.33 ≈ US$6.08
    localMarket: localMarket(59.9, false),
    demand: [demand('AU', 4400, 'rising', 0.48), demand('NZ', 590, 'rising', 0.22)],
    ...over,
  })
}

const score = (c: ProductCandidate) => scoreCandidate(c, ASSUMPTIONS)
const gateOf = (c: ProductCandidate, id: string) =>
  score(c).gates.find((g) => g.gate === id)

describe('五道闸', () => {
  it('证据齐全且都达标 → TEST_NOW', () => {
    const s = score(candidate())
    expect(s.verdict).toBe('TEST_NOW')
    expect(s.gates.every((g) => g.outcome === 'PASS')).toBe(true)
  })

  it('累计销量不足 → REJECT', () => {
    expect(score(candidate({ cumulativeSold: m(108) })).verdict).toBe('REJECT')
  })

  it('🔴 销量为 null（取不到）跟销量为 0（真没卖）走向必须相反', () => {
    expect(gateOf(candidate({ cumulativeSold: m<number>(null) }), 'proven_demand')?.outcome)
      .toBe('UNKNOWN')
    expect(gateOf(candidate({ cumulativeSold: m(0) }), 'proven_demand')?.outcome).toBe('FAIL')
  })

  it('澳新两地都在跌 → REJECT；有一地不跌就放行', () => {
    expect(score(candidate({
      demand: [demand('AU', 4400, 'declining'), demand('NZ', 590, 'declining')],
    })).verdict).toBe('REJECT')
    expect(score(candidate({
      demand: [demand('AU', 4400, 'declining'), demand('NZ', 590, 'flat')],
    })).verdict).toBe('TEST_NOW')
  })

  it('搜索量按 AU+NZ 合计判', () => {
    const g = gateOf(candidate({
      demand: [demand('AU', 150, 'flat'), demand('NZ', 120, 'flat')],
    }), 'aunz_searched')
    expect(g?.outcome).toBe('PASS')
    expect(g?.reason).toContain('270')
  })

  it('🔴 门槛放宽到 100（PM 2026-08-16）：合计 150 过、合计 50 砍', () => {
    // 过去 200 门槛会把外溢需求（合计 150）误砍，现在放行。
    expect(gateOf(candidate({
      demand: [demand('AU', 90, 'flat'), demand('NZ', 60, 'flat')],
    }), 'aunz_searched')?.outcome).toBe('PASS')
    // 但真的太薄（合计 50）仍然砍 —— 松的是门槛，不是拆掉这道闸。
    expect(gateOf(candidate({
      demand: [demand('AU', 30, 'flat'), demand('NZ', 20, 'flat')],
    }), 'aunz_searched')?.outcome).toBe('FAIL')
  })

  it('🔴 一地取不到 + 另一地不足门槛 → UNKNOWN，绝不 FAIL（缺的可能顶过门槛）', () => {
    // 魏征复审实测的错杀场景：AU=null、NZ=80，旧代码判 FAIL→REJECT，错杀潜在赢家。
    expect(gateOf(candidate({
      demand: [demand('AU', null, 'flat'), demand('NZ', 80, 'flat')],
    }), 'aunz_searched')?.outcome).toBe('UNKNOWN')
    // 但已知那一地本身就够门槛 → 照样 PASS（缺的只会更多）。
    expect(gateOf(candidate({
      demand: [demand('AU', null, 'flat'), demand('NZ', 150, 'flat')],
    }), 'aunz_searched')?.outcome).toBe('PASS')
    // 两地都已知且真不足 → 才 FAIL。
    expect(gateOf(candidate({
      demand: [demand('AU', 30, 'flat'), demand('NZ', 20, 'flat')],
    }), 'aunz_searched')?.outcome).toBe('FAIL')
  })

  it('🔴 一地趋势取不到 + 另一地在跌 → UNKNOWN，不硬 FAIL（未知那地可能在涨）', () => {
    expect(gateOf(candidate({
      demand: [demand('AU', 4400, 'declining'), demand('NZ', 590, null)],
    }), 'aunz_not_declining')?.outcome).toBe('UNKNOWN')
    // 一地取不到但另一地在涨 → 放行。
    expect(gateOf(candidate({
      demand: [demand('AU', 4400, 'rising'), demand('NZ', 590, null)],
    }), 'aunz_not_declining')?.outcome).toBe('PASS')
    // 两地都已知且都在跌 → 才 FAIL。
    expect(gateOf(candidate({
      demand: [demand('AU', 4400, 'declining'), demand('NZ', 590, 'declining')],
    }), 'aunz_not_declining')?.outcome).toBe('FAIL')
  })

  it('🔴 本地有低价倾销 = 一票否决', () => {
    const s = score(candidate({ localMarket: localMarket(49.9, true, 20) }))
    expect(s.gates.find((g) => g.gate === 'no_local_dumping')?.outcome).toBe('FAIL')
    expect(s.verdict).toBe('REJECT')
  })
})

describe('单件经济闸（这道是判据本身）', () => {
  it('🔴 回归：搭电宝一体机不许被旧的 5× 门槛误杀 —— 完整模型 60% 毛利', () => {
    // 旧门槛：美国售价 US$42.99 ÷ 货价 US$18.84 = 2.3× → FAIL（误杀）。
    // 真实情形：新西兰卖 NZ$129.90（是美国价的 1.8 倍），毛利 60%。
    // 这就是「用美国售价当代理」最致命的地方 —— 两地价差越大，误杀越狠。
    expect(42.99 / 18.84).toBeLessThan(5)
    expect(gateOf(candidate(), 'unit_economics')?.outcome).toBe('PASS')
    expect(score(candidate()).verdict).toBe('TEST_NOW')
  })

  it('🔴 车载胎压泵在售价带上沿可行（旧门槛按美国价 7.9× 也放行，但理由是错的）', () => {
    // 旧门槛用美国售价当代理：47.98/6.08 = 7.9× 放行；
    // 而真实的纽币口径是 59.90/10.33 = 5.8× —— 两个口径给出不同的数，
    // 说明用哪国价格当分子本身就是个未定义的问题，倍数不能当判据。
    expect(gateOf(tyreInflator(), 'unit_economics')?.outcome).toBe('PASS')
  })

  it('🔴 同一个品，售价差 NZ$10 就翻盘 —— 证明单一倍数门槛不可能对', () => {
    // Trade Me 实测带 NZ$41.90–59.90：上沿可行，中位不可行。
    expect(gateOf(tyreInflator({ localMarket: localMarket(59.9, false) }),
      'unit_economics')?.outcome).toBe('PASS')
    expect(gateOf(tyreInflator({ localMarket: localMarket(49.9, false) }),
      'unit_economics')?.outcome).toBe('FAIL')
  })

  it('🔴 回归：便携榨汁机（需要 3.53% 转化率）必须被排除', () => {
    const blender = candidate({
      title: 'Portable Blender',
      retailPriceUsd: m(15.86),
      cumulativeSold: m(99_605),
      chargeableWeightKg: m(0.8),
      sourcing: sourcing(4.5),
      localMarket: localMarket(34.9, false),
      demand: [demand('AU', 8100, 'flat', 0.28), demand('NZ', 1600, 'rising', 0.28)],
    })
    expect(gateOf(blender, 'unit_economics')?.outcome).toBe('FAIL')
    expect(score(blender).verdict).toBe('REJECT')
  })

  it('本地售价低到毛利为负 → FAIL，且说明再高转化率也没用', () => {
    const g = gateOf(candidate({ localMarket: localMarket(39.9, false) }), 'unit_economics')
    expect(g?.outcome).toBe('FAIL')
    expect(g?.reason).toContain('救不回来')
  })

  it('优先用 NZ 的点击成本，NZ 缺失才退 AU', () => {
    const nzOnly = gateOf(candidate({
      demand: [demand('AU', 12_100, 'rising', 5.0), demand('NZ', 2_400, 'rising', 0.32)],
    }), 'unit_economics')
    expect(nzOnly?.reason).toContain('NZ$0.54')   // 0.32 × 1.6981

    const auFallback = gateOf(candidate({
      demand: [demand('AU', 12_100, 'rising', 0.48), demand('NZ', 2_400, 'rising', null)],
    }), 'unit_economics')
    expect(auFallback?.reason).toContain('NZ$0.82')  // 0.48 × 1.6981
  })
})

describe('缺新西兰售价时：既不能证实，也不能证伪', () => {
  it('🔴 缺完整数据 + 倍数尚可 → UNKNOWN，绝不给 PASS', () => {
    const g = gateOf(tyreInflator({ localMarket: null, chargeableWeightKg: m<number>(null) }),
      'unit_economics')
    expect(g?.outcome).toBe('UNKNOWN')
    expect(g?.reason).toContain('仅供参考')
  })

  it('🔴 倍数低也不许排除 —— 搭电宝 2.28× 但完整模型是 60% 毛利的赢家', () => {
    const noLocalPrice = candidate({ localMarket: null, chargeableWeightKg: m<number>(null) })
    // 42.99 / 18.84 = 2.28×，老的 3× 线会把它当垃圾扔掉。
    const g = gateOf(noLocalPrice, 'unit_economics')
    expect(g?.outcome).toBe('UNKNOWN')
    expect(g?.outcome).not.toBe('FAIL')
    expect(g?.reason).toContain('2.3×')

    // 同一个候选，把新西兰售价补上就通过 —— 证明当初排除它是误杀。
    expect(gateOf(candidate(), 'unit_economics')?.outcome).toBe('PASS')
  })

  it('🔴 倍数极低（2×）同样只判 UNKNOWN，不许 FAIL', () => {
    const g = gateOf(candidate({
      localMarket: null,
      chargeableWeightKg: m<number>(null),
      retailPriceUsd: m(12),
      sourcing: sourcing(6),
    }), 'unit_economics')
    expect(g?.outcome).toBe('UNKNOWN')
  })

  it('🔴 单件经济是核心闸，UNKNOWN 时整体判 UNKNOWN 不许降级成 WATCH', () => {
    expect(score(tyreInflator({ localMarket: null, chargeableWeightKg: m<number>(null) })).verdict)
      .toBe('UNKNOWN')
  })

  it('连货价都没有 → UNKNOWN', () => {
    expect(gateOf(candidate({ sourcing: null, localMarket: null }), 'unit_economics')?.outcome)
      .toBe('UNKNOWN')
  })
})

describe('保守估重：只缺重量时用它证实，不用它证伪', () => {
  // 只把重量抹掉，本地价/货价/点击成本都保留（= canary 里的真实处境）。
  const onlyWeightMissing = (over = {}) =>
    candidate({ chargeableWeightKg: m<number>(null), ...over })

  it('🔴 只缺重量、保守估重下仍能过 → PASS，且标注是估重', () => {
    const g = gateOf(onlyWeightMissing(), 'unit_economics')
    expect(g?.outcome).toBe('PASS')
    expect(g?.reason).toContain('保守估重 1kg')
    expect(g?.reason).toContain('实测更轻只会更好')
  })

  it('🔴 保守估重下过不了 → UNKNOWN，绝不 FAIL（可能只是估太重）', () => {
    // 本地价压到很低，1kg 估重把毛利挤到不够 —— 但真实更轻可能翻盘。
    const g = gateOf(onlyWeightMissing({ localMarket: localMarket(34.9, false) }),
      'unit_economics')
    expect(g?.outcome).toBe('UNKNOWN')
    expect(g?.outcome).not.toBe('FAIL')
    expect(g?.reason).toContain('实测更轻可能翻盘')
  })

  it('🔴 有真实重量时不走估重路径 —— reason 不带「估重」字样', () => {
    const g = gateOf(candidate(), 'unit_economics')   // 默认 weightKg=1.2
    expect(g?.outcome).toBe('PASS')
    expect(g?.reason).not.toContain('估重')
  })

  it('🔴 除重量外还缺别的（本地价）→ 不启用估重，退回粗筛 UNKNOWN', () => {
    const g = gateOf(onlyWeightMissing({ localMarket: null }), 'unit_economics')
    expect(g?.outcome).toBe('UNKNOWN')
    expect(g?.reason).toContain('仅供参考')   // 粗筛的措辞，不是估重的
  })

  it('估重 PASS 时整体仍停在 WATCH（倾销未验），不冒进 TEST_NOW', () => {
    // localMarket 有价但 hasDumping=null → no_local_dumping 判 UNKNOWN。
    const scored = score(onlyWeightMissing({ localMarket: localMarket(129.9, null) }))
    expect(gateOf(onlyWeightMissing({ localMarket: localMarket(129.9, null) }),
      'unit_economics')?.outcome).toBe('PASS')
    expect(scored.verdict).toBe('WATCH')
  })
})

describe('排序', () => {
  it('通过闸数优先于销量', () => {
    const strong = candidate({ cumulativeSold: m(1_500) })
    const weak = candidate({
      cumulativeSold: m(900_000),
      localMarket: localMarket(39.9, false),   // 毛利撑不住
    })
    const ranked = rankCandidates([weak, strong], ASSUMPTIONS)
    expect(ranked[0].candidate.cumulativeSold.value).toBe(1_500)
    expect(ranked[0].verdict).toBe('TEST_NOW')
  })
})
