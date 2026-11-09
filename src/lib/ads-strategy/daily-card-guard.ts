/**
 * Confirm-time re-read for cards the daily jobs issued.
 * A stale snapshot or a rule that no longer holds stops the write.
 * This file does not call the ad platform.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { KernelDeps } from '@/lib/kernel/deps'
import { dailyTotalCapCents } from '@/lib/marketing-plan/promo/daily-total-cap'
import { isExpired, readStoredCard } from '@/lib/confirmation-card/view'
import type { CardResolution } from '@/lib/confirmation-card/decide'
import { DEFAULT_STALE_HOURS } from '@/lib/ads-strategy/circuit-breaker/settings'
import { loadBreakerFacts } from '@/lib/ads-strategy/circuit-breaker/load'
import { judgeBreaker } from '@/lib/ads-strategy/circuit-breaker/rules'
import { loadScaleFallback } from '@/lib/ads-strategy/scale-fallback/load'
import { judgeScaleFallback } from '@/lib/ads-strategy/scale-fallback/rules'

const HOUR_MS = 3_600_000
const CAPTURE_LIMIT = 40

export const STALE_SNAPSHOT = '广告快照不是最近一次抓全的，或者抓的时候出错了，没有改广告。'
export const SNAPSHOT_UNREAD = '广告快照读不出来，没有改广告。'
export const DATA_UNREAD = '广告数据读不出来，没有改广告。'
export const RULE_CLEARED = '按最新数字，这条建议已经不成立，没有改广告。'
export const NO_PLAN = '这位客户现在没有已批准的广告计划，没有改广告。'
export const MANY_PLANS = '这位客户有不止一份已批准的广告计划，对不上单独一份，没有改广告。'
export const NO_CAP = '已批准的计划里还没有每天广告总上限，没有改广告。'
export const PLAN_UNREAD = '已批准的计划读不出来，没有改广告。'
export const NZ_DAY_EXPIRED = '过了当天新西兰时间 23:59 没人点，这张卡作废了。'

interface CaptureRow {
  captured_at?: string
  complete?: boolean
  error?: string | null
  skipped_shared?: boolean
}

type CaptureState = 'fresh' | 'stale' | 'unread'

export async function latestUsableCapture(
  sb: SupabaseClient,
  clientId: string,
  accountId: string,
  level: string,
): Promise<{ state: 'row'; capturedAt: string } | { state: 'none' } | { state: 'unread' }> {
  const { data, error } = await sb.from('ad_snapshot_captures')
    .select('captured_at, complete, error, skipped_shared')
    .eq('client_id', clientId)
    .eq('ad_account_id', accountId)
    .eq('level', level)
    .order('captured_at', { ascending: false })
    .limit(CAPTURE_LIMIT)
  if (error) return { state: 'unread' }
  const row = ((data ?? []) as CaptureRow[]).find(usableCapture)
  if (!row?.captured_at) return { state: 'none' }
  return { state: 'row', capturedAt: row.captured_at }
}

export async function captureIsFresh(
  sb: SupabaseClient,
  clientId: string,
  accountId: string,
  now: Date,
  maxAgeMs: number,
  levels: readonly string[] = ['ad', 'campaign'],
): Promise<CaptureState> {
  for (const level of levels) {
    const found = await latestUsableCapture(sb, clientId, accountId, level)
    if (found.state === 'unread') return 'unread'
    if (found.state === 'none') return 'stale'
    const age = now.getTime() - Date.parse(found.capturedAt)
    if (!Number.isFinite(age) || age < 0 || age > maxAgeMs) return 'stale'
  }
  return 'fresh'
}

export async function singleApprovedPlanReason(sb: SupabaseClient, clientId: string): Promise<string | null> {
  const { data, error } = await sb.from('marketing_plans')
    .select('id, plan_data')
    .eq('client_id', clientId)
    .eq('status', 'approved')
  if (error) return PLAN_UNREAD
  const rows = ((data ?? []) as { plan_data?: unknown }[]).filter((row) => hasPromo(row.plan_data))
  if (rows.length === 0) return NO_PLAN
  if (rows.length !== 1) return MANY_PLANS
  if (dailyTotalCapCents(rows[0]?.plan_data) === null) return NO_CAP
  return null
}

export async function recheckBreakerPause(
  sb: SupabaseClient,
  clientId: string,
  campaignId: string,
  accountId: string,
  now: Date,
  ports: {
    plan?: typeof singleApprovedPlanReason
    load?: typeof loadBreakerFacts
    capture?: typeof captureIsFresh
  } = {},
): Promise<string | null> {
  const plan = await (ports.plan ?? singleApprovedPlanReason)(sb, clientId)
  if (plan) return plan
  const facts = await (ports.load ?? loadBreakerFacts)(sb, clientId, now)
  if (facts === 'unreadable') return DATA_UNREAD
  const maxAge = (facts.settings.staleHours || DEFAULT_STALE_HOURS) * HOUR_MS
  const capture = await (ports.capture ?? captureIsFresh)(sb, clientId, accountId, now, maxAge)
  if (capture === 'unread') return SNAPSHOT_UNREAD
  if (capture === 'stale') return STALE_SNAPSHOT
  const still = judgeBreaker(facts).pauses.some((pause) => pause.campaignId === campaignId)
  return still ? null : RULE_CLEARED
}

export async function recheckScaleFallback(
  sb: SupabaseClient,
  clientId: string,
  subjectKey: string,
  now: Date,
  ports: {
    plan?: typeof singleApprovedPlanReason
    load?: typeof loadScaleFallback
  } = {},
): Promise<string | null> {
  const plan = await (ports.plan ?? singleApprovedPlanReason)(sb, clientId)
  if (plan) return plan
  const loaded = await (ports.load ?? loadScaleFallback)(sb, clientId, now)
  if (loaded === 'unreadable') return DATA_UNREAD
  if (!loaded.fresh) return STALE_SNAPSHOT
  const still = judgeScaleFallback(loaded).some((item) => item.subjectKey === subjectKey)
  return still ? null : RULE_CLEARED
}

export async function blockScaleFallbackOnConfirm(
  kernel: KernelDeps,
  clientId: string,
  runId: string,
  resolution: CardResolution,
  now = new Date(),
): Promise<string | null> {
  if (resolution !== 'confirm' || typeof kernel.requireRun !== 'function') return null
  const run = await kernel.requireRun(runId)
  if (run.client_id !== clientId) return null
  const stored = readStoredCard(run.input)
  if (!stored || stored.lifetime !== 'nz_day' || !stored.subjectKey.startsWith('scale-back-')) return null
  if (isExpired(stored.issuedAt, now, 'nz_day')) return NZ_DAY_EXPIRED
  return recheckScaleFallback(kernel.supabase, clientId, stored.subjectKey, now)
}

function usableCapture(row: CaptureRow): boolean {
  return row.complete === true
    && row.skipped_shared !== true
    && (row.error == null || row.error === '')
    && typeof row.captured_at === 'string'
}

function hasPromo(planData: unknown): boolean {
  if (!planData || typeof planData !== 'object' || Array.isArray(planData)) return false
  const promo = (planData as { promo?: unknown }).promo
  return promo !== null && typeof promo === 'object' && !Array.isArray(promo)
}
