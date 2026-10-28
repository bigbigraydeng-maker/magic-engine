/**
 * The new gates of the template send path, in the order `sendMailNew` calls them:
 *   preLock  — template/catalog freshness, picks, content checks (links, markers, phrases)
 *   inLock   — same-call / same-template duplicates, then the rolling per-guest cap
 * Everything the gates read comes in through `SendGateData`, so each failure path is testable without a database.
 * Design: docs/specs/2026-10-28-crm-post-call-email-templates-design-v0.md §8.
 */

import { createHash } from 'node:crypto'
import type { EffectiveEmailConfig } from './effective-config'
import { getProvider } from './facts/registry'
import type { FactProvider, PickInput, PublishedTourFact, RenderFacts } from './facts/types'
import { evaluateContentGates } from './gates/content-gates'
import { evaluateFollowUp } from './gates/follow-up'
import { evaluateFrequency } from './gates/frequency'
import type { FrequencySources, GateViolation } from './gates/types'
import { renderTemplate } from './render'
import { checkTemplateSendable } from './template-store'
import type { CallBasis, EmailTemplateVersion, StoredReceipt } from './types'

export type GateReason =
  | 'config_invalid'
  | 'recipient_not_allowed'
  | 'template_unavailable'
  | 'template_outdated'
  | 'catalog_outdated'
  | 'catalog_unreadable'
  | 'tour_unavailable'
  | 'invalid_pick'
  | 'placeholder_left'
  | 'link_not_https'
  | 'link_userinfo'
  | 'link_host_not_allowed'
  | 'tour_page_not_on_sale'
  | 'departure_not_on_sale'
  | 'content_blocked'
  | 'already_followed_up'
  | 'duplicate_template'
  | 'frequency_cap'
  | 'frequency_unverifiable'
  | 'internal_error'

export const GATE_MESSAGES: Record<GateReason, string> = {
  config_invalid: '发信设置无效，这封没有发出，请找 Magic Lab 团队。',
  recipient_not_allowed: '试运行期间只能发给测试地址，这封没有发出。',
  template_unavailable: '这个模板已被停用或不存在，这封没有发出。',
  template_outdated: '模板刚被更新，请重新生成预览后再发。',
  catalog_outdated: '官网价格或班期刚更新，请重新生成预览后再发。',
  catalog_unreadable: '暂时读不到官网上架数据，这封没有发出，请稍后再试。',
  tour_unavailable: '所选的团或班期已不在售，请重新选择。',
  invalid_pick: '所选的团不符合模板要求，请重新选择。',
  placeholder_left: '正文里还有没填的占位符或「待确认」标记，请先改掉。',
  link_not_https: '链接必须以 https 开头。',
  link_userinfo: '链接里不能带用户名或密码。',
  link_host_not_allowed: '正文里有不在白名单里的链接，请改成官网链接。',
  tour_page_not_on_sale: '正文里有指向已下架团页的链接，请改掉。',
  departure_not_on_sale: '正文里的链接指向一个已不在售的班期，请改掉。',
  content_blocked: '正文里有不允许写的内容，请按提示改掉。',
  already_followed_up: '这次通话后已经发过跟进邮件了。',
  duplicate_template: '同一个模板刚给他发过，请稍后再发。',
  frequency_cap: '他最近收到的邮件已达上限。',
  frequency_unverifiable: '暂时数不清他这周收了几封，先别发，稍后再试。',
  internal_error: '系统内部出错，这封没有发出。',
}

const CONTENT_REASONS: ReadonlySet<string> = new Set([
  'placeholder_left',
  'link_not_https',
  'link_userinfo',
  'link_host_not_allowed',
  'tour_page_not_on_sale',
  'departure_not_on_sale',
])

export interface TemplateRequest {
  key: string
  version: number
  catalogVersion: number | null
  picks: PickInput[]
  inputs: Record<string, string>
  /** What the browser claims; the server decides what is believed (see decideCallBasis). */
  callBasis: CallBasis
}

/** Facts about one send attempt, for the receipt. Never contains an address or a body. */
export interface SendMeta {
  templateKey: string | null
  templateVersion: number | null
  catalogVersion: number | null
  callBasis: CallBasis
  editedAfterRender: boolean | null
  renderedSha256: string | null
  finalSha256: string | null
  warnings: string[]
  blockDetail: string | null
  /** The sending mailbox, once chosen (set by sendMailNew; the gates never know it). */
  mailbox: string | null
}

export function emptyMeta(): SendMeta {
  return {
    templateKey: null,
    templateVersion: null,
    catalogVersion: null,
    callBasis: 'none',
    editedAfterRender: null,
    renderedSha256: null,
    finalSha256: null,
    warnings: [],
    blockDetail: null,
    mailbox: null,
  }
}

export interface GateState {
  templateKey: string | null
  callEvidenceAt: string | null
  addresses: string[]
}

export type GateStatus = 403 | 409 | 503
export type GateFailure = { ok: false; status: GateStatus; reason: GateReason; error: string; meta: SendMeta }
export type PreLockResult = { ok: true; meta: SendMeta; state: GateState } | GateFailure
export type InLockResult = { ok: true; meta: SendMeta } | GateFailure

export interface PreLockArgs {
  clientId: string
  contactId: string
  sentByEmail: string
  config: EffectiveEmailConfig
  subject: string
  body: string
  footer: string | null
  template: TemplateRequest | null
  to: string
  now: Date
}

export interface InLockArgs {
  clientId: string
  contactId: string
  config: EffectiveEmailConfig
  state: GateState
  meta: SendMeta
  now: Date
}

export interface MailNewGates {
  preLock(args: PreLockArgs): Promise<PreLockResult>
  inLock(args: InLockArgs): Promise<InLockResult>
}

export interface ContactView {
  displayName: string | null
  /** Every email address of the guest (primary + identities). */
  addresses: string[]
  /** Most recent connected system call within the call window, or null. */
  callEvidenceAt: string | null
}

export type FactsLoad = { ok: true; version: number; tours: PublishedTourFact[] } | { ok: false; error: string }

export interface SendGateData {
  loadTemplate(clientId: string, key: string): Promise<EmailTemplateVersion | null>
  loadFacts(clientId: string, today: string): Promise<FactsLoad>
  loadContactView(clientId: string, contactId: string, callWindowHours: number, now: Date): Promise<ContactView | null>
  loadSenderName(clientId: string, email: string): Promise<string | null>
  sentTemplateReceiptsSince(clientId: string, contactId: string, sinceIso: string): Promise<StoredReceipt[]>
  frequencySources: FrequencySources
}

export const DEFAULT_TIME_ZONE = 'Pacific/Auckland'

export function todayInZone(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function formatInZone(iso: string, timeZone: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

export function decideCallBasis(claimed: CallBasis, evidenceAt: string | null): CallBasis {
  if (evidenceAt !== null) return 'system_call'
  return claimed === 'staff_attested' ? 'staff_attested' : 'none'
}

export function computeCallWhen(
  basis: CallBasis,
  evidenceAt: string | null,
  now: Date,
  timeZone: string,
): 'today' | 'yesterday' | 'recently' | null {
  if (basis === 'none') return null
  if (basis === 'staff_attested' || evidenceAt === null) return 'today'
  const callDay = todayInZone(new Date(evidenceAt), timeZone)
  if (callDay === todayInZone(now, timeZone)) return 'today'
  if (callDay === todayInZone(new Date(now.getTime() - 86_400_000), timeZone)) return 'yesterday'
  return 'recently'
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function fail(status: GateStatus, reason: GateReason, meta: SendMeta, extra?: string): GateFailure {
  const base = GATE_MESSAGES[reason]
  return { ok: false, status, reason, error: extra ? `${base}（${extra}）` : base, meta }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function summarise(blocks: readonly GateViolation[]): string {
  const text = blocks.map((b) => `${b.ruleId ?? b.code}${b.detail ? `:${b.detail}` : ''}`).join(' | ')
  return text.length > 300 ? text.slice(0, 300) : text
}

function reasonOf(violation: GateViolation): GateReason {
  return CONTENT_REASONS.has(violation.code) ? (violation.code as GateReason) : 'content_blocked'
}

interface TemplateStage {
  ok: true
  tpl: EmailTemplateVersion
  provider: FactProvider | null
  facts: RenderFacts | null
}

async function templateStage(
  args: PreLockArgs,
  template: TemplateRequest,
  data: SendGateData,
  tz: string,
  meta: SendMeta,
): Promise<TemplateStage | GateFailure> {
  const tpl = await data.loadTemplate(args.clientId, template.key)
  const sendable = checkTemplateSendable(tpl, template.version)
  if (!sendable.ok || tpl === null) return fail(409, sendable.ok ? 'template_unavailable' : sendable.reason, meta)
  meta.templateKey = tpl.templateKey
  meta.templateVersion = tpl.version
  if (tpl.factSource === 'none') return { ok: true, tpl, provider: null, facts: null }

  const provider = getProvider(tpl.factSource)
  if (provider === null) return fail(503, 'internal_error', meta, `fact source ${tpl.factSource}`)
  const loaded = await data.loadFacts(args.clientId, todayInZone(args.now, tz))
  if (!loaded.ok) return fail(503, 'catalog_unreadable', meta)
  meta.catalogVersion = loaded.version
  if (template.catalogVersion !== loaded.version) return fail(409, 'catalog_outdated', meta)

  const resolved = provider.resolvePicks(loaded.tours, template.picks, tpl.pickFilter, tpl.pickMode)
  if (!resolved.ok) return fail(409, resolved.reason, meta, resolved.detail)
  const sellable = provider.sellable(resolved.picks)
  if (!sellable.ok) return fail(409, 'tour_unavailable', meta, sellable.detail)
  const facts: RenderFacts = {
    tours: loaded.tours,
    picks: resolved.picks,
    settings: args.config.providers.publishedTours ?? null,
  }
  return { ok: true, tpl, provider, facts }
}

// Free-compose sends still get their links checked against the published catalog when the client has a tour site.
async function linkFactsStage(
  args: PreLockArgs,
  data: SendGateData,
  tz: string,
  meta: SendMeta,
): Promise<{ ok: true; provider: FactProvider | null; facts: RenderFacts | null } | GateFailure> {
  const settings = args.config.providers.publishedTours
  if (settings === undefined) return { ok: true, provider: null, facts: null }
  const provider = getProvider('published_tours')
  if (provider === null) return { ok: true, provider: null, facts: null }
  const loaded = await data.loadFacts(args.clientId, todayInZone(args.now, tz))
  if (!loaded.ok) return fail(503, 'catalog_unreadable', meta)
  meta.catalogVersion = loaded.version
  return { ok: true, provider, facts: { tours: loaded.tours, picks: [], settings } }
}

async function attachRenderHash(
  args: PreLockArgs,
  template: TemplateRequest,
  stage: TemplateStage,
  view: ContactView,
  data: SendGateData,
  tz: string,
  meta: SendMeta,
): Promise<void> {
  const senderName = await data.loadSenderName(args.clientId, args.sentByEmail).catch(() => null)
  const rendered = renderTemplate(stage.tpl, {
    contactName: view.displayName,
    senderDisplayName: senderName,
    callWhen: computeCallWhen(meta.callBasis, view.callEvidenceAt, args.now, tz),
    inputs: template.inputs,
    facts: stage.facts,
    provider: stage.provider,
  })
  // A render with gaps cannot be compared with what was sent: leave the edit flag unknown.
  if (rendered.missing.length > 0 || rendered.problems.length > 0) return
  meta.renderedSha256 = sha256(`${rendered.subject}\n${rendered.body}`)
  meta.editedAfterRender = meta.renderedSha256 !== meta.finalSha256
}

function contentFailure(blocks: readonly GateViolation[], meta: SendMeta): GateFailure {
  meta.blockDetail = summarise(blocks)
  return fail(409, reasonOf(blocks[0]), meta, blocks[0].detail)
}

async function runPreLock(args: PreLockArgs, data: SendGateData, tz: string): Promise<PreLockResult> {
  const meta = emptyMeta()
  meta.finalSha256 = sha256(`${args.subject}\n${args.body}`)
  const view = await data.loadContactView(args.clientId, args.contactId, args.config.callPromptHours, args.now)
  if (view === null) return fail(503, 'internal_error', meta, 'contact view')
  meta.callBasis = decideCallBasis(args.template?.callBasis ?? 'none', view.callEvidenceAt)
  const state: GateState = {
    templateKey: args.template?.key ?? null,
    callEvidenceAt: view.callEvidenceAt,
    addresses: Array.from(new Set([args.to, ...view.addresses].map((a) => a.toLowerCase()))),
  }

  let provider: FactProvider | null = null
  let facts: RenderFacts | null = null
  if (args.template !== null) {
    const stage = await templateStage(args, args.template, data, tz, meta)
    if (!('tpl' in stage)) return stage
    provider = stage.provider
    facts = stage.facts
    await attachRenderHash(args, args.template, stage, view, data, tz, meta)
  } else {
    const stage = await linkFactsStage(args, data, tz, meta)
    if (!stage.ok) return stage
    provider = stage.provider
    facts = stage.facts
  }

  const result = evaluateContentGates({
    subject: args.subject,
    body: args.body,
    footer: args.footer,
    settings: { guardrails: args.config.guardrails },
    provider,
    facts,
  })
  meta.warnings = result.warnings.map((w) => (w.ruleId ? `${w.code}:${w.ruleId}` : w.code))
  if (result.blocks.length > 0) return contentFailure(result.blocks, meta)
  return { ok: true, meta, state }
}

async function followUpStage(args: InLockArgs, data: SendGateData): Promise<GateFailure | null> {
  const { state, config, now } = args
  if (state.templateKey === null) return null
  const candidates: number[] = []
  const callMs = state.callEvidenceAt === null ? NaN : Date.parse(state.callEvidenceAt)
  if (!Number.isNaN(callMs)) candidates.push(callMs)
  if (config.sameTemplateCooldownHours > 0) candidates.push(now.getTime() - config.sameTemplateCooldownHours * 3_600_000)
  if (candidates.length === 0) return null
  const since = new Date(Math.min(...candidates)).toISOString()
  const receipts = await data.sentTemplateReceiptsSince(args.clientId, args.contactId, since)
  const violation = evaluateFollowUp({
    templateKey: state.templateKey,
    callEvidenceAt: state.callEvidenceAt,
    cooldownHours: config.sameTemplateCooldownHours,
    now,
    sentTemplateReceipts: receipts,
  })
  if (violation === null) return null
  const meta = { ...args.meta, blockDetail: violation.code }
  return fail(409, violation.code === 'already_followed_up' ? 'already_followed_up' : 'duplicate_template', meta)
}

async function frequencyStage(args: InLockArgs, data: SendGateData, tz: string): Promise<GateFailure | null> {
  const cap = args.config.frequencyCap
  if (cap === null) return null
  const verdict = await evaluateFrequency({
    cap,
    now: args.now,
    addresses: args.state.addresses,
    contactId: args.contactId,
    sources: data.frequencySources,
  })
  if (verdict.ok) return null
  if (verdict.reason === 'frequency_unverifiable') {
    return fail(503, 'frequency_unverifiable', { ...args.meta, blockDetail: `unverifiable:${verdict.error}`.slice(0, 300) })
  }
  const detail = `count=${verdict.count};next=${verdict.nextAllowedAt}`
  const text = `他最近 ${cap.windowDays} 天已收到 ${verdict.count} 封（上限 ${cap.max}），最早 ${formatInZone(verdict.nextAllowedAt, tz)} 可再发`
  return { ...fail(409, 'frequency_cap', { ...args.meta, blockDetail: detail }), error: `${GATE_MESSAGES.frequency_cap}${text}。` }
}

async function runInLock(args: InLockArgs, data: SendGateData, tz: string): Promise<InLockResult> {
  const followUp = await followUpStage(args, data)
  if (followUp !== null) return followUp
  const frequency = await frequencyStage(args, data, tz)
  if (frequency !== null) return frequency
  return { ok: true, meta: args.meta }
}

export function createSendGates(data: SendGateData, opts: { timeZone?: string } = {}): MailNewGates {
  const tz = opts.timeZone ?? DEFAULT_TIME_ZONE
  return {
    async preLock(args) {
      try {
        return await runPreLock(args, data, tz)
      } catch (err) {
        console.error('[send-gates] preLock failed:', errorText(err))
        return fail(503, 'internal_error', emptyMeta())
      }
    },
    async inLock(args) {
      try {
        return await runInLock(args, data, tz)
      } catch (err) {
        console.error('[send-gates] inLock failed:', errorText(err))
        return fail(503, 'internal_error', args.meta)
      }
    },
  }
}
