/**
 * AI Visibility Tracker — weekly snapshot metrics (pure).
 *
 * The numbers that land in `ai_visibility_snapshots`: mention count, average
 * rank, models covered, engine coverage and the compact `ranking_table`.
 *
 * Kept free of I/O so the live orchestrator pass and any offline recompute
 * (e.g. after a correction to historical `client_brand_rank` values) share
 * one definition instead of two that drift apart.
 */

import { buildClientIdentifiers, isClientBrand, type ClientBrandIdentity } from './client-brand-match'
import type { BrandMention } from '@/types/magic-engine'

/** The per-run fields a snapshot is computed from. */
export interface SnapshotRun {
  ai_engine: string
  ai_model: string
  client_brand_rank: number | null
  brands_mentioned: BrandMention[]
}

export interface SnapshotMetrics {
  totalRuns: number
  mentionsCount: number
  avgRank: number | null
  modelsCovered: string[]
  /** Distinct engines where the client appeared at least once. */
  engineCoverage: number
  ranking_table: Record<string, unknown>
}

/** Every number a weekly snapshot row holds, from that week's runs. */
export function computeSnapshotMetrics(
  runs: readonly SnapshotRun[],
  identity: ClientBrandIdentity
): SnapshotMetrics {
  const totalRuns = runs.length
  const ranks = runs
    .map(r => r.client_brand_rank)
    .filter((r): r is number => r !== null)
  const mentionsCount = ranks.length
  const avgRank =
    mentionsCount > 0 ? ranks.reduce((a, b) => a + b, 0) / mentionsCount : null
  const modelsCovered = Array.from(new Set(runs.map(r => r.ai_model)))
  const engineCoverage = new Set(
    runs.filter(r => r.client_brand_rank !== null).map(r => r.ai_engine)
  ).size

  return {
    totalRuns,
    mentionsCount,
    avgRank,
    modelsCovered,
    engineCoverage,
    ranking_table: buildRankingTable(runs, identity),
  }
}

/** Aggregate brand mentions across all runs into a flat ranking table. */
export function buildRankingTable(
  runs: ReadonlyArray<{ ai_engine: string; brands_mentioned: BrandMention[] }>,
  identity?: ClientBrandIdentity
): Record<string, unknown> {
  const byBrand = new Map<
    string,
    { mentions: number; rankSum: number; byEngine: Record<string, number[]> }
  >()

  for (const run of runs) {
    const mentions = Array.isArray(run.brands_mentioned)
      ? run.brands_mentioned
      : []
    for (const m of mentions) {
      if (!m.brand) continue
      const key = m.brand.trim()
      if (!key) continue
      const entry = byBrand.get(key) ?? {
        mentions: 0,
        rankSum: 0,
        byEngine: {},
      }
      entry.mentions++
      entry.rankSum += m.rank
      const ranksForEngine = entry.byEngine[run.ai_engine] ?? []
      ranksForEngine.push(m.rank)
      entry.byEngine[run.ai_engine] = ranksForEngine
      byBrand.set(key, entry)
    }
  }

  // Merge brand name variants for the client (e.g. "CTS Tours" and
  // "CTS Tours - China Travel Service (NZ) Limited" → one canonical entry)
  if (identity) {
    mergeClientBrandVariants(byBrand, identity)
  }

  const brands = Array.from(byBrand.entries())
    .map(([name, e]) => ({
      name,
      mentions: e.mentions,
      avg_rank: e.mentions > 0 ? e.rankSum / e.mentions : null,
      by_engine: e.byEngine,
    }))
    .sort((a, b) => {
      // Higher mention count first, then lower avg_rank
      if (b.mentions !== a.mentions) return b.mentions - a.mentions
      return (a.avg_rank ?? 999) - (b.avg_rank ?? 999)
    })

  return { brands }
}

/**
 * Merge all brand-name variants of the client into a single canonical entry.
 * Uses the same client-identity rules as the parser (brand name, aliases,
 * domain), so every entry that set client_brand_rank lands in one row.
 */
function mergeClientBrandVariants(
  byBrand: Map<string, { mentions: number; rankSum: number; byEngine: Record<string, number[]> }>,
  identity: ClientBrandIdentity
): void {
  const canon = identity.brandName.trim()
  const ids = buildClientIdentifiers(identity)

  let canonicalKey = ''
  const variantKeys: string[] = []

  for (const key of Array.from(byBrand.keys())) {
    if (key.trim().toLowerCase() === canon.toLowerCase()) {
      canonicalKey = key
    } else if (isClientBrand(key, ids)) {
      variantKeys.push(key)
    }
  }

  if (variantKeys.length === 0) return

  const canonEntry = (canonicalKey ? byBrand.get(canonicalKey) : undefined) ?? {
    mentions: 0,
    rankSum: 0,
    byEngine: {} as Record<string, number[]>,
  }

  for (const variantKey of variantKeys) {
    const variant = byBrand.get(variantKey)
    if (!variant) continue
    canonEntry.mentions += variant.mentions
    canonEntry.rankSum += variant.rankSum
    for (const [engine, ranks] of Object.entries(variant.byEngine)) {
      canonEntry.byEngine[engine] = [...(canonEntry.byEngine[engine] ?? []), ...ranks]
    }
    byBrand.delete(variantKey)
  }

  if (canonicalKey && canonicalKey !== canon) byBrand.delete(canonicalKey)
  byBrand.set(canon, canonEntry)
}
