/**
 * 发出目录之后没人跟的客人 → 今日待办「要转给客户那边的」（临时措施，跟进流程整套重排的第 0 刀）。
 * 方案：docs/specs/2026-11-14-crm-catalogue-followup-reschedule-v1.md §4。
 *
 * ## 为什么要有这条
 *
 * 目录发出后客人挂上「AI 跟进中」，从第二天起不在员工的「今天先联系」名单里。可是 AI 的后续动作（第 2 天打电话提醒、
 * 第 7 天跟进信……）还没做成程序，于是这些客人处在「AI 在跟、其实没人跟」的洞里。整套流程做好之前，先靠这条提醒员工。
 *
 * ## 两种情况，一个客户一种合成一条
 *  - 看了目录（点了链接）、发出至少 2 天、还没有联系我们 → 请员工打个电话；
 *  - 没点也没回、发出满 7 天 → 请员工换个方式联系。
 * 只数还挂着「AI 跟进中」的人：员工点了「收回人工」，或客人自己回来（那样他会回到名单），这条就不再算他。
 *
 * ## 纪律
 * 一行写操作都没有；不写客人姓名、邮箱、电话（待办会进汇总信、进日志），要认人点链接进「发信统计」页看；
 * 哪个模板算「目录」取自该客户的发信设置（客户配置），不写死任何模板代号；
 * 读不到 ≠ 没人在等：取数失败留一条 `catalogue_followup_check_failed`（开发的活），不假装是零。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadEmailSettings } from '@/lib/crm/email-templates/settings-store'
import { humanClicksByRequest } from '@/lib/crm/email-templates/link-tracking/click-summary'
import { loadReactions } from '@/lib/crm/send-stats/reactions'
import { APP_BASE } from './binding-request-items'
import type { ManualItem } from './manual-item-types'

export type CatalogueFollowupItemKind =
  /** 看了目录（点了链接）还没有人联系他们 —— 一个客户合成一条 */
  | 'catalogue_followup_clicked'
  /** 发目录满 7 天一点动静都没有 —— 一个客户合成一条 */
  | 'catalogue_followup_quiet'
  /** 这一栏今天没算出来 —— 我们这边要查（开发的活） */
  | 'catalogue_followup_check_failed'

export const CLICKED_CALL_AFTER_DAYS = 2
export const QUIET_AFTER_DAYS = 7
/** 只看最近这么多天发出的目录：更早的不在这条里催。 */
export const LOOKBACK_DAYS = 60
const DAY_MS = 86_400_000
const ID_CHUNK = 100

/** 一位客人的一封目录信（取最早的一封）及其后的反应。纯数据，判断函数不碰库。 */
export interface CatalogueFollowupRow {
  sentAt: string
  /** 还挂着「AI 跟进中」（员工点「收回人工」就不再是）。 */
  takeoverOn: boolean
  /** 目录信里的链接被人真点过。`null` = 点击读不到，这个人不进任何一桶（不假装没点）。 */
  clicked: boolean | null
  /** 发出之后客人联系过我们（真回信 / 接通的来电 / 填表）：他会回到员工名单，不归这条管。 */
  reacted: boolean
}

export interface CatalogueFollowupCounts {
  clicked: number
  quiet: number
}

/** 纯：把每位客人分到哪一桶。 */
export function bucketCatalogueFollowups(rows: readonly CatalogueFollowupRow[], now: Date): CatalogueFollowupCounts {
  const out: CatalogueFollowupCounts = { clicked: 0, quiet: 0 }
  for (const r of rows) {
    if (!r.takeoverOn || r.reacted || r.clicked === null) continue
    const ageDays = (now.getTime() - Date.parse(r.sentAt)) / DAY_MS
    if (Number.isNaN(ageDays)) continue
    if (r.clicked) {
      if (ageDays >= CLICKED_CALL_AFTER_DAYS) out.clicked++
    } else if (ageDays >= QUIET_AFTER_DAYS) {
      out.quiet++
    }
  }
  return out
}

/** 落点：发信统计页 —— 目录信按「点了 / 没点」分好了，点了的排在前面。 */
function sendStatsHref(clientId: string): string {
  return `${APP_BASE}/dashboard/clients/${encodeURIComponent(clientId)}/crm/send-stats`
}

export function buildCatalogueFollowupItems(clientId: string, clientName: string, c: CatalogueFollowupCounts): ManualItem[] {
  const out: ManualItem[] = []
  const href = sendStatsHref(clientId)
  if (c.clicked > 0) {
    out.push({
      kind: 'catalogue_followup_clicked',
      client_id: clientId,
      client_name: clientName,
      what:
        `${clientName} 有 ${c.clicked} 位客人点开了发给他们的目录、至少 2 天了，还没有人联系他们。` +
        '他们现在挂着「AI 跟进中」，不在今天先联系的名单里，实际没人在跟——看过目录的人最值得马上打个电话',
      how:
        '请转给客户的销售：点链接打开「发信统计」，目录那一组里标绿色「点了目录」的就是他们，逐位打电话。' +
        '聊上了就点客人名字进资料页，点「收回人工」并记一笔，这条里就不再算他；打不通也记一句。',
      href,
    })
  }
  if (c.quiet > 0) {
    out.push({
      kind: 'catalogue_followup_quiet',
      client_id: clientId,
      client_name: clientName,
      what:
        `${clientName} 有 ${c.quiet} 位客人发目录满 7 天，一点动静都没有（没点链接，也没回）。` +
        '他们仍挂着「AI 跟进中」，实际没人在跟',
      how:
        '请转给客户的销售：点链接打开「发信统计」，找标灰色「没点链接」的人，换个方式联系（电话、WhatsApp、短信）。' +
        '注意：没点链接不代表没看，系统只看得到点击。联系上就点「收回人工」，这条里就不再算他。',
      href,
    })
  }
  return out
}

/** 取数依赖，测试里注入假的，生产走默认实现。 */
export interface CatalogueFollowupDeps {
  load: (supabase: SupabaseClient, clientId: string, now: Date) => Promise<CatalogueFollowupRow[]>
}

interface ReceiptRead {
  contact_id: string
  request_id: string
  created_at: string
}

function isReceiptRead(v: unknown): v is ReceiptRead {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return typeof r.contact_id === 'string' && typeof r.request_id === 'string' && typeof r.created_at === 'string'
}

async function readCatalogueReceipts(supabase: SupabaseClient, clientId: string, templateKey: string, sinceIso: string): Promise<ReceiptRead[]> {
  const { data, error } = await supabase
    .from('crm_email_send_receipts')
    .select('contact_id, request_id, created_at')
    .eq('client_id', clientId)
    .eq('template_key', templateKey)
    .eq('outcome', 'sent')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: true })
    .limit(2000)
  if (error) throw new Error(`catalogue receipts: ${error.message}`)
  // 每位客人只取最早的一封：第 2 / 7 天从第一次发出算。
  const first = new Map<string, ReceiptRead>()
  for (const r of Array.isArray(data) ? data : []) if (isReceiptRead(r) && !first.has(r.contact_id)) first.set(r.contact_id, r)
  return [...first.values()]
}

async function readTakeoverOn(supabase: SupabaseClient, clientId: string, contactIds: readonly string[]): Promise<Set<string>> {
  const on = new Set<string>()
  for (let i = 0; i < contactIds.length; i += ID_CHUNK) {
    const { data, error } = await supabase
      .from('contacts')
      .select('id')
      .eq('client_id', clientId)
      .eq('do_not_contact', false)
      .not('ai_takeover_since', 'is', null)
      .in('id', contactIds.slice(i, i + ID_CHUNK))
    if (error) throw new Error(`contacts: ${error.message}`)
    for (const row of Array.isArray(data) ? data : []) if (typeof (row as { id?: unknown }).id === 'string') on.add((row as { id: string }).id)
  }
  return on
}

/** 生产实现：读发送回执 + 联系人标记 + 点击 + 客人回应。任何一项读不到都抛（调用方留「没算出来」待办）。 */
export const defaultCatalogueFollowupDeps: CatalogueFollowupDeps = {
  async load(supabase, clientId, now) {
    const loaded = await loadEmailSettings(supabase, clientId)
    if (loaded.kind !== 'ok') return []
    const templateKey = loaded.settings.providers.catalogue?.templateKey
    if (!templateKey) return []
    const since = new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS).toISOString()
    const receipts = await readCatalogueReceipts(supabase, clientId, templateKey, since)
    if (receipts.length === 0) return []
    const takeover = await readTakeoverOn(supabase, clientId, receipts.map((r) => r.contact_id))
    const live = receipts.filter((r) => takeover.has(r.contact_id))
    if (live.length === 0) return []
    const clicks = await humanClicksByRequest(supabase, clientId, live.map((r) => r.request_id))
    const reactions = await loadReactions(supabase, clientId, live.map((r) => ({ key: r.request_id, contactId: r.contact_id, sentAt: r.created_at })), now)
    if (reactions === null) throw new Error('客人回应读不到')
    return live.map((r) => ({
      sentAt: r.created_at,
      takeoverOn: true,
      clicked: clicks === null ? null : (clicks[r.request_id]?.length ?? 0) > 0,
      reacted: reactions.has(r.request_id),
    }))
  },
}

function errorSnippet(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.length > 120 ? `${msg.slice(0, 120)}…` : msg
}

/**
 * 调用方在 `loadManualItems` 里必须挂 `.catch` —— 这条通道出问题不该把整份今日待办一起带走。
 * 逐个客户串行：一个客户取数失败不能影响别的客户。
 */
export async function pushCatalogueFollowupItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  ids: string[],
  now: Date,
  nameOf: (id: string) => string,
  deps: CatalogueFollowupDeps = defaultCatalogueFollowupDeps,
): Promise<void> {
  for (const id of ids) {
    const name = nameOf(id)
    try {
      const rows = await deps.load(supabase, id, now)
      items.push(...buildCatalogueFollowupItems(id, name, bucketCatalogueFollowups(rows, now)))
    } catch (err) {
      items.push({
        kind: 'catalogue_followup_check_failed',
        client_id: id,
        client_name: name,
        what: `${name}「发目录之后没人跟的客人」这一栏今天没算出来（${errorSnippet(err)}）。这时候没有这条提醒，不等于没有人在等`,
        how: '开发窗口查 CRM 发信回执、点击记录、客人回应三处哪一处读失败；修好前请员工自己打开「发信统计」看目录那一组。',
        href: sendStatsHref(id),
      })
    }
  }
}
