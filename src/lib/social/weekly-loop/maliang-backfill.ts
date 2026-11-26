// 马良 · 周循环补审：挑出「已发布但没被马良看过」的草稿片，在每周预算内补一次 v2 自检。
// 纯函数，不做 IO、不调模型；真正的模型调用由调用方按 targets 执行。

import type { MaliangCheck, NineGridInput } from '@/lib/maliang/render-check'
import { REVIEW_V2_ESTIMATE_USD, withinWeeklyBudget } from '@/lib/maliang/render-check-v2'
import { remotionNineGridInput } from '@/lib/maliang/remotion-review-input'
import { stampWorkOrderOutput } from '@/lib/maliang/review-disposition'
import { factoryVideoUrl } from '@/lib/factory/outlets'
import { reelTitle } from '@/lib/social/week-pack/manifest'
import type { WeeklyLoopItem, WeeklyLoopOrderRow } from './run'

/** Max number of model calls a single backfill run may make. */
export const MALIANG_BACKFILL_MAX_PER_RUN = 6

/** Default weekly money cap for backfill reviews, USD. */
export const MALIANG_WEEKLY_CAP_DEFAULT_USD = 0.5

/** Hard ceiling for the weekly backfill cap, USD. */
export const MALIANG_WEEKLY_CAP_MAX_USD = 5

export interface BackfillTarget {
  id: string
  videoUrl: string
  input: NineGridInput
  readUpdatedAt: string
}

export type BackfillSkipReason = 'row_missing' | 'no_video' | 'run_cap' | 'budget'

export interface MaliangBackfillReceipt {
  enabled: boolean
  /** Why no model call is made this run; null when enabled. */
  off_reason: string | null
  cap_usd: number
  spent_before_usd: number
  /** One entry per charged model call (preferred for weekly spend totals). */
  charges_usd?: number[]
  /** Model calls made in this run x REVIEW_V2_ESTIMATE_USD. */
  spent_usd: number
  /** Targets x REVIEW_V2_ESTIMATE_USD: what this run would spend if every target is reviewed. */
  estimated_usd: number
  targets: number
  skipped: Record<string, number>
  reviewed: Array<{ id: string; status: string; persisted: BackfillPersisted }>
}

/**
 * not_written: dry run (verdict only kept in memory).
 * unverifiable_not_written: 马良 could not look (timeout / download / parse); not stored so the reel stays "unreviewed" and is retried next week.
 */
export type BackfillPersisted = 'written' | 'conflict' | 'failed' | 'not_written' | 'unverifiable_not_written'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Read the weekly backfill cap from config, clamped to the hard ceiling. */
export function maliangWeeklyCapUsd(config: unknown): number {
  if (!isRecord(config)) return MALIANG_WEEKLY_CAP_DEFAULT_USD
  const loop = config.weekly_loop
  if (!isRecord(loop)) return MALIANG_WEEKLY_CAP_DEFAULT_USD
  const raw = loop.maliang_weekly_cap_usd
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    return MALIANG_WEEKLY_CAP_DEFAULT_USD
  }
  return Math.min(raw, MALIANG_WEEKLY_CAP_MAX_USD)
}

function sumValidCharges(charges: readonly unknown[]): number {
  let total = 0
  for (const charge of charges) {
    if (typeof charge !== 'number' || !Number.isFinite(charge) || charge < 0) continue
    total += charge
  }
  return total
}

/** Sum one backfill block: per-review `charges_usd` when present, else legacy `spent_usd`. */
export function maliangBackfillSpendTotal(backfill: unknown): number {
  if (!isRecord(backfill)) return 0
  const charges = backfill.charges_usd
  if (Array.isArray(charges) && charges.length > 0) return sumValidCharges(charges)
  const spent = backfill.spent_usd
  if (typeof spent !== 'number' || !Number.isFinite(spent) || spent < 0) return 0
  return spent
}

/** Sum 马良 spend across weekly run summaries; bad entries count as 0. */
export function sumWeeklyMaliangSpend(summaries: readonly unknown[]): number {
  let total = 0
  for (const summary of summaries) {
    if (!isRecord(summary)) continue
    total += maliangBackfillSpendTotal(summary.maliang_backfill)
  }
  return total
}

/** Append one per-review charge ledger on the run row. */
export function nextMaliangChargeLedger(
  backfill: unknown,
  chargeUsd: number,
): { charges_usd: number[]; spent_usd: number } {
  const prior = isRecord(backfill) && Array.isArray(backfill.charges_usd) ? backfill.charges_usd : []
  const charges_usd = [...prior.filter((c) => typeof c === 'number' && Number.isFinite(c) && c >= 0), chargeUsd]
  return { charges_usd, spent_usd: sumValidCharges(charges_usd) }
}

/**
 * Keep whichever charge ledger is longer so finish-run never drops reserves written
 * before a crash or a partial receipt.
 */
export function mergeMaliangChargeLedgers(
  reservedCharges: readonly number[],
  receiptCharges: readonly number[],
): number[] {
  if (receiptCharges.length >= reservedCharges.length) return [...receiptCharges]
  return [...reservedCharges]
}

/** Build a public https video url from a storage path, or null when unusable. */
export function backfillVideoUrl(videoPath: unknown, supabaseUrl: string | undefined): string | null {
  if (typeof videoPath !== 'string' || videoPath.trim().length === 0) return null
  if (typeof supabaseUrl !== 'string' || supabaseUrl.trim().length === 0) return null
  const trimmed = supabaseUrl.trim()
  const base = trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
  const url = factoryVideoUrl(videoPath.trim(), base)
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    return parsed.toString()
  } catch {
    return null
  }
}

/** Pick unreviewed, fact-passing items that fit the run cap and weekly budget. */
export function pickBackfillTargets(args: {
  items: readonly WeeklyLoopItem[]
  rows: readonly WeeklyLoopOrderRow[]
  brandName: string
  supabaseUrl: string | undefined
  spentUsd: number
  capUsd: number
  maxPerRun: number
}): { targets: BackfillTarget[]; skipped: Record<string, number> } {
  const byId = new Map<string, WeeklyLoopOrderRow>()
  for (const row of args.rows) byId.set(row.id, row)

  const targets: BackfillTarget[] = []
  const skipped: Record<string, number> = {}
  const bump = (reason: BackfillSkipReason) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1
  }

  for (const item of args.items) {
    if (item.excluded_reason !== 'unreviewed') continue
    if (item.fact_verdict !== 'pass') continue

    const row = byId.get(item.id)
    if (!row) {
      bump('row_missing')
      continue
    }

    const output = isRecord(row.output) ? row.output : {}
    const videoUrl = backfillVideoUrl(output.video_path, args.supabaseUrl)
    if (videoUrl === null) {
      bump('no_video')
      continue
    }

    if (targets.length >= args.maxPerRun) {
      bump('run_cap')
      continue
    }

    const projected = args.spentUsd + targets.length * REVIEW_V2_ESTIMATE_USD
    if (!withinWeeklyBudget(projected, args.capUsd, REVIEW_V2_ESTIMATE_USD)) {
      bump('budget')
      continue
    }

    targets.push({
      id: row.id,
      videoUrl,
      readUpdatedAt: row.updated_at,
      input: remotionNineGridInput({
        title: reelTitle(row.angle),
        brandName: args.brandName,
        brief: row.brief,
        caption: output.caption,
      }),
    })
  }

  return { targets, skipped }
}

/** Return rows with fresh 马良 checks stamped into output; untouched rows keep identity. */
export function overlayReviews(
  rows: readonly WeeklyLoopOrderRow[],
  checks: Readonly<Record<string, MaliangCheck>>,
): WeeklyLoopOrderRow[] {
  return rows.map((row) => {
    if (!Object.prototype.hasOwnProperty.call(checks, row.id)) return row
    return { ...row, output: stampWorkOrderOutput(row.output, checks[row.id]) }
  })
}
