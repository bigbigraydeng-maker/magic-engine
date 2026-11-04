/**
 * Daily scheduling step of the social agent (dev plan v1.2, knife 1). The weekly loop calls this instead of
 * its weekly scheduling when the client is on the daily cadence; one writer of publish_on per client.
 * Never moves a date that is already set (it may already be approved). Writes nothing in dry_run.
 */
import { fillSlots } from './schedule'
import type { WriteReelScheduleArgs, WriteReelScheduleResult } from './schedule-writer'
import { mondayOf, occupiedDays, poolDepthDays } from './daily-schedule'
import { readSocialAgentSettings, type SocialAgentSettings } from '@/lib/social/recipe/tier-defaults'

export const DAILY_SCHEDULED_BY = 'social-daily-agent'

export interface DailyEntry {
  id: string
  scheduledOn: string | null
  productKey: string | null
  rankAt: string
  /** eligible = passed facts, 马良 and consent; and (write mode) its fact check was stored. */
  eligible: boolean
}

export interface DailyScheduleResult {
  written: Array<{ id: string; publishOn: string }>
  skipped: Array<{ id: string; reason: string }>
  unscheduled: Array<{ id: string; reason: string }>
  errors: string[]
  poolDepthDays: number | null
  alreadyScheduled: number
}

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
): { entries: DailyEntry[]; notPersisted: number } {
  const byId = new Map(reviewed.map((r) => [r.id, r]))
  let notPersisted = 0
  const entries = candidates.map((c) => {
    const r = byId.get(c.id)
    const passed = r !== undefined && r.excluded === null
    const stored = persistedIds === null || persistedIds.has(c.id)
    if (passed && c.scheduledOn === null && !stored) notPersisted += 1
    return { id: c.id, scheduledOn: c.scheduledOn, productKey: r?.productKey ?? null, rankAt: c.createdAt, eligible: passed && stored }
  })
  return { entries, notPersisted }
}

export async function scheduleDaily(
  writeSchedule: (args: WriteReelScheduleArgs) => Promise<WriteReelScheduleResult>,
  args: {
    clientId: string
    slotDates: readonly string[]
    reelPerDay: number
    entries: readonly DailyEntry[]
    dryRun: boolean
  },
): Promise<DailyScheduleResult> {
  const keyOf = new Map(args.entries.map((e) => [e.id, e.productKey]))
  const occupied = occupiedDays(args.entries, (id) => keyOf.get(id) ?? null)
  const pool = args.entries.filter((e) => e.eligible && e.scheduledOn === null)
  const result: DailyScheduleResult = {
    written: [],
    skipped: [],
    unscheduled: [],
    errors: [],
    poolDepthDays: poolDepthDays(pool.length, args.reelPerDay),
    alreadyScheduled: occupied.length,
  }
  const slots = args.reelPerDay > 0 ? args.slotDates : []
  const plan = fillSlots(slots, pool.map((e) => ({ id: e.id, productKey: e.productKey, rankAt: e.rankAt })), occupied)
  result.unscheduled = plan.unscheduled
  for (const a of plan.assignments) {
    const res = await writeSchedule({
      clientId: args.clientId,
      weekStart: mondayOf(a.publishOn),
      assignments: [a],
      dryRun: args.dryRun,
      blockOnlyPending: true,
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
