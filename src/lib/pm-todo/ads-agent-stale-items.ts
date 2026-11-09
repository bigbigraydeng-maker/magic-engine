/**
 * 广告 Agent 定时任务太久没成功 + 花费超日上限只读提醒 → 今日待办（按客户）。
 *
 * 只读：不暂停广告、不改预算、不写熔断。跟 ads-circuit-items 分工：
 * 熔断那条读 ads_circuit_events；这里的花费提醒在熔断之前就让人看见。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { APP_BASE } from './binding-request-items'
import { getActiveClientsWithMetaAccounts } from '@/lib/meta/client-ad-accounts'
import { PRESCRIPTION_WEEKLY_CHECK_KIND } from '@/lib/diagnostic/prescription-weekly-check'
import { pickInActPrescriptions } from '@/lib/diagnostic/prescription-weekly-check-text'
import {
  type AdAgentJobId,
  AD_AGENT_SCHEDULED_JOBS,
} from '@/lib/ads-strategy/monitoring/agent-jobs'
import {
  evaluateClientJobStaleness,
  formatStaleJobsSummary,
} from '@/lib/ads-strategy/monitoring/staleness'
import { loadClientCapFacts } from '@/lib/ads-strategy/circuit-cap-facts'
import { readClientPacing } from '@/lib/ads-strategy/intraday-spend/db'
import {
  evaluateDailySpendOverCapNotice,
  forecastOverCapWhat,
  spendCapNoticeWhat,
} from '@/lib/ads-strategy/monitoring/spend-cap-notice'
import { listActiveCircuitTrips } from '@/lib/ads-strategy/circuit-state'
import {
  AD_HEARTBEAT_JOB_NAME,
  evaluateHeartbeatStall,
  heartbeatStallShouldAlert,
  heartbeatStallSummary,
  readHeartbeatEnvConfig,
  type HeartbeatCronRun,
} from '@/lib/ads-strategy/monitoring/heartbeat-stall'
import {
  collectDailyPullbackGaps,
  formatDailyPullbackGapWhat,
  type PullbackErrorRow,
} from '@/lib/ads-strategy/monitoring/daily-pullback-gaps'

export type AdsAgentSyncStaleItemKind = 'ads_agent_sync_stale'
export type AdsDailySpendOverCapNoticeItemKind = 'ads_daily_spend_over_cap_notice'
export type AdsHeartbeatStallItemKind = 'ads_heartbeat_stall'
export type AdsAgentDailyPullGapItemKind = 'ads_agent_daily_pull_gap'
export type AdsPlanDailyCapMissingItemKind = 'ads_plan_daily_cap_missing'

const DAILY_PULLBACK_JOB = 'google-data-pullback-daily'
const DAILY_PULLBACK_STALE_HOURS = 30
const HEARTBEAT_LOOKBACK_HOURS = 72

const META_LEADS_LOOKBACK_MS = 48 * 3_600_000
const PRESCRIPTION_LOOKBACK_DAYS = 10

function adsHealthHref(clientId: string): string {
  return `${APP_BASE}/dashboard/clients/${encodeURIComponent(clientId)}/ads-health`
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

async function maxTimestamp(
  supabase: SupabaseClient,
  table: 'ad_daily_insights' | 'ad_entity_snapshots',
  clientId: string,
  column: 'updated_at' | 'captured_at',
): Promise<string | null> {
  const { data, error } = await supabase
    .from(table)
    .select(column)
    .eq('client_id', clientId)
    .order(column, { ascending: false })
    .limit(1)
  if (error) throw new Error(`${table} 读取失败：${error.message}`)
  const row = data?.[0] as Record<string, string> | undefined
  return row?.[column] ?? null
}

interface LeadsRunRow {
  finished_at: string | null
  started_at: string
  summary: unknown
}

function parseLeadsLastOk(
  clientId: string,
  runs: readonly LeadsRunRow[],
): string | null {
  for (const run of runs) {
    const at = run.finished_at ?? run.started_at
    const summary = run.summary
    if (!isRecord(summary) || !Array.isArray(summary.receipts)) continue
    for (const raw of summary.receipts) {
      if (!isRecord(raw)) continue
      if (raw.clientId !== clientId) continue
      if (raw.state === 'ok') return at
    }
  }
  return null
}

async function loadMetaLeadsRuns(supabase: SupabaseClient, since: string): Promise<LeadsRunRow[]> {
  const { data, error } = await supabase
    .from('cron_run_logs')
    .select('finished_at, started_at, summary')
    .eq('job_name', 'meta-leads-sync')
    .eq('status', 'completed')
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(120)
  if (error) throw new Error(`meta-leads-sync 运行记录读取失败：${error.message}`)
  return (data ?? []) as LeadsRunRow[]
}

async function loadClientsWithFacebookPage(supabase: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('clients')
    .select('id')
    .not('facebook_page_id', 'is', null)
  if (error) throw new Error(`clients 读取失败：${error.message}`)
  return new Set((data ?? []).map((r) => (r as { id: string }).id))
}

async function loadPrescriptionInActClients(supabase: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('prescriptions')
    .select('id, client_id, goal_id, status, approved_at')
    .eq('status', 'approved')
    .limit(500)
  if (error) throw new Error(`prescriptions 读取失败：${error.message}`)
  const picked = pickInActPrescriptions((data ?? []) as Parameters<typeof pickInActPrescriptions>[0])
  return new Set(picked.map((p) => p.client_id))
}

function parsePrescriptionLastOk(
  clientId: string,
  logs: Array<{ started_at: string; summary: unknown }>,
): string | null {
  for (const log of logs) {
    const summary = log.summary
    if (!isRecord(summary) || summary.kind !== PRESCRIPTION_WEEKLY_CHECK_KIND) continue
    if (!Array.isArray(summary.outcomes)) continue
    for (const raw of summary.outcomes) {
      if (!isRecord(raw) || raw.clientId !== clientId) continue
      if (raw.result === 'checked') return log.started_at
    }
  }
  return null
}

async function loadPrescriptionWeeklyLogs(
  supabase: SupabaseClient,
  since: string,
): Promise<Array<{ started_at: string; summary: unknown }>> {
  const { data, error } = await supabase
    .from('cron_run_logs')
    .select('started_at, summary')
    .eq('job_name', 'prescription-weekly')
    .eq('status', 'completed')
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(5)
  if (error) throw new Error(`prescription-weekly 运行记录读取失败：${error.message}`)
  return (data ?? []) as Array<{ started_at: string; summary: unknown }>
}

async function freshnessForClient(
  supabase: SupabaseClient,
  clientId: string,
  opts: {
    metaLeadsRuns: LeadsRunRow[]
    fbPageClients: Set<string>
    prescriptionLogs: Array<{ started_at: string; summary: unknown }>
    prescriptionClients: Set<string>
  },
): Promise<Partial<Record<AdAgentJobId, string | null>>> {
  const insightsAt = await maxTimestamp(supabase, 'ad_daily_insights', clientId, 'updated_at')
  const entityAt = await maxTimestamp(supabase, 'ad_entity_snapshots', clientId, 'captured_at')
  const out: Partial<Record<AdAgentJobId, string | null>> = {
    insights: insightsAt,
    entity_snapshots: entityAt,
    spend_fetch: insightsAt,
  }
  if (opts.fbPageClients.has(clientId)) {
    out.meta_leads_sync = parseLeadsLastOk(clientId, opts.metaLeadsRuns)
  }
  if (opts.prescriptionClients.has(clientId)) {
    out.prescription_weekly = parsePrescriptionLastOk(clientId, opts.prescriptionLogs)
  }
  return out
}

function staleItem(
  clientId: string,
  clientName: string,
  findings: ReturnType<typeof evaluateClientJobStaleness>,
): ManualItem | null {
  if (findings.length === 0) return null
  const summary = formatStaleJobsSummary(findings)
  return {
    kind: 'ads_agent_sync_stale',
    client_id: clientId,
    client_name: clientName,
    what: `${clientName} 的广告后台有几项自动同步好像停了：${summary}。成绩单和提醒可能不完整，但广告不会被自动改动。`,
    how: '这条不用客户操作，是系统开发排查：打开广告健康页看数据日期是否正常，并核对定时任务最近有没有报错。',
    href: adsHealthHref(clientId),
  }
}

export async function pushAdsAgentStaleItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  nameOf: (id: string) => string,
): Promise<void> {
  const clients = await getActiveClientsWithMetaAccounts(supabase)
  if (clients.length === 0) return

  const sinceLeads = new Date(now.getTime() - META_LEADS_LOOKBACK_MS).toISOString()
  const sinceRx = new Date(now.getTime() - PRESCRIPTION_LOOKBACK_DAYS * 86_400_000).toISOString()
  const [metaLeadsRuns, fbPageClients, prescriptionLogs, prescriptionClients] = await Promise.all([
    loadMetaLeadsRuns(supabase, sinceLeads),
    loadClientsWithFacebookPage(supabase),
    loadPrescriptionWeeklyLogs(supabase, sinceRx),
    loadPrescriptionInActClients(supabase),
  ])

  for (const client of clients) {
    const freshness = await freshnessForClient(supabase, client.id, {
      metaLeadsRuns,
      fbPageClients,
      prescriptionLogs,
      prescriptionClients,
    })
    const jobIds = AD_AGENT_SCHEDULED_JOBS.map((j) => j.id).filter((id) => id in freshness)
    const inputs: Partial<Record<AdAgentJobId, string | null>> = {}
    for (const id of jobIds) inputs[id] = freshness[id] ?? null
    const item = staleItem(client.id, client.name, evaluateClientJobStaleness(inputs, now))
    if (item) items.push(item)
  }
}

export async function pushAdsDailySpendOverCapNoticeItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  nameOf: (id: string) => string,
): Promise<void> {
  const clients = await getActiveClientsWithMetaAccounts(supabase)
  if (clients.length === 0) return

  const trips = await listActiveCircuitTrips(supabase)
  const trippedCaps = new Set(
    trips
      .filter((t) => t.reason === 'circuit:client_daily_cap_exceeded')
      .map((t) => t.clientId),
  )

  for (const client of clients) {
    if (trippedCaps.has(client.id)) continue
    const facts = await loadClientCapFacts(client.id)
    const verdict = evaluateDailySpendOverCapNotice(facts)
    const name = client.name || nameOf(client.id)
    if (!verdict.alert) {
      if ('skipReason' in verdict && verdict.skipReason === 'no_cap') {
        items.push({
          kind: 'ads_plan_daily_cap_missing',
          client_id: client.id,
          client_name: name,
          what: `${name} 的已批准广告计划里还没有每天广告总上限。没有这个数，加预算会被拦住。`,
          how: '打开广告计划，填上每天的广告总上限，保存后再批准。不要用以前的客户总闸，也不要填 0。',
          href: `${APP_BASE}/dashboard/clients/${encodeURIComponent(client.id)}/promo-plan`,
        })
      }
      if ('skipReason' in verdict && (verdict.skipReason === 'no_cap' || verdict.skipReason === 'unreadable')) {
        continue
      }
      const pacing = await readClientPacing(supabase, client.id, new Date()).catch(() => null)
      const day = pacing?.accounts[0]?.accountDay
      if (pacing?.clientOverCap && pacing.forecastMajor !== null && pacing.capMajor !== null && pacing.currency && day) {
        items.push({
          kind: 'ads_daily_spend_over_cap_notice',
          client_id: client.id,
          client_name: name,
          what: forecastOverCapWhat(name, {
            accountDay: day,
            forecastMajor: pacing.forecastMajor,
            capMajor: pacing.capMajor,
            currency: pacing.currency,
          }),
          how: '先看广告健康页上的收盘预测和每天上限是不是符合你的预期；要不要改预算或暂停由你决定，系统不会自动动广告。',
          href: adsHealthHref(client.id),
        })
      }
      continue
    }
    items.push({
      kind: 'ads_daily_spend_over_cap_notice',
      client_id: client.id,
      client_name: name,
      what: spendCapNoticeWhat(name, verdict),
      how: '先看广告健康页上的花费和日上限是不是符合你的预期；要不要改预算或暂停由你决定，系统不会自动动广告。',
      href: adsHealthHref(client.id),
    })
  }
}

async function loadHeartbeatRuns(
  supabase: SupabaseClient,
  since: string,
): Promise<HeartbeatCronRun[]> {
  const { data, error } = await supabase
    .from('cron_run_logs')
    .select('status, finished_at, started_at')
    .eq('job_name', AD_HEARTBEAT_JOB_NAME)
    .gte('started_at', since)
    .not('finished_at', 'is', null)
    .order('started_at', { ascending: false })
    .limit(80)
  if (error) throw new Error(`ad-heartbeat 运行记录读取失败：${error.message}`)
  return (data ?? []) as HeartbeatCronRun[]
}

export async function pushAdsHeartbeatStallItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
): Promise<void> {
  const cfg = readHeartbeatEnvConfig(process.env.AD_HEARTBEAT_MODE, process.env.AD_HEARTBEAT_CLIENT_IDS)
  const since = new Date(now.getTime() - HEARTBEAT_LOOKBACK_HOURS * 3_600_000).toISOString()
  const runs = await loadHeartbeatRuns(supabase, since)
  const verdict = evaluateHeartbeatStall(cfg, runs, now)
  if (!verdict || !heartbeatStallShouldAlert(verdict)) return
  if (items.some((i) => i.kind === 'ads_heartbeat_stall')) return
  items.push({
    kind: 'ads_heartbeat_stall',
    client_id: 'infra',
    client_name: 'Magic Engine 后台',
    what: heartbeatStallSummary(verdict),
    how: '这条不用你动手 —— 是开发排查广告小时心跳（Inngest）。回我一句「查一下广告心跳」我就看 Inngest / 运行记录和 env 开关（AD_HEARTBEAT_*）',
    href: `${APP_BASE}/dashboard/admin/cron-health`,
  })
}

async function loadRecentDailyPullbackRuns(
  supabase: SupabaseClient,
  limit: number,
): Promise<Array<{ finished_at: string | null; summary: { errors?: PullbackErrorRow[] } | null }>> {
  const { data, error } = await supabase
    .from('cron_run_logs')
    .select('finished_at, summary')
    .eq('job_name', DAILY_PULLBACK_JOB)
    .not('finished_at', 'is', null)
    .in('status', ['completed', 'failed'])
    .order('finished_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`google-data-pullback-daily 运行记录读取失败：${error.message}`)
  return (data ?? []) as Array<{ finished_at: string | null; summary: { errors?: PullbackErrorRow[] } | null }>
}

export async function pushAdsDailyPullbackGapItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  nameOf: (id: string) => string,
): Promise<void> {
  const runs = await loadRecentDailyPullbackRuns(supabase, 3)
  const run = runs.find((r) => Array.isArray(r.summary?.errors) && r.summary!.errors!.length > 0)
  if (!run?.summary?.errors || !run.finished_at) return

  const hoursOld = (now.getTime() - Date.parse(run.finished_at)) / 3_600_000
  if (hoursOld > DAILY_PULLBACK_STALE_HOURS) return

  const gaps = collectDailyPullbackGaps(run.summary.errors)
  if (gaps.length === 0) return

  const existingGapClients = new Set(
    items.filter((i) => i.kind === 'ads_agent_daily_pull_gap').map((i) => i.client_id),
  )
  const existingStaleClients = new Set(
    items.filter((i) => i.kind === 'ads_agent_sync_stale').map((i) => i.client_id),
  )

  for (const gap of gaps) {
    if (gap.clientId === '?') continue
    if (existingGapClients.has(gap.clientId)) continue
    if (existingStaleClients.has(gap.clientId)) continue
    const name = nameOf(gap.clientId)
    items.push({
      kind: 'ads_agent_daily_pull_gap',
      client_id: gap.clientId,
      client_name: name,
      what: formatDailyPullbackGapWhat(name, gap),
      how: '这条不用客户操作。打开广告健康页看最近数据日期；若是临时故障，明天这条会自己消失。',
      href: adsHealthHref(gap.clientId),
    })
    existingGapClients.add(gap.clientId)
  }
}

export async function pushAdsAgentMonitorItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  nameOf: (id: string) => string,
): Promise<void> {
  await pushAdsAgentStaleItems(supabase, items, now, nameOf)
  await pushAdsDailyPullbackGapItems(supabase, items, now, nameOf)
  await pushAdsHeartbeatStallItems(supabase, items, now)
  await pushAdsDailySpendOverCapNoticeItems(supabase, items, nameOf)
}
