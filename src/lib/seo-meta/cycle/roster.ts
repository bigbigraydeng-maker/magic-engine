/**
 * SEO Meta-Cycle v1 — fan-out roster + per-client dedup (mirrors
 * src/lib/flywheel/seo-weekly.ts's split exactly, per 子牙 finding #1: this
 * must be a TWO-FUNCTION Inngest pattern, not a for-loop over clients inside
 * one function).
 *
 * Reuses `isoWeekKey` from seo-weekly.ts directly rather than reimplementing
 * ISO-week-over-NZ-timezone math a second time in this codebase.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isoWeekKey } from '@/lib/flywheel/seo-weekly'
import { STEP6_JOB_NAME } from './receipts'
import type { MetaCycleClientConfig } from './types'

export { isoWeekKey }

export const META_CYCLE_DUE_EVENT = 'seo/meta-cycle.due'
export const META_CYCLE_JOB = 'seo-meta-cycle'

/** Same UTC time the CTS weekly cron used ("Monday 05:30 UTC, right after oztop-seo-optimizer") — no TZ math, this PR retires that render.yaml cron entry in favour of this native Inngest trigger at the identical wall-clock time operators already expect. */
export const META_CYCLE_CRON = '30 5 * * 1'

/** Same rationale as flywheel-seo-weekly's MIN_HOURS_BETWEEN_SNAPSHOTS: Inngest's
 *  event dedup window is 24h, not "once this ISO week" — a manual re-trigger the
 *  next day would otherwise re-run the whole client. 156h (6.5 days) < 7 days so
 *  it never blocks the next normal weekly run. */
export const MIN_HOURS_BETWEEN_CYCLES = 156

export interface MetaCycleRosterEntry {
  clientId: string
  domain: string
  semrushDb: string | null
  maxPagesPerRun: number
  cooldownDays: number
  brandVoice: string
}

export type RosterResult =
  | { ok: true; entries: MetaCycleRosterEntry[] }
  | { ok: false; reason: string }

const DEFAULT_MAX_PAGES_PER_RUN = 3
const DEFAULT_COOLDOWN_DAYS = 30
const DEFAULT_BRAND_VOICE = 'Professional, factual AU/NZ English. No invented prices, dates, or itinerary details.'

/**
 * Who's due: active + domain set + seo_config.meta_cycle_enabled=true.
 * No client-name allowlist (same warning as loadSnapshotRoster/getClientCompetitors) —
 * to exclude a client, flip their config flag, don't add an ID list here.
 */
export async function loadMetaCycleRoster(supabase: SupabaseClient): Promise<RosterResult> {
  const { data, error } = await supabase
    .from('clients')
    .select('id, domain, semrush_db, seo_config')
    .eq('client_status', 'active')
    .contains('seo_config', { meta_cycle_enabled: true })
    .not('domain', 'is', null)

  if (error) return { ok: false, reason: error.message }

  const entries = (data ?? []).flatMap((row): MetaCycleRosterEntry[] => {
    const r = row as { id?: unknown; domain?: unknown; semrush_db?: unknown; seo_config?: unknown }
    if (typeof r.id !== 'string' || r.id.length === 0) return []
    if (typeof r.domain !== 'string' || r.domain.trim().length === 0) return []
    const cfg = (r.seo_config ?? {}) as Record<string, unknown>
    return [{
      clientId: r.id,
      domain: r.domain.trim(),
      semrushDb: typeof r.semrush_db === 'string' ? r.semrush_db : null,
      maxPagesPerRun: typeof cfg.meta_cycle_max_pages === 'number' && cfg.meta_cycle_max_pages > 0 ? cfg.meta_cycle_max_pages : DEFAULT_MAX_PAGES_PER_RUN,
      cooldownDays: typeof cfg.meta_cycle_cooldown_days === 'number' && cfg.meta_cycle_cooldown_days > 0 ? cfg.meta_cycle_cooldown_days : DEFAULT_COOLDOWN_DAYS,
      brandVoice: typeof cfg.meta_cycle_brand_voice === 'string' && cfg.meta_cycle_brand_voice.trim().length > 0 ? cfg.meta_cycle_brand_voice : DEFAULT_BRAND_VOICE,
    }]
  })

  return { ok: true, entries }
}

export function toClientConfig(entry: MetaCycleRosterEntry): MetaCycleClientConfig {
  return {
    clientId: entry.clientId,
    domain: entry.domain,
    semrushDb: entry.semrushDb,
    maxPagesPerRun: entry.maxPagesPerRun,
    cooldownDays: entry.cooldownDays,
    brandVoice: entry.brandVoice,
  }
}

export function metaCycleEventId(clientId: string, weekKey: string): string {
  return `seo-meta-cycle-${weekKey}-${clientId}`
}

/**
 * Fail-closed like recentlySnapshotted: a lookup failure skips the client
 * rather than risking a duplicate week's worth of PRs/reverts.
 */
export async function recentlyCycled(
  supabase: SupabaseClient,
  clientId: string,
  now: Date = new Date(),
): Promise<{ skip: boolean; reason: string | null }> {
  const cutoff = new Date(now.getTime() - MIN_HOURS_BETWEEN_CYCLES * 3_600_000).toISOString()
  const { data, error } = await supabase
    .from('cron_run_logs')
    .select('started_at')
    .eq('job_name', STEP6_JOB_NAME)
    .gte('started_at', cutoff)
    .contains('summary', { client_id: clientId })
    .limit(1)

  if (error) return { skip: true, reason: `lookup_failed:${error.message}` }
  if ((data ?? []).length > 0) return { skip: true, reason: 'cycled_recently' }
  return { skip: false, reason: null }
}
