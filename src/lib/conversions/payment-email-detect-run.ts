/**
 * 邮箱付款确认 → 成交（purchase）的识别批处理（PM 2026-10-04 拍板：不要人批，查到凭据就自动标成交）。
 *
 * 读信 = `microsoft/mail-graph`，判信与提取 = `payment-email-extract`（复用 `mailchimp/paid-signal`），
 * 入库 = `intake.buildIntakeRow`（来源 `inbox_extract`），外发 = `writeback-service.sendApprovedOutcome`
 * （7 天窗口 / 拒联 / 唯一键 / 非 live 只干跑 全部沿用，一道不改）。
 *
 * ## 双车道（见 docs/specs/2026-10-04-cts-payment-email-detection-and-qualified-lead-feedback.md §5）
 *
 *   自动车道：证据齐全才进 —— 无转发/引用冲突、类型是定金或全款、邮箱与联系人精确一致、
 *             金额币种唯一、线程无取消/退款字样、跨来源无重复、没拒联。自动批准并发送。
 *   人工车道：任何一条不满足 → 有金额的写成 `pending_review`（审核页可见，**不进 AI 自动批准**），
 *             没金额的数据库根本不让写（Meta 的 Purchase 要求金额和币种）→ 只进汇总 `needsHuman`。
 *
 * 🔴 撤不回的事只靠这里的规则把关，所以：
 *   · 每次运行最多自动发 `MAX_AUTO_SENDS_PER_RUN` 条、单笔不超过 `MAX_AUTO_AMOUNT_MINOR`，超出的留在人工车道；
 *   · 绝不估算金额、绝不按价目表补；找不到就是找不到；
 *   · 证据句不写库、不写审计，只记它的 sha256（审计表只增不删，原文会和「删除个人信息」冲突）；
 *   · 客户配置没开 `leads_config.payment_email_detect.enabled` 就一条都不处理（fail-closed）。
 */

import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { looksLikeCustomerAddress } from '@/lib/mailchimp/paid-signal'
import { ownDomainsOf } from '@/lib/microsoft/mail-ingest'
import type { MessageTextResult } from '@/lib/microsoft/mail-graph'
import { buildIntakeRow, type IntakeInput } from './intake'
import { toMinorUnits } from './money'
import { isTooLateToApprove } from './event-window'
import { advanceContactStage } from '@/lib/crm/advance-contact-stage'
import { extractPaymentFromEmail, type PaymentExtraction } from './payment-email-extract'
import { sendApprovedOutcome, type SendDeps } from './writeback-service'

export const MAX_AUTO_SENDS_PER_RUN = 10
/** 定金通常几百到几千；比这大的一律转人工（魏征 2026-10-04 复审：3 万太松）。 */
export const MAX_AUTO_AMOUNT_MINOR = 10_000_00
export const MAX_FETCH_PER_RUN = 100
/** 整段识别的时间预算；到点就停并标 truncated（单步网关 ~125 秒硬上限，PITFALLS F8）。 */
export const DETECT_DEADLINE_MS = 90_000
/** 人工拒绝过的成交，这么多天内同一联系人再识别出确认信一律转人工，不再自动发。 */
export const REJECTION_COOLDOWN_DAYS = 30
/** 同时在途的读邮件请求数；单步目标 ≤ 60 秒（网关 ~125 秒硬上限，PITFALLS F8）。 */
export const FETCH_CONCURRENCY = 5
export const DEFAULT_LOOKBACK_DAYS = 8
export const AUTO_REVIEWER_IDENTITY = 'auto:payment-email-evidence'
export const DETECTOR_ACTOR = 'payment-email-detect'

const CANCEL_WORDS = /\b(refund(?:ed|s)?|cancel(?:l?ed|l?ing|lation)?)\b|取消|退款|退订|退钱|不去了|改期|不想去/i
const ID_CHUNK = 100

export type NeedsHumanReason =
  | `amount_${'missing' | 'ambiguous' | 'no_currency' | 'unsupported_currency'}`
  | 'duplicate_suspected'
  | 'cancel_words_in_thread'
  | 'do_not_contact'
  | 'auto_cap_reached'
  | 'no_match_key'
  | 'mail_text_unreadable'
  | 'intake_rejected'
  | 'previously_rejected'
  | 'multiple_recipients'
  | 'not_auto_eligible'

export interface PaymentDetectSummary {
  ran: boolean
  reason?: 'disabled' | 'no_candidates' | 'no_mailbox'
  dryRun: boolean
  scanned: number
  fetched: number
  fetchErrors: number
  notConfirmed: number
  balanceIgnored: number
  unknownKind: number
  expired: number
  duplicates: number
  autoCreated: number
  autoApproved: number
  /** 自动车道里成功把联系人 CRM 阶段推进了的条数。 */
  stageAdvanced: number
  /** 自动车道里尝试推进阶段但失败/被拒的条数（不阻断发送）。 */
  stageAdvanceFailed: number
  autoSendStatuses: Record<string, number>
  humanQueued: number
  /** dryRun 下「本来会走自动车道」的条数（不写库、不外发）。 */
  wouldAuto: number
  truncated: boolean
  byChannel: Record<'email' | 'messenger' | 'whatsapp', { scanned: number; confirmed: number }>
  needsHuman: Array<{ messageId: string; reason: NeedsHumanReason }>
}

export interface PaymentDetectDeps {
  supabase: SupabaseClient
  /** 取一封信的全文；令牌、重试由调用方包好。 */
  fetchText: (messageId: string) => Promise<MessageTextResult>
  sendDeps: Omit<SendDeps, 'supabase'>
  /** 该客户邮箱地址，用来算「自己人」域名。 */
  mailboxAddress: string | null
  now?: Date
  dryRun?: boolean
}

interface DetectConfig {
  enabled: boolean
  defaultCurrency: string | null
  lookbackDays: number
  ownDomains: string[]
}

type Channel = 'email' | 'messenger' | 'whatsapp'

interface Candidate {
  messageId: string
  sentAt: string
  conversationId: string
  contactId: string
  channel: Channel
  body: string | null
  participantPsid: string | null
}

interface ContactFacts {
  displayName: string | null
  doNotContact: boolean
  emails: string[]
  phone: string | null
  metaLeadId: string | null
}

export function emptySummary(dryRun: boolean): PaymentDetectSummary {
  return {
    ran: false,
    dryRun,
    scanned: 0,
    fetched: 0,
    fetchErrors: 0,
    notConfirmed: 0,
    balanceIgnored: 0,
    unknownKind: 0,
    expired: 0,
    duplicates: 0,
    autoCreated: 0,
    autoApproved: 0,
    stageAdvanced: 0,
    stageAdvanceFailed: 0,
    autoSendStatuses: {},
    humanQueued: 0,
    wouldAuto: 0,
    truncated: false,
    byChannel: {
      email: { scanned: 0, confirmed: 0 },
      messenger: { scanned: 0, confirmed: 0 },
      whatsapp: { scanned: 0, confirmed: 0 },
    },
    needsHuman: [],
  }
}

/** 客户配置：`leads_config.payment_email_detect`。没配 = 关。 */
export function readDetectConfig(
  clientDomain: string | null,
  leadsConfig: unknown,
  mailboxAddress: string | null,
): DetectConfig {
  const cfg = (leadsConfig ?? {}) as {
    payment_email_detect?: { enabled?: unknown; default_currency?: unknown; lookback_days?: unknown }
    own_email_domains?: unknown
  }
  const raw = cfg.payment_email_detect ?? {}
  const extra = Array.isArray(cfg.own_email_domains)
    ? cfg.own_email_domains.filter((d): d is string => typeof d === 'string')
    : []
  const days = typeof raw.lookback_days === 'number' ? Math.floor(raw.lookback_days) : DEFAULT_LOOKBACK_DAYS
  return {
    enabled: raw.enabled === true,
    defaultCurrency:
      typeof raw.default_currency === 'string' && raw.default_currency.trim()
        ? raw.default_currency.trim().toUpperCase()
        : null,
    lookbackDays: Math.min(Math.max(days, 1), 14),
    ownDomains: ownDomainsOf(mailboxAddress, clientDomain, extra),
  }
}

function sha256Of(evidence: string): string {
  return createHash('sha256').update(evidence.replace(/\s+/g, ' ').trim().toLowerCase()).digest('hex')
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

// ── 读候选 ──────────────────────────────────────────────────────────────────

interface ConvMeta {
  contactId: string
  channel: Channel
  participantPsid: string | null
}

async function listCandidates(supabase: SupabaseClient, clientId: string, since: Date): Promise<Candidate[]> {
  const { data: convs, error } = await supabase
    .from('conversations')
    .select('id, contact_id, channel, participant_psid')
    .eq('client_id', clientId)
    .in('channel', ['email', 'messenger', 'whatsapp'])
    .not('contact_id', 'is', null)
    .gte('last_message_at', since.toISOString())
  if (error) throw new Error(`读取会话失败：${error.message}`)
  const metaByConv = new Map(
    (convs ?? []).map((c) => [
      c.id as string,
      {
        contactId: c.contact_id as string,
        channel: c.channel as Channel,
        participantPsid: (c.participant_psid as string | null) ?? null,
      } satisfies ConvMeta,
    ]),
  )

  const out: Candidate[] = []
  for (const ids of chunk([...metaByConv.keys()], ID_CHUNK)) {
    const { data: msgs, error: mErr } = await supabase
      .from('conversation_messages')
      .select('conversation_id, message_id, sent_at, body')
      .in('conversation_id', ids)
      .eq('direction', 'outbound')
      .gte('sent_at', since.toISOString())
      .order('sent_at', { ascending: false })
      .limit(1000)
    if (mErr) throw new Error(`读取已发消息失败：${mErr.message}`)
    for (const m of msgs ?? []) {
      const meta = metaByConv.get(m.conversation_id as string) as ConvMeta
      out.push({
        messageId: m.message_id as string,
        sentAt: m.sent_at as string,
        conversationId: m.conversation_id as string,
        contactId: meta.contactId,
        channel: meta.channel,
        body: (m.body as string | null) ?? null,
        participantPsid: meta.participantPsid,
      })
    }
  }
  // 新到旧：就算超过单次上限，被丢下的也是最旧的（它们离 7 天窗口最近、最不值得发）。
  return out.sort((a, b) => (a.sentAt < b.sentAt ? 1 : -1))
}

async function alreadyProcessed(supabase: SupabaseClient, clientId: string, ids: string[]): Promise<Set<string>> {
  const done = new Set<string>()
  for (const part of chunk(ids, ID_CHUNK)) {
    const { data, error } = await supabase
      .from('me_sale_outcomes')
      .select('source_ref')
      .eq('client_id', clientId)
      .in('source_kind', ['inbox_extract', 'messenger_conversation'])
      .in('source_ref', part)
    if (error) throw new Error(`查询已处理邮件失败：${error.message}`)
    for (const r of data ?? []) done.add(r.source_ref as string)
  }
  return done
}

async function loadContactFacts(supabase: SupabaseClient, clientId: string, contactId: string): Promise<ContactFacts> {
  const [contact, idents, leadTp] = await Promise.all([
    supabase.from('contacts').select('display_name, do_not_contact').eq('id', contactId).eq('client_id', clientId).maybeSingle(),
    supabase.from('contact_identities').select('kind, value').eq('contact_id', contactId).eq('client_id', clientId),
    supabase
      .from('contact_touchpoints')
      .select('source_ref')
      .eq('contact_id', contactId)
      .eq('client_id', clientId)
      .eq('source', 'meta_lead_form')
      .order('occurred_at', { ascending: false })
      .limit(5),
  ])
  if (contact.error || idents.error || leadTp.error) {
    throw new Error(`读取联系人信息失败：${(contact.error ?? idents.error ?? leadTp.error)?.message}`)
  }
  const rows = (idents.data ?? []) as Array<{ kind: string; value: string }>
  const lead = ((leadTp.data ?? []) as Array<{ source_ref: string | null }>)
    .map((r) => r.source_ref ?? '')
    .find((v) => /^\d{15,17}$/.test(v))
  return {
    displayName: (contact.data?.display_name as string | null) ?? null,
    doNotContact: contact.data?.do_not_contact === true,
    emails: rows.filter((r) => r.kind === 'email').map((r) => r.value.trim().toLowerCase()),
    phone: rows.find((r) => r.kind === 'phone')?.value ?? null,
    metaLeadId: lead ?? null,
  }
}

async function threadMentionsCancel(supabase: SupabaseClient, conversationId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('conversation_messages')
    .select('body')
    .eq('conversation_id', conversationId)
    .limit(200)
  if (error) throw new Error(`读取线程失败：${error.message}`)
  return (data ?? []).some((m) => CANCEL_WORDS.test((m.body as string | null) ?? ''))
}

async function hasExistingPurchase(
  supabase: SupabaseClient,
  clientId: string,
  contactId: string,
  metaLeadId: string | null,
): Promise<boolean> {
  const base = () =>
    supabase
      .from('me_sale_outcomes')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('outcome_kind', 'purchase')
      .neq('review_status', 'rejected')
      .is('redacted_at', null)
  const byContact = await base().eq('contact_id', contactId)
  if (byContact.error) throw new Error(`查重失败：${byContact.error.message}`)
  if ((byContact.count ?? 0) > 0) return true
  if (!metaLeadId) return false
  const byLead = await base().eq('meta_lead_id', metaLeadId)
  if (byLead.error) throw new Error(`查重失败：${byLead.error.message}`)
  return (byLead.count ?? 0) > 0
}

async function hasRecentRejection(
  supabase: SupabaseClient,
  clientId: string,
  contactId: string,
  now: Date,
): Promise<boolean> {
  const since = new Date(now.getTime() - REJECTION_COOLDOWN_DAYS * 86_400_000).toISOString()
  const { count, error } = await supabase
    .from('me_sale_outcomes')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('contact_id', contactId)
    .eq('outcome_kind', 'purchase')
    .eq('review_status', 'rejected')
    .gte('created_at', since)
  if (error) throw new Error(`查询被拒记录失败：${error.message}`)
  return (count ?? 0) > 0
}

// ── 写库 ────────────────────────────────────────────────────────────────────

function splitName(displayName: string | null): { first: string | null; last: string | null } {
  const parts = (displayName ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { first: null, last: null }
  return { first: parts[0], last: parts.length > 1 ? parts.slice(1).join(' ') : null }
}

async function insertOutcome(
  supabase: SupabaseClient,
  input: IntakeInput,
  audit: Record<string, unknown>,
  now: Date,
  approvedBy?: string,
): Promise<{ id: string; amountMinor: number } | 'duplicate' | 'already' | { error: string }> {
  const built = buildIntakeRow(input, { defaultPhoneCountry: null, now })
  if (!built.ok) return { error: built.errors.join('; ') }
  // Messenger/WhatsApp rows are inserted already-approved so the AI reviewer never sees a pending window.
  const row = approvedBy
    ? {
        ...built.row,
        review_status: 'approved',
        reviewed_by: approvedBy,
        reviewed_at: now.toISOString(),
        review_request_id: crypto.randomUUID(),
      }
    : built.row
  const { data, error } = await supabase.from('me_sale_outcomes').insert(row).select('id').single()
  if (error) {
    // 只认**哪一个**唯一约束命中：同一封邮件再来一遍 = 已处理，静默；
    // 同线索 / 同邮箱+单号 = 跨来源已有成交，记疑似重复；别的 23505 当错误，不许吞（子牙/魏征 2026-10-04 复审）。
    if ((error as { code?: string }).code === '23505') {
      if (error.message.includes('uq_me_sale_outcomes_source')) return 'already'
      if (error.message.includes('uq_me_sale_outcomes_purchase_per_')) return 'duplicate'
    }
    return { error: error.message }
  }
  const id = (data as { id: string }).id
  await supabase.from('me_conversion_audit').insert({ outcome_id: id, action: 'created', actor: DETECTOR_ACTOR, detail: audit })
  return { id, amountMinor: built.row.amount_minor ?? 0 }
}

async function approveByEvidence(supabase: SupabaseClient, outcomeId: string, now: Date): Promise<boolean> {
  const { data, error } = await supabase
    .from('me_sale_outcomes')
    .update({
      review_status: 'approved',
      reviewed_by: AUTO_REVIEWER_IDENTITY,
      reviewed_at: now.toISOString(),
      reviewed_ip: null,
      reviewed_ua: null,
      review_request_id: crypto.randomUUID(),
      updated_at: now.toISOString(),
    })
    .eq('id', outcomeId)
    .eq('review_status', 'pending_review')
    .select('id')
  if (error) throw new Error(`自动批准失败：${error.message}`)
  return (data?.length ?? 0) > 0
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

interface Verdict {
  lane: 'auto' | 'human' | 'skip'
  reason?: NeedsHumanReason
}

interface EvalContext {
  extraction: Extract<PaymentExtraction, { status: 'confirmed' }>
  facts: ContactFacts
  recipient: string | null
  cancelWords: boolean
  duplicate: boolean
  previouslyRejected: boolean
  recipientCount: number
  ownDomains: string[]
  /** messenger/whatsapp 是 1:1 平台绑定会话，收件人天然就是对方，无需邮箱精确匹配。 */
  channelBound: boolean
}

/** 纯判定：把「所有已知事实」折成车道。单独成函数方便逐条测。 */
export function decideLane(c: EvalContext): Verdict {
  if (c.extraction.amountIssue) return { lane: 'skip', reason: `amount_${c.extraction.amountIssue}` }
  if (c.duplicate) return { lane: 'skip', reason: 'duplicate_suspected' }
  if (c.previouslyRejected) return { lane: 'skip', reason: 'previously_rejected' }
  if (c.cancelWords) return { lane: 'skip', reason: 'cancel_words_in_thread' }
  if (c.facts.doNotContact) return { lane: 'skip', reason: 'do_not_contact' }
  const customerLike = looksLikeCustomerAddress(c.recipient, c.ownDomains)
  const emailExact =
    c.channelBound || (!!c.recipient && customerLike && c.facts.emails.includes(c.recipient.toLowerCase()))
  // 只有恰好一个收件人且无抄送才敢自动：多人/抄送的信，确认句不一定是对第一个人说的。
  const clean =
    c.extraction.flags.length === 0 && c.extraction.invoiceAmbiguous === false && c.recipientCount === 1
  const kindOk = c.extraction.kind === 'deposit' || c.extraction.kind === 'full'
  return emailExact && clean && kindOk ? { lane: 'auto' } : { lane: 'human' }
}

/** 取一封候选消息的全文：email 走 Graph，messenger/whatsapp 直接用库里存的 body。 */
function fetchCandidateText(cand: Candidate, deps: PaymentDetectDeps): Promise<MessageTextResult> {
  if (cand.channel === 'email') return deps.fetchText(cand.messageId)
  return Promise.resolve({
    ok: true,
    message: {
      subject: null,
      body: cand.body ?? '',
      firstRecipient: null,
      recipientCount: 1,
    },
  })
}

export async function runPaymentEmailDetection(
  clientId: string,
  deps: PaymentDetectDeps,
): Promise<PaymentDetectSummary> {
  const { supabase } = deps
  const now = deps.now ?? new Date()
  const dryRun = deps.dryRun === true
  const summary = emptySummary(dryRun)

  const { data: client, error } = await supabase.from('clients').select('domain, leads_config').eq('id', clientId).maybeSingle()
  if (error) throw new Error(`读取客户配置失败：${error.message}`)
  if (!client) throw new Error('客户不存在')
  const cfg = readDetectConfig(client.domain as string | null, client.leads_config, deps.mailboxAddress)
  if (!cfg.enabled) return { ...summary, reason: 'disabled' }

  const since = new Date(now.getTime() - cfg.lookbackDays * 86_400_000)
  const all = await listCandidates(supabase, clientId, since)
  const done = await alreadyProcessed(supabase, clientId, all.map((c) => c.messageId))
  const todo = all.filter((c) => !done.has(c.messageId))
  summary.ran = true
  summary.scanned = todo.length
  summary.truncated = todo.length > MAX_FETCH_PER_RUN
  if (todo.length === 0) return { ...summary, reason: 'no_candidates' }

  let sends = 0
  const t0 = Date.now()
  const batch = todo.slice(0, MAX_FETCH_PER_RUN)
  for (const group of chunk(batch, FETCH_CONCURRENCY)) {
    if (Date.now() - t0 > DETECT_DEADLINE_MS) {
      summary.truncated = true
      break
    }
    // 只并发读邮件全文（慢的是网络）；messenger/whatsapp 全文已在库里，立即 resolve。
    // 判定、写库、发送仍然逐封串行，名额与防重不会被并发打乱。
    const texts = await Promise.all(group.map((c) => fetchCandidateText(c, deps)))
    for (let i = 0; i < group.length; i++) {
      const used = await processOne(group[i], texts[i], { clientId, cfg, deps, summary, now }, sends)
      if (used) sends++
    }
  }
  return summary
}

/** 处理一封已取到全文（或取失败）的邮件。返回是否占用了一个自动发送名额。 */
async function processOne(cand: Candidate, text: MessageTextResult, ctx: RunCtx, sends: number): Promise<boolean> {
  const { summary } = ctx
  summary.byChannel[cand.channel].scanned++
  if (!text.ok) {
    summary.fetchErrors++
    summary.needsHuman.push({ messageId: cand.messageId, reason: 'mail_text_unreadable' })
    return false
  }
  summary.fetched++
  const ex = extractPaymentFromEmail(
    { subject: text.message.subject, body: text.message.body },
    { defaultCurrency: ctx.cfg.defaultCurrency },
  )
  if (ex.status !== 'confirmed') {
    summary.notConfirmed++
    return false
  }
  summary.byChannel[cand.channel].confirmed++
  if (ex.kind === 'balance') {
    summary.balanceIgnored++
    return false
  }
  if (ex.kind === 'unknown') {
    summary.unknownKind++
    return false
  }
  if (isTooLateToApprove(cand.sentAt, ctx.now)) {
    summary.expired++
    return false
  }
  return handleConfirmed(
    cand,
    ex,
    {
      recipient: text.message.firstRecipient?.address ?? null,
      recipientCount: text.message.recipientCount,
      // 本封邮件自己的全文也查取消/退款字样（线程里存的只是 255 字摘要，会漏）。
      bodyCancel: CANCEL_WORDS.test(text.message.body),
    },
    ctx,
    sends < MAX_AUTO_SENDS_PER_RUN,
  )
}

type Confirmed = Extract<PaymentExtraction, { status: 'confirmed' }>

interface RunCtx {
  clientId: string
  cfg: DetectConfig
  deps: PaymentDetectDeps
  summary: PaymentDetectSummary
  now: Date
}

/** 处理一封已确认、类型明确的付款邮件。返回是否占用了一个自动发送名额。 */
async function handleConfirmed(
  cand: Candidate,
  ex: Confirmed,
  mail: { recipient: string | null; recipientCount: number; bodyCancel: boolean },
  ctx: RunCtx,
  canSend: boolean,
): Promise<boolean> {
  const { supabase } = ctx.deps
  const recipient = mail.recipient
  const facts = await loadContactFacts(supabase, ctx.clientId, cand.contactId)
  const [threadCancel, duplicate, previouslyRejected] = await Promise.all([
    threadMentionsCancel(supabase, cand.conversationId),
    hasExistingPurchase(supabase, ctx.clientId, cand.contactId, facts.metaLeadId),
    hasRecentRejection(supabase, ctx.clientId, cand.contactId, ctx.now),
  ])
  const verdict = decideLane({
    extraction: ex,
    facts,
    recipient,
    cancelWords: mail.bodyCancel || threadCancel,
    duplicate,
    previouslyRejected,
    recipientCount: mail.recipientCount,
    ownDomains: ctx.cfg.ownDomains,
    channelBound: cand.channel !== 'email',
  })
  if (verdict.lane === 'skip') {
    if (verdict.reason === 'duplicate_suspected') ctx.summary.duplicates++
    ctx.summary.needsHuman.push({ messageId: cand.messageId, reason: verdict.reason as NeedsHumanReason })
    return false
  }
  // WhatsApp is identification only: Meta matching requirements for WhatsApp are unverified, so never auto-send.
  if (cand.channel === 'whatsapp') {
    ctx.summary.needsHuman.push({ messageId: cand.messageId, reason: 'not_auto_eligible' })
    return false
  }
  // 私信身份（PSID）是 Meta 匹配 messenger 事件的依据；没有 PSID 的 messenger 会话只有邮箱/电话，
  // 却会被按 business_messaging 渠道发出，口径对不上（子牙 Round 2）→ 只识别、不自动发。
  if (cand.channel === 'messenger' && !cand.participantPsid) {
    ctx.summary.needsHuman.push({ messageId: cand.messageId, reason: 'not_auto_eligible' })
    return false
  }
  const overAmountCap = ex.amount != null && (toMinorUnits(ex.amount.value, ex.amount.currency) ?? Infinity) > MAX_AUTO_AMOUNT_MINOR
  const wantsAuto = verdict.lane === 'auto'
  const goAuto = wantsAuto && !overAmountCap && canSend
  // messenger/whatsapp 只走自动车道：任何一条不满足就整封丢弃，绝不写人工行（平台会话没有可审核的邮箱/金额上下文）。
  if (cand.channel !== 'email' && !goAuto) {
    ctx.summary.needsHuman.push({ messageId: cand.messageId, reason: 'not_auto_eligible' })
    return false
  }
  if (wantsAuto && (overAmountCap || !canSend)) {
    ctx.summary.needsHuman.push({ messageId: cand.messageId, reason: 'auto_cap_reached' })
  }
  if (ctx.deps.dryRun) {
    if (goAuto) ctx.summary.wouldAuto++
    return false
  }
  return writeAndMaybeSend(cand, ex, facts, recipient, goAuto, ctx)
}

/** 渠道相关的身份字段：email 走邮箱/电话，messenger/whatsapp 走 PSID 与联系人已有邮箱。 */
function outcomeIdentity(
  cand: Candidate,
  goAuto: boolean,
  facts: ContactFacts,
  recipient: string | null,
): {
  customerEmail: string | null
  customerPhone: string | null
  sourceKind: 'inbox_extract' | 'messenger_conversation'
  createdBy: string
  pageScopedUserId: string | null
} {
  if (cand.channel === 'email') {
    return {
      customerEmail: goAuto ? recipient : facts.emails[0] ?? null,
      customerPhone: facts.phone,
      sourceKind: 'inbox_extract',
      createdBy: goAuto ? 'auto:payment-email' : 'payment-email:needs-review',
      pageScopedUserId: null,
    }
  }
  return {
    customerEmail: facts.emails[0] ?? null,
    customerPhone: facts.phone,
    sourceKind: 'messenger_conversation',
    createdBy: 'auto:payment-conversation',
    pageScopedUserId: cand.channel === 'messenger' ? cand.participantPsid : null,
  }
}

async function writeAndMaybeSend(
  cand: Candidate,
  ex: Confirmed,
  facts: ContactFacts,
  recipient: string | null,
  goAuto: boolean,
  ctx: RunCtx,
): Promise<boolean> {
  const { supabase } = ctx.deps
  const name = splitName(facts.displayName)
  const identity = outcomeIdentity(cand, goAuto, facts, recipient)
  const preApproved = goAuto && cand.channel !== 'email'
  if (!identity.customerEmail && !identity.customerPhone && !identity.pageScopedUserId) {
    ctx.summary.needsHuman.push({ messageId: cand.messageId, reason: 'no_match_key' })
    return false
  }
  const created = await insertOutcome(
    supabase,
    {
      clientId: ctx.clientId,
      contactId: cand.contactId,
      outcomeKind: 'purchase',
      customerEmail: identity.customerEmail,
      customerPhone: identity.customerPhone,
      customerFirst: name.first,
      customerLast: name.last,
      orderRef: ex.invoiceNo,
      amount: ex.amount?.value ?? null,
      currency: ex.amount?.currency ?? null,
      occurredAt: cand.sentAt,
      sourceKind: identity.sourceKind,
      sourceRef: cand.messageId,
      createdBy: identity.createdBy,
      metaLeadId: facts.metaLeadId,
      pageScopedUserId: identity.pageScopedUserId,
    },
    {
      lane: goAuto ? 'auto' : 'human',
      kind: ex.kind,
      has_invoice_no: ex.invoiceNo != null,
      evidence_sha256: sha256Of(ex.evidence),
      flags: ex.flags,
    },
    ctx.now,
    preApproved ? AUTO_REVIEWER_IDENTITY : undefined,
  )
  if (created === 'already') return false
  if (created === 'duplicate') {
    ctx.summary.duplicates++
    ctx.summary.needsHuman.push({ messageId: cand.messageId, reason: 'duplicate_suspected' })
    return false
  }
  if ('error' in created) {
    ctx.summary.needsHuman.push({ messageId: cand.messageId, reason: 'intake_rejected' })
    return false
  }
  if (!goAuto) {
    ctx.summary.humanQueued++
    return false
  }
  ctx.summary.autoCreated++
  // goAuto 只会在 deposit / full 时为真（decideLane 的 kindOk）；这里只是给类型收窄。
  if (ex.kind !== 'deposit' && ex.kind !== 'full') return false
  return approveAndSend(created.id, cand.contactId, ex.kind, ctx, preApproved)
}

/**
 * Stages from which an automatic advance is allowed. The stage change is a deliberate
 * PM-approved exception to the "看账不看话" rule in stage-from-conversation.ts because the
 * evidence is the company's own confirmation message.
 */
const STAGE_ADVANCE_FROM = new Set(['new', 'contacted', 'quoted'])

/**
 * 自动车道记完成交后，把联系人 CRM 阶段往前推一档（定金→deposit_paid，全款→paid_full）。
 * 纯尽力而为：任何失败只计数、不抛、不阻断后面的发送。
 */
async function advanceStageForPayment(ctx: RunCtx, contactId: string, kind: 'deposit' | 'full'): Promise<void> {
  const target = kind === 'deposit' ? 'deposit_paid' : 'paid_full'
  try {
    const { data, error } = await ctx.deps.supabase
      .from('contacts')
      .select('stage')
      .eq('id', contactId)
      .eq('client_id', ctx.clientId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    const current = (data as { stage: string | null } | null)?.stage ?? null
    if (current !== null && !STAGE_ADVANCE_FROM.has(current)) return
    const res = await advanceContactStage(
      ctx.deps.supabase,
      ctx.clientId,
      contactId,
      target,
      '邮箱/私信确认收款（自动）',
      'auto:payment-detect',
      current,
    )
    if (res.ok && res.changed) ctx.summary.stageAdvanced++
    else if (!res.ok) ctx.summary.stageAdvanceFailed++
  } catch (e) {
    ctx.summary.stageAdvanceFailed++
    console.error('[payment-email-detect] stage advance failed', contactId, e instanceof Error ? e.name : 'unknown')
  }
}

async function approveAndSend(
  outcomeId: string,
  contactId: string,
  kind: 'deposit' | 'full',
  ctx: RunCtx,
  preApproved: boolean,
): Promise<boolean> {
  const { supabase } = ctx.deps
  // Pre-approved rows (messenger/whatsapp) were inserted as approved; skip the CAS.
  if (!preApproved && !(await approveByEvidence(supabase, outcomeId, ctx.now))) return false
  await supabase.from('me_conversion_audit').insert({
    outcome_id: outcomeId,
    action: 'auto_approved_by_payment_evidence',
    actor: DETECTOR_ACTOR,
    detail: { reviewer: AUTO_REVIEWER_IDENTITY, pre_approved: preApproved },
  })
  ctx.summary.autoApproved++
  try {
    // 发送一律用真实时间，不透传本批的 `now`（同 ai-auto-review-run 的教训：过去时的 last_attempt_at 会让发送状态机误判卡住）。
    const sent = await sendApprovedOutcome(outcomeId, { supabase, ...ctx.deps.sendDeps })
    ctx.summary.autoSendStatuses[sent.status] = (ctx.summary.autoSendStatuses[sent.status] ?? 0) + 1
    await supabase
      .from('me_conversion_audit')
      .insert({ outcome_id: outcomeId, action: 'sent', actor: DETECTOR_ACTOR, detail: { status: sent.status } })
    // 被拦下（客人拒联 / 已删除个人信息 = redacted）的不改阶段：那条成交没发出去，也不该动他的营销状态。
    if (sent.status !== 'redacted') await advanceStageForPayment(ctx, contactId, kind)
  } catch (e) {
    ctx.summary.autoSendStatuses.error = (ctx.summary.autoSendStatuses.error ?? 0) + 1
    // 只记错误类型，不记原文（错误信息里可能带邮箱/金额）。
    console.error('[payment-email-detect] send failed', outcomeId, e instanceof Error ? e.name : 'unknown')
  }
  return true
}
