/**
 * Magic Engine Commerce · Product Intelligence —— 最小 canonical 契约。
 *
 * 这一层**只读**：发现商品、比市场、给可解释判定。它不写任何客户资产，
 * 所以不进 `lib/capabilities/`、不注册 ActionKey、不过 Kernel。
 * （Kernel 管的是「会作用到客户资产之外」的动作 —— 见 lib/kernel/types.ts。）
 *
 * 🔴 **字段来源必须可回答**：每一个会影响判定的数值都带 Provenance。
 *    「AI 推断的」永远不许伪装成「平台观测到的事实」。v1 **一个 model 字段都没有** ——
 *    宁可 UNKNOWN 也不让模型猜。
 */

/** 一个数值是怎么来的。 */
export type ProvenanceKind =
  /** 平台直接返回的事实（TikTok 的 soldCount、1688 的报价） */
  | 'observed'
  /** 由 observed 值按明确公式算出来的（毛利倍数、velocity） */
  | 'derived'
  /** 模型判断的。**v1 不产出这一类** —— 留着是为了将来加 creative 信号时不改契约。 */
  | 'model'

/** 带来源的数值。`value === null` 表示**取不到**，不是 0。 */
export interface Measured<T> {
  readonly value: T | null
  readonly provenance: ProvenanceKind
  /** 人能看懂的来源说明，如 "TikTok Shop US · apify run abc123"。 */
  readonly source: string
  /** ISO 时间戳 —— 这个数是什么时候取的。 */
  readonly collectedAt: string
}

/** raw 数据的回溯指针 —— 「这条记录背后的原始响应在哪」。 */
export interface SourceRef {
  /** 数据源标识，如 'tiktok_shop_us' / 'alibaba_image_search'。 */
  readonly provider: string
  /** provider 内部的商品 id。 */
  readonly sourceProductId: string
  readonly sourceUrl: string
  /** Apify run id —— 原始 dataset 靠它找回来。 */
  readonly runId: string | null
  readonly collectedAt: string
}

/** 需求侧市场（我们真正要卖货的地方）。 */
export type TargetMarket = 'AU' | 'NZ'

/** 单个市场的需求证据。 */
export interface MarketDemand {
  readonly market: TargetMarket
  /** 月搜索量（Google，DataForSEO）。 */
  readonly monthlySearches: Measured<number>
  /** 12 个月搜索趋势轨迹。 */
  readonly trajectory: Measured<'rising' | 'flat' | 'declining'>
  /** 每次点击成本（USD）—— 作为「这个词值不值钱」和广告竞争的弱代理。 */
  readonly cpcUsd: Measured<number>
  /** 付费竞争密度 0–1。 */
  readonly competition: Measured<number>
}

/**
 * 目标市场的**本地在售**证据（Trade Me 等）。
 *
 * 🔴 这是判定的关键输入之一：我们卖货的价格由**新西兰市场**决定，不由美国售价决定。
 *    实测同一件便携榨汁机美国 TikTok US$15.86、新西兰 Trade Me NZ$29.90–34.90
 *    （高约 30%）——拿美国价当代理会系统性低估。
 */
export interface LocalMarketEvidence {
  readonly market: TargetMarket
  /** 本地在售价中位数（NZD，含 GST —— 消费者看到的标价）。 */
  readonly medianPriceNzd: Measured<number>
  /** 在售条目数。少 = 竞争弱。 */
  readonly listingCount: Measured<number>
  /**
   * 有没有低价倾销（标题带 CLEARANCE / OVER STOCKED，或价格显著低于主流带）。
   * **true 是一票否决级信号** —— 有人在不赚钱地清库存，你进去就是陪跑。
   */
  readonly hasDumping: Measured<boolean>
}

/** 中国供货端证据。来自以图搜款 —— 是**款式价格带**，不是这件商品的成本。 */
export interface SourcingEvidence {
  /** 近似款报价中位数（USD）。 */
  readonly medianUnitCostUsd: Measured<number>
  /** 找到几个近似款供应商。0 = 没找到同款货源。 */
  readonly matchCount: Measured<number>
  /** 最低起订量（取所有匹配里的最小值）。 */
  readonly minOrderQty: Measured<number>
  readonly topSuppliers: readonly string[]
}

/** 最小 Product Candidate。字段只保留真正影响判定的。 */
export interface ProductCandidate {
  readonly source: SourceRef
  readonly title: string
  /** 需求侧零售价（USD，TikTok Shop US 售价）。 */
  readonly retailPriceUsd: Measured<number>
  /** 累计已售件数。**不是近 30 天** —— 无时间窗切分，别拿它当增速。 */
  readonly cumulativeSold: Measured<number>
  readonly rating: Measured<number>
  readonly imageUrl: string | null
  /**
   * 计费重量（kg）= max(实重, 体积重)。空运/海运都按它计价。
   * 🔴 取不到就是 null —— 没有重量就算不出到岸成本，判定退回粗筛。
   */
  readonly chargeableWeightKg: Measured<number>
  /** 供货端证据。未跑以图搜款时为 null。 */
  readonly sourcing: SourcingEvidence | null
  /** 目标市场本地在售证据。未跑 Trade Me 时为 null。 */
  readonly localMarket: LocalMarketEvidence | null
  /** 澳新需求证据。未跑市场验证时为空数组。 */
  readonly demand: readonly MarketDemand[]
}

/** 判定四态。**没有 0–100 分** —— 数据支撑不了那个精度。 */
export type Verdict =
  /** 四道闸全过 —— 值得花小钱真投一次广告测。 */
  | 'TEST_NOW'
  /** 没有硬伤，但证据不够强，先观察。 */
  | 'WATCH'
  /** 至少一道闸明确不过。 */
  | 'REJECT'
  /** 关键输入取不到，**判不了**。不等于不好。 */
  | 'UNKNOWN'

export type GateId =
  /** 需求侧已被真实消费者验证（累计销量够大）。 */
  | 'proven_demand'
  /** 澳新真的有人在搜。 */
  | 'aunz_searched'
  /** 澳新需求趋势没在掉。 */
  | 'aunz_not_declining'
  /** 本地没有低价倾销。 */
  | 'no_local_dumping'
  /** 单件经济撑得起广告（完整到岸模型；数据不全时退回倍数粗筛，且只能证伪）。 */
  | 'unit_economics'

export type GateOutcome = 'PASS' | 'FAIL' | 'UNKNOWN'

/** 一道闸的判定结果。**reason 必须指向具体数值** —— 不许写「看起来不错」。 */
export interface GateResult {
  readonly gate: GateId
  readonly outcome: GateOutcome
  /** 判据说明，含实际数值与门槛。 */
  readonly reason: string
}

export interface ScoredCandidate {
  readonly candidate: ProductCandidate
  readonly verdict: Verdict
  readonly gates: readonly GateResult[]
  /** 排序用。**这是证据强度，不是预测销量** —— 越大只表示证据越齐越硬。 */
  readonly evidenceRank: number
}
