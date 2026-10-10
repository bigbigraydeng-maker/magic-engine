/**
 * Client Knowledge Base — the customer confirmation link (issue #1646,
 * design doc §9.4 / §9.5 / §9.14 A.D and B).
 *
 * The second half of the dual signature. ME approves a draft fact; the
 * customer's own nominated person confirms it. That person has no dashboard
 * login (板桥 1: they should not have to register an account to click "yes"),
 * so the confirmation travels as a one-time signed link sent to the email a
 * global admin registered in `client_knowledge_confirmers`.
 *
 * ## Four properties this module exists to guarantee
 *
 * 1. **The raw token is never persisted.** `createConfirmationRequest`
 *    returns it exactly once, to be put in a URL in an email. Only
 *    `sha256(raw)` reaches the database. A leaked backup therefore does not
 *    let anyone sign on the customer's behalf.
 *
 * 2. **Opening the link confirms nothing.** `loadConfirmationRequest` is a
 *    pure read — no state change, no token consumption. Mail security
 *    scanners and link-preview bots routinely GET every URL in an email; if
 *    opening were confirming, a scanner would sign the customer's prices for
 *    them. Only `consumeConfirmationRequest`, reached from the rendered
 *    page's own submit button, writes anything. Same structural discipline as
 *    `src/app/auth/invite-landing/route.ts`.
 *
 * 3. **Single use, even under concurrency.** Consumption claims the request
 *    with a conditional update (`WHERE status = 'pending'`) and refuses if
 *    zero rows come back. Two simultaneous submits cannot both win, and the
 *    table's own trigger refuses to move a request out of a terminal state
 *    ever again.
 *
 * 4. **A confirmation applies to the content the customer actually read.**
 *    Each request pins every fact's `computeContentFingerprint()` at send
 *    time. If an FDE edits a price after the link goes out, that fact's
 *    fingerprint no longer matches and it is EXCLUDED from the confirmation
 *    (reported back as "needs a fresh link") instead of being silently
 *    signed. Design doc §9.5.
 */

import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { getRegisteredConfirmerEmails } from './confirmers'
import { checkConfirmerIdentity, type ConfirmerIdentityRejection } from './dual-sign'
import { KnowledgeReadError } from './errors'
import { computeContentFingerprint } from './fingerprint'
import type { Sensitivity } from './sensitivity'
import type { Visibility } from './types'
import { asRows, type KnowledgeWriteClient } from './write-client'

/** 两周 —— 客户老板未必天天看邮箱，但一条能签字的链接也不该无限期挂着。 */
export const CONFIRMATION_LINK_DEFAULT_TTL_HOURS = 14 * 24

/** §9.10「确认按价目表分组：一组 ≤5 行」—— 页面按这个块大小渲染。 */
export const CONFIRMATION_BATCH_BLOCK_SIZE = 5

export class KnowledgeConfirmationError extends Error {
  constructor(message: string) {
    super(`[knowledge] ${message}`)
    this.name = 'KnowledgeConfirmationError'
  }
}

// ── Token ───────────────────────────────────────────────────────────────────

/**
 * 32 random bytes, base64url. Long enough that guessing is not a strategy;
 * url-safe so it survives being pasted out of an email client.
 */
export function generateConfirmationToken(): string {
  return randomBytes(32).toString('base64url')
}

/** sha256 hex — matches the `token_hash_is_sha256_hex` CHECK on the table. */
export function hashConfirmationToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex')
}

/** Constant-time comparison so response timing can't be used to walk a token hash. */
function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

// ── Shapes ──────────────────────────────────────────────────────────────────

export interface PinnedFact {
  factId: string
  fingerprint: string
}

export interface ConfirmationFactView {
  factId: string
  /** 给客户看的那句话 —— §9.10 要求整页没有任何代码词，所以这里只出正文，绝不出 fact_key / scope。 */
  statement: string
  sensitivity: Sensitivity
  validUntil: string | null
  /** 同一批里互相矛盾的说法共用一个组号；页面据此提示「这几条是同一件事的不同说法」。 */
  conflictGroupId: string | null
  /**
   * 发链接之后这条被改过：客户现在看到的内容跟他将要签字的版本对不上，
   * 所以本次确认不收这一条，需要重发一条新链接（design doc §9.5）。
   */
  changedSinceSent: boolean
}

export type ConfirmationLinkProblem =
  | 'not_found'
  | 'bad_token'
  | 'expired'
  | 'already_used'
  | ConfirmerIdentityRejection

export interface ConfirmationLinkView {
  ok: true
  requestId: string
  clientId: string
  clientName: string | null
  confirmerEmail: string
  expiresAt: string
  facts: ConfirmationFactView[]
}

export type ConfirmationLinkResult = ConfirmationLinkView | { ok: false; problem: ConfirmationLinkProblem }

interface RequestRow {
  id: string
  client_id: string
  confirmer_email: string
  token_hash: string
  fact_fingerprints: unknown
  status: string
  expires_at: string
  created_by_email: string
}

interface FactRow {
  id: string
  client_id: string
  statement: string
  structured_value: unknown
  scope: Record<string, unknown> | null
  valid_from: string
  valid_until: string | null
  visibility: Visibility
  sensitivity: Sensitivity
  status: string
  approved_by_email: string | null
  client_confirmed_at: string | null
  conflict_group_id: string | null
}

const REQUEST_COLUMNS =
  'id, client_id, confirmer_email, token_hash, fact_fingerprints, status, expires_at, created_by_email'

const FACT_COLUMNS =
  'id, client_id, statement, structured_value, scope, valid_from, valid_until, visibility, sensitivity, status, approved_by_email, client_confirmed_at, conflict_group_id'

function fingerprintOf(row: FactRow): string {
  return computeContentFingerprint({
    statement: row.statement,
    structuredValue: row.structured_value,
    scope: row.scope ?? {},
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    visibility: row.visibility,
    sensitivity: row.sensitivity,
  })
}

/** `fact_fingerprints` comes back as untyped jsonb — narrow it defensively rather than trusting its shape. */
function parsePinnedFacts(value: unknown): PinnedFact[] {
  if (!Array.isArray(value)) return []
  const out: PinnedFact[] = []
  for (const item of value) {
    const record = item as { fact_id?: unknown; fingerprint?: unknown } | null
    if (typeof record?.fact_id === 'string' && typeof record?.fingerprint === 'string') {
      out.push({ factId: record.fact_id, fingerprint: record.fingerprint })
    }
  }
  return out
}

// ── Creating a request ──────────────────────────────────────────────────────

export interface CreateConfirmationRequestResult {
  requestId: string
  /** 🔴 The ONE and only moment the raw token exists outside the recipient's inbox. Put it straight in the link; never log it, never store it. */
  rawToken: string
  confirmerEmail: string
  expiresAt: string
  factIds: string[]
}

/**
 * Issue a confirmation link covering `factIds`.
 *
 * Every gate that could refuse the customer's click later is checked HERE
 * too, on purpose: a link that is guaranteed to be refused should never be
 * sent. Discovering "sorry, you're not allowed to confirm this" after the
 * customer has read five prices and clicked the button is the worst possible
 * moment to find out.
 */
export async function createConfirmationRequest(
  sb: KnowledgeWriteClient,
  params: {
    clientId: string
    factIds: string[]
    confirmerEmail: string
    actorEmail: string
    ttlHours?: number
    now?: () => Date
  },
): Promise<CreateConfirmationRequestResult> {
  const clientId = params.clientId
  const actorEmail = params.actorEmail.trim()
  const confirmerEmail = params.confirmerEmail.trim()
  const now = params.now?.() ?? new Date()

  if (!actorEmail) throw new KnowledgeConfirmationError('缺少发起人身份，拒绝发送确认链接')
  if (!confirmerEmail) throw new KnowledgeConfirmationError('没有填收件人，无法发送确认链接')

  const factIds = Array.from(
    new Set(params.factIds.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())),
  )
  if (factIds.length === 0) throw new KnowledgeConfirmationError('没有选中任何条目，不发空白确认链接')

  // ① 身份闸 —— 跟客户点确认时用的是同一个判据函数（dual-sign.ts），不是
  //    另写一份「差不多」的规则。
  const registered = await getRegisteredConfirmerEmails(clientId, sb)
  const identityProblem = checkConfirmerIdentity({
    confirmerEmail,
    // 批准人逐条不同，这一步只判「是否登记 / 是否管理员」；跟批准人的比对
    // 在下面拿到每条事实之后逐条做。
    approverEmail: null,
    registeredConfirmerEmails: registered,
  })
  if (identityProblem) throw new KnowledgeConfirmationError(describeIdentityProblem(identityProblem, confirmerEmail))

  // ② 条目闸：必须都是这个客户的、已批准、还没被客户确认过的条目。
  const factResult = await sb
    .from('client_knowledge_facts')
    .select(FACT_COLUMNS)
    .eq('client_id', clientId)
    .in('id', factIds)
  if (factResult.error) {
    throw new KnowledgeReadError('读取待确认知识事实（client_knowledge_facts）', factResult.error)
  }
  const rows = asRows<FactRow>(factResult.data).filter((row) => row.client_id === clientId)

  if (rows.length !== factIds.length) {
    throw new KnowledgeConfirmationError('选中的条目里有一条不属于这个客户，或者已经不存在了。刷新页面再试。')
  }
  for (const row of rows) {
    if (row.status !== 'approved') {
      throw new KnowledgeConfirmationError('选中的条目里有一条还没被 ME 批准，不能发给客户确认。')
    }
    if (row.client_confirmed_at) {
      throw new KnowledgeConfirmationError('选中的条目里有一条客户已经确认过了，不用再发一次。')
    }
    // 职责分离：批草稿的人不能同时是确认的人。
    const perFactProblem = checkConfirmerIdentity({
      confirmerEmail,
      approverEmail: row.approved_by_email,
      registeredConfirmerEmails: registered,
    })
    if (perFactProblem) {
      throw new KnowledgeConfirmationError(describeIdentityProblem(perFactProblem, confirmerEmail))
    }
  }

  // ③ 钉指纹 + 发令牌。
  const rawToken = generateConfirmationToken()
  const ttlHours = params.ttlHours ?? CONFIRMATION_LINK_DEFAULT_TTL_HOURS
  if (!(ttlHours > 0)) throw new KnowledgeConfirmationError('确认链接的有效期必须是正数小时')
  const expiresAt = new Date(now.getTime() + ttlHours * 3_600_000).toISOString()

  const insertResult = await sb
    .from('client_knowledge_confirmation_requests')
    .insert({
      client_id: clientId,
      confirmer_email: confirmerEmail,
      token_hash: hashConfirmationToken(rawToken),
      fact_fingerprints: rows.map((row) => ({ fact_id: row.id, fingerprint: fingerprintOf(row) })),
      expires_at: expiresAt,
      created_by_email: actorEmail,
    })
    .select('id')
  if (insertResult.error) {
    throw new KnowledgeConfirmationError(`发送确认链接失败：${insertResult.error.message ?? '未知错误'}`)
  }
  const inserted = asRows<{ id: string }>(insertResult.data)[0]
  // 🔴 PostgREST 的 insert().select() 没拿到行 = 这次写入没有真正落库（或者
  // 调用方漏了 .select()）。这时候如果还把 rawToken 发出去，客户会拿到一条
  // 永远打不开的链接，而 ME 这边看起来一切正常。
  if (!inserted?.id) {
    throw new KnowledgeConfirmationError('确认链接没有写进数据库（没有拿到记录号），已中止发送。')
  }

  return {
    requestId: inserted.id,
    rawToken,
    confirmerEmail,
    expiresAt,
    factIds: rows.map((row) => row.id),
  }
}

function describeIdentityProblem(problem: ConfirmerIdentityRejection, email: string): string {
  switch (problem) {
    case 'missing':
      return '没有填收件人，无法发送确认链接'
    case 'same_as_approver':
      return `${email} 就是批准这条草稿的人。批的人和确认的人必须是两个人，否则等于没有客户确认。`
    case 'global_admin':
      return `${email} 是 Magic Engine 管理员账号，不能代客户确认。`
    case 'not_registered':
      return `${email} 还不是这个客户登记过的确认人。请先由全局管理员登记，再发确认链接。`
  }
}

// ── Viewing a request (GET — must never change anything) ─────────────────────

export async function loadConfirmationRequest(
  sb: KnowledgeWriteClient,
  params: { requestId: string; rawToken: string; now?: () => Date },
): Promise<ConfirmationLinkResult> {
  const now = params.now?.() ?? new Date()

  const request = await readRequest(sb, params.requestId)
  if (!request) return { ok: false, problem: 'not_found' }

  const gate = gateRequest(request, params.rawToken, now)
  if (gate) return { ok: false, problem: gate }

  const pinned = parsePinnedFacts(request.fact_fingerprints)
  const { views } = await readBatchFacts(sb, request.client_id, pinned)
  const clientName = await readClientName(sb, request.client_id)

  return {
    ok: true,
    requestId: request.id,
    clientId: request.client_id,
    clientName,
    confirmerEmail: request.confirmer_email,
    expiresAt: request.expires_at,
    facts: views,
  }
}

async function readRequest(sb: KnowledgeWriteClient, requestId: string): Promise<RequestRow | null> {
  const result = await sb
    .from('client_knowledge_confirmation_requests')
    .select(REQUEST_COLUMNS)
    .eq('id', requestId)
  if (result.error) {
    throw new KnowledgeReadError('读取客户确认请求（client_knowledge_confirmation_requests）', result.error)
  }
  return asRows<RequestRow>(result.data)[0] ?? null
}

/** The three link-level gates, in one place so GET and POST cannot drift apart. */
function gateRequest(request: RequestRow, rawToken: string, now: Date): ConfirmationLinkProblem | null {
  if (!hashesMatch(request.token_hash, hashConfirmationToken(rawToken))) return 'bad_token'
  if (request.status !== 'pending') return 'already_used'
  if (Date.parse(request.expires_at) <= now.getTime()) return 'expired'
  return null
}

interface BatchFacts {
  views: ConfirmationFactView[]
  rowsById: Map<string, FactRow>
  pinnedById: Map<string, string>
}

async function readBatchFacts(sb: KnowledgeWriteClient, clientId: string, pinned: PinnedFact[]): Promise<BatchFacts> {
  const ids = pinned.map((p) => p.factId)
  const rowsById = new Map<string, FactRow>()
  if (ids.length > 0) {
    const result = await sb.from('client_knowledge_facts').select(FACT_COLUMNS).eq('client_id', clientId).in('id', ids)
    if (result.error) {
      throw new KnowledgeReadError('读取确认批次里的知识事实（client_knowledge_facts）', result.error)
    }
    for (const row of asRows<FactRow>(result.data)) {
      if (row.client_id === clientId) rowsById.set(row.id, row)
    }
  }

  const pinnedById = new Map(pinned.map((p) => [p.factId, p.fingerprint]))
  const views: ConfirmationFactView[] = []
  for (const item of pinned) {
    const row = rowsById.get(item.factId)
    // 条目被删掉（或换了客户）就当成「变过了」—— 不能把一条查不到的东西
    // 摆在客户面前让他签字。
    if (!row) {
      views.push({
        factId: item.factId,
        statement: '',
        sensitivity: 'price',
        validUntil: null,
        conflictGroupId: null,
        changedSinceSent: true,
      })
      continue
    }
    views.push({
      factId: row.id,
      statement: row.statement,
      sensitivity: row.sensitivity,
      validUntil: row.valid_until,
      conflictGroupId: row.conflict_group_id,
      changedSinceSent: fingerprintOf(row) !== item.fingerprint,
    })
  }

  return { views, rowsById, pinnedById }
}

async function readClientName(sb: KnowledgeWriteClient, clientId: string): Promise<string | null> {
  const result = await sb.from('clients').select('id, name').eq('id', clientId)
  if (result.error) return null // 客户名只是抬头文案，取不到不该让整页打不开
  const row = asRows<{ id: string; name?: string | null }>(result.data)[0]
  return row?.name ?? null
}

// ── Consuming a request (POST — the only path that writes) ───────────────────

export type FactChoice = 'confirm' | 'reject'

export interface ConfirmationOutcome {
  confirmedFactIds: string[]
  rejectedFactIds: string[]
  /** 发链接之后被改过 —— 本次不收，要重发一条新链接。 */
  staleFactIds: string[]
}

export type ConsumeResult =
  | ({ ok: true; requestId: string; clientId: string; confirmerEmail: string } & ConfirmationOutcome)
  | { ok: false; problem: ConfirmationLinkProblem }

/**
 * Apply the customer's decisions. The ONLY function in this module that
 * writes.
 *
 * Order of operations, and why:
 *   1. Validate the link (exists / token matches / pending / not expired).
 *   2. Validate the confirmer's identity against the CURRENT registry and
 *      every fact's approver — reject the whole request before any write.
 *   3. Work out the full outcome in memory (which facts drifted, which the
 *      customer confirmed, which they pushed back on).
 *   4. Call `consume_knowledge_confirmation_request` — ONE Postgres function
 *      that claims the request (`WHERE status='pending'`) AND writes every
 *      fact's sign-off inside a single transaction.
 *
 * 🔴 Steps 4 used to be two separate JS statements: claim the request, then
 * loop over facts writing each one. 子牙 + 魏征's independent reviews of this
 * PR both caught the same real gap: a crash or network drop between "claim"
 * and "finish the loop" left the request burnt (status='confirmed', outcome
 * listing every fact as done) while some facts never got
 * `client_confirmed_at` written — a silent, permanent inconsistency nothing
 * ever re-checks, and the customer sees "please try the link again" for a
 * link that then reports "already confirmed". Folding both writes into one
 * `rpc()` call makes them one statement-level transaction: any failure rolls
 * back the claim too, so the link genuinely stays retryable instead of
 * lying about it.
 */
export async function consumeConfirmationRequest(
  sb: KnowledgeWriteClient,
  params: {
    requestId: string
    rawToken: string
    /** factId → 客户的选择。批次里没出现的条目当作「没表态」，既不确认也不驳回。 */
    choices: Record<string, FactChoice>
    /** factId → 客户写的「需要修改」原因。 */
    notes?: Record<string, string>
    now?: () => Date
  },
): Promise<ConsumeResult> {
  const now = params.now?.() ?? new Date()

  const request = await readRequest(sb, params.requestId)
  if (!request) return { ok: false, problem: 'not_found' }
  const gate = gateRequest(request, params.rawToken, now)
  if (gate) return { ok: false, problem: gate }

  const pinned = parsePinnedFacts(request.fact_fingerprints)
  const { rowsById, pinnedById } = await readBatchFacts(sb, request.client_id, pinned)

  // ── Identity gate: the whole request dies here, before any write ──────────
  const registered = await getRegisteredConfirmerEmails(request.client_id, sb)
  const baseProblem = checkConfirmerIdentity({
    confirmerEmail: request.confirmer_email,
    approverEmail: null,
    registeredConfirmerEmails: registered,
  })
  if (baseProblem) return { ok: false, problem: baseProblem }
  for (const row of rowsById.values()) {
    const problem = checkConfirmerIdentity({
      confirmerEmail: request.confirmer_email,
      approverEmail: row.approved_by_email,
      registeredConfirmerEmails: registered,
    })
    if (problem) return { ok: false, problem }
  }

  // ── Plan ─────────────────────────────────────────────────────────────────
  const outcome: ConfirmationOutcome = { confirmedFactIds: [], rejectedFactIds: [], staleFactIds: [] }
  const fingerprintByFactId = new Map<string, string>()

  for (const item of pinned) {
    const row = rowsById.get(item.factId)
    if (!row) {
      outcome.staleFactIds.push(item.factId)
      continue
    }
    const current = fingerprintOf(row)
    if (current !== pinnedById.get(item.factId)) {
      // 🔴 §9.5：发链接之后内容变了，客户看的和库里的不是同一版。不确认，
      //    也不驳回 —— 这条需要重新发一条链接。
      outcome.staleFactIds.push(item.factId)
      continue
    }
    const choice = params.choices[item.factId]
    if (choice === 'confirm') {
      outcome.confirmedFactIds.push(item.factId)
      fingerprintByFactId.set(item.factId, current)
    } else if (choice === 'reject') {
      outcome.rejectedFactIds.push(item.factId)
    }
  }

  // ── Claim + write, atomically ────────────────────────────────────────────
  const finalStatus = outcome.confirmedFactIds.length > 0 ? 'confirmed' : 'rejected'
  const confirmedAtIso = now.toISOString()
  const rpcResult = await sb.rpc('consume_knowledge_confirmation_request', {
    p_request_id: request.id,
    p_client_id: request.client_id,
    p_confirmer_email: request.confirmer_email,
    p_final_status: finalStatus,
    p_confirmed_at: confirmedAtIso,
    p_outcome: {
      confirmed_fact_ids: outcome.confirmedFactIds,
      rejected_fact_ids: outcome.rejectedFactIds,
      stale_fact_ids: outcome.staleFactIds,
    },
    p_confirmed: outcome.confirmedFactIds.map((factId) => ({
      fact_id: factId,
      fingerprint: fingerprintByFactId.get(factId) ?? null,
    })),
    p_rejected: outcome.rejectedFactIds.map((factId) => ({
      fact_id: factId,
      note: params.notes?.[factId]?.trim() || null,
    })),
  })
  if (rpcResult.error) {
    throw new KnowledgeConfirmationError(`确认失败：${rpcResult.error.message ?? '未知错误'}`)
  }
  const claimed = asRows<{ claimed: boolean }>(rpcResult.data)[0]?.claimed
  if (!claimed) {
    // 有人（或另一个浏览器标签）刚刚抢先提交了同一条链接。一个字都没写。
    return { ok: false, problem: 'already_used' }
  }

  return {
    ok: true,
    requestId: request.id,
    clientId: request.client_id,
    confirmerEmail: request.confirmer_email,
    ...outcome,
  }
}

/** Human-readable reason for a refused link — shown on the customer page, so no code words. */
export function describeLinkProblem(problem: ConfirmationLinkProblem): string {
  switch (problem) {
    case 'not_found':
    case 'bad_token':
      return '这个确认链接不对。请用我们发给你的那封邮件里的链接重新打开；如果找不到，回一封邮件告诉我们，我们重发一条。'
    case 'expired':
      return '这个确认链接已经过期了。回一封邮件告诉我们一声，我们马上重发一条新的。'
    case 'already_used':
      return '这批内容已经确认过了，不用再点一次。'
    case 'missing':
    case 'not_registered':
      return '你的邮箱目前不在这个账户的确认人名单里，所以这次确认没有生效。回这封邮件告诉我们，我们帮你登记。'
    case 'same_as_approver':
      return '这批内容需要由你们公司的人确认，不能由整理这批内容的人自己确认。回这封邮件告诉我们一声。'
    case 'global_admin':
      return 'Magic Engine 的账号不能代你们确认。回这封邮件告诉我们，我们用你们自己的邮箱重发一条。'
  }
}
