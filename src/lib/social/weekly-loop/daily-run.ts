/**
 * Daily scheduling step of the social agent (dev plan v1.2, knife 1). The weekly loop calls this instead of
 * its weekly scheduling when the client is on the daily cadence; one writer of publish_on per client.
 * Never moves a date that is already set (it may already be approved). Writes nothing in dry_run.
 */
import { fillSlots } from './schedule'
import type { ExpireOutcome, WriteReelScheduleArgs, WriteReelScheduleResult } from './schedule-writer'
import { mondayOf, occupiedDays, poolDepthDays, type DatedRow } from './daily-schedule'
import { STYLE_LIMITS, styleOf, type EntryStyle } from './style-rules'

const STYLE_LOOKBACK_DAYS = Math.max(STYLE_LIMITS.sameMusicDays, STYLE_LIMITS.variantDays)
import { toAuditReel } from '@/lib/social/account-audit/load'
import { checkReelFacts, reelOverlayOf, type OkFactSource } from './reel-facts'
import { readPublishOn } from '@/lib/social/week-pack/manifest'
import { readSocialAgentSettings, type SocialAgentSettings } from '@/lib/social/recipe/tier-defaults'

export const DAILY_SCHEDULED_BY = 'social-daily-agent'

/**
 * Only a week card still under review blocks daily scheduling. Items put into an approved week are approved
 * on the daily list (knife 2); unapproved ones past their day go back to the pool (expiry pass).
 */
export const DAILY_BLOCK_ONLY_PENDING = true

/**
 * Rows the candidate selection left out but that carry a date (today, past, beyond the look window, any status).
 * They occupy their day and taint their version group, so nothing is booked twice and no second version is dated.
 */
export function datedOutsideCandidates(
  rows: ReadonlyArray<{ id: string; created_at: string; brief: unknown; output: unknown }>,
  candidateIds: ReadonlySet<string>,
): DatedRow[] {
  const out: DatedRow[] = []
  for (const r of rows) {
    if (candidateIds.has(r.id)) continue
    const on = readPublishOn(r.brief)
    if (typeof on !== 'string' || on === 'invalid') continue
    out.push({ id: r.id, created_at: r.created_at, brief: r.brief, overlay: reelOverlayOf(r.output), scheduledOn: on })
  }
  return out
}

export interface DailyEntry {
  id: string
  scheduledOn: string | null
  productKey: string | null
  rankAt: string
  /** eligible = passed facts, 马良 and consent; and (write mode) its fact check was stored. */
  eligible: boolean
  /** Template / music / variant group of the reel; null = unreadable (never held back for style). */
  style?: EntryStyle | null
}

/** Style of every order row the run loaded (candidates and dated rows outside them). Unreadable fields stay null. */
export function rowStyler(rows: ReadonlyArray<{ id: string; created_at: string; brief: unknown }>): (id: string) => EntryStyle | null {
  const byId = new Map(rows.map((r) => [r.id, r]))
  return (id) => {
    const row = byId.get(id)
    const reel = row ? toAuditReel(row) : null
    return reel ? styleOf(reel) : null
  }
}

export interface DailyScheduleResult {
  written: Array<{ id: string; publishOn: string }>
  skipped: Array<{ id: string; reason: string }>
  unscheduled: Array<{ id: string; reason: string }>
  errors: string[]
  poolDepthDays: number | null
  alreadyScheduled: number
  /** Past-day reels that were never approved and went back to the pool this run. */
  expired: string[]
  /** Placed even though it repeats a recent track / variant / template, because nothing else fitted that day. */
  relaxed: Array<{ id: string; violation: string }>
}

/** Reels already public in the last days: they are not schedulable, but the style rules must see them. */
export type RecentPublishedPort = (args: { clientId: string; sinceDay: string }) => Promise<Array<{ id: string; created_at: string; brief: unknown; publishedOn: string }>>

export type ExpirePort = (args: { clientId: string; ids: string[]; today: string; dryRun: boolean }) => Promise<Array<{ id: string; outcome: ExpireOutcome }>>

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Settings for this run. `force` (manual dry runs only) turns the daily cadence on without touching the config. */
export function dailySettings(config: unknown, planTier: unknown, force: boolean): SocialAgentSettings {
  if (!force) return readSocialAgentSettings(config, planTier)
  const base = isRecord(config) ? config : {}
  const agent = isRecord(base.social_agent) ? base.social_agent : {}
  return readSocialAgentSettings({ ...base, social_agent: { ...agent, enabled: true } }, planTier)
}

/** Joins the run's candidates with their review. Eligible needs: passed every gate, undated or dated, and (write mode) a stored fact check. */
export function dailyEntries(
  candidates: ReadonlyArray<{ id: string; scheduledOn: string | null; createdAt: string }>,
  reviewed: ReadonlyArray<{ id: string; excluded: string | null; productKey: string | null }>,
  persistedIds: ReadonlySet<string> | null,
  /** Product key for rows that were not reviewed in this run (dated rows outside the candidates). */
  fallbackKey: (id: string) => string | null = () => null,
  styleFor: (id: string) => EntryStyle | null = () => null,
): { entries: DailyEntry[]; notPersisted: number } {
  const byId = new Map(reviewed.map((r) => [r.id, r]))
  let notPersisted = 0
  const entries = candidates.map((c) => {
    const r = byId.get(c.id)
    const passed = r !== undefined && r.excluded === null
    const stored = persistedIds === null || persistedIds.has(c.id)
    if (passed && c.scheduledOn === null && !stored) notPersisted += 1
    return { id: c.id, scheduledOn: c.scheduledOn, productKey: r ? r.productKey : fallbackKey(c.id), rankAt: c.createdAt, eligible: passed && stored, style: styleFor(c.id) }
  })
  return { entries, notPersisted }
}

/** Product key of a dated row outside the candidates, so a same-tour reel is not put next to it. */
export function outsideTourKey(
  rows: ReadonlyArray<{ id: string; brief: unknown; output: unknown }>,
  outside: readonly DatedRow[],
  id: string,
  source: OkFactSource,
  today: string,
): string | null {
  if (!outside.some((o) => o.id === id)) return null
  const row = rows.find((r) => r.id === id)
  return row ? checkReelFacts({ brief: row.brief, output: row.output, orderId: row.id, source, today }).result.targetTourId : null
}

async function loadRecent(
  args: { clientId: string; today: string },
  port: RecentPublishedPort | undefined,
): Promise<{ placed: Array<{ id: string; publishOn: string; productKey: null; style: EntryStyle | null }>; errors: string[] }> {
  if (!port) return { placed: [], errors: [] }
  try {
    const rows = await port({ clientId: args.clientId, sinceDay: shiftDay(args.today, -STYLE_LOOKBACK_DAYS) })
    const styleFor = rowStyler(rows)
    return { placed: rows.map((r) => ({ id: r.id, publishOn: r.publishedOn, productKey: null, style: styleFor(r.id) })), errors: [] }
  } catch {
    // Not seeing the recent past only weakens the repeat check; it must not stop the schedule.
    return { placed: [], errors: ['recent_published_unreadable'] }
  }
}

function shiftDay(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

async function expirePast(
  args: { clientId: string; entries: readonly DailyEntry[]; dryRun: boolean; today: string },
  expire: ExpirePort | undefined,
): Promise<{ expired: string[]; errors: string[] }> {
  const past = args.entries.filter((e) => e.scheduledOn !== null && e.scheduledOn < args.today).map((e) => e.id)
  if (!expire || past.length === 0) return { expired: [], errors: [] }
  const res = await expire({ clientId: args.clientId, ids: past, today: args.today, dryRun: args.dryRun })
  const broken = res.filter((r) => r.outcome === 'check_failed' || r.outcome === 'write_failed').length
  return { expired: res.filter((r) => r.outcome === 'expired').map((r) => r.id), errors: broken > 0 ? [`expire_failed:${broken}`] : [] }
}

export async function scheduleDaily(
  writeSchedule: (args: WriteReelScheduleArgs) => Promise<WriteReelScheduleResult>,
  args: {
    clientId: string
    slotDates: readonly string[]
    reelPerDay: number
    entries: readonly DailyEntry[]
    dryRun: boolean
    today: string
  },
  expire?: ExpirePort,
  recentPublished?: RecentPublishedPort,
): Promise<DailyScheduleResult> {
  const keyOf = new Map(args.entries.map((e) => [e.id, e.productKey]))
  const styleOfId = new Map(args.entries.map((e) => [e.id, e.style ?? null]))
  const { expired, errors } = await expirePast(args, expire)
  const live = args.entries.filter((e) => !expired.includes(e.id))
  const occupied = occupiedDays(live, (id) => keyOf.get(id) ?? null, (id) => styleOfId.get(id) ?? null)
  const pool = live.filter((e) => e.eligible && e.scheduledOn === null)
  const result: DailyScheduleResult = {
    written: [],
    skipped: [],
    unscheduled: [],
    errors,
    expired,
    relaxed: [],
    poolDepthDays: poolDepthDays(pool.length, args.reelPerDay),
    alreadyScheduled: occupied.length,
  }
  const slots = args.reelPerDay > 0 ? args.slotDates : []
  const recent = await loadRecent(args, recentPublished)
  result.errors.push(...recent.errors)
  const plan = fillSlots(slots, pool.map((e) => ({ id: e.id, productKey: e.productKey, rankAt: e.rankAt, style: e.style })), [...occupied, ...recent.placed])
  result.unscheduled = plan.unscheduled
  result.relaxed = plan.relaxed ?? []
  for (const a of plan.assignments) {
    const res = await writeSchedule({
      clientId: args.clientId,
      weekStart: mondayOf(a.publishOn),
      assignments: [a],
      dryRun: args.dryRun,
      blockOnlyPending: DAILY_BLOCK_ONLY_PENDING,
      scheduledBy: DAILY_SCHEDULED_BY,
    })
    if (res.ok === false) {
      // A card under review for that week is the guard working, not a breakage.
      if (res.reason !== 'card_open') result.errors.push('schedule_' + res.reason)
      result.skipped.push({ id: a.id, reason: res.reason })
      continue
    }
    result.written.push(...res.written)
    result.skipped.push(...res.skipped)
  }
  return result
}
