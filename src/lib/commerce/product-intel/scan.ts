/**
 * 扫一个种子词 —— 端到端 IO 编排：TikTok US → 以图搜款 → 澳新需求 + 本地价 → 判定。
 *
 * 这是 commerce-poc（单词验证）与 commerce-scan-batch（批量）**共用的唯一实现**，
 * 避免两处各写一份 enrich 逻辑跑偏。分工同 validate-aunz / validate-local-price：
 * 这里是 IO 编排，判据纯逻辑在 score.ts。
 *
 * 🔴 需求与售价都是**品类级**（按种子词查一次，整批候选共用），不是单品级。
 *    展示层必须说清楚 —— 见 commerce-poc.ts 的 printMarketContext。
 */

import { searchTikTokShop } from '@/lib/apify/tiktok-shop'
import { findSourcingByImage } from '@/lib/apify/sourcing-by-image'
import {
  normalizeSourcing,
  normalizeTikTokProduct,
  withLocalMarket,
  withSourcing,
} from './normalize'
import { measureAuNzDemand } from './validate-aunz'
import { measureLocalPrice } from './validate-local-price'
import { rankCandidates } from './score'
import type { CostAssumptions } from './landed-cost'
import type { ProductCandidate, ScoredCandidate } from './types'

export interface ScanOptions {
  /** TikTok Shop 每个词取几条。 */
  readonly maxResults: number
  /** 其中销量前几条做供货 + 需求验证。 */
  readonly enrichCount: number
}

export interface SeedScanResult {
  readonly seedKeyword: string
  readonly scored: readonly ScoredCandidate[]
  /** 非空 = 这个词没扫成（TikTok 搜失败）；scored 必为空。 */
  readonly error?: string
}

/** 对 shortlist 补供货证据 + 澳新需求 + 本地价。需求/售价品类级，整批共用一次。 */
async function enrichCandidates(
  shortlist: readonly ProductCandidate[],
  seedKeyword: string,
): Promise<readonly ProductCandidate[]> {
  const [demand, localMarket] = await Promise.all([
    measureAuNzDemand(seedKeyword),
    measureLocalPrice(seedKeyword, 'NZ'),
  ])
  return Promise.all(
    shortlist.map(async (candidate) => {
      const base = withLocalMarket({ ...candidate, demand }, localMarket)
      if (!candidate.imageUrl) return base
      const sourcing = await findSourcingByImage(candidate.imageUrl)
      if (sourcing.error) return base
      const evidence = normalizeSourcing(
        sourcing.matches, sourcing.runId, new Date().toISOString(),
      )
      return withSourcing(base, evidence)
    }),
  )
}

/**
 * 扫一个种子词，返回按证据强度排好序的候选。
 *
 * TikTok 搜失败不抛错 —— 回 `{ scored: [], error }`，让批量调用方 skip 这个词继续，
 * 不中断整批。
 */
export async function scanSeedKeyword(
  seedKeyword: string,
  assumptions: Omit<CostAssumptions, 'chargeableWeightKg'>,
  opts: ScanOptions,
): Promise<SeedScanResult> {
  const search = await searchTikTokShop({
    keywords: [seedKeyword], region: 'US', maxResultsPerKeyword: opts.maxResults,
  })
  if (search.error) return { seedKeyword, scored: [], error: search.error }

  const collectedAt = new Date().toISOString()
  const all = search.products.map(
    (p) => normalizeTikTokProduct(p, search.runId, collectedAt),
  )
  const shortlist = [...all]
    .sort((a, b) => (b.cumulativeSold.value ?? 0) - (a.cumulativeSold.value ?? 0))
    .slice(0, opts.enrichCount)

  const enriched = await enrichCandidates(shortlist, seedKeyword)
  return { seedKeyword, scored: rankCandidates(enriched, assumptions) }
}
