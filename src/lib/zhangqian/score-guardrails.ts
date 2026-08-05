/**
 * 张骞评分护栏 — 确定性兜底，纠正 LLM 抽风的评分。
 *
 * 即使 prompts.ts 里写明了硬性约束，LLM 在长上下文 + 多轮 tool call 后仍可能
 * 出现"5 星 + 2 条评价 = 45 分"这种折中错误（被星级拉高，没充分惩罚评价稀少）。
 *
 * 这里实现一个纯函数 clamp：根据 raw data 计算理论上限，把 LLM 给出的过高分数
 * 压回上限，保证落库数据符合产品定义。
 *
 * 上限规则与 prompts.ts:86-101 的硬性约束严格对齐 —— 改动这里也要同步改 prompt。
 */

import type { DiscoveryReport, DiscoveredReviewPlatform, SanityIssue } from './types'

// ─── 常量（与 prompts.ts 硬性约束对齐）────────────────────────────────────────

const REVIEW_THRESHOLD_TINY  = 5    // 全平台总评价 < 5 → cap 15
const REVIEW_THRESHOLD_FEW   = 20   // 全平台总评价 < 20 → cap 30
const REVIEW_THRESHOLD_OK    = 50   // 全平台总评价 < 50 → cap 50

const CAP_TINY = 15
const CAP_FEW  = 30
const CAP_OK   = 50

const SINGLE_PLATFORM_PENALTY = 10  // 只有 1 个平台覆盖时再 -10

const SCORE_DIMENSIONS = ['seo', 'social', 'reputation', 'ai_visibility'] as const

// ─── 工具函数 ────────────────────────────────────────────────────────────────

/** 总评价数 = 所有平台 review_count 之和（null 当 0）。GBP 已在 review_platforms 里就不重复加。 */
function sumReviews(platforms: DiscoveredReviewPlatform[]): number {
  return platforms.reduce((acc, p) => acc + (p.review_count ?? 0), 0)
}

/** 有效平台数 = 拥有 ≥1 条评价的平台去重数。 */
function countActivePlatforms(platforms: DiscoveredReviewPlatform[]): number {
  const active = platforms.filter(p => (p.review_count ?? 0) > 0).map(p => p.platform)
  return new Set(active).size
}

/**
 * 根据 raw 评价数据计算 reputation 分数的理论上限。
 * 与 prompts.ts:96-101 的硬性约束严格对齐。
 */
export function computeReputationCap(platforms: DiscoveredReviewPlatform[]): number {
  const total      = sumReviews(platforms)
  const platCount  = countActivePlatforms(platforms)

  let cap = 100
  if (total < REVIEW_THRESHOLD_TINY)      cap = CAP_TINY
  else if (total < REVIEW_THRESHOLD_FEW)  cap = CAP_FEW
  else if (total < REVIEW_THRESHOLD_OK)   cap = CAP_OK

  if (platCount <= 1) cap = Math.max(0, cap - SINGLE_PLATFORM_PENALTY)

  return cap
}

/** 重算 overall 为 4 个维度的算术平均（向下取整），与 prompt 输出格式一致。 */
function recomputeOverall(scores: { seo: number; social: number; reputation: number; ai_visibility: number }): number {
  const sum = SCORE_DIMENSIONS.reduce((acc, k) => acc + scores[k], 0)
  return Math.floor(sum / SCORE_DIMENSIONS.length)
}

// ─── Main entry ──────────────────────────────────────────────────────────────

export interface ClampResult {
  applied: boolean
  oldReputation: number
  newReputation: number
  cap: number
  oldOverall: number
  newOverall: number
}

/**
 * 落库前的护栏。如果 LLM 给出的 reputation 高于 raw data 允许的上限，把它压回上限并重算 overall。
 * 返回 [clamped report, clamp result]。永远不抛错 —— 缺字段时直接返回原 report。
 */
export function applyReputationGuardrail(
  report: DiscoveryReport,
): { report: DiscoveryReport; result: ClampResult | null } {
  const diagnosis = report.diagnosis
  if (!diagnosis || !diagnosis.scores) {
    return { report, result: null }
  }

  const platforms = report.review_platforms ?? []
  const cap = computeReputationCap(platforms)

  const oldReputation = diagnosis.scores.reputation
  if (oldReputation <= cap) {
    return { report, result: null }  // LLM 评分已经合规
  }

  const newScores = { ...diagnosis.scores, reputation: cap }
  const oldOverall = diagnosis.scores.overall
  const newOverall = recomputeOverall(newScores)

  const clampedReport: DiscoveryReport = {
    ...report,
    diagnosis: {
      ...diagnosis,
      scores: { ...newScores, overall: newOverall },
    },
  }

  return {
    report: clampedReport,
    result: {
      applied: true,
      oldReputation,
      newReputation: cap,
      cap,
      oldOverall,
      newOverall,
    },
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// v1.1 · 4-类硬伤 sanity check (P8.13.E · me-client-discovery plugin merge)
// ═══════════════════════════════════════════════════════════════════════════════
//
// 4 detectors that run post-agent, pre-persist. Never rejects a report — issues
// are attached to `report.sanity_issues` for FDE review. The plugin's original
// sanity-check ran once against Roman's canonical data and caught 2 red + 6
// yellow flags, all of which turned out to be real (Paul GMV derived-not-raw,
// Lawrence 均价 derived-not-raw, Lawrence "no" Meta ads over-confident, etc.).
//
// Categories:
//   fabricated_number     · 数字无 source_url 且非典型 typical-range
//   unmarked_uncertainty  · 分数或数字过于精确但基础数据稀疏
//   cross_geography       · competitor location 提到超出 target region 的地方
//   weakness_omitted      · 只有 differentiators / SUPs · 无 gaps / notes
//
// Design principle: prefer false negatives over false positives — an FDE
// annoyed by noise stops trusting the flags. Only flag when we're >80% sure
// something is off.

const NUMERIC_FIELDS_WITH_SOURCE_EXPECTED = [
  'monthly_traffic',
  'keyword_count',
  'trust_score',
  'estimated_volume',
  'semrush_volume',
  'followers_count',
  'posts_last_30d',
  'engagement_rate',
] as const

/**
 * Detector 1 · fabricated_number
 *
 * Numbers that look precise (not a round-ish estimate) but appear in fields
 * where we'd expect a source_url or provenance note. We can't fully verify
 * fabrication from the payload alone — but a rating of 4.7 with 3 reviews,
 * a competitor with monthly_traffic=15234 but no rationale citing where it
 * came from, or an integer that looks pulled from thin air is worth flagging.
 */
function detectFabricatedNumbers(report: DiscoveryReport): SanityIssue[] {
  const issues: SanityIssue[] = []

  // Rating precision vs review count sanity
  const reviewPlatforms = report.review_platforms ?? []
  for (let i = 0; i < reviewPlatforms.length; i++) {
    const plat = reviewPlatforms[i]
    if (plat.rating !== null && plat.review_count !== null && plat.review_count < 5) {
      const isPrecise = Number.isFinite(plat.rating) && (plat.rating * 10) % 10 !== 0  // 4.7 vs 5.0
      if (isPrecise) {
        issues.push({
          severity: 'yellow',
          category: 'fabricated_number',
          location: `review_platforms.${i}.rating`,
          issue: `Rating ${plat.rating} with only ${plat.review_count} reviews looks over-precise (< 5 reviews can't produce fractional averages)`,
          fix_suggestion: 'Round to nearest 0.5 or verify against the platform',
        })
      }
    }
  }

  // Competitor monthly_traffic without rationale citing a source
  const trafficCompetitors = report.competitors ?? []
  for (let i = 0; i < trafficCompetitors.length; i++) {
    const comp = trafficCompetitors[i]
    if (comp.monthly_traffic !== null && comp.monthly_traffic !== undefined && comp.monthly_traffic > 0) {
      const rationale = comp.rationale ?? ''
      const mentionsSource = /semrush|dataforseo|ahrefs|similarweb|source|据|来源|数据/i.test(rationale)
      if (!mentionsSource) {
        issues.push({
          severity: 'yellow',
          category: 'fabricated_number',
          location: `competitors.${i}.monthly_traffic`,
          issue: `Traffic ${comp.monthly_traffic} present but rationale does not cite a source`,
          fix_suggestion: 'Ensure fetch_competitors returned this value; if unknown, set to null',
        })
      }
    }
  }

  return issues
}

/**
 * Detector 2 · unmarked_uncertainty
 *
 * Diagnosis or top-level claims made with high confidence but underlying
 * evidence is thin. E.g. reputation score 85 with only 8 reviews (already
 * clamped by applyReputationGuardrail, but flag as unmarked confidence),
 * or ai_visibility "high" with only 2 questions tested.
 */
function detectUnmarkedUncertainty(report: DiscoveryReport): SanityIssue[] {
  const issues: SanityIssue[] = []

  if (report.diagnosis?.scores) {
    const totalReviews = (report.review_platforms ?? []).reduce(
      (acc, p) => acc + (p.review_count ?? 0), 0,
    )
    const repScore = report.diagnosis.scores.reputation
    if (repScore >= 60 && totalReviews < 10) {
      issues.push({
        severity: 'yellow',
        category: 'unmarked_uncertainty',
        location: 'diagnosis.scores.reputation',
        issue: `Reputation ${repScore}/100 with only ${totalReviews} reviews across all platforms — low-evidence score`,
        fix_suggestion: 'Add note in diagnosis.money_flow explaining the score confidence',
      })
    }
  }

  const aiVis = report.ai_visibility_results ?? []
  if (aiVis.length > 0 && aiVis.length < 2) {
    issues.push({
      severity: 'yellow',
      category: 'unmarked_uncertainty',
      location: 'ai_visibility_results',
      issue: `Only ${aiVis.length} AI visibility question tested — insufficient for trend claims`,
      fix_suggestion: 'Test at least 2 questions before drawing conclusions',
    })
  }

  return issues
}

/**
 * Detector 3 · cross_geography
 *
 * Competitor or media location mentions places outside the client's target
 * region. E.g. client is Auckland Bayside but a "direct" competitor is in
 * Wellington. This is a soft signal — sometimes cross-region competitors are
 * legitimate (e.g. franchise chains) — so we only flag as yellow.
 */
function detectCrossGeography(report: DiscoveryReport): SanityIssue[] {
  const issues: SanityIssue[] = []

  const clientCity = report.business?.location?.city?.toLowerCase().trim() ?? ''
  const clientRegion = report.business?.location?.region?.toLowerCase().trim() ?? ''
  if (!clientCity && !clientRegion) return issues  // can't detect without anchor

  // Rough Auckland / other-NZ heuristic. Extends per-market as needed.
  const NZ_REGIONS_OTHER_THAN_AUCKLAND = ['wellington', 'christchurch', 'hamilton', 'tauranga', 'dunedin']
  const AU_MAJOR_CITIES = ['sydney', 'melbourne', 'brisbane', 'perth', 'adelaide']

  const geoCompetitors = report.competitors ?? []
  for (let i = 0; i < geoCompetitors.length; i++) {
    const comp = geoCompetitors[i]
    const loc = (comp.location ?? '').toLowerCase()
    if (!loc) continue
    if (comp.relevance !== 'direct') continue  // only flag DIRECT competitors as wrong region

    if (clientCity === 'auckland' || clientRegion === 'auckland') {
      const inOtherNz = NZ_REGIONS_OTHER_THAN_AUCKLAND.some(r => loc.includes(r))
      if (inOtherNz) {
        issues.push({
          severity: 'yellow',
          category: 'cross_geography',
          location: `competitors.${i}.location`,
          issue: `Direct competitor located in "${comp.location}" but client is Auckland — check if relevance should be "adjacent" or "aspirational"`,
          fix_suggestion: 'Reclassify to adjacent/aspirational, or verify the competitor actually serves Auckland',
        })
      }
    } else {
      const inOtherAu = AU_MAJOR_CITIES.some(c => loc.includes(c) && !loc.includes(clientCity))
      if (clientCity && inOtherAu) {
        issues.push({
          severity: 'yellow',
          category: 'cross_geography',
          location: `competitors.${i}.location`,
          issue: `Direct competitor in "${comp.location}" but client is ${report.business.location.city} — cross-region`,
          fix_suggestion: 'Verify or reclassify relevance',
        })
      }
    }
  }

  return issues
}

/**
 * Detector 4 · weakness_omitted
 *
 * Report has business.unique_selling_points but diagnosis.actions.quick_fix
 * and diagnosis.actions.important are both empty — suggests the report is
 * "all strengths, no weaknesses". Discovery should always surface at least
 * one thing to fix.
 */
function detectWeaknessOmitted(report: DiscoveryReport): SanityIssue[] {
  const issues: SanityIssue[] = []

  const usps = report.business?.unique_selling_points ?? []
  const diagnosis = report.diagnosis
  if (usps.length === 0 || !diagnosis) return issues

  const quickFix = diagnosis.actions?.quick_fix ?? []
  const important = diagnosis.actions?.important ?? []
  const talkToUs = diagnosis.actions?.talk_to_us ?? []
  const totalActions = quickFix.length + important.length + talkToUs.length

  if (totalActions === 0) {
    issues.push({
      severity: 'red',
      category: 'weakness_omitted',
      location: 'diagnosis.actions',
      issue: `${usps.length} strengths listed but zero recommended actions — every business has at least one improvement area`,
      fix_suggestion: 'Add at least 1 quick_fix or important action, even if minor',
    })
  } else if (quickFix.length === 0 && important.length === 0 && talkToUs.length > 0) {
    // All actions are "talk to us" — no self-serve wins listed
    issues.push({
      severity: 'yellow',
      category: 'weakness_omitted',
      location: 'diagnosis.actions.quick_fix',
      issue: 'All actions are "talk_to_us" — no client-self-serve quick wins identified',
      fix_suggestion: 'Add at least 1 quick_fix the client can do themselves',
    })
  }

  return issues
}

/**
 * Run all 4 sanity detectors and return the combined issue list. Never throws
 * — a broken detector must not block persistence. Called by persistor after
 * validation, before write.
 *
 * Returns [] when everything looks clean.
 */
export function runSanityCheck(report: DiscoveryReport): SanityIssue[] {
  const results: SanityIssue[] = []
  for (const detector of [
    detectFabricatedNumbers,
    detectUnmarkedUncertainty,
    detectCrossGeography,
    detectWeaknessOmitted,
  ]) {
    try {
      results.push(...detector(report))
    } catch {
      // A broken detector should never block persistence. Silent skip.
    }
  }
  return results
}
