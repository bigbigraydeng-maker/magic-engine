/** 开广告前对上当前已批准计划。对不上就拒绝，不调用广告平台。 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { parsePausedDraft } from '@/lib/ads-go-live/draft'
import { DELIVERING_STATUSES } from '@/lib/ads-strategy/portfolio/diagnostics/context'
import { MISSING_PLAN_CAP, readPlanDailyTotalCap } from '@/lib/approval-source/plan-cap'
import { CLIENT_BUDGET_FACT_FRESH_MS } from '@/lib/capabilities/ads/envelope-facts'
export const LAUNCH_NO_PLAN = '这位客户现在没有已批准的广告计划，没有开。'
export const LAUNCH_MANY_PLANS = '这位客户有不止一份已批准的广告计划，对不上单独一份，没有开。'
export const LAUNCH_NO_CAP = '已批准的计划里还没有每天广告总上限，没有开。'
export const LAUNCH_PLAN_UNREAD = '已批准的计划读不出来，没有开。'
export const LAUNCH_SNAP_MISSING = '没有抓全的广告快照，读不准现在每天在投多少，没有开。'
export const LAUNCH_SNAP_STALE = '广告快照过期了，读不准现在每天在投多少，没有开。'
export const LAUNCH_SNAP_BAD = '最近一次广告快照没抓全，读不准现在每天在投多少，没有开。'
export const LAUNCH_SNAP_UNREAD = '广告快照读不出来，没有开。'
export const LAUNCH_OVER = '开了之后每天在投的预算会超过已批准计划的每天总上限，没有开。'
export const LAUNCH_SUM_UNREAD = '现在的每日预算合计读不到，没有开。'
export const LAUNCH_NO_ACCOUNT = '没有登记广告账户，读不到在投预算，没有开。'
export const LAUNCH_ACCOUNT_UNREAD = '广告账户读不出来，没有开。'
export const LAUNCH_BUDGET_UNREAD = '草稿上没有能用的每天预算，没有开。'
export const LAUNCH_DRAFT_UNREAD = '读不到这份草稿，没有开。'
export const LAUNCH_PARENT_OFF = '快照里这个广告系列不是在投，这次没有开。'
const LOOKBACK_MS = 36 * 60 * 60 * 1000
const SNAP_ROW_CAP = 2000
export type LaunchSpend =
  | { mode: 'add'; cents: number }
  | { mode: 'ad_only' }
  | { mode: 'under_campaign'; campaignId: string; cents: number }
  | { mode: 'resume'; campaignId: string }
export type LaunchBind = { ok: true; planId: string } | { ok: false; reason: string }
type Snap = {
  ad_account_id?: string
  level?: string
  entity_id?: string
  campaign_id?: string | null
  effective_status?: string | null
  budget_level?: string | null
  daily_budget_minor?: number | null
  captured_at?: string
}
type CaptureRow = {
  captured_at?: string
  complete?: boolean
  error?: string | null
  skipped_shared?: boolean
}
type Fail = { ok: false; reason: string }
function fail(reason: string): Fail {
  return { ok: false, reason }
}
function promoPlan(planData: unknown): boolean {
  if (!planData || typeof planData !== 'object' || Array.isArray(planData)) return false
  const promo = (planData as { promo?: unknown }).promo
  return promo !== null && typeof promo === 'object' && !Array.isArray(promo)
}
function usableCents(cents: number): boolean {
  return Number.isSafeInteger(cents) && cents > 0
}
function yuanToMinor(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  const cents = Math.round(value * 100)
  if (!Number.isSafeInteger(cents) || cents <= 0) return null
  if (Math.abs(value * 100 - cents) > 1e-6) return null
  return cents
}
function delivering(status: string | null | undefined): boolean {
  return typeof status === 'string' && DELIVERING_STATUSES.has(status)
}
function dailyOrBad(value: unknown): number | 'bad' {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return 'bad'
  return value
}
function spendCents(spend: LaunchSpend): Fail | null {
  if (spend.mode !== 'add' && spend.mode !== 'under_campaign') return null
  if (!usableCents(spend.cents)) return fail(LAUNCH_BUDGET_UNREAD)
  if (spend.mode === 'under_campaign' && spend.campaignId.trim() === '') return fail(LAUNCH_PARENT_OFF)
  return null
}
async function loadPromoPlan(sb: SupabaseClient, clientId: string): Promise<{ ok: true; planId: string } | Fail> {
  const { data, error } = await sb
    .from('marketing_plans')
    .select('id, plan_data, status')
    .eq('client_id', clientId)
    .eq('status', 'approved')
  if (error) return fail(LAUNCH_PLAN_UNREAD)
  const rows = ((data ?? []) as { id?: unknown; plan_data?: unknown }[]).filter((row) => promoPlan(row.plan_data))
  if (rows.length === 0) return fail(LAUNCH_NO_PLAN)
  if (rows.length > 1) return fail(LAUNCH_MANY_PLANS)
  const id = rows[0]?.id
  if (typeof id !== 'string' || id.length === 0) return fail(LAUNCH_PLAN_UNREAD)
  return { ok: true, planId: id }
}
async function loadCap(sb: SupabaseClient, clientId: string, planId: string): Promise<{ ok: true; cents: number } | Fail> {
  const cap = await readPlanDailyTotalCap(sb, clientId, planId)
  if (cap.ok) return cap
  if (cap.reason === MISSING_PLAN_CAP) return fail(LAUNCH_NO_CAP)
  return fail(LAUNCH_PLAN_UNREAD)
}
async function accountIds(sb: SupabaseClient, clientId: string): Promise<{ ok: true; ids: string[] } | Fail> {
  const listed = await sb.from('client_meta_ad_accounts').select('ad_account_id').eq('client_id', clientId)
  if (listed.error) return fail(LAUNCH_ACCOUNT_UNREAD)
  const ids = [...new Set(
    ((listed.data ?? []) as { ad_account_id?: unknown }[])
      .map((row) => row.ad_account_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  )]
  if (ids.length > 0) return { ok: true, ids }
  const fallback = await sb.from('clients').select('meta_ad_account_id').eq('id', clientId).maybeSingle()
  if (fallback.error) return fail(LAUNCH_ACCOUNT_UNREAD)
  const id = (fallback.data as { meta_ad_account_id?: unknown } | null)?.meta_ad_account_id
  if (typeof id !== 'string' || id.length === 0) return fail(LAUNCH_NO_ACCOUNT)
  return { ok: true, ids: [id] }
}
function usableCapture(row: CaptureRow): boolean {
  return row.complete === true && (row.error == null || row.error === '') && row.skipped_shared !== true
}
async function latestCapture(
  sb: SupabaseClient,
  clientId: string,
  accountId: string,
  level: 'campaign' | 'adset',
): Promise<{ ok: true; row: CaptureRow | null } | Fail> {
  const { data, error } = await sb
    .from('ad_snapshot_captures')
    .select('captured_at, complete, error, skipped_shared')
    .eq('client_id', clientId)
    .eq('ad_account_id', accountId)
    .eq('level', level)
    .order('captured_at', { ascending: false })
    .limit(1)
  if (error) return fail(LAUNCH_SNAP_UNREAD)
  const row = ((data ?? []) as CaptureRow[])[0] ?? null
  return { ok: true, row }
}
function judgePair(campaign: CaptureRow, adset: CaptureRow, nowMs: number): { ok: true; atMs: number } | Fail {
  const at = campaign.captured_at
  if (typeof at !== 'string' || at.length === 0 || at !== adset.captured_at) return fail(LAUNCH_SNAP_BAD)
  if (!usableCapture(campaign) || !usableCapture(adset)) return fail(LAUNCH_SNAP_BAD)
  const ms = Date.parse(at)
  if (!Number.isFinite(ms) || ms > nowMs || nowMs - ms > CLIENT_BUDGET_FACT_FRESH_MS) return fail(LAUNCH_SNAP_STALE)
  return { ok: true, atMs: ms }
}
async function freshRound(
  sb: SupabaseClient,
  clientId: string,
  accountId: string,
  nowMs: number,
): Promise<{ ok: true; atMs: number } | Fail> {
  const campaign = await latestCapture(sb, clientId, accountId, 'campaign')
  if (!campaign.ok) return campaign
  const adset = await latestCapture(sb, clientId, accountId, 'adset')
  if (!adset.ok) return adset
  if (!campaign.row || !adset.row) return fail(LAUNCH_SNAP_MISSING)
  return judgePair(campaign.row, adset.row, nowMs)
}
async function entityRows(sb: SupabaseClient, clientId: string, accountId: string, atMs: number): Promise<{ ok: true; rows: Snap[] } | Fail> {
  const { data, error } = await sb
    .from('ad_entity_snapshots')
    .select('ad_account_id, level, entity_id, campaign_id, effective_status, budget_level, daily_budget_minor, captured_at')
    .eq('client_id', clientId)
    .eq('ad_account_id', accountId)
    .in('level', ['campaign', 'adset'])
    .gte('captured_at', new Date(atMs - LOOKBACK_MS).toISOString())
    .lte('captured_at', new Date(atMs).toISOString())
    .order('captured_at', { ascending: false })
    .limit(SNAP_ROW_CAP)
  if (error) return fail(LAUNCH_SUM_UNREAD)
  const rows = (data ?? []) as Snap[]
  if (rows.length >= SNAP_ROW_CAP) return fail(LAUNCH_SUM_UNREAD)
  return { ok: true, rows }
}
function newest(rows: readonly Snap[]): Map<string, Snap> {
  const out = new Map<string, Snap>()
  for (const row of rows) {
    if (typeof row.entity_id !== 'string' || (row.level !== 'campaign' && row.level !== 'adset')) continue
    const key = `${row.ad_account_id ?? ''}:${row.level}:${row.entity_id}`
    const prev = out.get(key)
    if (!prev || (row.captured_at ?? '') > (prev.captured_at ?? '')) out.set(key, row)
  }
  return out
}
function countedMinor(row: Snap, cbo: ReadonlySet<string>): number | 'bad' {
  if (row.level === 'campaign') {
    if (!delivering(row.effective_status)) return 0
    if (row.budget_level === 'abo') return 0
    if (row.budget_level !== 'cbo') return 'bad'
    return dailyOrBad(row.daily_budget_minor)
  }
  if (!delivering(row.effective_status)) return 0
  if (typeof row.campaign_id !== 'string' || row.campaign_id.length === 0) return 'bad'
  if (cbo.has(row.campaign_id)) return 0
  if (row.budget_level !== 'abo') return 'bad'
  return dailyOrBad(row.daily_budget_minor)
}
function sumRows(rows: readonly Snap[]): { ok: true; cents: number } | Fail {
  const latest = newest(rows)
  const cbo = new Set<string>()
  for (const row of latest.values()) {
    if (row.level === 'campaign' && row.budget_level === 'cbo' && delivering(row.effective_status) && row.entity_id) {
      cbo.add(row.entity_id)
    }
  }
  let total = 0
  for (const row of latest.values()) {
    const part = countedMinor(row, cbo)
    if (part === 'bad') return fail(LAUNCH_SUM_UNREAD)
    total += part
  }
  if (!Number.isSafeInteger(total)) return fail(LAUNCH_SUM_UNREAD)
  return { ok: true, cents: total }
}
function campaignMatches(rows: readonly Snap[], campaignId: string): Snap[] {
  return [...newest(rows).values()].filter((row) => row.level === 'campaign' && row.entity_id === campaignId)
}
function underAdded(rows: readonly Snap[], campaignId: string, cents: number): number | 'off' | 'bad' {
  const found = campaignMatches(rows, campaignId)
  if (found.length !== 1) return 'off'
  const campaign = found[0]
  if (!campaign || !delivering(campaign.effective_status)) return 'off'
  if (campaign.budget_level === 'cbo') return 0
  if (campaign.budget_level === 'abo') return cents
  return 'bad'
}
function resumeChildren(rows: readonly Snap[], campaignId: string): number | 'bad' {
  let total = 0
  for (const row of newest(rows).values()) {
    if (row.level !== 'adset' || row.campaign_id !== campaignId || row.effective_status !== 'CAMPAIGN_PAUSED') continue
    if (row.budget_level !== 'abo') return 'bad'
    const daily = dailyOrBad(row.daily_budget_minor)
    if (daily === 'bad') return 'bad'
    total += daily
  }
  return Number.isSafeInteger(total) ? total : 'bad'
}
function resumeAdded(rows: readonly Snap[], campaignId: string): number | 'missing' | 'bad' {
  const found = campaignMatches(rows, campaignId)
  if (found.length !== 1) return found.length === 0 ? 'missing' : 'bad'
  const campaign = found[0]
  if (!campaign) return 'missing'
  if (delivering(campaign.effective_status)) return 0
  if (campaign.budget_level === 'cbo') {
    const daily = dailyOrBad(campaign.daily_budget_minor)
    return daily === 'bad' ? 'bad' : daily
  }
  if (campaign.budget_level !== 'abo') return 'bad'
  return resumeChildren(rows, campaignId)
}
function addedFor(spend: LaunchSpend, rows: readonly Snap[]): { ok: true; cents: number } | Fail {
  if (spend.mode === 'add') return { ok: true, cents: spend.cents }
  if (spend.mode === 'ad_only') return { ok: true, cents: 0 }
  if (spend.mode === 'under_campaign') {
    const added = underAdded(rows, spend.campaignId, spend.cents)
    if (added === 'off') return fail(LAUNCH_PARENT_OFF)
    if (added === 'bad') return fail(LAUNCH_SUM_UNREAD)
    return { ok: true, cents: added }
  }
  if (spend.campaignId.trim() === '') return fail(LAUNCH_SUM_UNREAD)
  const added = resumeAdded(rows, spend.campaignId)
  if (added === 'missing' || added === 'bad') return fail(LAUNCH_SUM_UNREAD)
  return { ok: true, cents: added }
}
async function liveAndRows(
  sb: SupabaseClient,
  clientId: string,
  ids: readonly string[],
  nowMs: number,
): Promise<{ ok: true; live: number; rows: Snap[] } | Fail> {
  let live = 0
  const rows: Snap[] = []
  for (const accountId of ids) {
    const round = await freshRound(sb, clientId, accountId, nowMs)
    if (!round.ok) return round
    const loaded = await entityRows(sb, clientId, accountId, round.atMs)
    if (!loaded.ok) return loaded
    const summed = sumRows(loaded.rows)
    if (!summed.ok) return summed
    live += summed.cents
    rows.push(...loaded.rows)
  }
  if (!Number.isSafeInteger(live)) return fail(LAUNCH_SUM_UNREAD)
  return { ok: true, live, rows }
}
function withinCap(live: number, added: number, cap: number): boolean | 'bad' {
  if (!Number.isSafeInteger(live) || !Number.isSafeInteger(added) || !Number.isSafeInteger(cap)) return 'bad'
  const total = live + added
  if (!Number.isSafeInteger(total)) return 'bad'
  return total <= cap
}
export async function bindLaunchToApprovedPlan(
  sb: SupabaseClient,
  clientId: string,
  spend: LaunchSpend,
  now: Date = new Date(),
): Promise<LaunchBind> {
  const badSpend = spendCents(spend)
  if (badSpend) return badSpend
  const plan = await loadPromoPlan(sb, clientId)
  if (!plan.ok) return plan
  const cap = await loadCap(sb, clientId, plan.planId)
  if (!cap.ok) return cap
  const accounts = await accountIds(sb, clientId)
  if (!accounts.ok) return accounts
  const loaded = await liveAndRows(sb, clientId, accounts.ids, now.getTime())
  if (!loaded.ok) return loaded
  const added = addedFor(spend, loaded.rows)
  if (!added.ok) return added
  const room = withinCap(loaded.live, added.cents, cap.cents)
  if (room === 'bad') return fail(LAUNCH_SUM_UNREAD)
  if (!room) return fail(LAUNCH_OVER)
  return { ok: true, planId: plan.planId }
}
type DraftSpend = {
  dailyBudget?: unknown
  existingAdSetId?: unknown
  existingCampaignId?: unknown
}
export function spendFromDraft(draft: DraftSpend): LaunchSpend | null {
  if (typeof draft.existingAdSetId === 'string' && draft.existingAdSetId.length > 0) return { mode: 'ad_only' }
  const cents = yuanToMinor(draft.dailyBudget)
  if (cents == null) return null
  if (typeof draft.existingCampaignId === 'string' && draft.existingCampaignId.length > 0) {
    return { mode: 'under_campaign', campaignId: draft.existingCampaignId, cents }
  }
  return { mode: 'add', cents }
}
export async function bindDraftLaunch(
  sb: SupabaseClient,
  clientId: string,
  draft: DraftSpend,
  now: Date = new Date(),
): Promise<LaunchBind> {
  const spend = spendFromDraft(draft)
  if (!spend) return fail(LAUNCH_BUDGET_UNREAD)
  return bindLaunchToApprovedPlan(sb, clientId, spend, now)
}
export async function assertLaunchAllowed(
  sb: SupabaseClient,
  clientId: string,
  payload: unknown,
  now: Date = new Date(),
): Promise<LaunchBind> {
  const view = parsePausedDraft(payload)
  if (!view?.ids) return fail(LAUNCH_DRAFT_UNREAD)
  if (view.ids.reusedAdSet) return bindLaunchToApprovedPlan(sb, clientId, { mode: 'ad_only' }, now)
  const cents = yuanToMinor(view.dailyBudget)
  if (cents == null) return fail(LAUNCH_BUDGET_UNREAD)
  if (view.ids.reusedCampaign) {
    return bindLaunchToApprovedPlan(sb, clientId, { mode: 'under_campaign', campaignId: view.ids.campaignId, cents }, now)
  }
  return bindLaunchToApprovedPlan(sb, clientId, { mode: 'add', cents }, now)
}
