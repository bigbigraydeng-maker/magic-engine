/**
 * Read existing ads config and snapshots, then build ports for a confirmed card.
 * Graph calls stay inside the existing ad wrappers and run only after confirm.
 */

import type { KernelDeps } from '@/lib/kernel/deps'
import { decideConfirmationCard } from '@/lib/confirmation-card'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { readPromoSpec, allAdsSteps } from '@/lib/marketing-plan/promo/spec'
import { agreedPlanDailyTotalCap } from '@/lib/approval-source/plan-cap'
import { createAdFromPost, readAdPlacement } from '@/lib/meta/ads-manager'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { pauseConfirmedWinnerAd } from '@/lib/ads-pause-card/winner-pause'
import { latestUsableCapture, singleApprovedPlanReason } from '@/lib/ads-strategy/daily-card-guard'
import {
  decideCreatives,
  rulesFromConfig,
  type CaptureFact,
  type CreativeDecision,
  type LiveCreative,
  type PlanRoom,
  type ScaleRoom,
} from '@/lib/creative-state/rules'
import {
  confirmCreativeStateCard,
  type ConfirmCreativeInput,
  type CreativePorts,
  type CreativeResult,
} from './creative-state-card'

const ROW_CAP = 2000
type Sb = KernelDeps['supabase']

export async function loadCreativeDecision(
  sb: Sb,
  clientId: string,
  now: Date,
  promotionsToday?: Promise<number>,
): Promise<CreativeDecision> {
  const config = await maybe(sb, 'winner_reel_sync_config', 'target_adset_id, ad_account_id, fb_page_id', clientId, true)
  if (config === 'unread') return empty('ledger_unread')
  const scaleId = text(config?.target_adset_id)
  const accountId = text(config?.ad_account_id)
  if (!scaleId || !accountId) return empty('no_scale_adset')
  const strategy = await maybe(sb, 'ad_strategy_configs', 'target_cost_per_primary, min_primary_per_unit', clientId, false)
  if (strategy === 'unread') return empty('ledger_unread')
  const leads = await readLeads(sb, clientId)
  if (leads === 'unread') return empty('ledger_unread')
  const plans = await approvedPlans(sb, clientId)
  if (plans === 'unread') return empty('ledger_unread')
  const capture = await latestCapture(sb, clientId, accountId)
  if (capture === 'unread') return empty('ledger_unread')
  const built = await buildAds(sb, clientId, accountId, scaleId, text(config?.fb_page_id), now)
  if (built === 'unread') return empty('ledger_unread')
  if (built === 'capped') return empty('too_many_rows')
  return decideCreatives({
    rules: rulesFromConfig(strategy, plans, leads),
    captures: capture ? [capture] : [],
    creatives: built.creatives,
    scale: built.scale,
    plan: planRoomFrom(plans),
    promotionsToday: await (promotionsToday ?? countPromotions(sb, clientId, now)),
    now,
  })
}

export function liveCreativePorts(kernel: KernelDeps): CreativePorts {
  return {
    decide: (input) => decideConfirmationCard(kernel, {
      clientId: input.clientId,
      runId: input.runId,
      clicker: input.clicker,
      resolution: input.choice,
      expectedDecisionId: input.decisionId,
      fingerprint: input.fingerprint,
    }),
    recheck: (clientId) => recheckCreative(kernel, clientId),
    token: getMetaTokenForClient,
    createPaused: (input) => createAdFromPost(input),
    readPlacement: async (adId, token) => {
      const row = await readAdPlacement(adId, token)
      return row ? { status: row.status, adsetId: row.adsetId } : null
    },
    pause: (input) => pauseConfirmedWinnerAd(input),
  }
}

export async function confirmCreativeStateFromSession(
  kernel: KernelDeps,
  input: Omit<ConfirmCreativeInput, 'actor'> & { userId: string },
): Promise<CreativeResult> {
  const access = await requirePaidClientAccess(input.clientId)
  if (!access.ok || !access.user.id || access.user.id !== input.userId) {
    throw new ConfirmationCardError('forbidden', '请先登录后再确认。')
  }
  return confirmCreativeStateCard(kernel, {
    ...input,
    actor: { triggeredBy: 'human', triggeredByRef: access.user.id },
  }, liveCreativePorts(kernel))
}

async function buildAds(
  sb: Sb,
  clientId: string,
  accountId: string,
  scaleId: string,
  pageId: string | null,
  now: Date,
): Promise<{ creatives: LiveCreative[]; scale: ScaleRoom } | 'unread' | 'capped'> {
  const insights = await insightRows(sb, clientId, accountId, now)
  const snaps = await rows(sb, 'ad_entity_snapshots', 'level, entity_id, adset_id, status, effective_status, entity_name, creative_page_id, daily_budget_minor, captured_at, capture_reason', clientId, accountId, null)
  const links = await rows(sb, 'ad_creative_links', 'ad_id, post_id, page_id', clientId, null, null)
  if (insights === 'unread' || snaps === 'unread' || links === 'unread') return 'unread'
  if (insights.length >= ROW_CAP || snaps.length >= ROW_CAP || links.length >= ROW_CAP) return 'capped'
  return assemble(insights, snaps, links, accountId, scaleId, pageId, now)
}

export function assemble(
  insights: Record<string, unknown>[],
  snaps: Record<string, unknown>[],
  links: Record<string, unknown>[],
  accountId: string,
  scaleId: string,
  pageId: string | null,
  now: Date,
): { creatives: LiveCreative[]; scale: ScaleRoom } {
  const latest = latestBy(snaps)
  const posts = new Map(links.flatMap((row) => {
    const adId = text(row.ad_id)
    const postId = text(row.post_id)
    return adId && postId ? [[adId, { postId, pageId: text(row.page_id) }] as const] : []
  }))
  const byAd = groupInsights(insights)
  const today = now.toISOString().slice(0, 10)
  const creatives: LiveCreative[] = []
  let spentToday = 0
  let sawToday = false
  for (const days of byAd.values()) {
    if (days.some((day) => day.date === today)) sawToday = true
  }
  for (const snap of latest.values()) {
    if (snap.level !== 'ad' || snap.reason === 'disappeared') continue
    if (snap.status !== 'ACTIVE') continue
    const days = byAd.get(snap.id) ?? []
    const live = summarize(days)
    if (snap.adsetId === scaleId) {
      for (const day of days) if (day.date === today) spentToday += day.spend
    }
    if (!snap.adsetId || !live) continue
    const link = posts.get(snap.id)
    creatives.push({
      adId: snap.id, name: snap.name || '广告', stage: snap.adsetId === scaleId ? 'scale' : 'test', status: 'ACTIVE',
      liveDays: live.days, leads: live.leads, spend: live.spend,
      postId: link?.postId ?? null, pageId: link?.pageId ?? snap.pageId ?? pageId,
      adAccountId: accountId, adsetId: snap.adsetId,
    })
  }
  const scaleSnap = latest.get(`adset:${scaleId}`)
  const daily = scaleSnap?.budgetMinor != null ? scaleSnap.budgetMinor / 100 : null
  return { creatives, scale: { adsetId: scaleId, dailyBudget: daily, spentToday: sawToday ? spentToday : null } }
}

function summarize(days: Array<{ date: string; spend: number; leads: number }>): { days: number; leads: number; spend: number } | null {
  const spent = days.filter((day) => day.spend > 0)
  if (spent.length === 0) return null
  return {
    days: new Set(spent.map((day) => day.date)).size,
    leads: days.reduce((sum, day) => sum + day.leads, 0),
    spend: days.reduce((sum, day) => sum + day.spend, 0),
  }
}

function groupInsights(rows: Record<string, unknown>[]): Map<string, Array<{ date: string; spend: number; leads: number }>> {
  const out = new Map<string, Array<{ date: string; spend: number; leads: number }>>()
  for (const row of rows) {
    const adId = text(row.entity_id)
    const date = text(row.insight_date)
    const spend = num(row.spend)
    const leads = num(row.leads)
    if (!adId || !date || spend === null || leads === null) continue
    const list = out.get(adId) ?? []
    list.push({ date: date.slice(0, 10), spend, leads })
    out.set(adId, list)
  }
  return out
}

async function readLeads(sb: Sb, clientId: string): Promise<unknown | 'unread'> {
  const { data, error } = await sb.from('clients').select('leads_config').eq('id', clientId).maybeSingle()
  if (error) return 'unread'
  return (data as { leads_config?: unknown } | null)?.leads_config ?? null
}

async function approvedPlans(sb: Sb, clientId: string): Promise<{ plan_data?: unknown }[] | 'unread'> {
  const { data, error } = await sb.from('marketing_plans').select('status, plan_data').eq('client_id', clientId).eq('status', 'approved')
  if (error) return 'unread'
  return (data ?? []) as { plan_data?: unknown }[]
}

function planRoomFrom(rows: readonly { plan_data?: unknown }[]): PlanRoom {
  const cap = agreedPlanDailyTotalCap(rows)
  return { approvedDailyCap: cap.state === 'set' ? cap.cents / 100 : null, committedDaily: committedMajor(rows) }
}

function committedMajor(rows: readonly { plan_data?: unknown }[]): number | null {
  const totals: number[] = []
  for (const row of rows) {
    const spec = readPromoSpec(row.plan_data)
    if (!spec) continue
    const steps = allAdsSteps(spec)
    if (steps.length === 0) return null
    let cents = 0
    for (const { step } of steps) {
      const value = step.settings.daily_budget_cents
      if (!Number.isSafeInteger(value) || value <= 0) return null
      cents += value
    }
    totals.push(cents)
  }
  return totals.length === 1 ? (totals[0] ?? 0) / 100 : null
}

async function countPromotions(sb: Sb, clientId: string, now: Date): Promise<number> {
  const { data, error } = await sb.from('flywheel_actions').select('payload').eq('client_id', clientId).eq('action_type', 'ads.creative_state_proposal')
  if (error || !data) return Number.POSITIVE_INFINITY
  const day = now.toISOString().slice(0, 10)
  return (data as Array<{ payload?: { kind?: string; proposedOn?: string } }>).filter((row) => (
    (row.payload?.kind === 'move_to_scale' || row.payload?.kind === 'new_plan') && row.payload.proposedOn === day
  )).length
}

async function recheckCreative(kernel: KernelDeps, clientId: string): Promise<CreativeDecision> {
  const decision = await loadCreativeDecision(kernel.supabase, clientId, kernel.now(), Promise.resolve(0))
  const plan = await singleApprovedPlanReason(kernel.supabase, clientId)
  if (!plan) return decision
  return { proposals: [], skipped: [...decision.skipped, 'plan_guard'] }
}

async function latestCapture(sb: Sb, clientId: string, accountId: string): Promise<CaptureFact | null | 'unread'> {
  const found = await latestUsableCapture(sb, clientId, accountId, 'ad')
  if (found.state === 'unread') return 'unread'
  if (found.state === 'none') return null
  return { accountId, complete: true, capturedAt: found.capturedAt }
}

async function maybe(sb: Sb, table: string, columns: string, clientId: string, enabled: boolean): Promise<Record<string, unknown> | null | 'unread'> {
  let query = sb.from(table).select(columns).eq('client_id', clientId)
  if (enabled) query = query.eq('enabled', true)
  const { data, error } = await query.maybeSingle()
  if (error) return 'unread'
  return (data as Record<string, unknown> | null) ?? null
}

async function insightRows(sb: Sb, clientId: string, accountId: string, now: Date) {
  const since = new Date(now.getTime() - 40 * 86_400_000).toISOString().slice(0, 10)
  const { data, error } = await sb.from('ad_daily_insights')
    .select('entity_id, insight_date, spend, leads')
    .eq('client_id', clientId)
    .eq('ad_account_id', accountId)
    .eq('level', 'ad')
    .gte('insight_date', since)
    .limit(ROW_CAP)
  if (error) return 'unread' as const
  return (data ?? []) as unknown as Record<string, unknown>[]
}

async function rows(sb: Sb, table: string, columns: string, clientId: string, accountId: string | null, level: string | null) {
  let query = sb.from(table).select(columns).eq('client_id', clientId).limit(ROW_CAP)
  if (accountId) query = query.eq('ad_account_id', accountId)
  if (level) query = query.eq('level', level)
  const { data, error } = await query
  if (error) return 'unread' as const
  return (data ?? []) as unknown as Record<string, unknown>[]
}

function latestBy(rows: Record<string, unknown>[]): Map<string, Snap> {
  const out = new Map<string, Snap>()
  const ordered = [...rows].sort((a, b) => String(b.captured_at).localeCompare(String(a.captured_at)))
  for (const row of ordered) {
    const id = text(row.entity_id)
    const level = text(row.level)
    if (!id || !level || out.has(`${level}:${id}`)) continue
    out.set(`${level}:${id}`, {
      id,
      level: text(row.level),
      adsetId: text(row.adset_id),
      status: text(row.effective_status) ?? text(row.status),
      name: text(row.entity_name) ?? '',
      pageId: text(row.creative_page_id),
      budgetMinor: num(row.daily_budget_minor),
      reason: text(row.capture_reason),
    })
  }
  return out
}

function empty(reason: string): CreativeDecision {
  return { proposals: [], skipped: [reason] }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function num(value: unknown): number | null {
  const amount = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(amount) ? amount : null
}

interface Snap {
  id: string
  level: string | null
  adsetId: string | null
  status: string | null
  name: string
  pageId: string | null
  budgetMinor: number | null
  reason: string | null
}
