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
 * 判定顺序**不能调**：先问「这一笔是不是机器发的」，再谈渠道。
 * 🔴 早前写反过一次（phone 直接 return true 排在最前），后果是 AI 外呼
 *    （`voice/crm-bridge.ts` 写的正是 `channel='phone'` + `metadata.automated=true`）
 *    会被当成真人跟过 —— 跟本模块要修的那个 bug 一模一样，只是换了条渠道。
 *
 * 算：
 *   · 电话记录（`channel='phone'`，不分方向 —— 打不通也是打过了）
 *   · 有人在系统里手写了一笔（`source` = `me_manual` / `sheet_followup`）
 *   · 我们发出去的、不是机器发的消息
 *
 * **不算**：
 *   · 🔴 **Facebook 私信的任何外发，整类不算。** 这不是保守，是实测：
 *     CTS 2026-09 的 Messenger 外发原文里，最多的三条是
 *     「你的 AI 客服将会回复。」「你已接管 AI 客服的这场聊天。」
 *     「你的 AI 客服已将这个聊天转移给你。」—— 全是 Meta 自家 AI 客服和系统通知。
 *     这些在库里跟一通真人回复长得**一模一样**（`senderId === pageId`，`raw` 还是空的），
 *     而且出站触点是**一个会话一行**（`messenger/link-contacts.ts` 的
 *     `source_ref = <convId>:out`，真人回复和机器回复共用同一行），所以也没法
 *     逐条标 `automated`。
 *     实测代价：最近 30 天 259 条线索里，**116 个人在系统眼里「已经联系过」，
 *     而唯一联系过他们的是机器人** —— 他们因此从后台「今天要联系」那一页上消失了。
 *     判错的方向是不对称的（`crm/automated-touch` 文件头同一句话）：
 *     多列一个人只是多看一眼，少列一个人是这单丢了。
 *     ⚠️ 这条是**权宜之计**，退出条件见 `docs/ROADMAP.md` 那条 P0
 *     （用 `conversation_outbound_log` 反查真人出站）。在它落地之前，这里和后台
 *     那一页对「联系过了没有」会给出**不同答案**，所以汇总信正文里必须把这句差异
 *     明说出来（见 `lead-followup-digest` 的 `calibrationNote`）。
 *   · Mailchimp 群发 / AI 外呼（`isAutomatedTouch` 认掉）
 *
 * ## 三条不列进来的
 *
 *   · 已经标了「别再联系」的 —— 判据全仓只有一份，用 `crm/dnc`
 *   · 阶段已经是「结论性状态」的 —— 判据也只有一份，用 `crm/pipeline`
 *     的 `stageSuppressesWorklist`，配置读每个客户自己的 `client_pipeline_stages`。
 *     🔴 别在这里写死阶段名：`deposit_paid` / `traveling_soon` 那一套是
 *        **CTS / 旅游行业**的九档，地产客户用的是 `offer` / `purchased`
 *        （`20260730145441_real_estate_pipeline_seed.sql`）。写死等于把行业语义
 *        塞进 shared runtime（铁律 0 Domain Semantics Gate）。
 *   · 被人按了「过阵子再提醒我」的（`contacts.snooze_until` 还没到）
 *
 * ## 🔴 锚点是「最近一次留资」，不是第一次
 *
 * CTS 676 个表单联系人里 **55 个填过不止一次**。按第一次算会出两种错，都朝
 * 「看起来没那么糟」偏：第一次被跟过 → 这个人整个被剔掉，连积压都不算；
 * 第一次没被跟过 → 锚点停在几个月前，永远落在窗口外只进积压数字。
 * 而二次留资恰恰是最热的线索。「他在表单里选的团」同理取最近那次
 * —— 55 个重复填表的人里 44 个两次选的团不一样。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase-paginate'
import { isAutomatedTouch } from './automated-touch'
import { isDoNotContact, type DncTouch } from './dnc'
import { stageSuppressesWorklist, isMarketingAction } from './pipeline'

/** 表单进来多少小时还没人回，就算欠着。太短会把刚填完 5 分钟的人也催上。 */
export const LEAD_SLA_HOURS = 24

/**
 * 这封信只逐条列最近这些天进来的线索。
 *
 * 为什么要有窗口：CTS 的历史积压是 277 个人，一次全倒进一封信，收信的人
 * 看到的是一堵墙，第二天就不看了。窗口之外的照样**算进总数**、在正文里说出来
 * （「数字不许说小」，同 `email-reply-digest` 文件头第 4 条），只是不逐条列。
 *
 * ⚠️ 这个数将来属于 Industry Playbook：地产的跟进节奏跟旅游不一样。
 *    现在是平台默认值，不是判据的一部分，改它不需要改判据。
 */
export const LEAD_WINDOW_DAYS = 7

/** 一封信里一个客户最多列几条。被压掉的算进 `dropped`，正文里要说。 */
export const MAX_PER_CLIENT = 15

/**
 * 积压往回看多久。只影响正文里那个「另有 N 个更早的」数字。
 *
 * 有上限是因为这个数字要全量读；**上限之外的人正文里会如实说「只算到这么久以前」**，
 * 不能让他们静默从数字里蒸发（`playbook-geo-general` §九：没测成 ≠ 测出来是零）。
 */
export const BACKLOG_LOOKBACK_DAYS = 180

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
  /** **最近**一条表单留资的时间，ISO。见文件头「锚点是最近一次留资」。 */
  leadAt: string
  /** 客人在**最近**那次表单下拉里选的「感兴趣的团」，没有就 null */
  interest: string | null
  /** 最近那次留资之后发生的全部触点 */
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

export interface LeadPickResult {
  /** 窗口内、已按等最久排序、已封顶的名单。 */
  items: LeadDueItem[]
  /** 窗口内被封顶压掉、没列出来的条数。 */
  dropped: number
  /** 窗口之外、同样没人回的人数。 */
  outsideWindow: number
}

/** 这一笔算不算「有真人跟过他」。判定顺序见文件头，**不要调换**。 */
export function isHumanFollowup(t: LeadTouch): boolean {
  // 🔴 机器发的先排掉。放在渠道判断之后 = AI 外呼被当成真人跟进。
  if (isAutomatedTouch(t.source, t.metadata)) return false
  // 客人自己打进来、没人接（任何电话适配器写的 inbound + outcome=missed_inbound）= 我们错过了他，
  // 不是我们跟进了他；算作「已跟进」会把最该回电的人从名单里抹掉。
  if (t.channel === 'phone' && t.direction === 'inbound' && t.metadata?.outcome === 'missed_inbound') return false
  // 电话系统记录的外呼没人接：不算「真人跟进过」（PM 2026-10-12）。
  if (t.channel === 'phone' && t.direction === 'outbound' && t.metadata?.answered === false) return false
  if (t.channel === 'phone') return true
  if (t.source === 'me_manual' || t.source === 'sheet_followup') return true
  if (t.direction !== 'outbound') return false
  // 🔴 Facebook 私信外发整类不算 —— 现在分不出真人和 Meta 的 AI 客服。
  if (t.channel === 'messenger') return false
  return true
}

/** 把触点翻成 `crm/dnc` 认的形状（「别再联系」被人推翻过没有，它自己判）。 */
function toDncTouches(touches: LeadTouch[]): DncTouch[] {
  return touches.map((t) => ({
    outcome: (t.metadata?.outcome as string | undefined) ?? null,
    flagged: t.metadata?.do_not_contact === true,
    occurredAt: t.occurredAt,
  }))
}

function ts(iso: string | null | undefined): number {
  if (!iso) return Number.NaN
  const v = Date.parse(iso)
  return Number.isNaN(v) ? Number.NaN : v
}

export interface PickOptions {
  /** 每客户封顶。`0` 或负数 = 不封顶。 */
  maxPerClient?: number
  windowDays?: number
  /** 这个客户配置里「已经有结论、不该再催」的阶段。见文件头第三段。 */
  suppressedStages?: ReadonlySet<string>
}

/** 纯判据。给一批候选人，挑出「该提醒」的那些。 */
export function pickLeadFollowupDue(
  candidates: LeadCandidate[],
  now: Date,
  opts: PickOptions = {},
): LeadPickResult {
  const maxPerClient = opts.maxPerClient ?? MAX_PER_CLIENT
  const windowDays = opts.windowDays ?? LEAD_WINDOW_DAYS
  const suppressed = opts.suppressedStages ?? new Set<string>()

  const nowMs = now.getTime()
  const windowStart = nowMs - windowDays * DAY_MS
  const slaCutoff = nowMs - LEAD_SLA_HOURS * HOUR_MS

  const inWindow: Array<{ item: LeadDueItem; leadMs: number }> = []
  let outsideWindow = 0

  for (const c of candidates) {
    if (isDoNotContact(c.doNotContactFlag, toDncTouches(c.touches))) continue
    if (c.stage && suppressed.has(c.stage)) continue
    const until = ts(c.snoozeUntil)
    if (Number.isFinite(until) && until > nowMs) continue
    if (c.touches.some(isHumanFollowup)) continue

    const leadMs = ts(c.leadAt)
    // 时间戳坏掉的照样要看见 —— 丢掉就等于这个人从名单上消失了。
    // 当成「很久以前」处理：进积压数，不占今天这封信的头条。
    if (!Number.isFinite(leadMs)) {
      outsideWindow++
      continue
    }
    // 刚填完还不到 SLA，现在催是催自己。
    if (leadMs > slaCutoff) continue

    if (leadMs < windowStart) {
      outsideWindow++
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
    return { items: inWindow.map((r) => r.item), dropped: 0, outsideWindow }
  }
  return {
    items: inWindow.slice(0, maxPerClient).map((r) => r.item),
    dropped: inWindow.length - maxPerClient,
    outsideWindow,
  }
}

/* ------------------------------------------------------------------ *
 * 取数层
 *
 * 🔴 每个查询都走 `fetchAll` + `.order('id')`：
 *    · PostgREST 单次硬顶 1000 行且**不报错**，直接 `.select()` 会静默少算，
 *      少算的方向恰好是「看起来没那么糟」（见 `lib/supabase-paginate` 文件头）。
 *    · 排序键必须唯一。CTS 实测 4434 条触点里 1665 条跟别的行共享同一个
 *      `occurred_at`，单个时间戳上最多挤了 179 行；按 `occurred_at` 分页，
 *      页边界落进这种并列组就会静默丢行 —— 丢一条**表单行**意味着那个人从
 *      名单上彻底消失，连积压都进不去。同 `email-reply-due` 五处全用 `.order('id')`。
 * ------------------------------------------------------------------ */

/** 一次 `.in()` 塞多少个 id。PostgREST 的 URL 长度有限。 */
const IN_CHUNK = 100

interface LeadRow {
  contact_id: string
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
 * 这个客户配置里「已经有结论、不该再催」的阶段。
 *
 * 判据用 `crm/pipeline` 的 `stageSuppressesWorklist` —— 跟后台「今天该联系谁」
 * 同一份，不另写。读不到配置就返回空集合：那意味着这个客户还没配阶段，
 * 此时 `contacts.stage` 也不会有值，抑制不抑制都一样。
 */
export async function loadSuppressedStages(
  supabase: SupabaseClient,
  clientId: string,
): Promise<ReadonlySet<string>> {
  const rows = await fetchAll<{ stage_key: string; marketing_action: string | null; is_terminal: boolean | null }>(
    (from, to) =>
      supabase
        .from('client_pipeline_stages')
        .select('stage_key, marketing_action, is_terminal')
        .eq('client_id', clientId)
        .order('id', { ascending: true })
        .range(from, to),
  )
  const out = new Set<string>()
  for (const r of rows) {
    const action = isMarketingAction(r.marketing_action) ? r.marketing_action : null
    if (stageSuppressesWorklist(action, r.is_terminal)) out.add(r.stage_key)
  }
  return out
}

/** 这个客户在 `since` 之后有过表单留资的人，各自**最近**那一条。 */
async function loadLatestLeads(
  supabase: SupabaseClient,
  clientId: string,
  since: string,
): Promise<Map<string, LeadRow>> {
  const rows = await fetchAll<LeadRow>((from, to) =>
    supabase
      .from('contact_touchpoints')
      .select('contact_id, occurred_at, metadata')
      .eq('client_id', clientId)
      .eq('channel', 'meta_lead_form')
      .gte('occurred_at', since)
      .order('id', { ascending: true })
      .range(from, to),
  )
  const latest = new Map<string, LeadRow>()
  for (const r of rows) {
    if (!r.contact_id) continue
    const prev = latest.get(r.contact_id)
    // 🔴 显式比时间，不靠到达顺序 —— 排序键是 id，行不是按时间来的。
    if (!prev || ts(r.occurred_at) > ts(prev.occurred_at)) latest.set(r.contact_id, r)
  }
  return latest
}

/** 这批人在各自最近一次留资**之后**的触点。 */
async function loadTouchesAfterLead(
  supabase: SupabaseClient,
  clientId: string,
  latestLeads: Map<string, LeadRow>,
): Promise<Map<string, LeadTouch[]>> {
  const ids = [...latestLeads.keys()]
  const out = new Map<string, LeadTouch[]>()
  for (const part of chunk(ids, IN_CHUNK)) {
    const rows = await fetchAll<TouchRow>((from, to) =>
      supabase
        .from('contact_touchpoints')
        .select('contact_id, channel, direction, occurred_at, source, metadata')
        .eq('client_id', clientId)
        .in('contact_id', part)
        .order('id', { ascending: true })
        .range(from, to),
    )
    for (const t of rows) {
      const lead = latestLeads.get(t.contact_id)
      if (!lead) continue
      // 留资**之前**的往来不算对这条线索的跟进。
      // 🔴 比数值不比字符串：两边都来自 PostgREST 时字符串比较恰好也对，
      //    但哪天有一侧换成 `toISOString()`（尾巴是 Z）结果会整个反向。
      if (ts(t.occurred_at) < ts(lead.occurred_at)) continue
      // 表单触点自己不算跟进。
      if (t.channel === 'meta_lead_form') continue
      const list = out.get(t.contact_id) ?? []
      list.push({
        channel: t.channel,
        direction: t.direction,
        occurredAt: t.occurred_at,
        source: t.source,
        metadata: t.metadata,
      })
      out.set(t.contact_id, list)
    }
  }
  return out
}

/** 这批人的联系人行。 */
async function loadContacts(
  supabase: SupabaseClient,
  clientId: string,
  ids: string[],
): Promise<Map<string, ContactRow>> {
  const out = new Map<string, ContactRow>()
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
    for (const c of rows) out.set(c.id, c)
  }
  return out
}

export interface LoadedCandidates {
  candidates: LeadCandidate[]
  /** 表单触点指向的人在 `contacts` 里查不到 —— 静默跳过会让人凭空消失，所以计数。 */
  orphans: number
}

/** 组装判据材料。`lookbackDays` 决定往回看多久。 */
export async function loadLeadCandidates(
  supabase: SupabaseClient,
  clientId: string,
  now: Date,
  lookbackDays: number,
): Promise<LoadedCandidates> {
  const since = new Date(now.getTime() - lookbackDays * DAY_MS).toISOString()
  const latestLeads = await loadLatestLeads(supabase, clientId, since)
  if (latestLeads.size === 0) return { candidates: [], orphans: 0 }

  const touches = await loadTouchesAfterLead(supabase, clientId, latestLeads)
  const contacts = await loadContacts(supabase, clientId, [...latestLeads.keys()])

  const candidates: LeadCandidate[] = []
  let orphans = 0
  for (const [contactId, lead] of latestLeads) {
    const c = contacts.get(contactId)
    if (!c) {
      orphans++
      continue
    }
    const interest = lead.metadata?.tour_interest_raw
    candidates.push({
      clientId,
      contactId,
      displayName: c.display_name,
      leadAt: lead.occurred_at,
      interest: typeof interest === 'string' && interest.trim() ? interest.trim() : null,
      touches: touches.get(contactId) ?? [],
      doNotContactFlag: c.do_not_contact === true,
      stage: c.stage,
      snoozeUntil: c.snooze_until,
    })
  }
  return { candidates, orphans }
}

export interface LeadDueResult {
  items: LeadDueItem[]
  dropped: number
  orphans: number
}

/** 今天该逐条列出来的那批人。只读窗口那么久，出错不牵连积压那一半。 */
export async function findLeadFollowupDue(
  supabase: SupabaseClient,
  clientId: string,
  now: Date = new Date(),
  maxPerClient = MAX_PER_CLIENT,
): Promise<LeadDueResult> {
  const [{ candidates, orphans }, suppressedStages] = await Promise.all([
    loadLeadCandidates(supabase, clientId, now, LEAD_WINDOW_DAYS),
    loadSuppressedStages(supabase, clientId),
  ])
  const picked = pickLeadFollowupDue(candidates, now, { maxPerClient, suppressedStages })
  return { items: picked.items, dropped: picked.dropped, orphans }
}

export interface LeadBacklogResult {
  /** 窗口之外、同样没人回的人数。 */
  backlog: number
  /** 这个数字只算到多少天以前 —— 正文里要如实说。 */
  lookbackDays: number
}

/**
 * 窗口之外的积压。
 *
 * **刻意跟 `findLeadFollowupDue` 分开**：它要全量读半年的数据，是这一层最贵、
 * 最可能出错的一次查询，而它的全部产出只是正文里一个数字。合在一起的话，
 * 这个数字算不出来会把**必须送达的名单**一起带走 —— 那是本末倒置。
 * 调用方应当单独 try/catch 它，算不出来就在正文里明说没算出来。
 */
export async function countLeadFollowupBacklog(
  supabase: SupabaseClient,
  clientId: string,
  now: Date = new Date(),
): Promise<LeadBacklogResult> {
  const [{ candidates }, suppressedStages] = await Promise.all([
    loadLeadCandidates(supabase, clientId, now, BACKLOG_LOOKBACK_DAYS),
    loadSuppressedStages(supabase, clientId),
  ])
  const picked = pickLeadFollowupDue(candidates, now, { maxPerClient: 0, suppressedStages })
  return { backlog: picked.outsideWindow, lookbackDays: BACKLOG_LOOKBACK_DAYS }
}
