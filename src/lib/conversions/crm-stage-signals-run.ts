/**
 * 线索阶段回传——读写编排（2026-11-10）。
 *
 * 每天由 `conversion-daily-pipeline` 调：
 *   1. 找出开了 `leads_config.crm_stage_signals.enabled` 的客户（不写死任何客户）；
 *   2. 读过去 7 天的阶段变化 + 新进来的即时表单线索 → `planLeadStageEvents` 算出该报的档；
 *   3. 每档写一条 `me_sale_outcomes`（outcome_kind='lead_stage'，自动批准，幂等键防重复）；
 *   4. 逐条交给 `sendApprovedOutcome` 发——防双发、拒联检查、7 天窗口、试运行、
 *      允许种类闸全部沿用那边，这里不另写一套。
 *
 * 🔴 自动批准不等于跳过闸：这一路的「批准」只代表「规则判定这条线索确实到了这一档」。
 *    能不能真发由 `sendApprovedOutcome` 决定——客户没开、试运行、客人说过别联系、
 *    超 7 天，都不会发。
 *
 * 🔴 **同一位客人的同一档只报一次**，不管它挂在哪条线索编号上（复核 P1：晚到的第二条
 *    表单线索会让同一档换个编号再报一次，Meta 那边就多记一位，撤不回）。查重按
 *    (客户, 联系人, 阶段名)，数据库有同样的唯一索引兜底。
 *
 * 🔴 **这个任务对每条记录只尝试一次**：只把「还没有发送记录」的交给发送口。发出去之后
 *    卡在「授权失效 / 平台忙 / 不确定」的，归补发任务和人工核对管，不在这里反复撞——
 *    否则几条卡住的会每块都占满名额，后面的永远轮不到（复核 P1）。
 *
 * 🔴 一次调用最多尝试 `maxSends` 条，没发完返回 `remaining > 0`，流水线用下一个 step
 *    接着跑——单步不许逼近网关 ~125 秒硬上限（PITFALLS F8/F10）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeEmail, normalizePhone } from '@/lib/pii/normalize'
import { DAY_MS } from './event-window'
import {
  bookingStageKey,
  parseCrmStageSignalsConfig,
  planLeadStageEvents,
  readCapiSendKinds,
  type BookingMilestoneKind,
  type CrmStageSignalsConfig,
  type FormLead,
  type StageChange,
  type PlannedLeadStageEvent,
} from './crm-stage-signals'
import { sendApprovedOutcome, type SendDeps } from './writeback-service'

export const CRM_STAGE_SOURCE_KIND = 'crm_stage_auto'
export const CRM_STAGE_REVIEWER = 'auto:crm-stage-signal'
/** 比平台的 7 天少 1 小时：留出排队与发送的时间，免得刚写进去就过期。 */
export const CRM_STAGE_WINDOW_MS = 7 * DAY_MS - 60 * 60_000
/** 每块（所有客户合计）最多尝试几条。试运行每条还要两次只读预检，约 1.5–2 秒一条。 */
export const CRM_STAGE_DEFAULT_MAX_SENDS = 20
const IN_CHUNK = 100
/**
 * 单次查询的行数上限。数据库接口默认最多回 1000 行且**不报错地截断**——
 * 截断了就会悄悄漏掉客人。到顶直接抛错，宁可这一段失败也不半截当整数用。
 */
const QUERY_CAP = 1000

export type CrmStageClientSummary =
  | { ran: false; reason: 'not_enabled' | 'config_invalid' | 'kind_not_allowed' }
  | {
      ran: true
      mode: 'dry_run' | 'live'
      planned: number
      inserted: number
      alreadyExisted: number
      skippedNoMatchKey: number
      skippedDoNotContact: number
      skippedStageBeforeLead: number
      /** 本次交给发送口的条数（每条至多一次）。 */
      attempted: number
      sendStatuses: Record<string, number>
      /** 还有没轮到发的，下一块接着发。 */
      remaining: number
    }

export type CrmStageRunDeps = {
  supabase: SupabaseClient
  sendDeps: Omit<SendDeps, 'supabase' | 'now'>
  /** 只用于「过去 7 天」的判断。发送用真实时间（见 conversion-daily-pipeline 文件头）。 */
  now: Date
}

function capped<T>(rows: T[] | null, what: string): T[] {
  const out = rows ?? []
  if (out.length >= QUERY_CAP) throw new Error(`${what}超过 ${QUERY_CAP} 行，可能被截断——停下，不拿半截数据算`)
  return out
}

async function inChunks<T>(ids: string[], fn: (part: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += IN_CHUNK) out.push(...(await fn(ids.slice(i, i + IN_CHUNK))))
  return out
}

type ContactInfo = { email: string | null; phone: string | null; doNotContact: boolean }

/** 读出某客户在时间窗内该报的档（只读，不写）。 */
export async function loadPlan(supabase: SupabaseClient, clientId: string, cfg: CrmStageSignalsConfig, now: Date) {
  const sinceIso = new Date(now.getTime() - CRM_STAGE_WINDOW_MS).toISOString()
  const stageKeys = [...new Set(cfg.stages.flatMap((s) => s.stageKeys))]

  const bookingKinds = [...new Set(cfg.stages.flatMap((s) => (s.bookingMilestone ? [s.bookingMilestone] : [])))]

  // 窗口内有动静的客人：阶段变到配置里的档、订单里程碑被标成已收，或（要报第一档时）新进来的表单线索
  const ids = new Set<string>()
  if (stageKeys.length > 0) {
    const recentChanges = await supabase
      .from('contact_stage_events')
      .select('contact_id')
      .eq('client_id', clientId)
      .in('to_stage', stageKeys)
      .gte('created_at', sinceIso)
      .limit(QUERY_CAP)
    if (recentChanges.error) throw new Error(`读取阶段变化失败：${recentChanges.error.message}`)
    for (const r of capped(recentChanges.data as { contact_id: string }[] | null, '近 7 天阶段变化')) ids.add(r.contact_id)
  }
  if (bookingKinds.length > 0) {
    for (const cid of await recentBookingContacts(supabase, clientId, bookingKinds, sinceIso)) ids.add(cid)
  }

  if (cfg.initialEventName) {
    const recentLeads = await supabase
      .from('contact_touchpoints')
      .select('contact_id')
      .eq('client_id', clientId)
      .eq('source', 'meta_lead_form')
      .gte('occurred_at', sinceIso)
      .limit(QUERY_CAP)
    if (recentLeads.error) throw new Error(`读取表单线索失败：${recentLeads.error.message}`)
    for (const r of capped(recentLeads.data as { contact_id: string | null }[] | null, '近 7 天表单线索')) {
      if (r.contact_id) ids.add(r.contact_id)
    }
  }

  const contactIds = [...ids]
  const contacts = new Map<string, ContactInfo>()
  if (contactIds.length === 0) return { plan: { events: [], skipped: [] }, contacts }

  // 这些客人的全部历史（判断「最早什么时候到过这一档」要看全）
  const stageChanges = stageKeys.length === 0 ? [] : await inChunks(contactIds, async (part) => {
    const r = await supabase
      .from('contact_stage_events')
      .select('contact_id, to_stage, created_at')
      .eq('client_id', clientId)
      .in('contact_id', part)
      .in('to_stage', stageKeys)
      .limit(QUERY_CAP)
    if (r.error) throw new Error(`读取阶段历史失败：${r.error.message}`)
    return capped(r.data as { contact_id: string; to_stage: string; created_at: string }[] | null, '阶段历史').map(
      (x): StageChange => ({ contactId: x.contact_id, toStage: x.to_stage, at: x.created_at }),
    )
  })
  const bookingChanges =
    bookingKinds.length === 0 ? [] : await bookingMilestoneChanges(supabase, clientId, bookingKinds, contactIds)
  const changes = [...stageChanges, ...bookingChanges]
  const leads = await inChunks(contactIds, async (part) => {
    const r = await supabase
      .from('contact_touchpoints')
      .select('contact_id, source_ref, occurred_at')
      .eq('client_id', clientId)
      .eq('source', 'meta_lead_form')
      .in('contact_id', part)
      .limit(QUERY_CAP)
    if (r.error) throw new Error(`读取表单线索失败：${r.error.message}`)
    return capped(r.data as { contact_id: string; source_ref: string | null; occurred_at: string }[] | null, '表单线索')
      .filter((x) => x.source_ref)
      .map((x): FormLead => ({ contactId: x.contact_id, leadId: x.source_ref as string, createdAt: x.occurred_at }))
  })
  const contactRows = await inChunks(contactIds, async (part) => {
    const r = await supabase
      .from('contacts')
      .select('id, primary_email, primary_phone, do_not_contact')
      .eq('client_id', clientId)
      .in('id', part)
    if (r.error) throw new Error(`读取联系人失败：${r.error.message}`)
    return (r.data ?? []) as { id: string; primary_email: string | null; primary_phone: string | null; do_not_contact: boolean | null }[]
  })
  for (const c of contactRows) {
    contacts.set(c.id, { email: c.primary_email, phone: c.primary_phone, doNotContact: c.do_not_contact === true })
  }

  const plan = planLeadStageEvents({ config: cfg, leads, changes, now, windowMs: CRM_STAGE_WINDOW_MS })
  return { plan, contacts }
}

/** 时间窗内有里程碑被标成「已收」的订单，对应哪些客人（只算没取消的订单）。 */
async function recentBookingContacts(
  supabase: SupabaseClient,
  clientId: string,
  kinds: BookingMilestoneKind[],
  sinceIso: string,
): Promise<string[]> {
  const ev = await supabase
    .from('crm_booking_events')
    .select('booking_id')
    .eq('client_id', clientId)
    .eq('action', 'milestone_paid')
    .in('milestone_kind', kinds)
    .gte('created_at', sinceIso)
    .limit(QUERY_CAP)
  if (ev.error) throw new Error(`读取订单收款记录失败：${ev.error.message}`)
  const bookingIds = [...new Set(capped(ev.data as { booking_id: string }[] | null, '近 7 天订单收款记录').map((r) => r.booking_id))]
  if (bookingIds.length === 0) return []
  const rows = await inChunks(bookingIds, async (part) => {
    const r = await supabase
      .from('crm_bookings')
      .select('contact_id')
      .eq('client_id', clientId)
      .eq('status', 'active')
      .in('id', part)
    if (r.error) throw new Error(`读取订单失败：${r.error.message}`)
    return (r.data ?? []) as { contact_id: string | null }[]
  })
  return [...new Set(rows.flatMap((r) => (r.contact_id ? [r.contact_id] : [])))]
}

/**
 * 这些客人的订单里程碑「被标成已收」的全部时刻，转成计划器认的阶段变化。
 *
 * 只算：订单没取消，且这个里程碑**现在仍是已收**（标了又取消的不算）。
 * 时间用员工标的那一刻（`crm_booking_events.created_at`），不用 `paid_on`：`paid_on` 可以补填成
 * 几十天前的日期，Meta 不收 7 天前的事件；标的那一刻才是 ME 第一次知道这件事的时间。
 */
async function bookingMilestoneChanges(
  supabase: SupabaseClient,
  clientId: string,
  kinds: BookingMilestoneKind[],
  contactIds: string[],
): Promise<StageChange[]> {
  const bookings = await inChunks(contactIds, async (part) => {
    const r = await supabase
      .from('crm_bookings')
      .select('id, contact_id')
      .eq('client_id', clientId)
      .eq('status', 'active')
      .in('contact_id', part)
      .limit(QUERY_CAP)
    if (r.error) throw new Error(`读取订单失败：${r.error.message}`)
    return capped(r.data as { id: string; contact_id: string | null }[] | null, '订单')
  })
  const contactOf = new Map<string, string>()
  for (const b of bookings) if (b.contact_id) contactOf.set(b.id, b.contact_id)
  const bookingIds = [...contactOf.keys()]
  if (bookingIds.length === 0) return []

  const paidNow = new Set<string>()
  const milestones = await inChunks(bookingIds, async (part) => {
    const r = await supabase
      .from('crm_booking_milestones')
      .select('booking_id, kind')
      .eq('client_id', clientId)
      .eq('state', 'paid')
      .in('kind', kinds)
      .in('booking_id', part)
      .limit(QUERY_CAP)
    if (r.error) throw new Error(`读取订单里程碑失败：${r.error.message}`)
    return capped(r.data as { booking_id: string; kind: BookingMilestoneKind }[] | null, '订单里程碑')
  })
  for (const m of milestones) paidNow.add(`${m.booking_id}|${m.kind}`)
  if (paidNow.size === 0) return []

  const events = await inChunks(bookingIds, async (part) => {
    const r = await supabase
      .from('crm_booking_events')
      .select('booking_id, milestone_kind, created_at')
      .eq('client_id', clientId)
      .eq('action', 'milestone_paid')
      .in('milestone_kind', kinds)
      .in('booking_id', part)
      .limit(QUERY_CAP)
    if (r.error) throw new Error(`读取订单收款记录失败：${r.error.message}`)
    return capped(
      r.data as { booking_id: string; milestone_kind: BookingMilestoneKind; created_at: string }[] | null,
      '订单收款记录',
    )
  })
  const out: StageChange[] = []
  for (const e of events) {
    const contactId = contactOf.get(e.booking_id)
    if (!contactId || !paidNow.has(`${e.booking_id}|${e.milestone_kind}`)) continue
    out.push({ contactId, toStage: bookingStageKey(e.milestone_kind), at: e.created_at })
  }
  return out
}

/** 这些客人已经报过哪些档（不限时间窗）——同一位客人的同一档只报一次。 */
async function alreadyReported(supabase: SupabaseClient, clientId: string, contactIds: string[]): Promise<Set<string>> {
  const rows = await inChunks(contactIds, async (part) => {
    const r = await supabase
      .from('me_sale_outcomes')
      .select('contact_id, lead_stage')
      .eq('client_id', clientId)
      .eq('outcome_kind', 'lead_stage')
      .in('contact_id', part)
      .limit(QUERY_CAP)
    if (r.error) throw new Error(`读取已报过的线索阶段失败：${r.error.message}`)
    return capped(r.data as { contact_id: string; lead_stage: string }[] | null, '已报过的线索阶段')
  })
  return new Set(rows.map((r) => `${r.contact_id}|${r.lead_stage}`))
}

async function insertPlanned(
  supabase: SupabaseClient,
  clientId: string,
  defaultPhoneCountry: string | null,
  ev: PlannedLeadStageEvent,
  contact: ContactInfo | undefined,
  nowIso: string,
): Promise<'inserted' | 'exists' | 'no_match_key'> {
  const email = normalizeEmail(contact?.email)
  const phone = normalizePhone(contact?.phone, defaultPhoneCountry)
  if (!email && !phone) return 'no_match_key'
  const { error } = await supabase.from('me_sale_outcomes').insert({
    client_id: clientId,
    contact_id: ev.contactId,
    outcome_kind: 'lead_stage',
    lead_stage: ev.eventName,
    meta_lead_id: ev.leadId,
    customer_email: email,
    customer_phone: phone,
    occurred_at: ev.occurredAt,
    source_kind: CRM_STAGE_SOURCE_KIND,
    source_ref: ev.sourceRef,
    review_status: 'approved',
    reviewed_by: CRM_STAGE_REVIEWER,
    reviewed_at: nowIso,
    created_by: CRM_STAGE_REVIEWER,
  })
  if (!error) return 'inserted'
  // 唯一约束冲突 = 这一档已经写过（同线索同档，或同客人同档），正常。认错误码不认文案。
  if ((error as { code?: string }).code === '23505') return 'exists'
  throw new Error(`写入线索阶段记录失败：${error.message}`)
}

/** 时间窗内本客户**还没有任何发送记录**的线索阶段记录（按发生时间先后，前面的档先发）。 */
async function neverAttempted(supabase: SupabaseClient, clientId: string, now: Date): Promise<string[]> {
  const sinceIso = new Date(now.getTime() - CRM_STAGE_WINDOW_MS).toISOString()
  const r = await supabase
    .from('me_sale_outcomes')
    .select('id, me_conversion_writebacks(status)')
    .eq('client_id', clientId)
    .eq('outcome_kind', 'lead_stage')
    .eq('source_kind', CRM_STAGE_SOURCE_KIND)
    .eq('review_status', 'approved')
    .is('redacted_at', null)
    .gte('occurred_at', sinceIso)
    .order('occurred_at', { ascending: true })
    .limit(QUERY_CAP)
  if (r.error) throw new Error(`读取待发线索阶段记录失败：${r.error.message}`)
  return capped(r.data as { id: string; me_conversion_writebacks: { status: string }[] | null }[] | null, '待发线索阶段记录')
    // 有发送记录但还停在 queued = 上次建了记录、没来得及往下走，仍算没尝试过。
    .filter((row) => (row.me_conversion_writebacks ?? []).every((w) => w.status === 'queued'))
    .map((row) => row.id)
}

/**
 * 发送口因「客人说过别再联系」拒发时不建发送记录。把这条记录标成已拒绝（原因：客人拒联），
 * 它就不会每天被重新捞出来占名额，审计上也说得清为什么没发。
 */
async function markOptedOut(supabase: SupabaseClient, outcomeId: string, nowIso: string): Promise<void> {
  const { error } = await supabase
    .from('me_sale_outcomes')
    .update({
      review_status: 'rejected',
      reject_reason: 'customer_opted_out',
      reject_note: '发送前查到客人说过别再联系',
      reviewed_by: CRM_STAGE_REVIEWER,
      reviewed_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', outcomeId)
    .eq('review_status', 'approved')
  if (error) throw new Error(`标记拒联记录失败：${error.message}`)
}

export async function runCrmStageSignalsForClient(
  clientId: string,
  deps: CrmStageRunDeps,
  opts: { maxSends?: number } = {},
): Promise<CrmStageClientSummary> {
  const { supabase, now } = deps
  const clientRes = await supabase.from('clients').select('id, default_phone_country, leads_config').eq('id', clientId).maybeSingle()
  if (clientRes.error) throw new Error(`读取客户配置失败：${clientRes.error.message}`)
  const client = clientRes.data as { default_phone_country: string | null; leads_config: unknown } | null
  if (!client) throw new Error('客户不存在')

  const hasKey = typeof client.leads_config === 'object' && client.leads_config !== null && 'crm_stage_signals' in client.leads_config
  const cfg = parseCrmStageSignalsConfig(client.leads_config)
  if (!cfg) return { ran: false, reason: hasKey ? 'config_invalid' : 'not_enabled' }
  if (!cfg.enabled) return { ran: false, reason: 'not_enabled' }
  // 允许种类名单里没有线索阶段 → 一条都不写（写了也发不出去，白存一份客人信息）
  const allowed = readCapiSendKinds(client.leads_config)
  if (allowed && !allowed.includes('lead_stage')) return { ran: false, reason: 'kind_not_allowed' }

  const { plan, contacts } = await loadPlan(supabase, clientId, cfg, now)
  const reported = await alreadyReported(supabase, clientId, [...new Set(plan.events.map((e) => e.contactId))])
  const nowIso = now.toISOString()
  let inserted = 0
  let alreadyExisted = 0
  let skippedNoMatchKey = 0
  let skippedDoNotContact = 0
  for (const ev of plan.events) {
    const key = `${ev.contactId}|${ev.eventName}`
    if (reported.has(key)) {
      alreadyExisted++
      continue
    }
    const contact = contacts.get(ev.contactId)
    // 已标拒联的客人不写入（不为发不出去的事再存一份邮箱电话）。发送口还会按触点再查一遍。
    if (contact?.doNotContact) {
      skippedDoNotContact++
      continue
    }
    const r = await insertPlanned(supabase, clientId, client.default_phone_country, ev, contact, nowIso)
    if (r === 'inserted') {
      inserted++
      reported.add(key)
    } else if (r === 'exists') alreadyExisted++
    else skippedNoMatchKey++
  }

  const toSend = await neverAttempted(supabase, clientId, now)
  const maxSends = Math.max(0, opts.maxSends ?? CRM_STAGE_DEFAULT_MAX_SENDS)
  const sendStatuses: Record<string, number> = {}
  let attempted = 0
  for (const id of toSend.slice(0, maxSends)) {
    // 不传 now：发送口用真实时间写尝试时刻（见 conversion-daily-pipeline 文件头「now 只给判断用」）。
    const res = await sendApprovedOutcome(id, { supabase, ...deps.sendDeps })
    attempted++
    sendStatuses[res.status] = (sendStatuses[res.status] ?? 0) + 1
    if (res.status === 'redacted' && res.writebackId == null) await markOptedOut(supabase, id, nowIso)
    // 配置在跑的途中被关掉了：剩下的也都会被拒，别再试。
    if (res.status === 'not_allowed') {
      return summary(0)
    }
  }
  return summary(Math.max(0, toSend.length - attempted))

  function summary(remaining: number): CrmStageClientSummary {
    return {
      ran: true,
      mode: cfg!.mode,
      planned: plan.events.length,
      inserted,
      alreadyExisted,
      skippedNoMatchKey,
      skippedDoNotContact,
      skippedStageBeforeLead: plan.skipped.length,
      attempted,
      sendStatuses,
      remaining,
    }
  }
}

/** 开了线索阶段回传的客户名单——来自配置，不写死。 */
export async function crmStageEnabledClientIds(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase
    .from('clients')
    .select('id')
    .filter('leads_config->crm_stage_signals->>enabled', 'eq', 'true')
  if (error) throw new Error(`读取已开启线索阶段回传的客户失败：${error.message}`)
  return ((data ?? []) as { id: string }[]).map((r) => r.id)
}

/**
 * 每日任务的一块：所有开了的客户**合计**最多尝试 `budget` 条（复核 P1：按客户各给 25 条，
 * 两三个客户就会顶到网关上限）。名额用完还有客户没轮到，就报 done:false 让下一块接着跑。
 */
export async function runCrmStageChunkForEnabledClients(
  deps: CrmStageRunDeps,
  budget: number = CRM_STAGE_DEFAULT_MAX_SENDS,
): Promise<{ summary: Record<string, CrmStageClientSummary>; done: boolean }> {
  const summary: Record<string, CrmStageClientSummary> = {}
  let left = budget
  let done = true
  for (const clientId of await crmStageEnabledClientIds(deps.supabase)) {
    if (left <= 0) {
      done = false
      break
    }
    const s = await runCrmStageSignalsForClient(clientId, deps, { maxSends: left })
    summary[clientId] = s
    if (s.ran) {
      left -= s.attempted
      if (s.remaining > 0) done = false
    }
  }
  return { summary, done }
}
