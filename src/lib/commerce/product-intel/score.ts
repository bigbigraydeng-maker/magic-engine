/**
 * 五道闸 + 判定 —— Product Intelligence 的全部业务逻辑，纯函数，无 IO。
 *
 * 🔴 **这不是销量预测模型，是排除模型。** 没人能预测一个品会不会爆；能确定的是
 *    「美国已被消费者验证 + 澳新有人搜且没在跌 + 本地没人倾销 + 单件经济撑得起广告」
 *    这几条同时不成立时**不值得测**。判定的作用是把候选压到少数几个，真正的判据是
 *    之后那 NZ$200 广告跑 48 小时 —— 那一段属于 DAPE 的 E（执行），不在这个文件里。
 *
 * 🔴 **缺数据一律 UNKNOWN，不猜、不给默认值。** UNKNOWN ≠ 不好。
 */

import {
  requiredConversionRatePct,
} from './ad-economics'
import {
  calculateLandedCost,
  priceBreakdown,
} from './landed-cost'
import type { CostAssumptions } from './landed-cost'
import type {
  GateResult,
  MarketDemand,
  ProductCandidate,
  ScoredCandidate,
  Verdict,
} from './types'

/**
 * 累计销量门槛。1,000 件 = 已经过了「几个朋友捧场」的量级，
 * 是真实消费者反复买出来的。
 */
const MIN_CUMULATIVE_SOLD = 1_000

/**
 * 澳新月搜索量合计的**测试可行下限** —— 不是「有没有需求」的线，
 * 是「一次 NZ$200 测试能不能在合理时间内跑出转化信号」的线。
 *
 * 🔴 2026-08-16 PM 拍板适度放宽 200 → 100（五道闸里只松这一道低风险的）：
 *    TikTok Shop 在 NZ 没开，需求外溢到 Google 时搜索量会系统性偏低
 *    （被种草但还没养成搜的习惯），200 会把这批外溢需求误砍 —— 而它正是套利窗口。
 *    100 仍撑得起测试：NZ 点击成本实测 ~0.3，NZ$200 约 660 次点击，
 *    一个月碰得到的相关搜索够看出转化信号；低于 100 不是赚不到，是测试周期太长。
 *
 *    🔴 **需求验证（美国销量）与倾销那两道硬门槛没动。** 松的只是这一道。
 */
const MIN_AUNZ_MONTHLY_SEARCHES = 100

/**
 * 电商在 Meta 上的转化率中位数（%）。**这是门槛，不是预测。**
 *
 * 判据是「这个品需要的转化率有没有超过中位水平」——超过就意味着
 * **你必须比一半的电商投手更强才能不亏**，那不是一个该拿真钱去赌的起点。
 *
 * 🔴 别把它当成"我们会做到 1.57%"。我们**没有任何自有电商转化率数据**
 *    （CTS 是旅游留资、Oztop 是建材），这个数只能当刻度用，
 *    真值要靠第一次投放买回来，买回来之后就该换掉它。
 */
const MEDIAN_ECOMMERCE_CVR_PCT = 1.57

/**
 * 🔴 **没有新西兰售价时，倍数连"证伪"都做不到** —— 2026-08-16 第二次实测推翻了
 *    原来那条 3× 排除线。
 *
 *    搭电宝一体机：美国售价 US$42.99 ÷ 中国货价 US$18.84 = **2.28×**，会被 3× 线排除；
 *    但它在新西兰卖 NZ$129.90，完整模型算出来是 **60% 毛利、只需要 0.8% 转化率**，
 *    是整批里最好的一个。
 *
 *    根因跟当初 5× 毛利闸误杀是同一个：**分子用错了市场**。我们的收入由新西兰售价
 *    决定，而两地价差实测可达 1.78 倍（NZ$129.90 vs US$42.99×1.6981 = NZ$73.01）。
 *    美国那边的倍数低，只说明美国那个市场加价少，跟我们能不能赚钱无关。
 *
 *    所以缺新西兰售价时**一律 UNKNOWN**：倍数照算、照写进 reason 供人参考，
 *    但**不作判据**。要排除，就得先把新西兰售价取到。
 */

function gateProvenDemand(candidate: ProductCandidate): GateResult {
  const sold = candidate.cumulativeSold.value
  if (sold === null) {
    return { gate: 'proven_demand', outcome: 'UNKNOWN', reason: '平台没有返回累计销量' }
  }
  return {
    gate: 'proven_demand',
    outcome: sold >= MIN_CUMULATIVE_SOLD ? 'PASS' : 'FAIL',
    reason: `美国累计已售 ${sold.toLocaleString()} 件（门槛 ${MIN_CUMULATIVE_SOLD.toLocaleString()}）`,
  }
}

/** 已知市场的搜索量之和 + 有没有市场取不到。区分两者是为了别拿残缺和硬判 FAIL。 */
function totalSearches(demand: readonly MarketDemand[]): { knownSum: number | null; hasNull: boolean } {
  let knownSum = 0
  let knownCount = 0
  let hasNull = false
  for (const d of demand) {
    const v = d.monthlySearches.value
    if (v === null) hasNull = true
    else { knownSum += v; knownCount += 1 }
  }
  return { knownSum: knownCount === 0 ? null : knownSum, hasNull }
}

function gateAuNzSearched(demand: readonly MarketDemand[]): GateResult {
  const { knownSum, hasNull } = totalSearches(demand)
  if (knownSum === null) {
    return { gate: 'aunz_searched', outcome: 'UNKNOWN', reason: '澳新搜索量取不到' }
  }
  const label = `AU+NZ 月搜索量合计 ${knownSum.toLocaleString()}（门槛 ${MIN_AUNZ_MONTHLY_SEARCHES}）`
  if (knownSum >= MIN_AUNZ_MONTHLY_SEARCHES) {
    return { gate: 'aunz_searched', outcome: 'PASS', reason: label }
  }
  // 🔴 已知和不足门槛，但若有市场取不到，缺的那个可能把合计顶过门槛 —— 判不了，
  //    绝不 FAIL（FAIL→REJECT 会错杀潜在赢家，尤其低搜索量外溢品这条带）。
  if (hasNull) {
    return {
      gate: 'aunz_searched',
      outcome: 'UNKNOWN',
      reason: `已知市场合计 ${knownSum.toLocaleString()} 不足门槛 ${MIN_AUNZ_MONTHLY_SEARCHES}，`
        + `但有市场搜索量取不到，可能顶过门槛 —— 判不了`,
    }
  }
  return { gate: 'aunz_searched', outcome: 'FAIL', reason: label }
}

function gateNotDeclining(demand: readonly MarketDemand[]): GateResult {
  const known = demand
    .map((d) => ({ market: d.market, value: d.trajectory.value }))
    .filter((t): t is { market: 'AU' | 'NZ'; value: 'rising' | 'flat' | 'declining' } =>
      t.value !== null)

  if (known.length === 0) {
    return { gate: 'aunz_not_declining', outcome: 'UNKNOWN', reason: '澳新趋势曲线取不到' }
  }
  const detail = known.map((t) => `${t.market}=${t.value}`).join(' · ')
  // 有任一市场不在跌 → 放行（这道闸只否决"全在跌"）。
  if (known.some((t) => t.value !== 'declining')) {
    return { gate: 'aunz_not_declining', outcome: 'PASS', reason: `12 个月轨迹 ${detail}` }
  }
  // 🔴 已知的都在跌，但若还有市场取不到，未知那个可能在涨 —— 判不了，不硬 FAIL。
  //    只有所有市场都已知且都在跌，才是铁的 FAIL。
  if (known.length < demand.length) {
    return {
      gate: 'aunz_not_declining',
      outcome: 'UNKNOWN',
      reason: `已知市场都在跌（${detail}），但有市场趋势取不到 —— 判不了`,
    }
  }
  return { gate: 'aunz_not_declining', outcome: 'FAIL', reason: `12 个月轨迹 ${detail}` }
}

/**
 * 本地倾销 —— 一票否决。
 *
 * 实测形态：Trade Me 上一批标着 "NZ CLEARANCE" / "OVER STOCKED" 的同款，
 * 价格只有主流带的三分之一。那是有人在不赚钱地清库存，进去就是陪跑。
 */
function gateNoDumping(candidate: ProductCandidate): GateResult {
  const local = candidate.localMarket
  const dumping = local?.hasDumping.value ?? null
  if (dumping === null) {
    // 🔴 「查到了本地价但判不了倾销」≠「根本没查本地」。Google 商品块给得出价、
    //    给不出同款倾销判断（见 local-price.ts），此时如实说清，别谎报「没查」。
    const listings = local?.listingCount.value ?? null
    const reason = local && listings !== null
      ? `本地 ${listings} 条在售、中位 NZ$${local.medianPriceNzd.value?.toFixed(2) ?? '—'}，`
        + `但倾销需同款比价，商品块判不了（等 Trade Me）`
      : '没查本地在售情况'
    return { gate: 'no_local_dumping', outcome: 'UNKNOWN', reason }
  }
  const listings = candidate.localMarket?.listingCount.value
  const detail = listings === null || listings === undefined
    ? ''
    : `（本地 ${listings} 条在售）`
  return {
    gate: 'no_local_dumping',
    outcome: dumping ? 'FAIL' : 'PASS',
    reason: dumping ? `本地已有低价倾销${detail}` : `本地没有倾销迹象${detail}`,
  }
}

/** 优先用 NZ 的点击成本；没有就退 AU。返回 NZD。 */
function clickCostNzd(
  demand: readonly MarketDemand[],
  fxUsdToNzd: number,
): number | null {
  const pick = (m: 'NZ' | 'AU'): number | null =>
    demand.find((d) => d.market === m)?.cpcUsd.value ?? null
  const usd = pick('NZ') ?? pick('AU')
  return usd === null || usd <= 0 ? null : usd * fxUsdToNzd
}

/**
 * 数据不全时**只报口径，不下判决** —— 永远返回 UNKNOWN。
 *
 * 见上方 COARSE 那段注释：美国倍数既不能证实也不能证伪，
 * 所以这里一个 PASS 和一个 FAIL 都不许出。
 */
function coarseScreen(candidate: ProductCandidate, missing: string): GateResult {
  const retailUsd = candidate.retailPriceUsd.value
  const costUsd = candidate.sourcing?.medianUnitCostUsd.value ?? null
  if (retailUsd === null || costUsd === null || costUsd <= 0) {
    return { gate: 'unit_economics', outcome: 'UNKNOWN', reason: `算不了：缺${missing}，也没有货价` }
  }
  const multiple = retailUsd / costUsd
  return {
    gate: 'unit_economics',
    outcome: 'UNKNOWN',
    reason: `判不了：缺${missing}。美国售价 ÷ 货价 = ${multiple.toFixed(1)}× 仅供参考 ——`
      + `我们的收入由新西兰售价决定，美国倍数低不代表这里赚不到钱`,
  }
}

/**
 * 单件经济 —— **这道闸是判据本身**。
 *
 * 完整路径需要四个输入：新西兰市场售价 · 中国货价 · 计费重量 · 点击成本。
 * 齐了就算「要做到多少转化率才不亏」，拿它跟中位水平比。
 *
 * 🔴 **为什么不再用固定的毛利倍数**：2026-08-16 实测两个赢家被 5× 闸误杀 ——
 *    车载胎压泵 4.8×（完整模型 54% 毛利）、搭电宝一体机 4.1×（60% 毛利）。
 *    原因是每单固定成本 NZ$6.50 **不随货价缩放**：价格越低倍数要求越高、
 *    价格越高倍数要求越低，**一个固定门槛在整条价格带上不可能都对**。
 *    倍数因此降级成粗筛，且只保留"证伪"这一半能力。
 */
/**
 * 保守估重（kg）—— **只在「只缺计费重量、其余三个输入都齐」时启用**。
 *
 * 🔴 **偏高是刻意的，因为它只能证实、不能证伪。** 往重里估 = 对我们不利
 *    （空运运费偏高 → 到岸偏高 → 毛利偏低），算出来的是**毛利下限**：
 *      · 下限都能过 → 真实（更轻）只会更好 → **稳健 PASS**
 *      · 下限过不了 → 可能只是估太重了 → 退 UNKNOWN 等实测，**绝不 FAIL**
 *    这样它和粗筛（只证伪不证实）正好对称，谁都不越权。
 *
 *    1.0kg 对 3C / 宠物这批轻小件普遍偏高（充电宝/手机配件实测多在 0.2–0.6kg），
 *    保证「过了就是真过」。带水泵的饮水机等偏重品可能被压到 UNKNOWN —— 那是
 *    安全的（退给实测），不冤枉谁。真要投的品仍须买样品实测称重换掉这个估值。
 *
 *    landed-cost.ts 的红线不变：它照样「拿到重量才算、null→null」，
 *    这里传进去的是一个**显式**估值，不是在 landed-cost 里埋默认。
 */
const CONSERVATIVE_WEIGHT_KG = 1.0

/** 用给定重量把单件经济算到底。`estimated` 决定它是完整判据还是只证实。 */
function evaluateUnitEconomics(
  nzPrice: number,
  costUsd: number,
  cpcNzd: number,
  weightKg: number,
  assumptions: Omit<CostAssumptions, 'chargeableWeightKg'>,
  estimated: boolean,
): GateResult {
  const full: CostAssumptions = { ...assumptions, chargeableWeightKg: weightKg }
  const landed = calculateLandedCost(costUsd, full)
  if (landed === null) {
    return { gate: 'unit_economics', outcome: 'UNKNOWN', reason: '到岸成本算不出来' }
  }
  const breakdown = priceBreakdown(nzPrice, landed, full)
  const required = requiredConversionRatePct(cpcNzd, {
    retailPriceNzd: nzPrice,
    grossProfitNzd: breakdown.grossProfitNzd,
  })

  // 毛利为负。真实重量下这是铁的 FAIL；估重下可能是估太重，退 UNKNOWN。
  if (required === null) {
    if (estimated) {
      return {
        gate: 'unit_economics',
        outcome: 'UNKNOWN',
        reason: `保守估重 ${weightKg}kg 下毛利为负（到岸 NZ$${landed.totalNzd.toFixed(2)}），`
          + `但重量是估的，实测更轻可能翻盘 —— 判不了，别急着排除`,
      }
    }
    return {
      gate: 'unit_economics',
      outcome: 'FAIL',
      reason: `按本地售价 NZ$${nzPrice.toFixed(2)} 算毛利为负`
        + `（到岸 NZ$${landed.totalNzd.toFixed(2)}），再高的转化率也救不回来`,
    }
  }

  const passes = required <= MEDIAN_ECOMMERCE_CVR_PCT
  const detail = `本地售价 NZ$${nzPrice.toFixed(2)} · 到岸 NZ$${landed.totalNzd.toFixed(2)}`
    + ` → 毛利 NZ$${breakdown.grossProfitNzd.toFixed(2)}（${breakdown.grossMarginPct.toFixed(0)}%）；`
    + `按点击成本 NZ$${cpcNzd.toFixed(2)} 需要转化率 ${required.toFixed(2)}%（中位 ${MEDIAN_ECOMMERCE_CVR_PCT}%）`

  if (!estimated) {
    return { gate: 'unit_economics', outcome: passes ? 'PASS' : 'FAIL', reason: detail }
  }
  // 估重：过了才 PASS（稳健，最坏都过）；没过退 UNKNOWN（可能估太重，不 FAIL）。
  return passes
    ? {
        gate: 'unit_economics',
        outcome: 'PASS',
        reason: `${detail}【保守估重 ${weightKg}kg，实测更轻只会更好】`,
      }
    : {
        gate: 'unit_economics',
        outcome: 'UNKNOWN',
        reason: `保守估重 ${weightKg}kg 下需要转化率 ${required.toFixed(2)}% 偏高（中位 `
          + `${MEDIAN_ECOMMERCE_CVR_PCT}%），但重量是估的，实测更轻可能翻盘 —— 判不了`,
      }
}

/**
 * 本地价合理性上限（本地中位 USD ÷ 美国单品售价）。**超过就判本地价污染。**
 *
 * 🔴 本地价用**品类词**查 Google 商品块，歧义词会把高价错品类混进来 ——
 *    2026-08-17 实测 "water fountain" 把庭院喷泉/商用饮水台混进猫饮水机，
 *    本地中位被拉到 NZ$1659–2505（是美国售价的 17–41×），毛利虚高到 NZ$1352，
 *    是最危险的假阳性。用美国**单品真实售价**当标尺校验：
 *      · 真候选（榨汁杯/狗碗/三脚架）实测全 ≤2.5×
 *      · 价格拉爆型污染全 ≥4×
 *    4× 落在干净空档里，剔污染碰不到真候选。被剔的判 UNKNOWN（退实测），不冤枉。
 *
 *    ⚠️ 它只抓「本地混入高价错品类」型污染；「整词就是错品类」型（water trough
 *    = 集雨桶，美国本地同为错品类、比值正常）它抓不到 —— 那要靠种子词层面收紧。
 */
const MAX_LOCAL_TO_US_RATIO = 4

function gateUnitEconomics(
  candidate: ProductCandidate,
  assumptions: Omit<CostAssumptions, 'chargeableWeightKg'>,
): GateResult {
  const nzPrice = candidate.localMarket?.medianPriceNzd.value ?? null
  const costUsd = candidate.sourcing?.medianUnitCostUsd.value ?? null
  const weightKg = candidate.chargeableWeightKg.value
  const cpcNzd = clickCostNzd(candidate.demand, assumptions.fxUsdToNzd)

  // 本地价合理性：中位换算成 USD 若远超美国单品售价，说明品类词混进了高价错品类，
  // 本地价不可信 —— 直接判不了，绝不拿污染价算出假毛利放行。
  const retailUsd = candidate.retailPriceUsd.value
  if (nzPrice !== null && retailUsd !== null && retailUsd > 0) {
    const ratio = (nzPrice / assumptions.fxUsdToNzd) / retailUsd
    if (ratio > MAX_LOCAL_TO_US_RATIO) {
      return {
        gate: 'unit_economics',
        outcome: 'UNKNOWN',
        reason: `本地中位 NZ$${nzPrice.toFixed(2)} 是美国售价 US$${retailUsd.toFixed(2)} 的 `
          + `${ratio.toFixed(1)}×，品类词疑似把高价错品类混进商品块 —— 本地价不可信，判不了`,
      }
    }
  }

  // 只缺计费重量、其余三个都齐 → 用保守估重跑一遍（只证实，不证伪）。
  if (weightKg === null && nzPrice !== null && costUsd !== null && cpcNzd !== null) {
    return evaluateUnitEconomics(nzPrice, costUsd, cpcNzd, CONSERVATIVE_WEIGHT_KG, assumptions, true)
  }

  const missing = [
    nzPrice === null ? '新西兰售价' : null,
    costUsd === null ? '中国货价' : null,
    weightKg === null ? '计费重量' : null,
    cpcNzd === null ? '点击成本' : null,
  ].filter((x): x is string => x !== null)

  if (missing.length > 0) return coarseScreen(candidate, missing.join('/'))

  return evaluateUnitEconomics(nzPrice!, costUsd!, cpcNzd!, weightKg!, assumptions, false)
}

/** 核心闸 —— 这几道 UNKNOWN 就判不了，不能降级成 WATCH。 */
const CORE_GATES = new Set(['proven_demand', 'aunz_searched', 'unit_economics'])

function decideVerdict(gates: readonly GateResult[]): Verdict {
  if (gates.some((g) => g.outcome === 'FAIL')) return 'REJECT'
  if (gates.every((g) => g.outcome === 'PASS')) return 'TEST_NOW'
  const coreUnknown = gates.some(
    (g) => g.outcome === 'UNKNOWN' && CORE_GATES.has(g.gate),
  )
  return coreUnknown ? 'UNKNOWN' : 'WATCH'
}

/**
 * 排序键。**这是证据强度，不是预测销量** ——
 * 先按通过的闸数，同数再按已售量。刻意不做成 0–100 分：
 * 那个精度我们的数据支撑不了，做出来只会被当成预测读。
 */
function evidenceRankOf(gates: readonly GateResult[], sold: number | null): number {
  const passCount = gates.filter((g) => g.outcome === 'PASS').length
  return passCount * 1_000_000 + Math.min(sold ?? 0, 999_999)
}

export function scoreCandidate(
  candidate: ProductCandidate,
  assumptions: Omit<CostAssumptions, 'chargeableWeightKg'>,
): ScoredCandidate {
  const gates: readonly GateResult[] = [
    gateProvenDemand(candidate),
    gateAuNzSearched(candidate.demand),
    gateNotDeclining(candidate.demand),
    gateNoDumping(candidate),
    gateUnitEconomics(candidate, assumptions),
  ]
  return {
    candidate,
    gates,
    verdict: decideVerdict(gates),
    evidenceRank: evidenceRankOf(gates, candidate.cumulativeSold.value),
  }
}

/** 批量打分并按证据强度降序。 */
export function rankCandidates(
  candidates: readonly ProductCandidate[],
  assumptions: Omit<CostAssumptions, 'chargeableWeightKg'>,
): readonly ScoredCandidate[] {
  return candidates
    .map((c) => scoreCandidate(c, assumptions))
    .sort((a, b) => b.evidenceRank - a.evidenceRank)
}
