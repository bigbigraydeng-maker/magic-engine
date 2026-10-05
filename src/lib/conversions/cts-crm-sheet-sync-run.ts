/**
 * CTS CRM 表格同步——编排层（Issue #1397 CAPI 续，2026-09-13）。
 *
 * 纯 I/O 编排：读表 → 关联两个 tab → 分类（`cts-crm-sheet-sync.ts`）→ 查价
 * （`cts-tour-price.ts`）→ 关联既有联系人 → 写 `me_sale_outcomes`。分类规则
 * 本身不在这里，方便单测；这一层只负责把各块接起来。
 *
 * 单独导出成一个函数（不塞进 API 路由 handler 里），是子牙复审建议：以后如果
 * 这条同步要转成 Inngest 事件处理器，直接复用这个函数，不用重写判断逻辑。
 *
 * ~~这一轮**只人工触发**，不接 cron/Inngest~~ —— 2026-09-15 起由
 * `conversion-daily-pipeline`（Inngest）每天自动调；2026-09-22 起改成**分块**调
 * `runCtsCrmSyncChunk()`（每块 ≤ 20 行）：整表一步跑 4–24 分钟，被网关 ~125 秒
 * 超时强杀，流水线连续 6 天没跑完（PITFALLS F10 第二实例）。手动路由仍走
 * `runCtsCrmSync()` 一次跑整表，两条调用路径并存。
 *
 * `maxInsertsPerRun` 是给现有人工审核页面（固定 limit=200）留的安全阀：不会
 * 一次性把几百条历史存量全灌进待审核队列，超出的部分下次再跑会继续处理
 * （已经写过的靠幂等键快速跳过，不会重复劳动）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import { readSheetValues } from '@/lib/google-sheets/client'
import { buildIdentities } from '@/lib/crm/identity'
import { buildIntakeRow, type IntakeInput } from './intake'
import { lookupTourPrice } from './cts-tour-price'
import { toMajorUnits } from './money'
import { isPastEventWindow } from './event-window'
import {
  parseSheet1Row,
  parseCrmManagementRow,
  classifyCtsCrmPerson,
  ctsPhoneE164,
  ctsSourceRef,
  isFormTemplateMessage,
  type Sheet1LeadRow,
} from './cts-crm-sheet-sync'

/** 同 `src/lib/seo-meta/cts-meta-pr.ts` 里的 CTS_CLIENT_ID —— 同一个客户，不同域各自声明这个字面量是既有惯例。 */
const CTS_CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
const SPREADSHEET_ID = '1vISaVkVkcQMSaR6Jo7xdmym6Ed5eE-q9025snYWYDVA'
const SHEET1_RANGE = 'Sheet1!A2:S'
const CRM_MANAGEMENT_RANGE = 'CRM管理!A2:H'
const DEFAULT_MAX_INSERTS_PER_RUN = 50
/** CTS 官网价格 feed（`first-party-tours.ts`）如果注册了，会用这个域名查——没注册就跳过这一步，不报错。 */
const CTS_WEBSITE_DOMAIN = 'ctstours.co.nz'

export interface HeldItem {
  /** 只露最后 4 位，这份摘要可能被贴进聊天/工单。 */
  phoneMasked: string
  tourInterest: string | null
  reason: string
}

export interface CtsCrmSyncSummary {
  totalCrmRows: number
  excludedNoPhone: number
  excludedByNotes: number
  /** 填了表单、没被标无效，但员工记录里没有明确兴趣证据——不当合格线索发（PM 2026-10-04）。 */
  excludedNoInterest: number
  /** 员工记录判合格，但客人从没真实发起过对话（表单自带的首条消息不算）——不当合格线索发。 */
  excludedNoConversation: number
  excludedNoDate: number
  /** 旧规则放进来、待核对的线索，按新规则复判不合格 → 自动拒绝（不发给 Meta）的条数。 */
  rejectedStaleLeads: number
  /** 客户自己的消息里显示出兴趣、据此写入的线索条数。 */
  qualifiedFromConversation: number
  /** 凭客户消息判合格、但线索已超过 Meta 的 7 天窗口，写进去也永远发不出去 → 不写（免得占满每次写入上限、挤掉新线索）。 */
  skippedPastWindow: number
  insertedLeads: number
  insertedPurchases: number
  /** 已经同步过、这次命中幂等键被跳过——预期行为，不是错误。 */
  skippedAlreadySynced: number
  /** 阶段=已订金/已出行，但查不到价格或缺真实成交日期，搁置未写入。 */
  heldForManualReview: HeldItem[]
  /** 没能在 contacts 里找到匹配的人——这些行的 do_not_contact 检查这次不生效。 */
  contactNotLinked: number
  /** 这次因为读客户会话失败而跳过的行数——读失败时「没有兴趣证据」是未知，不是没有。 */
  conversationReadFailed: number
  insertErrors: Array<{ phoneMasked: string; error: string }>
  cappedAtMaxInserts: boolean
}

function maskPhone(phone: string): string {
  return phone.length > 4 ? `***${phone.slice(-4)}` : phone
}

function emptySummary(): CtsCrmSyncSummary {
  return {
    totalCrmRows: 0,
    excludedNoPhone: 0,
    excludedByNotes: 0,
    excludedNoInterest: 0,
    excludedNoConversation: 0,
    excludedNoDate: 0,
    rejectedStaleLeads: 0,
    qualifiedFromConversation: 0,
    skippedPastWindow: 0,
    insertedLeads: 0,
    insertedPurchases: 0,
    skippedAlreadySynced: 0,
    heldForManualReview: [],
    contactNotLinked: 0,
    conversationReadFailed: 0,
    insertErrors: [],
    cappedAtMaxInserts: false,
  }
}

/**
 * Sheet1 按电话建索引，供 CRM管理 逐行关联；查不到有效电话的行直接跳过索引。
 *
 * 同一个电话在 Sheet1 有多行（同一个人交过多次表单）时取**最先出现的那一行**——姓名、邮箱、
 * 提交时间、Facebook 线索编号都来自这同一行，彼此自洽（首次接触归因）。2026-10-04 魏征复审点名：
 * 这意味着发给 Meta 的 lead_id 是该客人**第一次**提交的那条，不一定是促成成交的那条；
 * 同一个人的任何一条线索对应的都是同一个真人，归到首次接触可接受，所以保持现状并用测试固定，
 * 不改成“多条就不带”（那会恰好丢掉重复提交的高意向客人）。*/
function indexSheet1ByPhone(rows: Sheet1LeadRow[]): Map<string, Sheet1LeadRow> {
  const map = new Map<string, Sheet1LeadRow>()
  for (const row of rows) {
    const phone = ctsPhoneE164(row.phoneRaw)
    if (phone && !map.has(phone)) map.set(phone, row)
  }
  return map
}

/**
 * 只读匹配既有联系人——不新建、不合并。这条同步的职责是记录 CAPI 事实，不是
 * 建联系人（那是 `meta-leads-hourly` cron 已经在做的事，见 `crm/meta-lead.ts`）。
 * 匹配不上就如实留空，调用方把这类行计进 `contactNotLinked`。
 */
async function findExistingContactId(
  supabase: SupabaseClient,
  clientId: string,
  phone: string | null,
  email: string | null,
): Promise<string | null> {
  const identities = buildIdentities({ phone, email, defaultCountry: 'NZ' })
  if (identities.length === 0) return null

  const { data } = await supabase
    .from('contact_identities')
    .select('contact_id, kind, value')
    .eq('client_id', clientId)
    .in(
      'value',
      identities.map((i) => i.value),
    )

  const matched = (data ?? []).filter((h) =>
    identities.some((i) => i.kind === h.kind && i.value === h.value),
  )
  const contactIds = [...new Set(matched.map((m) => m.contact_id as string))]
  // 两个不同的既有联系人都命中——含糊不清，宁可留空交给人工审核页面上的
  // "未关联联系人"提示，也不要猜一个。
  return contactIds.length === 1 ? contactIds[0] : null
}

async function insertOutcome(
  supabase: SupabaseClient,
  input: IntakeInput,
  phoneMasked: string,
  summary: CtsCrmSyncSummary,
  onSuccess: () => void,
  auditExtra?: Record<string, unknown>,
): Promise<void> {
  const built = buildIntakeRow(input, { defaultPhoneCountry: '64', now: new Date() })
  if (!built.ok) {
    summary.insertErrors.push({ phoneMasked, error: built.errors.join('; ') })
    return
  }

  const { data, error } = await supabase.from('me_sale_outcomes').insert(built.row).select('id').single()

  if (error) {
    if ((error as { code?: string }).code === '23505') {
      // 幂等键命中——正常去重，见 ctsSourceRef 的设计说明。
      summary.skippedAlreadySynced++
      return
    }
    summary.insertErrors.push({ phoneMasked, error: error.message })
    return
  }

  await supabase.from('me_conversion_audit').insert({
    outcome_id: (data as { id: string }).id,
    action: 'created',
    actor: 'cts-crm-sheet-sync',
    detail: { source_kind: input.sourceKind, source_ref: input.sourceRef, ...auditExtra },
  })
  onSuccess()
}

export interface RunCtsCrmSyncDeps {
  supabase?: SupabaseClient
  maxInsertsPerRun?: number
}

/**
 * 分块游标——给 Inngest 逐块推进用（2026-09-22，PITFALLS F10 第二实例）。
 *
 * 🔴 三个字段全是 number：它要经过 Inngest 的 step 记忆化（JSON 序列化），
 *    `Date`/`undefined`/`Infinity` 都会在那一层变形。
 */
export interface CtsCrmSyncCursor {
  /** 从 CRM管理 的第几行（0 起）开始处理。 */
  offset: number
  /** 这一块最多看多少行；不传 = 一直看到表尾（手动路由沿用这个）。 */
  limit?: number
  /** 之前几块累计写入了多少条——`maxInsertsPerRun` 这道安全阀要跨块生效。 */
  insertedSoFar: number
}

export interface CtsCrmSyncChunkResult {
  /** 只含这一块处理的行；跨块汇总用 `mergeCtsCrmSummaries`。 */
  summary: CtsCrmSyncSummary
  nextOffset: number
  /** 这次读到的 CRM管理 总行数——两块之间表格可能变化，以每次读到的为准。 */
  totalSheetRows: number
  insertedSoFar: number
  /** 已经看到表尾。 */
  done: boolean
}

/** 跨块合并：计数相加、清单拼接（搁置项按打码电话+团名去重——同一行在两块之间因表格插行被看两次时不重复列）。 */
export function mergeCtsCrmSummaries(a: CtsCrmSyncSummary, b: CtsCrmSyncSummary): CtsCrmSyncSummary {
  const heldKeys = new Set(a.heldForManualReview.map((h) => `${h.phoneMasked}|${h.tourInterest ?? ''}`))
  const held = [...a.heldForManualReview]
  for (const h of b.heldForManualReview) {
    const key = `${h.phoneMasked}|${h.tourInterest ?? ''}`
    if (!heldKeys.has(key)) {
      heldKeys.add(key)
      held.push(h)
    }
  }
  return {
    totalCrmRows: a.totalCrmRows + b.totalCrmRows,
    excludedNoPhone: a.excludedNoPhone + b.excludedNoPhone,
    excludedByNotes: a.excludedByNotes + b.excludedByNotes,
    excludedNoDate: a.excludedNoDate + b.excludedNoDate,
    excludedNoInterest: a.excludedNoInterest + b.excludedNoInterest,
    excludedNoConversation: a.excludedNoConversation + b.excludedNoConversation,
    rejectedStaleLeads: a.rejectedStaleLeads + b.rejectedStaleLeads,
    qualifiedFromConversation: a.qualifiedFromConversation + b.qualifiedFromConversation,
    skippedPastWindow: a.skippedPastWindow + b.skippedPastWindow,
    insertedLeads: a.insertedLeads + b.insertedLeads,
    insertedPurchases: a.insertedPurchases + b.insertedPurchases,
    skippedAlreadySynced: a.skippedAlreadySynced + b.skippedAlreadySynced,
    heldForManualReview: held,
    contactNotLinked: a.contactNotLinked + b.contactNotLinked,
    conversationReadFailed: a.conversationReadFailed + b.conversationReadFailed,
    insertErrors: [...a.insertErrors, ...b.insertErrors],
    cappedAtMaxInserts: a.cappedAtMaxInserts || b.cappedAtMaxInserts,
  }
}

/** Supabase 一次最多回 1000 行（PITFALLS F9）——按主键分页读全。 */
const EXISTING_REFS_PAGE = 1000

/**
 * 已同步过的幂等键集合——在任何按行的数据库往返之前先判「已同步」直接跳过。
 *
 * 🔴 这不是安全闸，只是省事：真正防重复的仍是 `(client_id, source_kind, source_ref)`
 *    唯一索引 + 23505 处理。没有这一步时，600 行历史行每行都要先查联系人、查价、
 *    再撞唯一索引（每行 3–5 次往返，实测 0.4–2.4 秒/行），拆块只是把 20 分钟分摊、
 *    没有减少（子牙 2026-09-22 复审 M6）。
 */
async function loadExistingSourceRefs(supabase: SupabaseClient): Promise<Map<string, { id: string; reviewStatus: string }>> {
  const refs = new Map<string, { id: string; reviewStatus: string }>()
  let lastId: string | null = null
  for (;;) {
    let q = supabase
      .from('me_sale_outcomes')
      .select('id, source_ref, review_status')
      .eq('client_id', CTS_CLIENT_ID)
      .eq('source_kind', 'crm_sheet_sync')
      .not('source_ref', 'is', null)
      .order('id', { ascending: true })
      .limit(EXISTING_REFS_PAGE)
    if (lastId) q = q.gt('id', lastId)
    const { data, error } = await q
    if (error) throw new Error(`读取已同步记录失败：${error.message}`)
    const rows = (data ?? []) as Array<{ id: string; source_ref: string | null; review_status: string }>
    for (const r of rows) if (r.source_ref) refs.set(r.source_ref, { id: r.id, reviewStatus: r.review_status })
    if (rows.length < EXISTING_REFS_PAGE) break
    lastId = rows[rows.length - 1].id
  }
  return refs
}

function tallyExcluded(
  summary: CtsCrmSyncSummary,
  reason: 'no_qualifying_phone' | 'excluded_by_notes' | 'no_usable_date' | 'no_interest_evidence' | 'no_customer_conversation',
): void {
  if (reason === 'no_qualifying_phone') summary.excludedNoPhone++
  else if (reason === 'excluded_by_notes') summary.excludedByNotes++
  else if (reason === 'no_interest_evidence') summary.excludedNoInterest++
  else if (reason === 'no_customer_conversation') summary.excludedNoConversation++
  else summary.excludedNoDate++
}

/** 拒绝旧待核对线索时写进 `reject_note` 的说明文案。 */
function staleRejectNote(reason: 'excluded_by_notes' | 'no_interest_evidence' | 'no_customer_conversation'): string {
  if (reason === 'excluded_by_notes') return '员工记录里出现排除词（打错电话/不感兴趣/已订别家等）'
  if (reason === 'no_interest_evidence') return '员工记录里没有明确兴趣证据，不当合格线索发'
  return '客人没有真实发起过对话（表单自带的首条消息不算），不当合格线索发'
}

/**
 * 旧规则（只看电话和两个排除词）放进来、还在「待核对」的线索，按新规则复判不合格（排除词 / 没有兴趣证据 /
 * 没有真实对话）→ 拒绝，不告诉 Meta。CAS：只在仍是 pending_review 时才拒，已批准/已发出的绝不动（撤不回）。
 */
async function rejectStalePendingLead(
  supabase: SupabaseClient,
  existing: { id: string; reviewStatus: string } | undefined,
  reason: 'excluded_by_notes' | 'no_interest_evidence' | 'no_customer_conversation',
  summary: CtsCrmSyncSummary,
): Promise<void> {
  if (!existing || existing.reviewStatus !== 'pending_review') return
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('me_sale_outcomes')
    .update({
      review_status: 'rejected',
      reject_reason: 'other',
      reject_note: staleRejectNote(reason),
      reviewed_by: 'auto:cts-qualify-rule',
      reviewed_at: now,
      updated_at: now,
    })
    .eq('id', existing.id)
    .eq('review_status', 'pending_review')
    .select('id')
  if (error) {
    summary.insertErrors.push({ phoneMasked: '(stale-lead-reject)', error: error.message })
    return
  }
  if ((data?.length ?? 0) > 0) {
    summary.rejectedStaleLeads++
    await supabase.from('me_conversion_audit').insert({
      outcome_id: existing.id,
      action: 'rejected',
      actor: 'cts-crm-sheet-sync',
      detail: { reason },
    })
  }
}

/** 把数组切成每块最多 `size` 个元素——给 `.in(...)` 查询用（Supabase URL 长度有限）。 */
function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

/** 每个联系人最多取多少条入站消息、每条正文截断到多少字符——控制拼出来的文本长度。 */
const INBOUND_MESSAGES_PER_CONTACT = 40
const INBOUND_BODY_MAX_CHARS = 500
/** 只看最近 90 天的入站消息。 */
const INBOUND_LOOKBACK_DAYS = 90
/** 一次查多少个会话的消息——`.limit(1000)` 是这一批共享的上限，块太大时后面的会话会被截掉。 */
const CONVERSATION_IDS_PER_QUERY = 20

/** 按联系人查会话 id → 联系人 id 的映射；任一查询出错就置 `failed`，但继续返回已收集到的部分。 */
async function loadConversationIds(
  supabase: SupabaseClient,
  clientId: string,
  contactIds: string[],
): Promise<{ convToContact: Map<string, string>; failed: boolean }> {
  const convToContact = new Map<string, string>()
  let failed = false
  for (const chunk of chunkArray(contactIds, 100)) {
    const { data, error } = await supabase
      .from('conversations')
      .select('id, contact_id')
      .eq('client_id', clientId)
      .in('contact_id', chunk)
    if (error) {
      failed = true
      continue
    }
    for (const row of (data ?? []) as Array<{ id: string; contact_id: string }>) {
      convToContact.set(row.id, row.contact_id)
    }
  }
  return { convToContact, failed }
}

/** 按会话 id 读入站消息正文，按联系人分组；任一查询出错就置 `failed`，但继续返回已收集到的部分。 */
async function loadBodiesByContact(
  supabase: SupabaseClient,
  convToContact: Map<string, string>,
  since: string,
): Promise<{ bodiesByContact: Map<string, string[]>; failed: boolean }> {
  const bodiesByContact = new Map<string, string[]>()
  let failed = false
  for (const chunk of chunkArray([...convToContact.keys()], CONVERSATION_IDS_PER_QUERY)) {
    const { data, error } = await supabase
      .from('conversation_messages')
      .select('conversation_id, body, sent_at')
      .in('conversation_id', chunk)
      .eq('direction', 'inbound')
      .gte('sent_at', since)
      .order('sent_at', { ascending: false })
      .limit(1000)
    if (error) {
      failed = true
      continue
    }
    for (const row of (data ?? []) as Array<{ conversation_id: string; body: string | null }>) {
      const contactId = convToContact.get(row.conversation_id)
      const body = row.body?.trim()
      if (!contactId || !body) continue
      // 表单自带的首条消息不算「客人真实发起过对话」——只留真人手打的消息。
      if (isFormTemplateMessage(body)) continue
      const list = bodiesByContact.get(contactId) ?? []
      if (list.length >= INBOUND_MESSAGES_PER_CONTACT) continue
      list.push(body.slice(0, INBOUND_BODY_MAX_CHARS))
      bodiesByContact.set(contactId, list)
    }
  }
  return { bodiesByContact, failed }
}

/**
 * 读这些联系人最近的入站消息正文，拼成一段文本（按联系人分组），供分类层判断
 * 「客户自己的消息里有没有兴趣证据」。查不到/查询出错就返回已收集到的部分，绝不抛；
 * 任一查询出错时 `failed` 为 true，调用方可据此决定是否信任「没有兴趣证据」的结论。
 */
export async function loadInboundConversationText(
  supabase: SupabaseClient,
  clientId: string,
  contactIds: string[],
  now: Date,
): Promise<{ texts: Map<string, string>; failed: boolean }> {
  if (contactIds.length === 0) return { texts: new Map(), failed: false }

  const { convToContact, failed: convFailed } = await loadConversationIds(supabase, clientId, contactIds)
  if (convToContact.size === 0) return { texts: new Map(), failed: convFailed }

  const since = new Date(now.getTime() - INBOUND_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { bodiesByContact, failed: bodiesFailed } = await loadBodiesByContact(supabase, convToContact, since)

  const texts = new Map<string, string>()
  for (const [contactId, bodies] of bodiesByContact) texts.set(contactId, bodies.join('\n'))
  return { texts, failed: convFailed || bodiesFailed }
}

/** 一条合格线索：关联联系人、组装、写库。 */
async function processQualifiedLead(
  supabase: SupabaseClient,
  classified: Extract<ReturnType<typeof classifyCtsCrmPerson>, { kind: 'qualified_lead' }>,
  summary: CtsCrmSyncSummary,
  markInserted: () => void,
): Promise<void> {
  const phoneMasked = maskPhone(classified.phoneE164)
  const contactId = await findExistingContactId(supabase, CTS_CLIENT_ID, classified.phoneE164, classified.email)
  if (!contactId) summary.contactNotLinked++

  const fromConversation = classified.interestFrom === 'conversation'
  await insertOutcome(
    supabase,
    {
      clientId: CTS_CLIENT_ID,
      contactId,
      outcomeKind: 'lead',
      metaLeadId: classified.metaLeadId,
      customerPhone: classified.phoneE164,
      customerEmail: classified.email,
      customerFirst: classified.fullName,
      occurredAt: classified.occurredAt,
      sourceKind: 'crm_sheet_sync',
      sourceRef: ctsSourceRef(classified.phoneE164, 'lead'),
    },
    phoneMasked,
    summary,
    () => {
      summary.insertedLeads++
      if (fromConversation) summary.qualifiedFromConversation++
      markInserted()
    },
    fromConversation ? { interest_from: 'conversation' } : undefined,
  )
}

/** 一条成交候选：关联联系人、查价，查到才写库，查不到搁置人工。 */
async function processPurchaseCandidate(
  supabase: SupabaseClient,
  classified: Extract<ReturnType<typeof classifyCtsCrmPerson>, { kind: 'purchase_candidate' }>,
  summary: CtsCrmSyncSummary,
  markInserted: () => void,
): Promise<void> {
  const phoneMasked = maskPhone(classified.phoneE164)
  const contactId = await findExistingContactId(supabase, CTS_CLIENT_ID, classified.phoneE164, classified.email)
  if (!contactId) summary.contactNotLinked++

  const price = await lookupTourPrice(supabase, CTS_CLIENT_ID, classified.tourInterest, CTS_WEBSITE_DOMAIN)
  const majorAmount = price ? toMajorUnits(price.amountMinor, price.currency) : null
  if (!price || majorAmount == null) {
    summary.heldForManualReview.push({
      phoneMasked,
      tourInterest: classified.tourInterest,
      reason: `官网/团数据里查不到"${classified.tourInterest}"的价格，需要人工核实金额`,
    })
    return
  }

  await insertOutcome(
    supabase,
    {
      clientId: CTS_CLIENT_ID,
      contactId,
      outcomeKind: 'purchase',
      metaLeadId: classified.metaLeadId,
      customerPhone: classified.phoneE164,
      customerEmail: classified.email,
      customerFirst: classified.fullName,
      amount: majorAmount,
      currency: price.currency,
      occurredAt: classified.occurredAt,
      sourceKind: 'crm_sheet_sync',
      sourceRef: ctsSourceRef(classified.phoneE164, 'purchase', classified.tourInterest),
    },
    phoneMasked,
    summary,
    () => {
      summary.insertedPurchases++
      markInserted()
    },
  )
}

type ClassifiedRow = ReturnType<typeof classifyCtsCrmPerson>
type CrmManagementRow = ReturnType<typeof parseCrmManagementRow>

/** 邮箱归一化：去空白、转小写；空串当没有。 */
function normaliseEmailForLookup(email: string | null | undefined): string | null {
  const trimmed = email?.trim().toLowerCase()
  return trimmed ? trimmed : null
}

interface PreparedRow {
  crmRow: CrmManagementRow
  phoneKey: string | null
  matchedSheet1: Sheet1LeadRow | null
  classified: ClassifiedRow
}

interface ClassifiedChunkRow {
  crmRow: CrmManagementRow
  phoneKey: string | null
  classified: ClassifiedRow
  conversationReadFailed?: boolean
  /** 员工记录判合格/判「没有兴趣证据」，但联系人没关联上——会话文本无从查起，跳过不判、不拒、不写。 */
  contactUnlinked?: boolean
}

/** 这一行的分类是否依赖客户会话文本：员工记录判「没有兴趣证据」或判合格线索，都要看会话。 */
function needsConversationLookup(p: PreparedRow): boolean {
  if (!p.phoneKey) return false
  if (p.classified.kind === 'qualified_lead') return true
  return p.classified.kind === 'excluded' && p.classified.reason === 'no_interest_evidence'
}

/** 收集需要读会话的行的联系人 id（一次批量读，避免逐行往返）。 */
async function collectConversationContacts(
  supabase: SupabaseClient,
  prepared: PreparedRow[],
  indexes: number[],
): Promise<{ contactIdByIndex: Map<number, string>; contactIds: string[] }> {
  const contactIdByIndex = new Map<number, string>()
  const contactIds = new Set<string>()
  for (const index of indexes) {
    const p = prepared[index]
    const email = normaliseEmailForLookup(p.matchedSheet1?.email ?? p.crmRow.email)
    const contactId = await findExistingContactId(supabase, CTS_CLIENT_ID, p.phoneKey, email)
    if (contactId) {
      contactIdByIndex.set(index, contactId)
      contactIds.add(contactId)
    }
  }
  return { contactIdByIndex, contactIds: [...contactIds] }
}

/**
 * 用会话文本复判一行。
 *
 * - 员工记录判合格线索：联系人没关联上 → `contactUnlinked`（跳过，不判不拒）；关联上但没真实文本 →
 *   降级为 `no_customer_conversation`；有真实文本 → 重跑分类，客户消息里的排除词压过员工记录里的正面备注，
 *   否则保留原合格判定。
 * - 员工记录判「没有兴趣证据」：联系人没关联上 → `contactUnlinked`；有真实文本 → 重跑分类。
 */
function reclassifyWithConversation(
  p: PreparedRow,
  text: string | undefined,
  hadContact: boolean,
): { classified: ClassifiedRow; contactUnlinked?: boolean } {
  if (p.classified.kind === 'qualified_lead') {
    if (!hadContact) return { classified: p.classified, contactUnlinked: true }
    if (!text) return { classified: { kind: 'excluded', reason: 'no_customer_conversation' } }
    const reclassified = classifyCtsCrmPerson(p.crmRow, p.matchedSheet1, text)
    return { classified: reclassified.kind === 'excluded' ? reclassified : p.classified }
  }
  if (!hadContact) return { classified: p.classified, contactUnlinked: true }
  if (!text) return { classified: p.classified }
  return { classified: classifyCtsCrmPerson(p.crmRow, p.matchedSheet1, text) }
}

/**
 * 先按员工记录分类，再对「员工记录里没有兴趣证据」和「员工记录判合格线索」的行补读客户自己的消息。
 *
 * 只有这些行需要读会话（其余行的分类不依赖会话文本），所以先收集它们的联系人、
 * 一次批量读，避免逐行往返。读不到会话文本的行保持原分类。
 */
async function classifyChunkRows(
  supabase: SupabaseClient,
  rows: CrmManagementRow[],
  sheet1ByPhone: Map<string, Sheet1LeadRow>,
): Promise<ClassifiedChunkRow[]> {
  const prepared: PreparedRow[] = rows.map((crmRow) => {
    const phoneKey = ctsPhoneE164(crmRow.phoneRaw)
    const matchedSheet1 = phoneKey ? (sheet1ByPhone.get(phoneKey) ?? null) : null
    return { crmRow, phoneKey, matchedSheet1, classified: classifyCtsCrmPerson(crmRow, matchedSheet1) }
  })

  const needsConversationIndexes: number[] = []
  prepared.forEach((p, index) => {
    if (needsConversationLookup(p)) needsConversationIndexes.push(index)
  })
  if (needsConversationIndexes.length === 0) {
    return prepared.map(({ crmRow, phoneKey, classified }) => ({ crmRow, phoneKey, classified }))
  }

  const { contactIdByIndex, contactIds } = await collectConversationContacts(supabase, prepared, needsConversationIndexes)
  const { texts: conversationText, failed } = await loadInboundConversationText(supabase, CTS_CLIENT_ID, contactIds, new Date())
  const failedIndexes = failed ? new Set(needsConversationIndexes) : null

  return prepared.map((p, index) => {
    if (failedIndexes?.has(index)) {
      return { crmRow: p.crmRow, phoneKey: p.phoneKey, classified: p.classified, conversationReadFailed: true }
    }
    const contactId = contactIdByIndex.get(index)
    const text = contactId ? conversationText.get(contactId) : undefined
    const { classified, contactUnlinked } = reclassifyWithConversation(p, text, Boolean(contactId))
    return { crmRow: p.crmRow, phoneKey: p.phoneKey, classified, contactUnlinked }
  })
}

/**
 * 处理表格的一块（`cursor.offset` 起、最多 `cursor.limit` 行）。
 *
 * 每块都重新读整张表，而不是第一块把快照存起来：快照会经过 Inngest 的 step 记忆化
 * 存到它的云端，而整表含电话/邮箱/姓名（客户 PII）；这里返回的 summary 只有打码电话。
 * 两块之间表格被人改动的代价是某一行这次跳过、明天再来（幂等键保证不会重复写）。
 */
export async function runCtsCrmSyncChunk(
  cursor: CtsCrmSyncCursor,
  deps: RunCtsCrmSyncDeps = {},
): Promise<CtsCrmSyncChunkResult> {
  const supabase = deps.supabase ?? supabaseAdmin
  const maxInserts = deps.maxInsertsPerRun ?? DEFAULT_MAX_INSERTS_PER_RUN
  const summary = emptySummary()

  const [sheet1Raw, crmRaw, existingRefs] = await Promise.all([
    readSheetValues(CTS_CLIENT_ID, SPREADSHEET_ID, SHEET1_RANGE),
    readSheetValues(CTS_CLIENT_ID, SPREADSHEET_ID, CRM_MANAGEMENT_RANGE),
    loadExistingSourceRefs(supabase),
  ])

  // 读的范围是 A2 起，所以数组下标 i 对应表格第 i+2 行 —— 跟进记录在 R 还是 S 列
  // 要靠这个行号判（见 `ctsNoteColumnIndex`）。
  const sheet1ByPhone = indexSheet1ByPhone(sheet1Raw.map((cells, i) => parseSheet1Row(cells, i + 2)))
  const crmRows = crmRaw.map(parseCrmManagementRow)
  const start = Math.max(0, cursor.offset)
  const end = cursor.limit == null ? crmRows.length : Math.min(crmRows.length, start + cursor.limit)

  let insertedThisRun = cursor.insertedSoFar
  const markInserted = () => {
    insertedThisRun++
  }

  const rows = await classifyChunkRows(supabase, crmRows.slice(start, end), sheet1ByPhone)

  for (const { phoneKey, classified, conversationReadFailed, contactUnlinked } of rows) {
    summary.totalCrmRows++

    // 联系人没关联上：会话文本无从查起，跳过这一行，不计数、不拒绝、不写入。
    if (contactUnlinked) {
      summary.contactNotLinked++
      continue
    }

    // 读会话失败时「没有兴趣证据」是未知，不能当成没有——跳过这一行，不计数、不拒绝、不写入。
    if (conversationReadFailed) {
      summary.conversationReadFailed++
      continue
    }

    if (classified.kind === 'excluded') {
      tallyExcluded(summary, classified.reason)
      // 旧规则遗留的待核对线索，新规则下不合格 → 拒绝（见 rejectStalePendingLead）。
      if (
        phoneKey &&
        (classified.reason === 'excluded_by_notes' ||
          classified.reason === 'no_interest_evidence' ||
          classified.reason === 'no_customer_conversation')
      ) {
        await rejectStalePendingLead(supabase, existingRefs.get(ctsSourceRef(phoneKey, 'lead')), classified.reason, summary)
      }
      continue
    }
    if (classified.kind === 'purchase_missing_date') {
      summary.heldForManualReview.push({
        phoneMasked: maskPhone(classified.phoneE164),
        tourInterest: classified.tourInterest,
        reason: classified.reason,
      })
      continue
    }
    const sourceRef =
      classified.kind === 'qualified_lead'
        ? ctsSourceRef(classified.phoneE164, 'lead')
        : ctsSourceRef(classified.phoneE164, 'purchase', classified.tourInterest)
    if (existingRefs.has(sourceRef)) {
      summary.skippedAlreadySynced++
      continue
    }
    // 新放宽的「客户消息里有兴趣」口径会一次捞出大批老线索；超过 7 天的写进去也发不出去，
    // 还会占满每次写入上限、把真正新的线索挤到几天以后。老路径（员工记录判合格）行为不变。
    if (
      classified.kind === 'qualified_lead' &&
      classified.interestFrom === 'conversation' &&
      isPastEventWindow(classified.occurredAt, new Date())
    ) {
      summary.skippedPastWindow++
      continue
    }
    if (insertedThisRun >= maxInserts) {
      summary.cappedAtMaxInserts = true
      continue
    }

    if (classified.kind === 'qualified_lead') {
      await processQualifiedLead(supabase, classified, summary, markInserted)
    } else {
      await processPurchaseCandidate(supabase, classified, summary, markInserted)
    }
  }

  return {
    summary,
    nextOffset: end,
    totalSheetRows: crmRows.length,
    insertedSoFar: insertedThisRun,
    done: end >= crmRows.length,
  }
}

/** 一次处理整张表——手动路由 `cts-crm-sync` 走这条，行为跟拆块之前一样。 */
export async function runCtsCrmSync(deps: RunCtsCrmSyncDeps = {}): Promise<CtsCrmSyncSummary> {
  const chunk = await runCtsCrmSyncChunk({ offset: 0, insertedSoFar: 0 }, deps)
  return chunk.summary
}
