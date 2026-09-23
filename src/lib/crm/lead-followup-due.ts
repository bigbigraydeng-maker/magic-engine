/**
 * 「客人填了表，到现在没有一个真人回过他」—— 判据。
 *
 * ## 为什么要有这个模块（2026-09-24 PM：「我们没有拿到客户资料」）
 *
 * Facebook 即时表单的线索每小时自动进 CRM（`meta/leads-sync`），进去之后
 * **没有任何外发**：不发信、不下发待办、不进任何人的视野。要有人主动点开
 * 后台那一页才看得见。查生产库（CTS，2026-09-24）：6 月以来 676 个人从表单
 * 进来，其中 **530 个查不到任何真人跟进记录**。这不是「客人不理我们」，
 * 是我们压根没打过那通电话。
 *
 * ## 「真人跟进」怎么算 —— 这是本模块唯一重要的判断
 *
 * 算：
 *   · 电话记录（`channel='phone'`，不分方向 —— 打不通也是打过了）
 *   · 有人在系统里手写了一笔（`source` = `me_manual` / `sheet_followup`）
 *   · 我们发出去的、不是机器发的消息（`isAutomatedTouch` 说了不算机器的）
 *
 * **不算**：
 *   · 🔴 **Facebook 私信的任何外发，整类不算。** 这不是保守，是实测：
 *     CTS 2026-09 的 Messenger 外发原文里，最多的三条是
 *     「你的 AI 客服将会回复。」「你已接管 AI 客服的这场聊天。」
 *     「你的 AI 客服已将这个聊天转移给你。」—— 全是 Meta 自家 AI 客服和系统通知，
 *     剩下的绝大多数是欢迎语和节日群发模板。这些在库里跟一通真人回复长得
 *     **一模一样**（`senderId === pageId`，`raw` 还是空的）。
 *     实测代价：最近 30 天 259 条线索里，**116 个人在系统眼里「已经联系过」，
 *     而唯一联系过他们的是机器人** —— 他们因此从后台「今天要联系」那一页上
 *     消失了。判错的方向是不对称的（`crm/automated-touch` 文件头同一句话）：
 *     多列一个人只是多看一眼，少列一个人是这单丢了。
 *     ⚠️ 这条是**权宜之计**。根子上的修法是在写触点那一步就把 Meta AI 客服
 *     标成 `metadata.automated=true`（那样 `isAutomatedTouch` 自然认得，后台
 *     那一页也跟着一起修好）。那是另一个改动，见本轮 PR 描述里的后续事项。
 *     在它落地之前，这里和后台那一页对「联系过了没有」会给出**不同答案**，
 *     所以汇总信正文里必须把这句差异明说出来（见 `lead-followup-digest`）。
 *   · Mailchimp 群发（`isAutomatedTouch` 已经整类认掉）
 *
 * ## 三条不列进来的
 *
 *   · 已经标了「别再联系」的 —— 判据全仓只有一份，用 `crm/dnc`
 *   · 已经付过钱 / 已经明确不感兴趣 / 已经要出发了 —— 见 `SETTLED_STAGES`
 *   · 被人按了「过阵子再提醒我」的（`contacts.snooze_until` 还没到）
 *
 * 本文件只有判断，不碰数据库；取数在下面的 `findLeadFollowupDue`，
 * 发信在 `lead-followup-digest`。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase-paginate'
import { isAutomatedTouch } from './automated-touch'
import { isDoNotContact, type DncTouch } from './dnc'

/** 表单进来多少小时还没人回，就算欠着。太短会把刚填完 5 分钟的人也催上。 */
export const LEAD_SLA_HOURS = 24

/**
 * 这封信只看最近这些天进来的线索。
 *
 * 为什么要有窗口：CTS 的历史积压是 315 个人，一次全倒进一封信，收信的人
 * 看到的是一堵墙，第二天就不看了。窗口之外的照样**算进总数**、在正文里说出来
 * （「数字不许说小」，同 `email-reply-digest` 文件头第 4 条），只是不逐条列。
 */
export const LEAD_WINDOW_DAYS = 7

/** 一封信里一个客户最多列几条。被压掉的算进 `dropped`，正文里要说。 */
export const MAX_PER_CLIENT = 15

/**
 * 这些阶段不再提醒 —— 都是「已经有人真的处理过了」的硬信号。
 *
 * 刻意**不包括** `contacted` / `quoted` / `no_response` / `deferred`：
 * 这几档有一部分是系统从对话内容里自动推出来的（`crm/stage-from-conversation`），
 * 而那些对话里就混着上面说的 AI 客服消息。拿一个可能被机器人推出来的阶段
 * 去抑制「没人回」的提醒，等于把这个 bug 又绕回来一遍。
 */
export const SETTLED_STAGES: ReadonlySet<string> = new Set([
  'deposit_paid',
  'paid_full',
  'not_interested',
  'traveling_soon',
])

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

/** 一笔触点，字段跟 `contact_touchpoints` 那几列一一对应。 */
export interface LeadTouch {
  channel: string
  direction: string | null
  occurredAt: string
  source: string | null
  metadata: Record<string, unknown> | null
}

/** 一个候选人的全部判据材料。 */
export interface LeadCandidate {
  clientId: string
  contactId: string
  displayName: string | null
  /** 最早一条表单留资的时间，ISO */
  leadAt: string
  /** 客人自己在表单下拉里选的「感兴趣的团」，没有就 null */
  interest: string | null
  /** 表单之后发生的全部触点 */
  touches: LeadTouch[]
  doNotContactFlag: boolean
  stage: string | null
  /** `contacts.snooze_until`，ISO 或 null */
  snoozeUntil: string | null
}

/** 挑出来的一条「填了表还没人回」。 */
export interface LeadDueItem {
  clientId: string
  contactId: string
  displayName: string | null
  interest: string | null
  leadAt: string
}

export interface LeadDueResult {
  /** 逐条列出来的（已按等最久排序、已封顶）。 */
  items: LeadDueItem[]
  /** 窗口内被封顶压掉、没列出来的条数。 */
  dropped: number
  /** 窗口之外、同样没人回的积压人数。只报数字，不逐条列。 */
  backlog: number
}

/** 这一笔算不算「有真人跟过他」。判据见文件头。 */
export function isHumanFollowup(t: LeadTouch): boolean {
  if (t.channel === 'phone') return true
  if (t.source === 'me_manual' || t.source === 'sheet_followup') return true
  if (t.direction !== 'outbound') return false
  // 🔴 Facebook 私信外发整类不算 —— 现在分不出真人和 Meta 的 AI 客服。
  if (t.channel === 'messenger') return false
  return !isAutomatedTouch(t.source, t.metadata)
}

/** 把触点翻成 `crm/dnc` 认的形状（「别再联系」被人推翻过没有，它自己判）。 */
function toDncTouches(touches: LeadTouch[]): DncTouch[] {
  return touches.map((t) => ({
    outcome: (t.metadata?.outcome as string | undefined) ?? null,
    flagged: t.metadata?.do_not_contact === true,
    occurredAt: t.occurredAt,
  }))
}

function ts(iso: string): number {
  const v = Date.parse(iso)
  return Number.isNaN(v) ? Number.NaN : v
}

/**
 * 纯判据。给一批候选人，挑出「该提醒」的那些。
 *
 * @param maxPerClient 每客户封顶。不传 = 不封顶（消费方各自的渲染预算）。
 */
export function pickLeadFollowupDue(
  candidates: LeadCandidate[],
  now: Date,
  maxPerClient = MAX_PER_CLIENT,
): LeadDueResult {
  const nowMs = now.getTime()
  const windowStart = nowMs - LEAD_WINDOW_DAYS * DAY_MS
  const slaCutoff = nowMs - LEAD_SLA_HOURS * HOUR_MS

  const inWindow: Array<{ item: LeadDueItem; leadMs: number }> = []
  let backlog = 0

  for (const c of candidates) {
    if (isDoNotContact(c.doNotContactFlag, toDncTouches(c.touches))) continue
    if (c.stage && SETTLED_STAGES.has(c.stage)) continue
    if (c.snoozeUntil) {
      const until = ts(c.snoozeUntil)
      if (Number.isFinite(until) && until > nowMs) continue
    }
    if (c.touches.some(isHumanFollowup)) continue

    const leadMs = ts(c.leadAt)
    // 时间戳坏掉的照样要看见 —— 丢掉就等于这个人从名单上消失了。
    // 当成「很久以前」处理：进积压数，不占今天这封信的头条。
    if (!Number.isFinite(leadMs)) {
      backlog++
      continue
    }
    // 刚填完还不到 SLA，现在催是催自己。
    if (leadMs > slaCutoff) continue

    if (leadMs < windowStart) {
      backlog++
      continue
    }
    inWindow.push({
      item: {
        clientId: c.clientId,
        contactId: c.contactId,
        displayName: c.displayName,
        interest: c.interest,
        leadAt: c.leadAt,
      },
      leadMs,
    })
  }

  // 等最久的排最前。
  inWindow.sort((a, b) => a.leadMs - b.leadMs)

  if (maxPerClient <= 0 || inWindow.length <= maxPerClient) {
    return { items: inWindow.map((r) => r.item), dropped: 0, backlog }
  }
  return {
    items: inWindow.slice(0, maxPerClient).map((r) => r.item),
    dropped: inWindow.length - maxPerClient,
    backlog,
  }
}

/* ------------------------------------------------------------------ *
 * 取数层
 * ------------------------------------------------------------------ */

/**
 * 积压往回看多久。只影响正文里那个「另有 N 个更早的」数字，不影响逐条名单。
 * 有上限是因为这个数字要配 `fetchAll` 全量读，不能让它无限增长。
 */
export const BACKLOG_LOOKBACK_DAYS = 365

/** 一次 `.in()` 塞多少个 id。PostgREST 的 URL 长度有限。 */
const IN_CHUNK = 100

interface LeadRow {
  contact_id: string
  client_id: string
  occurred_at: string
  metadata: Record<string, unknown> | null
}

interface TouchRow {
  contact_id: string
  channel: string
  direction: string | null
  occurred_at: string
  source: string | null
  metadata: Record<string, unknown> | null
}

interface ContactRow {
  id: string
  display_name: string | null
  do_not_contact: boolean | null
  stage: string | null
  snooze_until: string | null
}

function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size))
  return out
}

/**
 * 读出一个客户「填了表还没人回」的名单。
 *
 * 🔴 三个查询全部走 `fetchAll` —— PostgREST 单次硬顶 1000 行且**不报错**，
 *    直接 `.select()` 会静默少算，而少算的方向恰好是「看起来没那么糟」。
 *    见 `lib/supabase-paginate` 文件头的 CTS 实测。
 */
export async function findLeadFollowupDue(
  supabase: SupabaseClient,
  clientId: string,
  now: Date = new Date(),
  maxPerClient = MAX_PER_CLIENT,
): Promise<LeadDueResult> {
  const since = new Date(now.getTime() - BACKLOG_LOOKBACK_DAYS * DAY_MS).toISOString()

  const leadRows = await fetchAll<LeadRow>((from, to) =>
    supabase
      .from('contact_touchpoints')
      .select('contact_id, client_id, occurred_at, metadata')
      .eq('client_id', clientId)
      .eq('channel', 'meta_lead_form')
      .gte('occurred_at', since)
      .order('occurred_at', { ascending: true })
      .range(from, to),
  )
  if (leadRows.length === 0) return { items: [], dropped: 0, backlog: 0 }

  // 同一个人可能填过几次表 —— 以**最早**那次算「他等了多久」。
  const firstLead = new Map<string, LeadRow>()
  for (const r of leadRows) {
    if (!r.contact_id) continue
    const prev = firstLead.get(r.contact_id)
    if (!prev || r.occurred_at < prev.occurred_at) firstLead.set(r.contact_id, r)
    // 「感兴趣的团」取有值的那一条，早晚都行 —— 空值不该把已有的覆盖掉。
    const cur = firstLead.get(r.contact_id)
    if (cur && !cur.metadata?.tour_interest_raw && r.metadata?.tour_interest_raw) {
      cur.metadata = { ...(cur.metadata ?? {}), tour_interest_raw: r.metadata.tour_interest_raw }
    }
  }
  const ids = [...firstLead.keys()]

  const touches: TouchRow[] = []
  for (const part of chunk(ids, IN_CHUNK)) {
    const rows = await fetchAll<TouchRow>((from, to) =>
      supabase
        .from('contact_touchpoints')
        .select('contact_id, channel, direction, occurred_at, source, metadata')
        .eq('client_id', clientId)
        .in('contact_id', part)
        .order('occurred_at', { ascending: true })
        .range(from, to),
    )
    touches.push(...rows)
  }

  const contacts: ContactRow[] = []
  for (const part of chunk(ids, IN_CHUNK)) {
    const rows = await fetchAll<ContactRow>((from, to) =>
      supabase
        .from('contacts')
        .select('id, display_name, do_not_contact, stage, snooze_until')
        .eq('client_id', clientId)
        .in('id', part)
        .order('id', { ascending: true })
        .range(from, to),
    )
    contacts.push(...rows)
  }
  const contactById = new Map(contacts.map((c) => [c.id, c]))

  const touchesByContact = new Map<string, LeadTouch[]>()
  for (const t of touches) {
    const lead = firstLead.get(t.contact_id)
    // 表单**之前**的往来不算「对这条线索的跟进」。
    if (!lead || t.occurred_at < lead.occurred_at) continue
    // 表单触点自己不算跟进。
    if (t.channel === 'meta_lead_form') continue
    const list = touchesByContact.get(t.contact_id) ?? []
    list.push({
      channel: t.channel,
      direction: t.direction,
      occurredAt: t.occurred_at,
      source: t.source,
      metadata: t.metadata,
    })
    touchesByContact.set(t.contact_id, list)
  }

  const candidates: LeadCandidate[] = []
  for (const [contactId, lead] of firstLead) {
    const c = contactById.get(contactId)
    // 查不到人就跳过 —— 没有名字、没有拒联标记，列出来也没法处理。
    if (!c) continue
    const interest = lead.metadata?.tour_interest_raw
    candidates.push({
      clientId,
      contactId,
      displayName: c.display_name,
      leadAt: lead.occurred_at,
      interest: typeof interest === 'string' && interest.trim() ? interest.trim() : null,
      touches: touchesByContact.get(contactId) ?? [],
      doNotContactFlag: c.do_not_contact === true,
      stage: c.stage,
      snoozeUntil: c.snooze_until,
    })
  }

  return pickLeadFollowupDue(candidates, now, maxPerClient)
}
