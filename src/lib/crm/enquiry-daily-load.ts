/**
 * 每日咨询早报的取数。**只读，一行写操作都没有。**
 *
 * 归类和渲染在 `enquiry-daily-digest` / `enquiry-daily-render`，编排在
 * `inngest/functions/crm-enquiry-daily-digest`。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase-paginate'
import { localDayStartMs } from './day-list'
import {
  ENQUIRY_CHAT_CHANNELS,
  ENQUIRY_FORM_CHANNELS,
  type EnquiryTouchRow,
} from './enquiry-daily-digest'

/** 最近多少天有过表单咨询的客户才发早报 —— 没在收线索的客户不该每天收一封「0 个」。 */
export const ACTIVE_LOOKBACK_DAYS = 30

/** 一次 `.in()` 塞多少个 id。PostgREST 的 URL 长度有限。 */
const IN_CHUNK = 100

const DAY_MS = 86_400_000

/**
 * 「昨天」的起止（毫秒，左闭右开），按客户所在地的日历日算。
 *
 * 不用 `今天零点 - 24 小时`：换夏令时那天一天只有 23 或 25 小时。
 * 拿「今天零点前一毫秒」再问一次那天的零点，换季那天也是对的。
 */
export function yesterdayWindow(now: Date, timeZone: string): { startMs: number; endMs: number } {
  const endMs = localDayStartMs(now, timeZone)
  const startMs = localDayStartMs(new Date(endMs - 1), timeZone)
  return { startMs, endMs }
}

export interface DigestClient {
  id: string
  name: string | null
}

/** 最近 30 天有过表单咨询的客户。 */
export async function loadActiveEnquiryClients(
  supabase: SupabaseClient,
  now: Date,
): Promise<DigestClient[]> {
  const since = new Date(now.getTime() - ACTIVE_LOOKBACK_DAYS * DAY_MS).toISOString()
  const rows = await fetchAll<{ client_id: string }>((from, to) =>
    supabase
      .from('contact_touchpoints')
      .select('client_id')
      .in('channel', [...ENQUIRY_FORM_CHANNELS])
      .eq('direction', 'inbound')
      .gte('occurred_at', since)
      .order('id', { ascending: true })
      .range(from, to),
  )
  const ids = Array.from(new Set(rows.map((r) => r.client_id))).sort()
  if (ids.length === 0) return []
  const { data, error } = await supabase.from('clients').select('id, name').in('id', ids)
  if (error) throw new Error(error.message)
  const byId = new Map((data ?? []).map((c: DigestClient) => [c.id, c]))
  return ids.map((id) => byId.get(id) ?? { id, name: null })
}

/** 某个客户在 [startMs, endMs) 里的进站表单 / 对话触点。 */
export async function loadEnquiryRows(
  supabase: SupabaseClient,
  clientId: string,
  window: { startMs: number; endMs: number },
): Promise<EnquiryTouchRow[]> {
  return fetchAll<EnquiryTouchRow>((from, to) =>
    supabase
      .from('contact_touchpoints')
      .select('contact_id, channel, source, occurred_at, summary, raw, metadata')
      .eq('client_id', clientId)
      .eq('direction', 'inbound')
      .in('channel', [...ENQUIRY_FORM_CHANNELS, ...ENQUIRY_CHAT_CHANNELS])
      .gte('occurred_at', new Date(window.startMs).toISOString())
      .lt('occurred_at', new Date(window.endMs).toISOString())
      .order('occurred_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  )
}

/** 这批人叫什么。查不到的人不进 Map —— 调用方据此数「孤儿」。 */
export async function loadContactNames(
  supabase: SupabaseClient,
  clientId: string,
  contactIds: string[],
): Promise<Map<string, string | null>> {
  const ids = Array.from(new Set(contactIds))
  const out = new Map<string, string | null>()
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const part = ids.slice(i, i + IN_CHUNK)
    const { data, error } = await supabase
      .from('contacts')
      .select('id, display_name')
      .eq('client_id', clientId)
      .in('id', part)
    if (error) throw new Error(error.message)
    for (const c of (data ?? []) as Array<{ id: string; display_name: string | null }>) {
      out.set(c.id, c.display_name)
    }
  }
  return out
}
