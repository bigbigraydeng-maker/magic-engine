/**
 * Client Knowledge Base — rollout stage machine (Issue #1648, design doc
 * §3.5 / §7.3 / §9.14 A "开关 / 停止 / 阶段合一" / §9.14 D).
 *
 * Three generic, `clientId`-parameterised stages — nothing here names a
 * specific customer, the same way `read.ts` / `kill-switch.ts` don't:
 *
 *   0 内部整理 — ME-only, nothing customer-facing
 *   1 客户共测 — AI drafts generated but never sent; ME + customer sample-check
 *   2 上线    — the ONLY stage `getClientKnowledge(customer_reply)` treats as live
 *
 * Current stage = the row with the latest `created_at` where
 * `client_knowledge_events.dimension = 'phase'`, for this client. No row yet
 * = stage 0 (the least-permissive default — same direction as every other
 * fail-closed default in this module).
 *
 * ## Forward vs. backward — deliberately asymmetric, per design doc §7.3
 *
 * - **Forward** (0→1, 1→2) needs BOTH signatures: an ME actor requests it
 *   (`createRolloutAdvanceRequest`) and the client's own registered
 *   confirmer has to open a one-time link and click confirm
 *   (`consumeRolloutAdvanceRequest`) before any `client_knowledge_events`
 *   row is written. This is the exact one-time-link PATTERN issue #1646's
 *   `confirmation-requests.ts` established for fact confirmation — reused
 *   here, but as its own table (`client_knowledge_rollout_advance_requests`):
 *   a stage advance isn't "confirm these facts", it's "confirm the rollout
 *   itself", with a different shape (from/to stage, a sample-check result,
 *   no `fact_fingerprints`). There is structurally NO other code path that
 *   inserts a forward-moving `dimension='phase'` event — the only INSERT
 *   happens inside `consume_knowledge_rollout_advance_request`, and that
 *   function only runs once a request row exists (an ME signer had to have
 *   created it) AND that row's token was consumed by the registered
 *   confirmer email (the customer signer). Missing either signer means the
 *   request is never created, or is created but never consumed — either way
 *   no event, and the effective current stage never changes.
 *
 * - **Backward** (rollback) is immediate and ME-only, no customer signature,
 *   no link, no request row — `rollbackKnowledgeRolloutStage` inserts the
 *   `client_knowledge_events` row directly. Design doc §7.3: "任何时候发现
 *   说错价格 → 一键退回阶段 1（不删知识，只停对客）" — the moment matters
 *   more than the ceremony, and it must NEVER touch `client_knowledge_facts`
 *   (it only ever calls `.from('client_knowledge_events').insert(...)`).
 */

import { checkConfirmerIdentity, type ConfirmerIdentityRejection } from './dual-sign'
import { getRegisteredConfirmerEmails } from './confirmers'
import {
  CONFIRMATION_LINK_DEFAULT_TTL_HOURS,
  generateConfirmationToken,
  hashConfirmationToken,
} from './confirmation-requests'
import { KnowledgeReadError } from './errors'
import type { KnowledgeSupabaseClient } from './db-client'
import { asRows, type KnowledgeWriteClient } from './write-client'
import { timingSafeEqual } from 'crypto'

export class KnowledgeRolloutError extends Error {
  constructor(message: string) {
    super(`[knowledge] ${message}`)
    this.name = 'KnowledgeRolloutError'
  }
}

export type KnowledgeRolloutStage = 0 | 1 | 2

/** No `phase` event yet = the least-permissive stage. */
export const INITIAL_STAGE: KnowledgeRolloutStage = 0
/** The only stage `getClientKnowledge(customer_reply)` treats as live. */
export const LIVE_STAGE: KnowledgeRolloutStage = 2

/** Reuse the same default TTL as fact-confirmation links (design doc doesn't specify a different one). */
export const ROLLOUT_ADVANCE_LINK_DEFAULT_TTL_HOURS = CONFIRMATION_LINK_DEFAULT_TTL_HOURS

/**
 * 板桥客户体验复审（issue #1648）："阶段号别裸给客户看"——客户确认页/邮件
 * 绝不能出现 "stage 1" / "阶段 1" 这种代号，只能用这几句大白话。ME 内部
 * 文档和日志仍然用数字（本文件头部注释、`KnowledgeRolloutStage` 本身）。
 */
export const ROLLOUT_STAGE_LABELS: Record<KnowledgeRolloutStage, string> = {
  0: '内部整理阶段',
  1: '客户共测阶段',
  2: '正式上线阶段',
}

function parseStageValue(value: unknown): KnowledgeRolloutStage | null {
  if (value === '0') return 0
  if (value === '1') return 1
  if (value === '2') return 2
  return null
}

/** The structural subset of both read/write clients this module's stage lookups actually use. */
type RolloutStageClient = KnowledgeSupabaseClient | KnowledgeWriteClient

/**
 * Current rollout stage for `clientId`. Throws `KnowledgeReadError` on a DB
 * failure — callers that need a fail-CLOSED boolean (i.e. `getClientKnowledge`)
 * are responsible for catching that and resolving to "not live" themselves;
 * this function's own contract stays "throw, never lie about the stage"
 * (same discipline as every other read in this module — see `errors.ts`).
 */
export async function getCurrentRolloutStage(
  clientId: string,
  sb: RolloutStageClient,
): Promise<KnowledgeRolloutStage> {
  const { data, error } = await sb
    .from('client_knowledge_events')
    .select('value')
    .eq('client_id', clientId)
    .eq('dimension', 'phase')
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw new KnowledgeReadError('读取客户知识库阶段（client_knowledge_events）', error)

  const row = (asRows<{ value: unknown }>(data))[0]
  if (!row) return INITIAL_STAGE
  // 🔴 一条读不懂的阶段值不能被当成"上线了"——同一个 fail-closed 方向：
  //    读不懂 = 当作最低阶段，不是当作阶段够了。
  return parseStageValue(row.value) ?? INITIAL_STAGE
}

/**
 * Is the Governed Reply Agent's Messenger channel switched on for this
 * client? Reads the exact column `channel-dispatch.ts`'s `isChannelEnabled`
 * reads (`clients.messenger_agent_enabled_messenger`) — confirmed against
 * that file rather than assumed, per issue #1648. Not calling
 * `isChannelEnabled` itself: that function's signature takes a real
 * `SupabaseClient` and calls `.maybeSingle()`, a method this module's fake
 * test clients don't (and shouldn't have to) implement — duplicating the
 * one column read here keeps this module's test doubles narrow, the same
 * reasoning `db-client.ts` / `write-client.ts` already use.
 */
async function getMessengerReplyEnabled(clientId: string, sb: RolloutStageClient): Promise<boolean> {
  const { data, error } = await sb.from('clients').select('messenger_agent_enabled_messenger').eq('id', clientId)
  if (error) throw new KnowledgeReadError('读取 Governed Reply Agent 开关（clients.messenger_agent_enabled_messenger）', error)
  const row = asRows<Record<string, unknown>>(data)[0]
  return row?.messenger_agent_enabled_messenger === true
}

/**
 * The ONE fail-closed judgement call: "is this client's knowledge actually
 * live for real customers right now?" — design doc §9.14 A: "最终是否对客
 * 生效 = 开关开 且 阶段够 且 messenger_agent_enabled_messenger 为真 …
 * 读失败一律当关，判断只写在 getClientKnowledge(customer_reply) 内部一处".
 *
 * This function IS that one place — `read.ts` calls it and nowhere else in
 * the codebase re-derives this decision. It never throws: both underlying
 * reads (`getCurrentRolloutStage`, `getMessengerReplyEnabled`) can throw on a
 * genuine DB failure, and this function's whole job is to turn that into
 * `false`, not to propagate it — the opposite of every other read in this
 * module, and deliberately so (see file header: this is the one place the
 * fail-closed direction is "pretend it's off", because "off" is safe here
 * and "empty facts" is NOT safe for the facts-read path those other
 * functions guard).
 */
export async function isKnowledgeLiveForCustomerReply(clientId: string, sb: RolloutStageClient): Promise<boolean> {
  try {
    const [stage, messengerEnabled] = await Promise.all([
      getCurrentRolloutStage(clientId, sb),
      getMessengerReplyEnabled(clientId, sb),
    ])
    return stage === LIVE_STAGE && messengerEnabled === true
  } catch {
    return false
  }
}

// ── Forward advance: one-time dual-signature link ───────────────────────────

export interface RolloutSampleCheck {
  sampleSize: number
  priceErrors: number
  otherAccuracyPct: number
}

/**
 * Design doc §9.10: "默认'抽查 30 条，价格错误 0 条，其他 ≥90%'，客户点同意
 * 即可，不能调低于下限。" This IS that floor — `meetsSampleCheckFloor` refuses
 * anything worse, and nothing in this module exposes a way to lower it.
 */
export const ROLLOUT_SAMPLE_CHECK_FLOOR = {
  minSampleSize: 30,
  maxPriceErrors: 0,
  minOtherAccuracyPct: 90,
} as const

export function meetsSampleCheckFloor(check: RolloutSampleCheck): boolean {
  return (
    Number.isFinite(check.sampleSize) &&
    check.sampleSize >= ROLLOUT_SAMPLE_CHECK_FLOOR.minSampleSize &&
    Number.isFinite(check.priceErrors) &&
    check.priceErrors <= ROLLOUT_SAMPLE_CHECK_FLOOR.maxPriceErrors &&
    Number.isFinite(check.otherAccuracyPct) &&
    check.otherAccuracyPct >= ROLLOUT_SAMPLE_CHECK_FLOOR.minOtherAccuracyPct
  )
}

function describeRolloutIdentityProblem(problem: ConfirmerIdentityRejection, email: string): string {
  switch (problem) {
    case 'missing':
      return '没有填客户签字人，无法发送阶段切换确认链接'
    case 'same_as_approver':
      return `${email} 就是发起这次阶段切换的 ME 员工自己。ME 签字人和客户签字人必须是两个人，否则等于没有客户签字。`
    case 'global_admin':
      return `${email} 是 Magic Engine 管理员账号，不能代客户签字。`
    case 'not_registered':
      return `${email} 还不是这个客户登记过的确认人。请先由全局管理员登记，再发阶段切换确认链接。`
  }
}

/** Constant-time hash comparison — same reasoning as `confirmation-requests.ts`'s private `hashesMatch`. */
function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export interface CreateRolloutAdvanceRequestResult {
  requestId: string
  /** 🔴 The ONE moment the raw token exists outside the recipient's inbox. */
  rawToken: string
  confirmerEmail: string
  fromStage: KnowledgeRolloutStage
  toStage: KnowledgeRolloutStage
  expiresAt: string
}

/**
 * ME requests a forward stage advance (0→1 or 1→2). Every gate that could
 * refuse the customer's click later is checked HERE too — same discipline
 * as `createConfirmationRequest` (issue #1646): a link guaranteed to be
 * refused should never be sent.
 */
export async function createRolloutAdvanceRequest(
  sb: KnowledgeWriteClient,
  params: {
    clientId: string
    toStage: 1 | 2
    confirmerEmail: string
    actorEmail: string
    sampleCheck?: RolloutSampleCheck
    ttlHours?: number
    now?: () => Date
  },
): Promise<CreateRolloutAdvanceRequestResult> {
  const clientId = params.clientId
  const actorEmail = params.actorEmail.trim()
  const confirmerEmail = params.confirmerEmail.trim()
  const now = params.now?.() ?? new Date()

  if (!actorEmail) throw new KnowledgeRolloutError('缺少发起人身份（ME 签字人），拒绝发送阶段切换确认链接')
  if (!confirmerEmail) throw new KnowledgeRolloutError('没有填客户签字人，无法发送阶段切换确认链接')

  const currentStage = await getCurrentRolloutStage(clientId, sb)
  const toStage = params.toStage
  // 🔴 换客户测试：这条判据不认识任何特定客户，只认「阶段号必须比当前
  //    大一」——从 NAL 换成 CTS、换成一个悉尼地产客户，行为完全不变。
  if (toStage !== currentStage + 1) {
    throw new KnowledgeRolloutError(
      `阶段前进必须一步一段：当前阶段 ${currentStage}，只能申请前进到 ${currentStage + 1}，不能直接申请 ${toStage}`,
    )
  }
  const fromStage = (toStage - 1) as 0 | 1

  let sampleCheck: RolloutSampleCheck | null = null
  if (fromStage === 1) {
    if (!params.sampleCheck) {
      throw new KnowledgeRolloutError('离开阶段 1（客户共测）必须先填抽查结果，才能申请上线')
    }
    if (!meetsSampleCheckFloor(params.sampleCheck)) {
      throw new KnowledgeRolloutError(
        `抽查结果没达到最低门槛（抽查 ≥${ROLLOUT_SAMPLE_CHECK_FLOOR.minSampleSize} 条、价格错误 = 0、其他准确率 ≥${ROLLOUT_SAMPLE_CHECK_FLOOR.minOtherAccuracyPct}%），这条门槛客户不能要求调低`,
      )
    }
    sampleCheck = params.sampleCheck
  }

  // 身份闸：跟事实确认（issue #1646）用的是同一个判据函数——ME 签字人在这里
  // 扮演"approver"角色（职责分离：签字确认的客户联系人不能是发起这次前进
  // 请求的 ME 员工自己）。
  const registered = await getRegisteredConfirmerEmails(clientId, sb)
  const identityProblem = checkConfirmerIdentity({
    confirmerEmail,
    approverEmail: actorEmail,
    registeredConfirmerEmails: registered,
  })
  if (identityProblem) {
    throw new KnowledgeRolloutError(describeRolloutIdentityProblem(identityProblem, confirmerEmail))
  }

  const rawToken = generateConfirmationToken()
  const ttlHours = params.ttlHours ?? ROLLOUT_ADVANCE_LINK_DEFAULT_TTL_HOURS
  if (!(ttlHours > 0)) throw new KnowledgeRolloutError('确认链接的有效期必须是正数小时')
  const expiresAt = new Date(now.getTime() + ttlHours * 3_600_000).toISOString()

  const insertResult = await sb
    .from('client_knowledge_rollout_advance_requests')
    .insert({
      client_id: clientId,
      from_stage: String(fromStage),
      to_stage: String(toStage),
      confirmer_email: confirmerEmail,
      token_hash: hashConfirmationToken(rawToken),
      sample_check: sampleCheck,
      expires_at: expiresAt,
      created_by_email: actorEmail,
    })
    .select('id')
  if (insertResult.error) {
    throw new KnowledgeRolloutError(`发送阶段切换确认链接失败：${insertResult.error.message ?? '未知错误'}`)
  }
  const inserted = asRows<{ id: string }>(insertResult.data)[0]
  if (!inserted?.id) {
    throw new KnowledgeRolloutError('阶段切换确认链接没有写进数据库（没有拿到记录号），已中止发送。')
  }

  return { requestId: inserted.id, rawToken, confirmerEmail, fromStage, toStage, expiresAt }
}

export type RolloutAdvanceLinkProblem =
  | 'not_found'
  | 'bad_token'
  | 'expired'
  | 'already_used'
  /**
   * 🔴 跟 `already_used` 是两件不同的事，不能合并（2026-09-15 子牙+魏征联合
   * 复审）：`already_used` 是"这条链接已经被点过一次了"（有人抢跑，或者
   * 客户自己点了两次）；`superseded` 是"这条链接从来没被点过，但客户的
   * 实际阶段已经不是这条请求创建时冻死的 from_stage 了"——最典型的原因是
   * 中途被一键回退。运营看到 `already_used` 会以为是重复提交，看到
   * `superseded` 才知道是"这条链接背后的前提已经不成立了，得重新走一次
   * 前进流程"，两者混在一起会误导运营去查错方向。
   */
  | 'superseded'
  | ConfirmerIdentityRejection

export interface RolloutAdvanceLinkView {
  ok: true
  requestId: string
  clientId: string
  clientName: string | null
  confirmerEmail: string
  fromStage: KnowledgeRolloutStage
  toStage: KnowledgeRolloutStage
  sampleCheck: RolloutSampleCheck | null
  expiresAt: string
}

export type RolloutAdvanceLinkResult = RolloutAdvanceLinkView | { ok: false; problem: RolloutAdvanceLinkProblem }

interface RolloutRequestRow {
  id: string
  client_id: string
  from_stage: string
  to_stage: string
  confirmer_email: string
  token_hash: string
  sample_check: unknown
  status: string
  expires_at: string
  created_by_email: string
}

const ROLLOUT_REQUEST_COLUMNS =
  'id, client_id, from_stage, to_stage, confirmer_email, token_hash, sample_check, status, expires_at, created_by_email'

async function readRolloutRequest(sb: KnowledgeWriteClient, requestId: string): Promise<RolloutRequestRow | null> {
  const result = await sb
    .from('client_knowledge_rollout_advance_requests')
    .select(ROLLOUT_REQUEST_COLUMNS)
    .eq('id', requestId)
  if (result.error) {
    throw new KnowledgeReadError('读取阶段切换确认请求（client_knowledge_rollout_advance_requests）', result.error)
  }
  return asRows<RolloutRequestRow>(result.data)[0] ?? null
}

/** The three link-level gates, shared by load (GET) and consume (POST) so they cannot drift apart. */
function gateRolloutRequest(request: RolloutRequestRow, rawToken: string, now: Date): RolloutAdvanceLinkProblem | null {
  if (!hashesMatch(request.token_hash, hashConfirmationToken(rawToken))) return 'bad_token'
  if (request.status !== 'pending') return 'already_used'
  if (Date.parse(request.expires_at) <= now.getTime()) return 'expired'
  return null
}

/**
 * Human-readable reason for a refused link, shown on the customer's confirm
 * page — same discipline as `confirmation-requests.ts`'s `describeLinkProblem`
 * (issue #1646): no field names, no stage numbers, written for the person
 * receiving the email, not for an engineer reading a log.
 */
export function describeRolloutLinkProblem(problem: RolloutAdvanceLinkProblem): string {
  switch (problem) {
    case 'not_found':
    case 'bad_token':
      return '这个确认链接不对。请用我们发给你的那封邮件里的链接重新打开；如果找不到，回一封邮件告诉我们，我们重发一条。'
    case 'expired':
      return '这个确认链接已经过期了。回一封邮件告诉我们一声，我们马上重发一条新的。'
    case 'already_used':
      return '这次阶段切换已经确认过了，不用再点一次。'
    case 'superseded':
      // 🔴 板桥客户体验复审：不能说"链接过期"或"已经用过"——那会让客户
      // 以为自己操作重复了，实际是我们这边中途改了主意（比如发现价格错
      // 了先退回去核对），这条链接对应的前提已经不成立。
      return '在你点这个链接之前，我们这边发现需要先重新核对一下，暂停了这次切换。这条链接已经不能用了，等我们核对完会重新发一条给你，麻烦你留意一下。'
    case 'missing':
    case 'not_registered':
      return '你的邮箱目前不在这个账户的确认人名单里，所以这次确认没有生效。回这封邮件告诉我们，我们帮你登记。'
    case 'same_as_approver':
      return '这次切换需要由你们公司的人确认，不能由发起这次切换的人自己确认。回这封邮件告诉我们一声。'
    case 'global_admin':
      return 'Magic Engine 的账号不能代你们确认。回这封邮件告诉我们，我们用你们自己的邮箱重发一条。'
  }
}

async function readClientNameForRollout(sb: KnowledgeWriteClient, clientId: string): Promise<string | null> {
  const result = await sb.from('clients').select('id, name').eq('id', clientId)
  if (result.error) return null // 客户名只是抬头文案，取不到不该让整页打不开
  const row = asRows<{ id: string; name?: string | null }>(result.data)[0]
  return row?.name ?? null
}

/** Opening the link confirms nothing — pure read, same discipline as `loadConfirmationRequest`. */
export async function loadRolloutAdvanceRequest(
  sb: KnowledgeWriteClient,
  params: { requestId: string; rawToken: string; now?: () => Date },
): Promise<RolloutAdvanceLinkResult> {
  const now = params.now?.() ?? new Date()
  const request = await readRolloutRequest(sb, params.requestId)
  if (!request) return { ok: false, problem: 'not_found' }
  const gate = gateRolloutRequest(request, params.rawToken, now)
  if (gate) return { ok: false, problem: gate }

  const clientName = await readClientNameForRollout(sb, request.client_id)
  return {
    ok: true,
    requestId: request.id,
    clientId: request.client_id,
    clientName,
    confirmerEmail: request.confirmer_email,
    fromStage: parseStageValue(request.from_stage) ?? 0,
    toStage: parseStageValue(request.to_stage) ?? 1,
    sampleCheck: (request.sample_check as RolloutSampleCheck | null) ?? null,
    expiresAt: request.expires_at,
  }
}

export interface ConsumeRolloutAdvanceResult {
  ok: true
  requestId: string
  clientId: string
  newStage: KnowledgeRolloutStage
  eventId: string
}

export type ConsumeRolloutAdvanceOutcome = ConsumeRolloutAdvanceResult | { ok: false; problem: RolloutAdvanceLinkProblem }

/**
 * The customer's click. The ONLY function in this module that writes a
 * forward-moving phase event — and it only ever does so via the atomic RPC
 * (`consume_knowledge_rollout_advance_request`), never a direct `.insert()`
 * on `client_knowledge_events`. See migration
 * `20260915010000_client_knowledge_rollout_stage.sql` for why claim+write
 * must be one transaction (same reasoning as issue #1646's fact-confirmation
 * RPC — a crash between the two would otherwise leave the link burnt with no
 * event ever recorded).
 */
export async function consumeRolloutAdvanceRequest(
  sb: KnowledgeWriteClient,
  params: { requestId: string; rawToken: string; now?: () => Date },
): Promise<ConsumeRolloutAdvanceOutcome> {
  const now = params.now?.() ?? new Date()
  const request = await readRolloutRequest(sb, params.requestId)
  if (!request) return { ok: false, problem: 'not_found' }
  const gate = gateRolloutRequest(request, params.rawToken, now)
  if (gate) return { ok: false, problem: gate }

  // 身份闸在 claim 之前再查一次当前登记表——跟发起时用的是同一份判据；链接
  // 发出后确认人被撤销登记，这次确认仍然必须被拒绝，不是只在发的那一刻检查。
  const registered = await getRegisteredConfirmerEmails(request.client_id, sb)
  const identityProblem = checkConfirmerIdentity({
    confirmerEmail: request.confirmer_email,
    approverEmail: request.created_by_email,
    registeredConfirmerEmails: registered,
  })
  if (identityProblem) return { ok: false, problem: identityProblem }

  const rpcResult = await sb.rpc('consume_knowledge_rollout_advance_request', {
    p_request_id: request.id,
    p_confirmed_at: now.toISOString(),
  })
  if (rpcResult.error) {
    throw new KnowledgeRolloutError(`阶段切换确认失败：${rpcResult.error.message ?? '未知错误'}`)
  }
  const outcome = asRows<{ claimed: boolean; event_id: string | null; stale: boolean }>(rpcResult.data)[0]
  if (!outcome?.claimed) {
    // 🔴 两种不同的拒绝原因，不能合并（见 RolloutAdvanceLinkProblem 的注释）：
    //   stale=true  —— 链接本身没被点过，但客户实际阶段已经被别的东西（典型：
    //                   一键回退）带走了，跟这条请求冻死的 from_stage 不一致。
    //   stale=false —— 有人（或另一个浏览器标签）刚刚抢先提交了同一条链接。
    // 两种情况都一个字没写。
    return { ok: false, problem: outcome?.stale ? 'superseded' : 'already_used' }
  }

  return {
    ok: true,
    requestId: request.id,
    clientId: request.client_id,
    newStage: parseStageValue(request.to_stage) ?? LIVE_STAGE,
    eventId: outcome.event_id ?? '',
  }
}

// ── Backward: immediate, ME-only, no link ────────────────────────────────────

export interface RollbackResult {
  fromStage: KnowledgeRolloutStage
  toStage: KnowledgeRolloutStage
  eventId: string
}

/**
 * 一键退回阶段（design doc §7.3: "任何时候发现说错价格 → 一键退回阶段 1
 * （不删知识，只停对客）"）。ME-only, immediate, no customer signature, and
 * this function NEVER touches `client_knowledge_facts` — it only ever
 * `.insert()`s into `client_knowledge_events`. `toStage` is a parameter
 * rather than hard-coded `1` so the same function works for any client in
 * any industry — the design doc's own example (retreat to stage 1) is just
 * the common case, not a constraint baked into this code.
 */
export async function rollbackKnowledgeRolloutStage(
  sb: KnowledgeWriteClient,
  params: { clientId: string; toStage: KnowledgeRolloutStage; reason?: string; actorEmail: string; now?: () => Date },
): Promise<RollbackResult> {
  const actorEmail = params.actorEmail.trim()
  if (!actorEmail) throw new KnowledgeRolloutError('缺少操作人身份，拒绝退回阶段')
  const now = params.now?.() ?? new Date()

  const currentStage = await getCurrentRolloutStage(params.clientId, sb)
  if (params.toStage >= currentStage) {
    throw new KnowledgeRolloutError(
      `退回阶段必须比当前阶段更低（当前 ${currentStage}，申请退到 ${params.toStage}）——阶段前进走 createRolloutAdvanceRequest，不走这里`,
    )
  }

  const insertResult = await sb
    .from('client_knowledge_events')
    .insert({
      client_id: params.clientId,
      dimension: 'phase',
      value: String(params.toStage),
      reason: params.reason?.trim() || null,
      actor_email: actorEmail,
      payload: {
        clientId: params.clientId,
        fromStage: currentStage,
        toStage: params.toStage,
        actorEmail,
        timestamp: now.toISOString(),
        kind: 'rollback',
      },
    })
    .select('id')
  if (insertResult.error) {
    throw new KnowledgeRolloutError(`退回阶段失败：${insertResult.error.message ?? '未知错误'}`)
  }
  const inserted = asRows<{ id: string }>(insertResult.data)[0]
  if (!inserted?.id) {
    throw new KnowledgeRolloutError('退回阶段事件没有写进数据库（没有拿到记录号）')
  }

  return { fromStage: currentStage, toStage: params.toStage, eventId: inserted.id }
}
