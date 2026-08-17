/**
 * 新西兰本地售价 —— 回答「这个品在 NZ 卖多少钱是合理的」。
 *
 * 🔴 **挂牌价不等于合理价**（PM 2026-08-16 拍板）。Trade Me 这类挂牌市场看不到成交，
 *    商家可以无限挂牌，单条 listing 不含信息。所以定价**只认那些必须靠卖货活着的
 *    零售商**：他们出现在 Google 商品块里意味着投了 SEO / Shopping feed，
 *    价格离谱活不到搜索结果里。
 *
 * 🔴 **这是品类价格带，不是同款价。** 商品块回的是「关联产品」——
 *    同一个搜索词下的一批可比商品，规格、品牌、容量都可能不同。
 *    所以产出的是 `derived` 中位数，不是 `observed` 单品价，
 *    调用方展示时必须说清楚（跟澳新搜索量是同一个口径问题）。
 *
 * 🔴 **倾销这里判不了，一律 null。** 倾销的定义是「**同款**在贱卖」，
 *    而价格带里的低价条目分不清是「同款有人清库存」还是「另一款本来就便宜」——
 *    实测车载胎压泵带里 NZ$14.99 那条只是个小型号，不是倾销。
 *    分不清就不表态：`hasDumping` 保持 null（判 UNKNOWN），
 *    **绝不填 false** —— 填 false 会让一票否决闸假装通过。
 */

import type { LocalMarketEvidence, Measured, TargetMarket } from './types'

/**
 * 一条本地在售记录（已归一，与数据源无关）。
 * Trade Me 采集器将来接进来时产出同一个形状，判定逻辑不用改。
 */
export interface LocalListing {
  readonly title: string
  /** 标价（含 GST —— 消费者看到的数）。 */
  readonly price: number
  /** ISO 币种码。**不是 NZD 的一律丢弃，不折算** —— 折算需要汇率，会引入编造。 */
  readonly currency: string
  /** 卖家名，如 "PB Tech" / "The Warehouse"。用来数「几个独立商家」。 */
  readonly seller: string | null
  readonly url: string | null
}

/**
 * 至少要几个**不同商家**才敢给一个中位价。
 *
 * 🔴 单一商家的价格是那家店的定价策略，不是市场价。实测便携榨汁杯只回了 5 条，
 *    车载胎压泵回了 48 条 —— 厚度极不稳定，所以门槛必须显式，
 *    薄的时候宁可判「不知道」也不给一个看起来很确定的数。
 */
const MIN_DISTINCT_SELLERS = 3

/** 我们唯一接受的币种。 */
const ACCEPTED_CURRENCY = 'NZD'

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/** 卖家名归一 —— 大小写与首尾空白不同不算两个商家。 */
function sellerKey(seller: string | null): string | null {
  const trimmed = seller?.trim().toLowerCase()
  return trimmed ? trimmed : null
}

function measured<T>(
  value: T | null,
  provenance: 'observed' | 'derived',
  source: string,
  collectedAt: string,
): Measured<T> {
  return { value, provenance, source, collectedAt }
}

export interface LocalPriceStats {
  /** 参与计算的 NZD 条目数（已剔除非 NZD 与非正价）。 */
  readonly usableCount: number
  /** 不同商家数。 */
  readonly distinctSellers: number
  /** 因币种不是 NZD 被丢掉的条目数 —— **必须报出来**，静默丢弃会让人以为市场很薄。 */
  readonly droppedNonNzd: number
  readonly minPrice: number | null
  readonly maxPrice: number | null
}

/** 把一批本地在售记录压成统计量。纯函数，无 IO。 */
export function summariseListings(listings: readonly LocalListing[]): LocalPriceStats {
  const nzd = listings.filter(
    (l) => l.currency?.toUpperCase() === ACCEPTED_CURRENCY
      && Number.isFinite(l.price) && l.price > 0,
  )
  const prices = nzd.map((l) => l.price)
  const sellers = new Set(
    nzd.map((l) => sellerKey(l.seller)).filter((s): s is string => s !== null),
  )
  return {
    usableCount: nzd.length,
    distinctSellers: sellers.size,
    droppedNonNzd: listings.length - nzd.length,
    minPrice: prices.length > 0 ? Math.min(...prices) : null,
    maxPrice: prices.length > 0 ? Math.max(...prices) : null,
  }
}

/**
 * 一批本地在售记录 → 本地市场证据。
 *
 * 商家数不够门槛时 `medianPriceNzd.value` 为 null —— 毛利闸会据此退回粗筛判 UNKNOWN，
 * **不会** FAIL。缺数据不是坏消息。
 */
export function normalizeLocalMarket(
  listings: readonly LocalListing[],
  market: TargetMarket,
  source: string,
  collectedAt: string,
): LocalMarketEvidence {
  const stats = summariseListings(listings)
  // 有限性检查必须与 summariseListings 同口径 —— 否则 Infinity 会污染中位数而
  // 商家数/条数却已排除它，两处对不上。当前 popular-products 的 finite() 已保证，
  // 但 Trade Me 采集器将来接同一形状进来时来源不一定保证有限。
  const nzdPrices = listings
    .filter((l) => l.currency?.toUpperCase() === ACCEPTED_CURRENCY
      && Number.isFinite(l.price) && l.price > 0)
    .map((l) => l.price)

  const enoughSellers = stats.distinctSellers >= MIN_DISTINCT_SELLERS
  const thin = `只有 ${stats.distinctSellers} 个商家（门槛 ${MIN_DISTINCT_SELLERS}）`
  const medianSource = enoughSellers
    ? `${source} · ${stats.usableCount} 条 / ${stats.distinctSellers} 个商家`
    : `${source} · ${thin}，不足以定价`

  return {
    market,
    // derived 不是 observed：这是一批**关联商品**的中位数，不是这件商品的售价。
    medianPriceNzd: measured(
      enoughSellers ? median(nzdPrices) : null,
      'derived',
      medianSource,
      collectedAt,
    ),
    listingCount: measured(stats.usableCount, 'observed', source, collectedAt),
    // 见文件头：分不清「同款贱卖」和「另一款本来就便宜」，所以不表态。
    hasDumping: measured<boolean>(
      null,
      'observed',
      `${source} · 倾销需同款比价，商品块判不了（等 Trade Me 采集器）`,
      collectedAt,
    ),
  }
}
