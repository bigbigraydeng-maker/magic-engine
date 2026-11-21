/**
 * Today-todo items for ads decision look-back and pending agent drafts.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { APP_BASE } from './binding-request-items'
import { readAdsDecisionV1 } from '@/lib/ads/decision-log/persist'
import { adsDecisionReviewEnabled } from '@/lib/ads/decision-log/switch'

export type AdsDecisionReviewDueKind = 'ads_decision_review_due'
export type AdsDecisionPendingConfirmKind = 'ads_decision_pending_confirm'

const LOOKBACK_DAYS = 14

export async function pushAdsDecisionTodoItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  nameOf: (id: string) => string,
): Promise<void> {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString()
  const asOf = nzDay(now)
  const { data, error } = await supabase
    .from('flywheel_actions')
    .select('id, client_id, payload, action_type, created_at')
    .eq('flywheel', 'ads')
    .gte('created_at', since)
    .limit(400)
  if (error || !Array.isArray(data)) return []

  const clientSwitch = new Map<string, boolean>()
  for (const row of data) {
    if (typeof row.client_id !== 'string' || typeof row.id !== 'string') continue
    const decision = readAdsDecisionV1(row.payload)
    if (!decision) continue
    if (decision.status === 'pending_confirm') {
      items.push(pendingItem(row.client_id, decision, nameOf))
      continue
    }
    if (decision.status !== 'active') continue
    if (decision.review_result) {
      const reviewedMs = Date.parse(decision.review_result.reviewed_at)
      if (Number.isFinite(reviewedMs) && now.getTime() - reviewedMs < 48 * 3_600_000) {
        items.push(conclusionItem(row.client_id, decision, nameOf))
      }
      continue
    }
    if (decision.review_due_on > asOf) continue
    const enabled = await switchOn(supabase, row.client_id, clientSwitch)
    if (!enabled) continue
    items.push(dueItem(row.client_id, decision, nameOf))
  }
}

function conclusionItem(
  clientId: string,
  decision: NonNullable<ReturnType<typeof readAdsDecisionV1>>,
  nameOf: (id: string) => string,
): ManualItem {
  const v = decision.review_result?.verdict ?? 'cant_tell'
  const label = v === 'met' ? '达到预期' : v === 'not_met' ? '未达预期' : '看不出'
  return {
    kind: 'ads_decision_review_due',
    client_id: clientId,
    client_name: nameOf(clientId),
    what: `广告决策回头看结论（${label}）：${decision.subject.label_zh}`,
    how: decision.review_result?.reason_zh ?? '打开广告门查看完整决策记录。',
    href: `${APP_BASE}/dashboard/clients/${clientId}/ads-health#ads-decision-log`,
    pm_kind: 'money',
  }
}

function pendingItem(
  clientId: string,
  decision: NonNullable<ReturnType<typeof readAdsDecisionV1>>,
  nameOf: (id: string) => string,
): ManualItem {
  return {
    kind: 'ads_decision_pending_confirm',
    client_id: clientId,
    client_name: nameOf(clientId),
    what: `广告决策草稿待确认：${decision.what_done_zh}`,
    how: '打开广告门「决策记录」，确认或改掉 agent 起草的内容。',
    href: `${APP_BASE}/dashboard/clients/${clientId}/ads-health#ads-decision-log`,
    pm_kind: 'money',
  }
}

function dueItem(
  clientId: string,
  decision: NonNullable<ReturnType<typeof readAdsDecisionV1>>,
  nameOf: (id: string) => string,
): ManualItem {
  return {
    kind: 'ads_decision_review_due',
    client_id: clientId,
    client_name: nameOf(clientId),
    what: `广告决策回头看到期：${decision.subject.label_zh} — ${decision.what_done_zh}`,
    how: '打开广告门「决策记录」或今日待办里的结论；未到自动结论时可手动触发回头看任务。',
    href: `${APP_BASE}/dashboard/clients/${clientId}/ads-health#ads-decision-log`,
    pm_kind: 'money',
  }
}

async function switchOn(
  supabase: SupabaseClient,
  clientId: string,
  cache: Map<string, boolean>,
): Promise<boolean> {
  if (cache.has(clientId)) return cache.get(clientId) ?? false
  const { data } = await supabase.from('clients').select('leads_config').eq('id', clientId).maybeSingle()
  const on = adsDecisionReviewEnabled((data as { leads_config?: unknown } | null)?.leads_config)
  cache.set(clientId, on)
  return on
}

function nzDay(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970'
  const m = parts.find((p) => p.type === 'month')?.value ?? '01'
  const d = parts.find((p) => p.type === 'day')?.value ?? '01'
  return `${y}-${m}-${d}`
}
