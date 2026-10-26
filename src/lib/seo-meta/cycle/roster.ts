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
import { normalizeSlug, parseProtectedSlugs, readProtectedRaw } from '@/lib/seo/protected-pages'
import { STEP6_JOB_NAME } from './receipts'
import type { MetaCycleClientConfig } from './types'

export { isoWeekKey, normalizeSlug }

export const META_CYCLE_DUE_EVENT = 'seo/meta-cycle.due'
export const META_CYCLE_JOB = 'seo-meta-cycle'

/**
 * Same UTC time the CTS weekly cron used ("Monday 05:30 UTC, right after
 * oztop-seo-optimizer") — no TZ math, chosen for wall-clock parity with what
 * operators already expect.
 *
 * render.yaml's old `cts-seo-optimizer` cron entry is retired in this same
 * PR (removed, not just disabled) — both flows writing to the same repo/table
 * at once was the risk, so they were never allowed to coexist past this PR.
 */
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
  /** See MetaCycleClientConfig.keywordFallbackLocations — validated here so a malformed config value can never reach the gate as garbage location_codes. */
  keywordFallbackLocations: number[]
  /** See MetaCycleClientConfig.protectedSlugs — validated here so a malformed config value can never silently become "protect nothing". */
  protectedSlugs: string[]
}

export type RosterResult =
  | { ok: true; entries: MetaCycleRosterEntry[] }
  | { ok: false; reason: string }

const DEFAULT_MAX_PAGES_PER_RUN = 3
/** 复审 2026-09-20（第三轮）item 2: a client config mistake (e.g. someone types
 *  30 instead of 3 into meta_cycle_max_pages) must not translate into 10x
 *  the intended weekly PR/AI/SERP spend — hard-capped regardless of what
 *  seo_config says. */
const HARD_MAX_PAGES_PER_RUN = 3
const DEFAULT_COOLDOWN_DAYS = 30
const DEFAULT_BRAND_VOICE = 'Professional, factual AU/NZ English. No invented prices, dates, or itinerary details.'
/** PM 2026-09-20 (fourth pass): at most 2 fallback locations — this is a small, deliberate escape hatch (CTS configures [2036]/AU today), not a general multi-market crawl. */
const MAX_KEYWORD_FALLBACK_LOCATIONS = 2
function parseKeywordFallbackLocations(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((v): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0)
    .slice(0, MAX_KEYWORD_FALLBACK_LOCATIONS)
}

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

  const entries = (data ?? []).flatMap((row) => {
    const entry = rowToEntry(row as { id?: unknown; domain?: unknown; semrush_db?: unknown; seo_config?: unknown })
    return entry ? [entry] : []
  })

  return { ok: true, entries }
}

function rowToEntry(row: { id?: unknown; domain?: unknown; semrush_db?: unknown; seo_config?: unknown }): MetaCycleRosterEntry | null {
  if (typeof row.id !== 'string' || row.id.length === 0) return null
  if (typeof row.domain !== 'string' || row.domain.trim().length === 0) return null
  const cfg = (row.seo_config ?? {}) as Record<string, unknown>
  const protectedRaw = readProtectedRaw(row.seo_config)
  const protectedResult = protectedRaw.malformed
    ? { entries: [] as string[], malformed: true, reason: 'seo_config_not_object' as string | null }
    : parseProtectedSlugs(protectedRaw.raw)
  if (protectedResult.malformed) {
    console.error(`[seo-meta-cycle] client ${row.id}: protected-page list is malformed (${protectedResult.reason}) — skipping client (treating as empty would mean "protect nothing", the opposite of intent)`)
    return null
  }
  return {
    clientId: row.id,
    domain: row.domain.trim(),
    semrushDb: typeof row.semrush_db === 'string' ? row.semrush_db : null,
    maxPagesPerRun: Math.min(
      typeof cfg.meta_cycle_max_pages === 'number' && cfg.meta_cycle_max_pages > 0 ? cfg.meta_cycle_max_pages : DEFAULT_MAX_PAGES_PER_RUN,
      HARD_MAX_PAGES_PER_RUN,
    ),
    cooldownDays: typeof cfg.meta_cycle_cooldown_days === 'number' && cfg.meta_cycle_cooldown_days > 0 ? cfg.meta_cycle_cooldown_days : DEFAULT_COOLDOWN_DAYS,
    brandVoice: typeof cfg.meta_cycle_brand_voice === 'string' && cfg.meta_cycle_brand_voice.trim().length > 0 ? cfg.meta_cycle_brand_voice : DEFAULT_BRAND_VOICE,
    keywordFallbackLocations: parseKeywordFallbackLocations(cfg.meta_cycle_keyword_fallback_locations),
    protectedSlugs: protectedResult.entries,
  }
}

/**
 * PM 2026-09-20（incident follow-up）: dry-run needs to test a client's
 * config BEFORE `meta_cycle_enabled` is ever flipped on — that's the whole
 * point of "PM 点头才重新打开开关". Deliberately does NOT filter by the
 * enabled flag (unlike loadMetaCycleRoster), so only ever call this from
 * the dry-run path, never from anything that might actually write.
 */
export async function loadMetaCycleClientConfigForDryRun(supabase: SupabaseClient, clientId: string): Promise<MetaCycleRosterEntry | null> {
  const { data } = await supabase
    .from('clients')
    .select('id, domain, semrush_db, seo_config')
    .eq('id', clientId)
    .eq('client_status', 'active')
    .not('domain', 'is', null)
    .maybeSingle()
  return data ? rowToEntry(data as { id?: unknown; domain?: unknown; semrush_db?: unknown; seo_config?: unknown }) : null
}

export function toClientConfig(entry: MetaCycleRosterEntry): MetaCycleClientConfig {
  return {
    clientId: entry.clientId,
    domain: entry.domain,
    semrushDb: entry.semrushDb,
    maxPagesPerRun: entry.maxPagesPerRun,
    cooldownDays: entry.cooldownDays,
    brandVoice: entry.brandVoice,
    keywordFallbackLocations: entry.keywordFallbackLocations,
    protectedSlugs: entry.protectedSlugs,
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
