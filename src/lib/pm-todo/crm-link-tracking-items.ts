/**
 * Mail click tracking that has quietly stopped working → a to-do (design 2026-11-10 B2 §6.1).
 *
 * Tracking fails silently by design: a failed token write still sends the mail, and the website never waits for ME.
 * So a broken tracker shows up only as "no clicks", and "no clicks" looks the same as "nobody clicked". This check
 * turns the suspicious pattern into a to-do instead of weeks of silence (CLAUDE.md 铁律 3).
 *
 * Read-only. Two signals over the last 7 days, per client:
 *  - tracked mails ≥ 5 and not a single click report of any kind (the website may not be reporting);
 *  - more than 3 sends whose receipt says the tokens could not be written or did not match.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'

export const LINK_TRACKING_LOOKBACK_DAYS = 7
export const MIN_TRACKED_MAILS = 5
export const MAX_FAILED_SENDS = 3

export interface LinkTrackingCounts {
  clientId: string
  trackedMails: number
  clickReports: number
  failedSends: number
}

export type LinkTrackingFinding = { clientId: string; problem: 'no_clicks'; trackedMails: number } | { clientId: string; problem: 'failed_sends'; failedSends: number }

/** Pure: which clients look broken. */
export function linkTrackingFindings(counts: readonly LinkTrackingCounts[]): LinkTrackingFinding[] {
  const out: LinkTrackingFinding[] = []
  for (const c of counts) {
    if (c.trackedMails >= MIN_TRACKED_MAILS && c.clickReports === 0) out.push({ clientId: c.clientId, problem: 'no_clicks', trackedMails: c.trackedMails })
    if (c.failedSends > MAX_FAILED_SENDS) out.push({ clientId: c.clientId, problem: 'failed_sends', failedSends: c.failedSends })
  }
  return out
}

function tally(map: Map<string, LinkTrackingCounts>, clientId: string): LinkTrackingCounts {
  let row = map.get(clientId)
  if (row === undefined) {
    row = { clientId, trackedMails: 0, clickReports: 0, failedSends: 0 }
    map.set(clientId, row)
  }
  return row
}

async function loadCounts(supabase: SupabaseClient, since: string): Promise<LinkTrackingCounts[]> {
  const [tokens, clicks, failed] = await Promise.all([
    supabase.from('crm_email_link_tokens').select('client_id, request_id').gte('created_at', since).limit(5000),
    supabase.from('crm_email_link_clicks').select('client_id').gte('occurred_at', since).limit(5000),
    supabase
      .from('crm_email_send_receipts')
      .select('client_id, request_id')
      .gte('created_at', since)
      .or('warnings.cs.{link_tracking_failed},warnings.cs.{link_tracking_mismatch}')
      .limit(5000),
  ])
  for (const r of [tokens, clicks, failed]) if (r.error) throw new Error(r.error.message)
  const map = new Map<string, LinkTrackingCounts>()
  const mails = new Map<string, Set<string>>()
  for (const t of (tokens.data as Array<{ client_id: string; request_id: string }> | null) ?? []) {
    const set = mails.get(t.client_id) ?? new Set<string>()
    set.add(t.request_id)
    mails.set(t.client_id, set)
  }
  for (const [clientId, set] of mails) tally(map, clientId).trackedMails = set.size
  for (const c of (clicks.data as Array<{ client_id: string }> | null) ?? []) tally(map, c.client_id).clickReports += 1
  for (const f of (failed.data as Array<{ client_id: string }> | null) ?? []) tally(map, f.client_id).failedSends += 1
  return [...map.values()]
}

/** IO. Throws on a read error (the caller logs it without blocking the other to-dos). */
export async function pushCrmLinkTrackingItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  nameOf: (clientId: string) => string,
  now: Date,
): Promise<void> {
  const since = new Date(now.getTime() - LINK_TRACKING_LOOKBACK_DAYS * 86_400_000).toISOString()
  for (const f of linkTrackingFindings(await loadCounts(supabase, since))) {
    const href = `https://app.magicengine.com.au/dashboard/clients/${f.clientId}/crm/templates`
    items.push(
      f.problem === 'no_clicks'
        ? {
            kind: 'crm_link_tracking_silent',
            client_id: f.clientId,
            client_name: nameOf(f.clientId),
            what: `邮件点击追踪可能坏了：近 7 天发出 ${f.trackedMails} 封带追踪的信，一次点击回传都没收到。影响：「第 2 天打电话」提醒和「点了什么」一栏全停`,
            how: '1. 开发窗口先看客户官网中间层有没有在回传（官网仓库 src/middleware.ts，正式域名才回传）；2. 再看 ME 接口 /api/public/crm/email-link-click 的日志；3. 修好前员工照常跟进，不靠点击提醒。',
            href,
          }
        : {
            kind: 'crm_link_tracking_silent',
            client_id: f.clientId,
            client_name: nameOf(f.clientId),
            what: `邮件点击追踪近 7 天有 ${f.failedSends} 封没打上编号（写编号失败或复核对不上），这些信照常发出了，但点了也看不到`,
            how: '1. 开发窗口查「最近发送」回执里 link_tracking_failed / link_tracking_mismatch 的那几封；2. 写编号失败看 crm_email_link_tokens 表是否可写；对不上看那几封信里链接的写法。',
            href,
          },
    )
  }
}
