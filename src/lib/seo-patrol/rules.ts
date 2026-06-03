/**
 * Built-in SEO patrol rules (Phase 22.E MVP).
 *
 * Each rule is pure-functional: evaluate(input) → SeoPatrolFinding[].
 * No I/O, no AI. The patrol job reads keyword_snapshots +
 * gsc_performance_snapshots, shapes them into SeoPatrolInput, and feeds the
 * rules. Findings are persisted to seo_patrol_findings (status='fresh') and
 * later judged by 诸葛亮.
 *
 * Rule table from ROADMAP.md § Phase 22.E:
 *
 * Rule | Trigger                                          | action_type
 * -----|--------------------------------------------------|------------------
 * R1   | rank P2-P3 AND GSC CTR < benchmark × 0.6         | seo.refresh_blog
 * R2   | page has GSC impressions but no internal link    | seo.refresh_blog
 * R3   | ranking dropped > 3 positions (vs prior snapshot)| seo.refresh_blog
 * R4   | high-volume low-KD keyword not covered           | seo.publish_blog
 * R5   | GSC "discovered not indexed" > 7 days            | seo.refresh_blog
 */

import { SEO_ACTION_TYPE } from '@/lib/flywheel/vocabulary'
import type {
  SeoPatrolRule,
  SeoPatrolFinding,
  SeoPatrolInput,
  KeywordSignal,
  PageSignal,
} from './types'

// ── Tunable thresholds ─────────────────────────────────────────────────────────

export const SEO_PATROL_THRESHOLDS = {
  /** R1: only flag positions in this band (top-of-page-2-ish, real CTR upside). */
  LOW_CTR_MIN_POSITION: 2,
  LOW_CTR_MAX_POSITION: 3,
  /** R1: actual CTR below benchmark × this ratio = underperforming title. */
  LOW_CTR_RATIO: 0.6,
  /** R2: page needs at least this many impressions to be worth interlinking. */
  MIN_IMPRESSIONS_FOR_LINK: 50,
  /** R3: ranking drop greater than this many positions = stale. */
  STALE_POSITION_DROP: 3,
  /** R4: keyword opportunity must have at least this much volume. */
  OPPORTUNITY_MIN_VOLUME: 100,
  /** R4: …and KD at or below this (easy to rank). */
  OPPORTUNITY_MAX_KD: 30,
  /** R5: not-indexed for more than this many days = worth resubmitting. */
  NOT_INDEXED_MIN_DAYS: 7,
} as const

// ── CTR benchmark by position ───────────────────────────────────────────────────
// Same curve as src/lib/seo-intelligence/intent-strategy.ts::ctrForPosition.
// Duplicated here intentionally so the rule engine is self-contained (no import
// of a private helper). If the canonical curve changes, update both.

export function ctrBenchmarkForPosition(position: number | null): number {
  if (position === null || position <= 0) return 0
  if (position === 1) return 0.28
  if (position === 2) return 0.15
  if (position === 3) return 0.11
  if (position <= 5) return 0.07
  if (position <= 10) return 0.035
  if (position <= 20) return 0.012
  if (position <= 50) return 0.004
  return 0.001
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

function baseFinding(
  clientId: string,
  ruleId: SeoPatrolFinding['ruleId'],
  suggestedActionType: string,
): SeoPatrolFinding {
  return {
    clientId,
    ruleId,
    keyword: null,
    url: null,
    position: null,
    ctr: null,
    ctrBenchmark: null,
    searchVolume: null,
    keywordDifficulty: null,
    positionDelta: null,
    suggestedActionType,
    description: '',
  }
}

// ── R1: low CTR title ────────────────────────────────────────────────────────────

const lowCtrTitle: SeoPatrolRule = {
  id: 'low_ctr_title',
  suggestedActionType: SEO_ACTION_TYPE.REFRESH_BLOG,
  evaluate({ clientId, keywords }: SeoPatrolInput): SeoPatrolFinding[] {
    const out: SeoPatrolFinding[] = []
    for (const kw of keywords) {
      if (kw.position === null || kw.gscCtr === null) continue
      if (
        kw.position < SEO_PATROL_THRESHOLDS.LOW_CTR_MIN_POSITION ||
        kw.position > SEO_PATROL_THRESHOLDS.LOW_CTR_MAX_POSITION
      ) {
        continue
      }
      const benchmark = ctrBenchmarkForPosition(kw.position)
      if (benchmark === 0) continue
      if (kw.gscCtr >= benchmark * SEO_PATROL_THRESHOLDS.LOW_CTR_RATIO) continue

      out.push({
        ...baseFinding(clientId, 'low_ctr_title', this.suggestedActionType),
        keyword: kw.keyword,
        position: kw.position,
        ctr: kw.gscCtr,
        ctrBenchmark: benchmark,
        description:
          `"${kw.keyword}" ranks #${kw.position} but CTR is only ${pct(kw.gscCtr)} ` +
          `(benchmark ${pct(benchmark)}). Rewrite the title to lift click-through.`,
      })
    }
    return out
  },
}

// ── R2: missing internal link ────────────────────────────────────────────────────

const missingInternalLink: SeoPatrolRule = {
  id: 'missing_internal_link',
  suggestedActionType: SEO_ACTION_TYPE.REFRESH_BLOG,
  evaluate({ clientId, pages }: SeoPatrolInput): SeoPatrolFinding[] {
    const out: SeoPatrolFinding[] = []
    for (const page of pages) {
      if (page.hasInternalLink) continue
      if (page.impressions < SEO_PATROL_THRESHOLDS.MIN_IMPRESSIONS_FOR_LINK) continue

      out.push({
        ...baseFinding(clientId, 'missing_internal_link', this.suggestedActionType),
        url: page.url,
        position: page.position,
        description:
          `${page.url} gets ${page.impressions} impressions but has no internal link ` +
          `driving to a money page. Add 2-3 internal links.`,
      })
    }
    return out
  },
}

// ── R3: stale content ────────────────────────────────────────────────────────────

const staleContent: SeoPatrolRule = {
  id: 'stale_content',
  suggestedActionType: SEO_ACTION_TYPE.REFRESH_BLOG,
  evaluate({ clientId, keywords }: SeoPatrolInput): SeoPatrolFinding[] {
    const out: SeoPatrolFinding[] = []
    for (const kw of keywords) {
      if (kw.position === null || kw.priorPosition === null) continue
      // Higher position number = worse ranking, so drop = current - prior.
      const drop = kw.position - kw.priorPosition
      if (drop <= SEO_PATROL_THRESHOLDS.STALE_POSITION_DROP) continue

      out.push({
        ...baseFinding(clientId, 'stale_content', this.suggestedActionType),
        keyword: kw.keyword,
        position: kw.position,
        positionDelta: drop,
        description:
          `"${kw.keyword}" dropped ${drop} positions ` +
          `(#${kw.priorPosition} → #${kw.position}). Refresh the content.`,
      })
    }
    return out
  },
}

// ── R4: keyword opportunity ──────────────────────────────────────────────────────

const keywordOpportunity: SeoPatrolRule = {
  id: 'keyword_opportunity',
  suggestedActionType: SEO_ACTION_TYPE.PUBLISH_BLOG,
  evaluate({ clientId, keywords }: SeoPatrolInput): SeoPatrolFinding[] {
    const out: SeoPatrolFinding[] = []
    for (const kw of keywords) {
      if (kw.covered) continue
      if (kw.searchVolume === null || kw.keywordDifficulty === null) continue
      if (kw.searchVolume < SEO_PATROL_THRESHOLDS.OPPORTUNITY_MIN_VOLUME) continue
      if (kw.keywordDifficulty > SEO_PATROL_THRESHOLDS.OPPORTUNITY_MAX_KD) continue

      out.push({
        ...baseFinding(clientId, 'keyword_opportunity', this.suggestedActionType),
        keyword: kw.keyword,
        searchVolume: kw.searchVolume,
        keywordDifficulty: kw.keywordDifficulty,
        description:
          `Opportunity keyword "${kw.keyword}" ` +
          `(volume ${kw.searchVolume}/mo, KD ${kw.keywordDifficulty}) is not yet covered. ` +
          `Write a new post targeting it.`,
      })
    }
    return out
  },
}

// ── R5: not indexed ──────────────────────────────────────────────────────────────

const notIndexed: SeoPatrolRule = {
  id: 'not_indexed',
  suggestedActionType: SEO_ACTION_TYPE.REFRESH_BLOG,
  evaluate({ clientId, pages }: SeoPatrolInput): SeoPatrolFinding[] {
    const out: SeoPatrolFinding[] = []
    for (const page of pages) {
      if (!page.discoveredNotIndexed) continue
      if (
        page.daysNotIndexed === null ||
        page.daysNotIndexed <= SEO_PATROL_THRESHOLDS.NOT_INDEXED_MIN_DAYS
      ) {
        continue
      }

      out.push({
        ...baseFinding(clientId, 'not_indexed', this.suggestedActionType),
        url: page.url,
        description:
          `${page.url} has been "discovered - not indexed" for ${page.daysNotIndexed} days. ` +
          `Resubmit for indexing.`,
      })
    }
    return out
  },
}

// ── Registry ──────────────────────────────────────────────────────────────────────

/** All built-in SEO patrol rules. Add new rules here to enrol them. */
export const SEO_PATROL_RULES: readonly SeoPatrolRule[] = [
  lowCtrTitle,
  missingInternalLink,
  staleContent,
  keywordOpportunity,
  notIndexed,
]

/** Run every rule against one client's signals and flatten the findings. */
export function runSeoPatrolRules(input: SeoPatrolInput): SeoPatrolFinding[] {
  return SEO_PATROL_RULES.flatMap((rule) => rule.evaluate(input))
}
