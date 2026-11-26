/**
 * Urgent todos for a proposed pause card, and alert-only stale data.
 * Reads the action ledger. Does not pause and does not write Meta.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { APP_BASE } from './binding-request-items'
import { BREAKER_ACTION } from '@/lib/ads-strategy/circuit-breaker/apply'

export type AdsCircuitBreakerPauseKind = 'ads_circuit_breaker_pause'
export type AdsCircuitBreakerAlertKind = 'ads_circuit_breaker_alert'

const LOOKBACK_MS = 36 * 60 * 60 * 1000

interface Notice {
  client_id: string
  payload: {
    status?: string
    summary?: string
    wrote?: boolean
    campaign_name?: string
  }
}

export async function pushAdsCircuitBreakerItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  nameOf: (id: string) => string,
): Promise<void> {
  const notices = await readNotices(supabase, now)
  for (const notice of notices) items.push(itemOf(notice, nameOf))
}

async function readNotices(supabase: SupabaseClient, now: Date): Promise<Notice[]> {
  const since = new Date(now.getTime() - LOOKBACK_MS).toISOString()
  const { data, error } = await supabase.from('flywheel_actions')
    .select('client_id, payload, created_at')
    .eq('action_type', BREAKER_ACTION)
    .gte('created_at', since)
    .limit(200)
  if (error || !Array.isArray(data)) return []
  return data.flatMap(asNotice)
}

function asNotice(row: { client_id?: unknown; payload?: unknown }): Notice[] {
  if (typeof row.client_id !== 'string' || !row.payload || typeof row.payload !== 'object') return []
  return [{ client_id: row.client_id, payload: row.payload as Notice['payload'] }]
}

function itemOf(notice: Notice, nameOf: (id: string) => string): ManualItem {
  const pause = notice.payload.status === 'card_issued' || notice.payload.status === 'card_failed'
  const name = notice.payload.campaign_name?.trim() || '这个广告系列'
  return {
    kind: pause ? 'ads_circuit_breaker_pause' : 'ads_circuit_breaker_alert',
    client_id: notice.client_id,
    client_name: nameOf(notice.client_id),
    what: pause ? pauseWhat(name, notice.payload.status === 'card_failed') : alertWhat(notice.payload.summary),
    how: pause
      ? '打开这个客户的广告页，找到「暂停这个广告系列」的确认卡。只有你点确认才会暂停。聊天里说可以不算。卡大约半小时内有效。'
      : '先看广告数据是不是太久没更新。这条不会暂停广告，也不用点确认。',
    href: `${APP_BASE}/dashboard/clients/${encodeURIComponent(notice.client_id)}/ads-health`,
  }
}

function pauseWhat(name: string, failed: boolean): string {
  const head = failed ? `没能发出「${name}」的暂停确认卡。` : `已经为「${name}」发出暂停确认卡。`
  return `${head}系统没有暂停。请负责这个客户的同事在卡上点确认。`
}

function alertWhat(summary: string | undefined): string {
  return summary?.trim() || '广告数据不够新。这条只是提醒，系统没有暂停。'
}
