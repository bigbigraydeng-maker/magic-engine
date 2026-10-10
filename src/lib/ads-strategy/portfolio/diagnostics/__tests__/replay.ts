/**
 * 回放工具：用 2026-09-14 真实只读实拉的 Meta 数据，重建「某个历史时刻」的诊断输入。
 *
 * 不编数据形状：
 *   - 设置：当前设置快照（portfolio/__tests__/fixtures/*-settings.json）经 snapshot.ts 规范化；
 *   - 历史时刻的差异只用 Meta 自己的证据倒推：
 *       ① created_time / time_created 晚于该时刻的实体不存在；
 *       ② activities 里晚于该时刻的预算变更按 old_value 倒回；
 *       ③ 投放状态按「当天或前一天有没有花费」判（有花费 = 在投），不猜；
 *       ④ Meta 实验只在实验创建之后才挂到实体上。
 *   - 日数据：真实 insights 行经 client.ts 同一套解析（getAdsetDailyInsights）再映射成库里的列；
 *   - 小时数据：真实 hourly insights 行经 loader.ts 同一个转换函数。
 */
import { vi } from 'vitest'
import { getAdsetDailyInsights } from '@/lib/meta/client'
import type { GraphAdSettings, GraphAdsetSettings, GraphCampaignSettings, GraphCustomAudience, GraphHourlySpendRow } from '@/lib/meta/entity-settings'
import {
  normalizeAccount, normalizeAd, normalizeAdset, normalizeAudience, normalizeCampaign, selectRowsToWrite,
  type EntitySnapshotRow, type SnapshotRowDraft,
} from '../../snapshot'
import { hourlyRowsFromGraph } from '../loader'
import { shiftDate } from '../context'
import type { AccountInput, DailyRow, HourlyRow } from '../types'

export interface SettingsFixture {
  ad_account_id: string
  account: { id: string; name?: string; account_status?: number; currency?: string; timezone_name?: string }
  campaigns: Array<GraphCampaignSettings & { created_time?: string }>
  adsets: Array<GraphAdsetSettings & { created_time?: string }>
  ads: Array<GraphAdSettings & { created_time?: string }>
  audiences: GraphCustomAudience[]
}

export interface ActivityRow { event_type: string; event_time: string; object_id: string; extra_data?: string }

/** JSON 夹具 → SettingsFixture：先核对必需字段在，再收窄类型（形状不对直接抛，不静默）。 */
export function settingsFixture(json: object): SettingsFixture {
  const j = json as Partial<SettingsFixture>
  if (typeof j.ad_account_id !== 'string' || !j.account || !Array.isArray(j.campaigns) || !Array.isArray(j.adsets) || !Array.isArray(j.ads) || !Array.isArray(j.audiences)) {
    throw new Error('settings fixture shape mismatch')
  }
  return j as SettingsFixture
}

export async function dailyRowsFromGraph(raw: unknown[]): Promise<DailyRow[]> {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: raw }), { status: 200 })))
  const { rows } = await getAdsetDailyInsights('act_replay', 'replay-token', '2000-01-01', '2100-01-01')
  vi.unstubAllGlobals()
  return rows.map(r => ({
    level: 'adset' as const,
    entity_id: r.adset_id,
    parent_id: r.campaign_id || null,
    insight_date: r.insight_date,
    spend: r.spend,
    impressions: r.impressions,
    reach: r.reach,
    clicks: r.clicks,
    leads: r.leads,
    messaging_conversations: r.messaging_conversations,
    video_thruplays: r.video_thruplays,
    actions: r.actions,
  }))
}

export function hourlyFromGraph(days: Record<string, GraphHourlySpendRow[]>): Record<string, HourlyRow[]> {
  return Object.fromEntries(Object.entries(days).map(([d, rows]) => [d, hourlyRowsFromGraph(rows)]))
}

interface BudgetChange { oldMinor: number | null }

function budgetRewinds(activities: ActivityRow[], asOfIso: string): Map<string, BudgetChange> {
  // 倒回：取 asOf 之后「最早」那次变更的 old_value
  const at = (t: string) => Date.parse(t.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
  const later = activities
    .filter(a => /update_(ad_set|campaign)_budget/.test(a.event_type) && at(a.event_time) > Date.parse(asOfIso))
    .sort((a, b) => at(a.event_time) - at(b.event_time))
  const out = new Map<string, BudgetChange>()
  for (const a of later) {
    if (out.has(a.object_id)) continue
    const extra = JSON.parse(a.extra_data ?? '{}') as { old_value?: { old_value?: number | null } }
    out.set(a.object_id, { oldMinor: extra.old_value?.old_value ?? null })
  }
  return out
}

export function replaySnapshots(opts: {
  fixture: SettingsFixture
  clientId: string
  asOfIso: string
  date: string
  daily: DailyRow[]
  activities: ActivityRow[]
  studies?: { createdAtIso: string; byAdsetId: Record<string, Array<{ id: string; type: string; start_time: string; end_time: string }>> }
}): EntitySnapshotRow[] {
  const { fixture, clientId, asOfIso, date, daily } = opts
  const asOf = Date.parse(asOfIso)
  const existed = (t?: string | number) =>
    t === undefined || (typeof t === 'number' ? t * 1000 : Date.parse(t.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))) <= asOf
  const ctx = { clientId, adAccountId: fixture.ad_account_id, currency: fixture.account.currency ?? null, sharedAccount: false }
  const rewinds = budgetRewinds(opts.activities, asOfIso)
  const spentNearDate = (ids: string[]) => daily.some(r => ids.includes(r.entity_id) && (r.insight_date === date || r.insight_date === shiftDate(date, -1)) && r.spend > 0)
  const studiesOn = asOf >= Date.parse(opts.studies?.createdAtIso ?? '9999-01-01')

  const adsets = fixture.adsets.filter(s => existed(s.created_time))
  const drafts: SnapshotRowDraft[] = [normalizeAccount(ctx, fixture.account)]
  for (const c of fixture.campaigns.filter(c => existed(c.created_time))) {
    const rw = rewinds.get(c.id)
    const raw = rw ? { ...c, daily_budget: rw.oldMinor === null ? undefined : String(rw.oldMinor) } : c
    const row = normalizeCampaign(ctx, raw)
    const live = spentNearDate(adsets.filter(s => s.campaign_id === c.id).map(s => s.id))
    drafts.push({ ...row, effective_status: live ? 'ACTIVE' : 'PAUSED', status: live ? 'ACTIVE' : 'PAUSED' })
  }
  for (const s of adsets) {
    const rw = rewinds.get(s.id)
    const raw = rw ? { ...s, daily_budget: rw.oldMinor === null ? undefined : String(rw.oldMinor) } : s
    const withStudies = studiesOn && opts.studies?.byAdsetId[s.id] ? { ...raw, ad_studies: { data: opts.studies.byAdsetId[s.id] } } : raw
    const row = normalizeAdset(ctx, withStudies)
    const live = spentNearDate([s.id])
    drafts.push({ ...row, effective_status: live ? 'ACTIVE' : 'PAUSED', status: live ? 'ACTIVE' : 'PAUSED' })
  }
  for (const a of fixture.ads.filter(a => existed(a.created_time))) drafts.push(normalizeAd(ctx, a))
  for (const a of fixture.audiences.filter(a => existed(a.time_created))) drafts.push(normalizeAudience(ctx, a))
  return selectRowsToWrite(drafts, [], { capturedAt: asOfIso, dayKey: s => s.slice(0, 10) })
}

export function accountInput(opts: {
  fixture: SettingsFixture
  snapshots: EntitySnapshotRow[]
  daily: DailyRow[]
  hourly?: Record<string, HourlyRow[]>
  lastInsightDate: string | null
  shared?: boolean
}): AccountInput {
  return {
    adAccountId: opts.fixture.ad_account_id,
    shared: opts.shared ?? false,
    timezone: opts.fixture.account.timezone_name ?? null,
    currency: opts.fixture.account.currency ?? null,
    snapshots: opts.snapshots,
    daily: opts.daily,
    hourly: opts.hourly ?? {},
    hourlyError: null,
    latestCaptures: [{ level: 'account', complete: true, skipped_shared: false, error: null, captured_at: '2026-09-14T00:30:00Z' }],
    lastInsightDate: opts.lastInsightDate,
  }
}
