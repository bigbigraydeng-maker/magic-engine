/**
 * Strategy / diagnostic / prescription manual items (from manual-items.ts, Round 2).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { fetchGa4KeyEventBreakdown } from '@/lib/ga4/client'
import { judgeLeadsSanity } from '@/lib/strategy/leads-sanity'
import { PRESCRIPTION_WEEKLY_CHECK_KIND } from '@/lib/diagnostic/prescription-weekly-check'

export async function pushLeadsSanityItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  nameOf: (id: string) => string,
): Promise<void> {
  const { data: goals } = await supabase
    .from('goals')
    .select('id, client_id, title, current_value')
    .eq('status', 'active')
    .eq('primary_metric_key', 'leads_count')
  const rows = (goals ?? []) as Array<{
    id: string
    client_id: string
    title: string
    current_value: number | null
  }>
  if (rows.length === 0) return

  // 一个客户查一次就够 —— 同客户多个客资目标共用同一份统计数据
  const checked = new Map<string, Awaited<ReturnType<typeof checkClientLeads>>>()
  for (const g of rows) {
    if (!checked.has(g.client_id)) {
      checked.set(g.client_id, await checkClientLeads(supabase, g.client_id))
    }
    const verdict = checked.get(g.client_id)
    if (!verdict || verdict.trustworthy) continue

    items.push({
      kind: 'leads_metric_untrusted',
      client_id: g.client_id,
      client_name: nameOf(g.client_id),
      what:
        `目标「${g.title}」现在显示 ${g.current_value ?? '—'}，但这个数不能信 —— ${verdict.humanReason}`,
      how:
        '这个要在客户的网站统计后台改（把「产生线索」的触发条件收窄到真的提交了表单），' +
        '我改不了。你确认一下该找谁改；在那之前别拿这个数判断这个目标做得好不好',
      href: `https://app.magicengine.com.au/dashboard/clients/${g.client_id}/goal/${g.id}`,
    })
  }
}

/** 拉一个客户的关键事件构成并判定。任何一步拿不到就返回 null（不误报）。 */
async function checkClientLeads(supabase: SupabaseClient, clientId: string) {
  const { data: conn } = await supabase
    .from('client_connectors')
    .select('config')
    .eq('client_id', clientId)
    .eq('anchor', 'ga4')
    .eq('status', 'connected')
    .maybeSingle<{ config: { property_id?: string } | null }>()
  const propertyId = conn?.config?.property_id
  if (!propertyId) return null

  const breakdown = await fetchGa4KeyEventBreakdown(propertyId, clientId).catch(() => null)
  if (!breakdown) return null
  return judgeLeadsSanity(breakdown)
}


/** Kept so old callers compile. Six-dimension findings are no longer pushed. */
export async function pushDiagnosticItems(
  _supabase: SupabaseClient,
  _items: ManualItem[],
  _now: Date,
  _nameOf: (id: string) => string,
): Promise<void> {
  return
}

/** 复查回执多新算「本周的」。比一周多一天，免得周一早上漏掉上周二那轮。 */
const PRESCRIPTION_CHECK_LOOKBACK_DAYS = 8

/**
 * 本周已批准方案的进度复查 → 通知一声。
 *
 * 回执由周二任务写进运行记录。这里只读那段人话，不自己现算，也不按看板上的
 * 待办条数报警。批准方案时已经不再往看板上插待办，条数为 0 不是故障。
 * 旧的「自动开方」回执没有 kind 标记，直接忽略，避免再报「一个都没排出来」。
 */
export async function pushPrescriptionItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  nameOf: (id: string) => string,
): Promise<void> {
  const since = new Date(now.getTime() - PRESCRIPTION_CHECK_LOOKBACK_DAYS * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from('cron_run_logs')
    .select('summary, started_at, status')
    .eq('job_name', 'prescription-weekly')
    .eq('status', 'completed')
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(5)
  if (error) throw new Error(`方案复查回执读取失败：${error.message}`)
  items.push(...prescriptionCheckItemsFromLogs((data ?? []) as Array<{ summary: unknown }>, nameOf))
}

/** 从最近几轮运行记录里取出最新一份复查回执，每个客户一条。形状不对就跳过。 */
export function prescriptionCheckItemsFromLogs(
  logs: Array<{ summary: unknown }>,
  nameOf: (id: string) => string,
): ManualItem[] {
  for (const log of logs) {
    const summary = log?.summary
    if (!isRecord(summary) || summary.kind !== PRESCRIPTION_WEEKLY_CHECK_KIND) continue
    if (!Array.isArray(summary.outcomes)) continue
    return itemsFromOutcomes(summary.outcomes, nameOf)
  }
  return []
}

function itemsFromOutcomes(outcomes: unknown[], nameOf: (id: string) => string): ManualItem[] {
  const items: ManualItem[] = []
  const seen = new Set<string>()
  for (const raw of outcomes) {
    const item = itemFromOutcome(raw, nameOf)
    if (!item || seen.has(item.client_id)) continue
    seen.add(item.client_id)
    items.push(item)
  }
  return items
}

function itemFromOutcome(raw: unknown, nameOf: (id: string) => string): ManualItem | null {
  if (!isRecord(raw) || (raw.result !== 'checked' && raw.result !== 'unreadable')) return null
  const clientId = raw.clientId
  const progress = raw.progress
  const suggestion = raw.suggestion
  if (typeof clientId !== 'string' || clientId.length === 0) return null
  if (typeof progress !== 'string' || typeof suggestion !== 'string') return null
  if (progress.trim().length === 0 || suggestion.trim().length === 0) return null
  const goalId = typeof raw.goalId === 'string' && raw.goalId.length > 0 ? raw.goalId : null
  const named = typeof raw.clientName === 'string' && raw.clientName.trim().length > 0
    ? raw.clientName
    : nameOf(clientId)
  return {
    kind: 'prescription_updated',
    client_id: clientId,
    client_name: named,
    what: progress,
    how: suggestion,
    href: goalId
      ? `https://app.magicengine.com.au/dashboard/clients/${clientId}/goal/${goalId}`
      : `https://app.magicengine.com.au/dashboard/clients/${clientId}`,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

