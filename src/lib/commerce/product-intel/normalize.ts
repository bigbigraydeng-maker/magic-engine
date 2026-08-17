/**
 * 归一化边界 —— raw actor 输出在这里变成 ProductCandidate，**只在这里**。
 *
 * 这个文件是唯一认识 actor 字段名的地方。业务逻辑（score.ts）一行都不许 import
 * lib/apify/*，换 actor 只改这里。
 *
 * 🔴 缺字段一律 `null`，**绝不填 0**。0 是「卖了零件」，null 是「不知道卖了多少」——
 *    两者在闸门里的走向完全相反（前者 FAIL，后者 UNKNOWN）。
 */

import type { RawTikTokShopProduct } from '@/lib/apify/tiktok-shop'
import type { RawSourcingMatch } from '@/lib/apify/sourcing-by-image'
import type {
  LocalMarketEvidence,
  Measured,
  ProductCandidate,
  ProvenanceKind,
  SourcingEvidence,
} from './types'

const TIKTOK_PROVIDER = 'tiktok_shop_us'
const SOURCING_PROVIDER = 'alibaba_image_search'

function measured<T>(
  value: T | null | undefined,
  provenance: ProvenanceKind,
  source: string,
  collectedAt: string,
): Measured<T> {
  return { value: value ?? null, provenance, source, collectedAt }
}

/** 把只在有限值域内有意义的数收窄；越界返回 null 而不是钳到边界。 */
function finiteNumber(input: unknown): number | null {
  return typeof input === 'number' && Number.isFinite(input) ? input : null
}

/**
 * TikTok Shop 一行 raw → ProductCandidate（此时还没有供货与需求证据）。
 */
export function normalizeTikTokProduct(
  raw: RawTikTokShopProduct,
  runId: string | null,
  collectedAt: string,
): ProductCandidate {
  const source = `TikTok Shop US · apify run ${runId ?? 'unknown'}`
  return {
    source: {
      provider: TIKTOK_PROVIDER,
      sourceProductId: raw.productId,
      sourceUrl: raw.productUrl,
      runId,
      collectedAt,
    },
    title: raw.title,
    retailPriceUsd: measured(finiteNumber(raw.price), 'observed', source, collectedAt),
    cumulativeSold: measured(finiteNumber(raw.soldCount), 'observed', source, collectedAt),
    rating: measured(finiteNumber(raw.rating), 'observed', source, collectedAt),
    imageUrl: raw.primaryImage ?? null,
    // TikTok Shop 不返回重量 —— 只能从中国供货端或实测样品拿，这里必须留空。
    chargeableWeightKg: measured<number>(null, 'observed', source, collectedAt),
    sourcing: null,
    localMarket: null,
    demand: [],
  }
}

/** 把计费重量挂到候选上（来自 1688 或实测样品）。 */
export function withChargeableWeight(
  candidate: ProductCandidate,
  weightKg: number | null,
  source: string,
  collectedAt: string,
): ProductCandidate {
  return {
    ...candidate,
    chargeableWeightKg: measured(weightKg, 'observed', source, collectedAt),
  }
}

/** 把本地在售证据挂到候选上（来自 Trade Me 等）。 */
export function withLocalMarket(
  candidate: ProductCandidate,
  localMarket: LocalMarketEvidence,
): ProductCandidate {
  return { ...candidate, localMarket }
}

/** 起订量 actor 回的是字符串（如 "2"）；解不出整数就是 null。 */
function parseMoq(input: string | undefined): number | null {
  if (!input) return null
  const parsed = Number.parseInt(input, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * 以图搜款结果 → 供货证据。
 *
 * 🔴 中位数标 `derived` 不是 `observed`：反向搜图回的是**近似款**，
 *    这是「这个款式在中国的价格带」，不是「这件商品的成本」。
 */
export function normalizeSourcing(
  matches: readonly RawSourcingMatch[],
  runId: string | null,
  collectedAt: string,
): SourcingEvidence {
  const source = `Alibaba 以图搜款 · apify run ${runId ?? 'unknown'}`
  const prices = matches
    .map((m) => finiteNumber(m.price))
    .filter((p): p is number => p !== null && p > 0)
  const moqs = matches
    .map((m) => parseMoq(m.minOrderQty))
    .filter((q): q is number => q !== null)

  return {
    medianUnitCostUsd: measured(median(prices), 'derived', source, collectedAt),
    matchCount: measured(matches.length, 'observed', source, collectedAt),
    minOrderQty: measured(moqs.length > 0 ? Math.min(...moqs) : null, 'observed', source, collectedAt),
    topSuppliers: Array.from(
      new Set(matches.map((m) => m.supplierName).filter((s): s is string => !!s)),
    ).slice(0, 5),
  }
}

/** 把供货证据挂到候选上（候选本身不可变，返回新对象）。 */
export function withSourcing(
  candidate: ProductCandidate,
  sourcing: SourcingEvidence,
): ProductCandidate {
  return { ...candidate, sourcing }
}
