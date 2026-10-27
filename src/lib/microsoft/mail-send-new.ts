/**
 * 从 CRM 里给客人发**第一封**邮件（Microsoft Graph）——真人点发送才会调。
 * 设计稿：docs/specs/2026-10-21-crm-send-first-email-design-v0.md（子牙 + 魏征审过两轮）
 *
 * `sendMailReply` 只能回「客人先来过信」的线程；这里补的是「这个人没有邮件往来，销售想先写一封」。
 *
 * 本文件是**编排**：所有读写（数据库、Graph）都通过注入的 `store` / `graph` 完成，
 * 所以每一道闸、每一种失败都能用内存替身一条条钉住；真实实现在 `mail-send-new-prod.ts`。
 *
 * 顺序（任何一步失败都不发）：校验 → 开关 → 收件人 → 只发给咨询过的人 → 别再联系 → 选邮箱
 * → 重复请求 → 对账上次不明的发送 → 配额 → 抢锁 → 先写会话 + 审计 → 建草稿 → 发送 → 发完补记录。
 *
 * 🔴 「信可能已经发出去了」不能记成失败：超时/网络错误时 Graph 也许已经把信发走了。
 * 这种情况审计保持 pending（带草稿 id），响应「状态不明，先别重发」，下次对账再定。
 */

import { hasEnquiryRecord, type TouchKind } from '@/lib/crm/email-compose/enquiry-record'
import { evaluateQuota, quotaMessage, type EmailUsage } from '@/lib/crm/email-compose/quota'
import { isUuid, normalizeRecipient, pickRecipient, sanitizeBody, sanitizeSubject } from '@/lib/crm/email-compose/validate'
import type { ManualSendDncGate } from '@/lib/crm/manual-send-dnc-gate'
import { classifySender } from '@/lib/microsoft/mail-sender'
import { effectiveFromLegacy, effectiveFromSettings, type EffectiveEmailConfig } from '@/lib/crm/email-templates/effective-config'
import {
  GATE_MESSAGES,
  type GateFailure,
  type GateReason,
  type MailNewGates,
  type PreLockResult,
  type SendMeta,
  type TemplateRequest,
} from '@/lib/crm/email-templates/send-gates'
import type { LoadSettingsResult } from '@/lib/crm/email-templates/settings-store'

export interface SendMailNewInput {
  clientId: string
  contactId: string
  subject: unknown
  body: unknown
  sentByEmail: string
  requestId: unknown
  /** 抽屉上显示给销售看的那个收件地址；和服务端最终取的不一致就拒发。 */
  expectedRecipient: unknown
  /** Set when the message was started from a template; the new gates verify it. Ignored for legacy configs. */
  template?: TemplateRequest | null
}

export type SendMailNewReason =
  | 'invalid_input'
  | 'disabled'
  | 'config_unreadable'
  | 'not_found'
  | 'no_recipient'
  | 'bad_recipient'
  | 'recipient_mismatch'
  | 'not_enquirer'
  | 'do_not_contact'
  | 'dnc_check_failed'
  | 'no_mailbox'
  | 'mailbox_mismatch'
  | 'duplicate_unfinished'
  | 'reconcile_pending'
  | 'quota'
  | 'busy'
  | 'audit_failed'
  | 'graph_failed'
  | 'send_unknown'
  | GateReason

export type SendMailNewResult =
  | { ok: true; messageId: string; conversationId: string; duplicate?: boolean; meta?: SendMeta }
  | { ok: false; status: 400 | 403 | 404 | 409 | 424 | 429 | 502 | 503; reason: SendMailNewReason; error: string; meta?: SendMeta }

export interface MailboxChoice {
  connectionId: string
  /** 连接的 account_id（邮箱地址，小写）。 */
  account: string
}

export interface PendingDraft {
  auditId: string
  draftId: string
  createdAt: string
}

export interface PriorSend {
  auditId: string
  status: 'pending' | 'sent' | 'failed'
  messageId: string | null
  conversationId: string
}

export type ClaimResult = { kind: 'claimed'; conversationId: string } | { kind: 'taken' } | { kind: 'error' }

export interface MailNewStore {
  loadLeadsConfig(clientId: string): Promise<unknown>
  /** The client's versioned send settings. Absent on stores that only know the legacy leads_config keys. */
  loadSettings?(clientId: string): Promise<LoadSettingsResult>
  /** 别再联系闸（按联系人，fail-closed）。 */
  checkDnc(clientId: string, contactId: string): Promise<ManualSendDncGate>
  loadContact(clientId: string, contactId: string): Promise<{ id: string; primaryEmail: string | null } | null>
  loadIdentityEmails(clientId: string, contactId: string): Promise<string[]>
  loadTouchKinds(clientId: string, contactId: string): Promise<TouchKind[]>
  listActiveMailboxes(clientId: string): Promise<MailboxChoice[]>
  findPriorSend(clientId: string, requestId: string): Promise<PriorSend | null>
  listPendingDrafts(clientId: string, contactId: string): Promise<PendingDraft[]>
  countUsage(clientId: string, sentByEmail: string, mailbox: string): Promise<EmailUsage>
  /** 最近 N 天我们发给这个人的邮件封数（只用于抽屉上的提示，不拦）。 */
  countRecentEmailsToContact(clientId: string, contactId: string, days: number): Promise<number>
  acquireContactLock(clientId: string, contactId: string, mailbox: string): Promise<boolean>
  releaseContactLock(clientId: string, contactId: string): Promise<void>
  claimConversation(args: { clientId: string; contactId: string; requestId: string; mailbox: string; subject: string }): Promise<ClaimResult>
  insertAudit(args: { clientId: string; conversationId: string; sentByEmail: string; body: string; requestId: string }): Promise<string | null>
  patchAudit(auditId: string, patch: { status?: 'sent' | 'failed'; metaMessageId?: string; errorMessage?: string }): Promise<void>
  rekeyConversation(conversationId: string, newKey: string): Promise<boolean>
  discardConversation(conversationId: string): Promise<void>
  recordSent(args: { clientId: string; contactId: string; conversationId: string; messageId: string; sentByEmail: string; body: string }): Promise<void>
}

export type GraphSendOutcome = 'sent' | 'rejected' | 'unknown'

export interface MailNewGraph {
  /** 令牌实际对应的邮箱地址（小写）；读不出来返回 null。 */
  whoAmI(connectionId: string): Promise<string | null>
  createDraft(connectionId: string, args: { to: string; subject: string; body: string }): Promise<{ id: string; conversationId: string } | { error: string }>
  sendDraft(connectionId: string, draftId: string): Promise<GraphSendOutcome>
  deleteDraft(connectionId: string, draftId: string): Promise<void>
  /** true = 还是草稿；false = 已不是草稿（已发出）；null = 查不到 / 出错。 */
  isStillDraft(connectionId: string, messageId: string): Promise<boolean | null>
}

export interface MailNewDeps {
  store: MailNewStore
  graph: MailNewGraph
  now?: () => Date
  /** The template-era gates. Only clients with a settings row run them; legacy configs behave exactly as before. */
  gates?: MailNewGates
}

const fail = (
  status: Extract<SendMailNewResult, { ok: false }>['status'],
  reason: SendMailNewReason,
  error: string,
): SendMailNewResult => ({ ok: false, status, reason, error })

/** 审计行的 meta_message_id：`req:<requestId>|draft:<id>` / `req:<requestId>|msg:<id>`，让重复请求能认出自己。 */
export const metaIdFor = (requestId: string, kind: 'draft' | 'msg', id: string): string => `req:${requestId}|${kind}:${id}`

const PENDING_UNKNOWN_AFTER_MS = 2 * 60_000

interface Resolved {
  config: EffectiveEmailConfig
  to: string
  mailbox: MailboxChoice
}

/**
 * 读发信设置。客户有版本化设置行就**严格**解析（坏值 = 拒发，绝不回落成默认）；没有设置行才沿用旧的 leads_config 键。
 */
async function loadEffectiveConfig(
  clientId: string,
  store: MailNewStore,
): Promise<EffectiveEmailConfig | SendMailNewResult> {
  try {
    if (store.loadSettings) {
      const settings = await store.loadSettings(clientId)
      if (settings.kind === 'ok') return effectiveFromSettings(settings.settings, settings.version)
      if (settings.kind === 'invalid') return fail(503, 'config_invalid', GATE_MESSAGES.config_invalid)
    }
    return effectiveFromLegacy(await store.loadLeadsConfig(clientId))
  } catch {
    return fail(503, 'config_unreadable', '系统暂时读不到发信设置，这封没有发出。')
  }
}

/** 第 1–6 步：把所有「能不能发、发给谁、从哪发」判清楚，任何一步不过就返回失败。 */
async function resolveSend(
  input: SendMailNewInput,
  deps: MailNewDeps,
  verifyMailbox = true,
): Promise<Resolved | SendMailNewResult> {
  const { store } = deps
  const loaded = await loadEffectiveConfig(input.clientId, store)
  if ('ok' in loaded) return loaded
  const config = loaded
  if (!config.enabled) return fail(403, 'disabled', '这个客户还没开通「在 CRM 里发邮件」。')

  const contact = await store.loadContact(input.clientId, input.contactId)
  if (!contact) return fail(404, 'not_found', '找不到这个客人。')

  const pick = pickRecipient(contact.primaryEmail, await store.loadIdentityEmails(input.clientId, input.contactId))
  if (!pick.ok) {
    return fail(409, 'no_recipient', pick.reason === 'ambiguous' ? '这个客人有多个邮箱且没有主邮箱，请先在资料里定一个。' : '这个客人没有可用的邮箱。')
  }
  if (classifySender({ address: pick.email }).kind === 'skip') {
    return fail(409, 'bad_recipient', '这个地址是系统/自动发件地址，不适合发邮件。')
  }
  if (normalizeRecipient(input.expectedRecipient) !== pick.email) {
    return fail(409, 'recipient_mismatch', '收件地址在你打开页面之后变了，请刷新后再发。')
  }
  // 灰度名单：非空时只能发给名单内地址（在碰邮箱 / Graph 之前就拦）
  if (config.recipientAllowlist !== null && !config.recipientAllowlist.includes(pick.email)) {
    return fail(403, 'recipient_not_allowed', GATE_MESSAGES.recipient_not_allowed)
  }

  if (!config.allowUnsolicited && !hasEnquiryRecord(await store.loadTouchKinds(input.clientId, input.contactId))) {
    return fail(403, 'not_enquirer', '他没咨询过我们，系统不允许给他发第一封邮件。')
  }

  const dnc = await checkDnc(input, deps)
  if (dnc) return dnc

  const mailbox = await chooseMailbox(input.clientId, config, deps, verifyMailbox)
  if ('ok' in mailbox) return mailbox
  return { config, to: pick.email, mailbox }
}

async function chooseMailbox(
  clientId: string,
  config: EffectiveEmailConfig,
  deps: MailNewDeps,
  verify = true,
): Promise<MailboxChoice | SendMailNewResult> {
  const boxes = await deps.store.listActiveMailboxes(clientId)
  let chosen: MailboxChoice | undefined
  if (boxes.length === 1) chosen = boxes[0]
  else if (boxes.length > 1 && config.sendMailbox) chosen = boxes.find((b) => b.account === config.sendMailbox)
  if (!chosen) return fail(424, 'no_mailbox', '没有可用的发信邮箱（未连接，或连接了多个但没有指定发信邮箱）。')
  if (!verify) return chosen
  const actual = await deps.graph.whoAmI(chosen.connectionId)
  if (!actual || actual !== chosen.account.toLowerCase()) {
    return fail(424, 'mailbox_mismatch', '邮箱授权对应的地址和登记的不一致，请找 Magic Lab 团队核实。')
  }
  return chosen
}

/** 对账上次「状态不明」的发送。全部有了结论返回 null；仍有悬而未决的返回 409。 */
async function reconcile(clientId: string, contactId: string, mailbox: MailboxChoice, deps: MailNewDeps): Promise<SendMailNewResult | null> {
  const now = (deps.now ?? (() => new Date()))().getTime()
  const pending = await deps.store.listPendingDrafts(clientId, contactId)
  let unresolved = false
  for (const p of pending) {
    const draft = await deps.graph.isStillDraft(mailbox.connectionId, p.draftId)
    if (draft === false) {
      await deps.store.patchAudit(p.auditId, { status: 'sent' })
    } else if (draft === true && now - Date.parse(p.createdAt) >= PENDING_UNKNOWN_AFTER_MS) {
      await deps.graph.deleteDraft(mailbox.connectionId, p.draftId)
      await deps.store.patchAudit(p.auditId, { status: 'failed', errorMessage: '对账：仍是草稿，已删除' })
    } else {
      unresolved = true
    }
  }
  return unresolved ? fail(409, 'reconcile_pending', '上一封邮件的发送状态还没确认，请一分钟后再看时间线，先别重发。') : null
}

export async function sendMailNew(input: SendMailNewInput, deps: MailNewDeps): Promise<SendMailNewResult> {
  const subject = sanitizeSubject(input.subject)
  const body = sanitizeBody(input.body)
  if (!subject || !body || !isUuid(input.requestId)) {
    return fail(400, 'invalid_input', '主题和正文不能为空（主题最长 200 字、正文最长 10000 字），请检查后再发。')
  }
  const requestId = input.requestId
  const { store } = deps

  const resolved = await resolveSend(input, deps)
  if ('ok' in resolved) return resolved
  const { config, to, mailbox } = resolved

  const prior = await store.findPriorSend(input.clientId, requestId)
  if (prior) {
    if (prior.status === 'sent' && prior.messageId) {
      return { ok: true, messageId: prior.messageId, conversationId: prior.conversationId, duplicate: true }
    }
    return fail(409, 'duplicate_unfinished', '这封邮件已经在处理中或发送状态不明，请稍后看时间线，先别重发。')
  }

  // 模板时代新增的锁前检查：版本新鲜、所选团仍在售、文字红线。只有「有版本化设置」的客户才跑，旧配置行为不变。
  let pre: Extract<PreLockResult, { ok: true }> | null = null
  if (deps.gates !== undefined && config.source === 'settings') {
    const step = await deps.gates.preLock({
      clientId: input.clientId,
      contactId: input.contactId,
      sentByEmail: input.sentByEmail,
      config,
      subject,
      body,
      footer: config.footer,
      template: input.template ?? null,
      to,
      now: (deps.now ?? (() => new Date()))(),
    })
    if (!step.ok) return gateFailure(step)
    pre = step
  }

  const unresolved = await reconcile(input.clientId, input.contactId, mailbox, deps)
  if (unresolved) return unresolved

  const quota = evaluateQuota(await store.countUsage(input.clientId, input.sentByEmail, mailbox.account), config.limits)
  if (!quota.ok) {
    console.warn('[mail-send-new] 配额拦截', { clientId: input.clientId, user: input.sentByEmail, which: quota.which })
    return fail(429, 'quota', quotaMessage(quota.which))
  }

  if (!(await store.acquireContactLock(input.clientId, input.contactId, mailbox.account))) {
    return fail(409, 'busy', '这个客人正在发送另一封邮件，请稍等。')
  }
  try {
    return await sendUnderLock({ input, subject, body, requestId, to, mailbox, config, pre }, deps)
  } finally {
    await store.releaseContactLock(input.clientId, input.contactId).catch((err) => {
      console.error('[mail-send-new] 释放发送锁失败（5 分钟后自动失效）:', err)
    })
  }
}

function appendFooter(body: string, footer: string | null): string {
  return footer ? `${body}\n\n${footer}` : body
}

function gateFailure(step: GateFailure): SendMailNewResult {
  return { ok: false, status: step.status, reason: step.reason, error: step.error, meta: step.meta }
}

interface LockedSend {
  input: SendMailNewInput
  subject: string
  body: string
  requestId: string
  to: string
  mailbox: MailboxChoice
  config: EffectiveEmailConfig
  pre: Extract<PreLockResult, { ok: true }> | null
}

// 已经拿到联系人锁：先跑「锁内」的检查（防重复跟进、7 天频次——必须在锁内数，防两个人同时都通过），再发。
async function sendUnderLock(args: LockedSend, deps: MailNewDeps): Promise<SendMailNewResult> {
  const { input, config, pre } = args
  let meta = pre === null ? undefined : pre.meta
  if (pre !== null && deps.gates !== undefined) {
    const step = await deps.gates.inLock({
      clientId: input.clientId,
      contactId: input.contactId,
      config,
      state: pre.state,
      meta: pre.meta,
      now: (deps.now ?? (() => new Date()))(),
    })
    if (!step.ok) return gateFailure(step)
    meta = step.meta
  }
  const sent = await claimAndSend(
    { input, subject: args.subject, body: appendFooter(args.body, config.footer), requestId: args.requestId, to: args.to, mailbox: args.mailbox },
    deps,
  )
  return meta === undefined ? sent : { ...sent, meta }
}

async function checkDnc(input: SendMailNewInput, deps: MailNewDeps): Promise<SendMailNewResult | null> {
  const gate: ManualSendDncGate = await deps.store.checkDnc(input.clientId, input.contactId)
  if (!gate.blocked) return null
  return fail(gate.status, gate.reason, gate.error)
}

interface SendPlan {
  input: SendMailNewInput
  subject: string
  body: string
  requestId: string
  to: string
  mailbox: MailboxChoice
}

/** 先写会话 + 审计，再碰 Graph。 */
async function claimAndSend(plan: SendPlan, deps: MailNewDeps): Promise<SendMailNewResult> {
  const { store, graph } = deps
  const { input, requestId, mailbox } = plan

  const claim = await store.claimConversation({ clientId: input.clientId, contactId: input.contactId, requestId, mailbox: mailbox.account, subject: plan.subject })
  if (claim.kind === 'taken') return fail(409, 'duplicate_unfinished', '这封邮件已经在处理中，请稍后看时间线，先别重发。')
  if (claim.kind === 'error') return fail(502, 'audit_failed', '系统暂时无法记录这次发送，请稍后重试。')
  const conversationId = claim.conversationId

  const auditId = await store.insertAudit({ clientId: input.clientId, conversationId, sentByEmail: input.sentByEmail, body: plan.body, requestId })
  if (!auditId) {
    await store.discardConversation(conversationId)
    return fail(502, 'audit_failed', '系统暂时无法记录这次发送，请稍后重试。')
  }

  const draft = await graph.createDraft(mailbox.connectionId, { to: plan.to, subject: plan.subject, body: plan.body })
  if ('error' in draft) {
    await store.patchAudit(auditId, { status: 'failed', errorMessage: draft.error })
    await store.discardConversation(conversationId)
    return fail(502, 'graph_failed', `建草稿失败: ${draft.error}`)
  }

  await store.patchAudit(auditId, { metaMessageId: metaIdFor(requestId, 'draft', draft.id) })
  if (!(await store.rekeyConversation(conversationId, `mail:${draft.conversationId}`))) {
    await graph.deleteDraft(mailbox.connectionId, draft.id)
    await store.patchAudit(auditId, { status: 'failed', errorMessage: '会话键冲突，已删除草稿' })
    return fail(502, 'graph_failed', '系统无法为这封邮件建立会话，没有发出。')
  }

  return finishSend({ plan, deps, auditId, conversationId, draftId: draft.id })
}

async function finishSend(args: {
  plan: SendPlan
  deps: MailNewDeps
  auditId: string
  conversationId: string
  draftId: string
}): Promise<SendMailNewResult> {
  const { plan, deps, auditId, conversationId, draftId } = args
  const outcome = await deps.graph.sendDraft(plan.mailbox.connectionId, draftId)

  if (outcome === 'rejected') {
    await deps.store.patchAudit(auditId, { status: 'failed', errorMessage: 'Graph 拒绝发送' })
    await deps.graph.deleteDraft(plan.mailbox.connectionId, draftId)
    return fail(502, 'graph_failed', '邮件服务拒绝了这次发送，没有发出。')
  }
  if (outcome === 'unknown') {
    // 不记 failed：信可能已经发走。保持 pending（带草稿 id），下次对账。
    return fail(502, 'send_unknown', '发送状态不明（网络超时）。请一分钟后看时间线确认，先别重发。')
  }

  const sentMetaId = metaIdFor(plan.requestId, 'msg', draftId)
  try {
    await deps.store.patchAudit(auditId, { status: 'sent', metaMessageId: sentMetaId })
    await deps.store.recordSent({
      clientId: plan.input.clientId,
      contactId: plan.input.contactId,
      conversationId,
      messageId: draftId,
      sentByEmail: plan.input.sentByEmail,
      body: plan.body,
    })
  } catch (err) {
    // 信已经发出去了：补记录失败不能判失败，否则会让人重发。
    console.error('[mail-send-new] 信发出去了，但补记录失败:', draftId, err)
  }
  return { ok: true, messageId: draftId, conversationId }
}

export type ComposePreview =
  | { canCompose: true; recipient: string; mailbox: string; sentToContactLast7Days: number }
  | { canCompose: false; reason: SendMailNewReason; message: string }

/**
 * 抽屉打开时问「这个人现在能不能写第一封邮件、发给谁、从哪个邮箱」。
 * 走的是和 `sendMailNew` 同一套判断（`resolveSend`），只是**不碰 Graph、不写任何东西**——
 * 所以界面上的「能不能发」和真发那一刻的判断不会各说各话。
 */
export async function previewCompose(
  args: { clientId: string; contactId: string },
  deps: MailNewDeps,
): Promise<ComposePreview> {
  const probe: SendMailNewInput = {
    clientId: args.clientId,
    contactId: args.contactId,
    subject: '',
    body: '',
    sentByEmail: '',
    requestId: '',
    expectedRecipient: undefined,
  }
  // expectedRecipient 在预览里没有意义：先取收件人，再用它去过 resolveSend 的比对。
  const contact = await deps.store.loadContact(args.clientId, args.contactId)
  if (!contact) return { canCompose: false, reason: 'not_found', message: '找不到这个客人。' }
  const pick = pickRecipient(contact.primaryEmail, await deps.store.loadIdentityEmails(args.clientId, args.contactId))
  if (!pick.ok) return { canCompose: false, reason: 'no_recipient', message: '这个客人没有可用的邮箱。' }

  const resolved = await resolveSend({ ...probe, expectedRecipient: pick.email }, deps, false)
  if ('ok' in resolved) {
    return resolved.ok
      ? { canCompose: false, reason: 'invalid_input', message: '内部错误：预览不应走到发送结果。' }
      : { canCompose: false, reason: resolved.reason, message: resolved.error }
  }
  const recent = await deps.store.countRecentEmailsToContact(args.clientId, args.contactId, 7).catch(() => 0)
  return { canCompose: true, recipient: resolved.to, mailbox: resolved.mailbox.account, sentToContactLast7Days: recent }
}
