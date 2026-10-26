/**
 * 服务暂停了一条广告系列 → 今日待办。
 * 只读操作记录。通知事件丢了，这里仍能把最近的暂停捞出来。
 * 不写收件地址。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { readStopAlertRecipient, formatMinor, formatNz } from '@/lib/ads/stop-pause-notify'
import { APP_BASE } from './binding-request-items'
import type { ManualItem } from './manual-item-types'

export type AdsServicePauseItemKind = 'ads_service_pause_notice'

const ACTION = 'ads.service_pause_only'
const WINDOW_MS = 48 * 3_600_000

export interface PauseNoticeRow {
  client_id: string
  executed_at: string | null
  payload: Record<string, unknown>
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function text(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function cents(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function emailNote(status: unknown, recipientConfigured: boolean): string {
  if (status === 'sent') return ''
  if (status === 'send_failed') return '邮件没有发出去。'
  if (status === 'recipient_unconfigured' || !recipientConfigured) return '邮件没有发出去：未配置收件人。'
  return ''
}

function itemOf(row: PauseNoticeRow, nameOf: (id: string) => string, recipientConfigured: boolean): ManualItem {
  const payload = row.payload
  const name = text(payload.campaign_name) ?? '未命名系列'
  const id = text(payload.campaign_id) ?? ''
  const account = text(payload.ad_account_id) ?? '没读到'
  const currency = text(payload.currency) ?? ''
  const why = text(payload.fault_what) ?? '没读到原因'
  const note = emailNote(payload.email_status, recipientConfigured)
  return {
    kind: 'ads_service_pause_notice',
    client_id: row.client_id,
    client_name: nameOf(row.client_id),
    what: `广告系列「${name}」（编号 ${id}）已经暂停。账户 ${account}。当天花费 ${formatMinor(cents(payload.spend_today_cents), currency)}，累计花费 ${formatMinor(cents(payload.spend_lifetime_cents), currency)}。原因：${why}。数据时间：${formatNz(text(payload.as_of) ?? '')}。`,
    how: `要恢复投放，由负责人在 Magic Engine 里点确认卡。先打开广告健康页核对这个系列。${note}`,
    href: `${APP_BASE}/dashboard/clients/${encodeURIComponent(row.client_id)}/ads-health`,
  }
}

/** 最近 48 小时、状态是已暂停的记录。同一个系列只留最新一条。 */
export function pauseNoticeItems(
  rows: readonly PauseNoticeRow[],
  now: Date,
  nameOf: (id: string) => string,
  recipientConfigured: boolean,
): ManualItem[] {
  const since = now.getTime() - WINDOW_MS
  const latest = new Map<string, PauseNoticeRow>()
  for (const row of rows) {
    if (row.payload.status !== 'paused') continue
    const at = Date.parse(row.executed_at ?? '')
    if (!Number.isFinite(at) || at < since) continue
    const campaign = text(row.payload.campaign_id)
    if (campaign === null) continue
    const key = `${row.client_id}:${campaign}`
    const prev = latest.get(key)
    if (!prev || Date.parse(prev.executed_at ?? '') < at) latest.set(key, row)
  }
  return [...latest.values()].map(row => itemOf(row, nameOf, recipientConfigured))
}

export async function pushAdsServicePauseItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  nameOf: (id: string) => string,
  now: Date,
): Promise<void> {
  const since = new Date(now.getTime() - WINDOW_MS).toISOString()
  const { data, error } = await supabase
    .from('flywheel_actions')
    .select('client_id, executed_at, payload')
    .eq('action_type', ACTION)
    .eq('payload->>status', 'paused')
    .gte('executed_at', since)
    .order('executed_at', { ascending: false })
    .limit(100)
  if (error) throw new Error('读暂停记录失败')
  const rows: PauseNoticeRow[] = []
  for (const raw of data ?? []) {
    if (!isRecord(raw) || typeof raw.client_id !== 'string' || !isRecord(raw.payload)) continue
    rows.push({
      client_id: raw.client_id,
      executed_at: typeof raw.executed_at === 'string' ? raw.executed_at : null,
      payload: raw.payload,
    })
  }
  const recipientConfigured = readStopAlertRecipient(process.env) !== null
  for (const item of pauseNoticeItems(rows, now, nameOf, recipientConfigured)) items.push(item)
}
