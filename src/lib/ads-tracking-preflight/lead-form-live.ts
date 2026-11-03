/**
 * 表单留资盯盘多读的那一层：当天花费、上限、CRM 今天进了几条、同步连续失败了几轮。
 * 读不懂 = null / known=false，不当成 0，也不因此去暂停。
 * 不点名任何客户。令牌只进 Graph 的 Authorization 头。
 */

import { loadAdStrategyConfigWithSource } from '@/lib/ads-strategy/config'
import { classifyLeadsSyncOutcome } from '@/lib/meta/leads-sync-alert'
import { isOverlapSkipSummary } from '@/lib/meta/leads-sync-lock'
import { getRegisteredAccountIds } from '@/lib/meta/campaign-ownership'
import { resolveMetaToken } from '@/lib/meta/token-selection'
import { supabaseAdmin } from '@/lib/supabase'
import { LAUNCH_WATCH_JOB } from './launch-watch'
import { previousSurplusSince, summaryMentionsCampaign } from './lead-form-history'
import { graphGetFor, readAccountTimezone, readTodaySpend } from './lead-form-read'
import type { LeadFormExtra } from './lead-form-watch'
import { dateInTimezone } from './post-launch'
import type { SeriesFacts } from './objective-watch'
import type { ObjectiveWatchSeries, TrackingClientConfig } from './types'

const SYNC_LOOKBACK = 8
const META_LEADS_SYNC_JOB = 'meta-leads-sync'

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export interface CapRead {
  known: boolean
  cents: number | null
}

function positiveCents(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null
  return n
}

function blankExtra(): LeadFormExtra {
  return {
    todaySpendCents: null,
    accountCapCents: null,
    accountCapKnown: false,
    accountTodaySpendCents: null,
    totalCapCents: null,
    totalCapKnown: false,
    clientTodaySpendCents: null,
    metaLeadsToday: null,
    crmRead: false,
    crmLeadsToday: null,
    syncRead: false,
    syncStreak: null,
  }
}

/** 账户日上限：读到了表、但这一户没配 = known 且 cents 为 null。查询失败 = known false。 */
export function accountCapFromRows(
  rows: readonly { ad_account_id?: unknown; daily_budget_cap_cents?: unknown }[] | null,
  accountId: string,
): CapRead {
  if (rows === null) return { known: false, cents: null }
  const want = accountId.replace(/^act_/, '')
  const row = rows.find(item => String(item.ad_account_id ?? '').replace(/^act_/, '') === want)
  if (!row) return { known: true, cents: null }
  return { known: true, cents: positiveCents(row.daily_budget_cap_cents) }
}

/** 总上限只认库里真实的那一行。读失败或没有这一行 = 没读到，不用默认空配置冒充「没超」。 */
export function totalCapFromSource(source: string, cents: number | null): CapRead {
  if (source !== 'row') return { known: false, cents: null }
  return { known: true, cents: positiveCents(cents) }
}

function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)
  const pick = (type: string): number => Number(parts.find(part => part.type === type)?.value ?? 'NaN')
  const asUtc = Date.UTC(pick('year'), pick('month') - 1, pick('day'), pick('hour') === 24 ? 0 : pick('hour'), pick('minute'), pick('second'))
  return asUtc - instant.getTime()
}

/** 账户时区当天 0 点的 UTC 时刻。时区不认识 = null，调用方就不去数「今天」。 */
export function startOfZonedDay(now: Date, timeZone: string): string | null {
  let day: string
  try {
    day = dateInTimezone(now, timeZone)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
    const utcMidnight = new Date(`${day}T00:00:00.000Z`)
    const offset = zoneOffsetMs(utcMidnight, timeZone)
    const start = new Date(utcMidnight.getTime() - offset)
    const offsetAtStart = zoneOffsetMs(start, timeZone)
    return (offsetAtStart === offset ? start : new Date(utcMidnight.getTime() - offsetAtStart)).toISOString()
  } catch {
    return null
  }
}

function syncState(summary: unknown, clientId: string): 'ok' | 'blocked' | 'failed' | 'absent' {
  if (!isRecord(summary) || !Array.isArray(summary.results)) return 'absent'
  const row = summary.results.find(item => isRecord(item) && item.clientId === clientId)
  if (!isRecord(row)) return 'absent'
  return classifyLeadsSyncOutcome({
    clientId,
    clientName: typeof row.clientName === 'string' ? row.clientName : null,
    error: typeof row.error === 'string' ? row.error : undefined,
    skipped: typeof row.skipped === 'string' ? row.skipped : undefined,
  }).state
}

/** 从最近一轮往前数，连续「不是成功」的轮数。客户没出现在某一轮里，连续就断了。 */
export function syncFailureStreak(runs: readonly { summary?: unknown }[], clientId: string): number {
  let streak = 0
  for (const run of runs) {
    if (isOverlapSkipSummary(run.summary)) continue
    const state = syncState(run.summary, clientId)
    if (state !== 'failed' && state !== 'blocked') break
    streak += 1
  }
  return streak
}

async function loadAccountRows(clientId: string): Promise<{ ad_account_id?: unknown; daily_budget_cap_cents?: unknown }[] | null> {
  const { data, error } = await supabaseAdmin
    .from('client_meta_ad_accounts')
    .select('ad_account_id, daily_budget_cap_cents')
    .eq('client_id', clientId)
  if (error) return null
  return (data ?? []) as { ad_account_id?: unknown; daily_budget_cap_cents?: unknown }[]
}

async function loadRegisteredIds(clientId: string): Promise<string[]> {
  const registered = await getRegisteredAccountIds(clientId)
  return registered.error ? [] : registered.ids
}

async function loadCrmCount(clientId: string, startIso: string | null): Promise<{ read: boolean; count: number | null }> {
  if (startIso === null) return { read: false, count: null }
  const { count, error } = await supabaseAdmin
    .from('contact_touchpoints')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('channel', 'meta_lead_form')
    .gte('occurred_at', startIso)
  if (error || typeof count !== 'number') return { read: false, count: null }
  return { read: true, count }
}

async function loadSyncStreak(clientId: string): Promise<{ read: boolean; streak: number | null }> {
  const { data, error } = await supabaseAdmin
    .from('cron_run_logs')
    .select('summary')
    .eq('job_name', META_LEADS_SYNC_JOB)
    .not('finished_at', 'is', null)
    .in('status', ['completed', 'partial', 'failed'])
    .order('finished_at', { ascending: false })
    .limit(SYNC_LOOKBACK)
  if (error) return { read: false, streak: null }
  return { read: true, streak: syncFailureStreak((data ?? []) as { summary?: unknown }[], clientId) }
}

/** 上一小时回执里的盈余时刻。当前这一轮还没写完，空摘要会跳过，往前找。 */
export async function loadPreviousSurplusLive(clientId: string, campaignId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('cron_run_logs')
    .select('summary')
    .eq('job_name', LAUNCH_WATCH_JOB)
    .order('started_at', { ascending: false })
    .limit(4)
  if (error) return null
  for (const row of data ?? []) {
    const summary = (row as { summary?: unknown }).summary
    const since = previousSurplusSince(summary, clientId, campaignId)
    if (since !== null) return since
    if (summaryMentionsCampaign(summary, clientId, campaignId)) return null
  }
  return null
}

async function applyCaps(extra: LeadFormExtra, clientId: string, accountId: string): Promise<string[]> {
  const [rows, registered, strategy] = await Promise.all([
    loadAccountRows(clientId),
    loadRegisteredIds(clientId),
    loadAdStrategyConfigWithSource(clientId),
  ])
  const accountCap = accountCapFromRows(rows, accountId)
  const totalCap = totalCapFromSource(strategy.source, strategy.config.daily_budget_cap_cents)
  extra.accountCapKnown = accountCap.known
  extra.accountCapCents = accountCap.cents
  extra.totalCapKnown = totalCap.known
  extra.totalCapCents = totalCap.cents
  return registered
}

function copySpend(extra: LeadFormExtra, spend: Awaited<ReturnType<typeof readTodaySpend>>): void {
  extra.todaySpendCents = spend.campaignSpendCents
  extra.metaLeadsToday = spend.campaignLeads
  extra.accountTodaySpendCents = spend.accountSpendCents
  extra.clientTodaySpendCents = spend.clientSpendCents
}

async function readLeadFormExtraUnsafe(
  clientId: string,
  cfg: TrackingClientConfig,
  series: ObjectiveWatchSeries,
  _facts: SeriesFacts,
  now: Date,
): Promise<LeadFormExtra> {
  const extra = blankExtra()
  const accountId = series.ad_account_id ?? cfg.ad_account_id
  const registered = await applyCaps(extra, clientId, accountId)
  const token = (await resolveMetaToken(supabaseAdmin, clientId, process.env))?.token ?? null
  const graphGet = token === null ? null : graphGetFor(fetch, token)
  const timezone = graphGet === null ? null : await readAccountTimezone(graphGet, accountId)
  if (graphGet !== null) {
    copySpend(extra, await readTodaySpend({
      graphGet, adAccountId: accountId, campaignId: series.campaign_id, registeredAccountIds: registered, now, timezone,
    }))
  }
  const crm = await loadCrmCount(clientId, timezone === null ? null : startOfZonedDay(now, timezone))
  const sync = await loadSyncStreak(clientId)
  extra.crmRead = crm.read
  extra.crmLeadsToday = crm.count
  extra.syncRead = sync.read
  extra.syncStreak = sync.streak
  return extra
}

/** 真读表单留资这一小时要的额外数字。任何一步抛错都当成没读到，不让整轮盯盘失败。 */
export async function readLeadFormExtraLive(
  clientId: string,
  cfg: TrackingClientConfig,
  series: ObjectiveWatchSeries,
  facts: SeriesFacts,
  now: Date,
): Promise<LeadFormExtra> {
  try {
    return await readLeadFormExtraUnsafe(clientId, cfg, series, facts, now)
  } catch {
    return blankExtra()
  }
}
