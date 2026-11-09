/**
 * Client Knowledge Base — the FDE review queue (issue #1646, design doc §3.3).
 *
 * "审" is the human gate between 萃 (mining writes `status='candidate'` rows,
 * never `approved`) and 用 (`getClientKnowledge` only ever returns `approved`
 * ones). This module is what an FDE actually looks at and clicks.
 *
 * 🔴 Why this does NOT reuse `getClientKnowledge`: that function's entire
 * purpose is to answer "what may we SAY", and it is scoped, on purpose, to
 * `status='approved'` rows that have passed every gate. The review queue is
 * the exact opposite question — "what has nobody decided on yet" — and wants
 * precisely the rows `getClientKnowledge` is built to hide. Widening that
 * function to serve both would mean every customer-facing caller inherits a
 * code path that can return un-approved facts. Separate function, separate
 * query, no shared filter to accidentally loosen.
 *
 * ## Ordering (design doc §3.3: "先冲突组，再新增，再佐证")
 *
 * The order is not cosmetic. A conflict group means the client's own staff
 * have been telling customers two different prices — that is the thing that
 * is actively costing money today, so it is first. A plain new candidate is
 * next. A candidate that merely corroborates a fact somebody already approved
 * is last: it changes nothing if it waits.
 *
 * ## What is safe to SHOW
 *
 * 🔴 `evidence` as written by `mining.ts` currently carries ONLY counters —
 * `occurrence_count`, `distinct_conversation_count`, `first_seen_at`,
 * `last_seen_at`. It carries no message ids and no redacted excerpt. So this
 * module does NOT surface "2–3 条脱敏原句" (design doc §3.3): there is
 * nothing stored to surface, and the original `conversation_messages` bodies
 * are NOT redacted (only the text sent to the model was) — displaying them
 * would put raw customer PII on an internal screen. The reviewer therefore
 * sees the extracted `statement` (which was derived from redacted input) plus
 * the counters. Closing this gap needs `mining.ts` to persist redacted
 * excerpts or message references; it is called out in this issue's handoff
 * rather than papered over with invented display data.
 */

import { KnowledgeReadError } from './errors'
import type { Sensitivity } from './sensitivity'
import type { Visibility } from './types'
import { asRows, type KnowledgeWriteClient } from './write-client'

// ── Shapes the UI renders ───────────────────────────────────────────────────

export interface CandidateEvidence {
  /** How many times the employee message this fact came from was sent, in total. */
  occurrenceCount: number | null
  /** Across how many DISTINCT conversations — the number that separates "a house rule" from "one customer told the same thing 51 times". */
  distinctConversationCount: number | null
  firstSeenAt: string | null
  lastSeenAt: string | null
}

export interface KnowledgeCandidate {
  id: string
  factKey: string
  scope: Record<string, unknown>
  statement: string
  structuredValue: unknown
  sensitivity: Sensitivity
  visibility: Visibility
  validFrom: string
  validUntil: string | null
  sourceKind: string
  conflictGroupId: string | null
  evidence: CandidateEvidence
  createdAt: string
}

/** An already-approved fact occupying the same identity a candidate is proposing. */
export interface ApprovedCounterpart {
  id: string
  statement: string
  validUntil: string | null
  approvedByEmail: string | null
  clientConfirmedAt: string | null
}

export type CandidateGroupKind = 'conflict' | 'new' | 'corroborating'

export interface CandidateGroup {
  kind: CandidateGroupKind
  /** Stable React key: the conflict group id, or `factKey::<canonical scope>`. */
  key: string
  factKey: string
  scope: Record<string, unknown>
  candidates: KnowledgeCandidate[]
  /** Non-null only for `corroborating` groups. */
  approvedCounterpart: ApprovedCounterpart | null
}

// ── Reading the queue ───────────────────────────────────────────────────────

interface CandidateRow {
  id: string
  client_id: string
  fact_key: string
  scope: Record<string, unknown> | null
  statement: string
  structured_value: unknown
  sensitivity: Sensitivity
  visibility: Visibility
  valid_from: string
  valid_until: string | null
  source_kind: string
  conflict_group_id: string | null
  evidence: Record<string, unknown> | null
  created_at: string
}

interface ApprovedRow {
  id: string
  fact_key: string
  scope: Record<string, unknown> | null
  statement: string
  valid_until: string | null
  approved_by_email: string | null
  client_confirmed_at: string | null
}

const CANDIDATE_COLUMNS =
  'id, client_id, fact_key, scope, statement, structured_value, sensitivity, visibility, valid_from, valid_until, source_kind, conflict_group_id, evidence, created_at'

const APPROVED_COLUMNS = 'id, fact_key, scope, statement, valid_until, approved_by_email, client_confirmed_at'

/** Stable identity key for "same fact, same scope" — fixed key order so `{a:1,b:2}` and `{b:2,a:1}` are one identity. */
function identityKey(factKey: string, scope: Record<string, unknown> | null): string {
  const entries = Object.entries(scope ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `${factKey}::${JSON.stringify(entries)}`
}

function readNumber(source: Record<string, unknown> | null, key: string): number | null {
  const value = source?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readString(source: Record<string, unknown> | null, key: string): string | null {
  const value = source?.[key]
  return typeof value === 'string' && value ? value : null
}

function toCandidate(row: CandidateRow): KnowledgeCandidate {
  return {
    id: row.id,
    factKey: row.fact_key,
    scope: row.scope ?? {},
    statement: row.statement,
    structuredValue: row.structured_value,
    sensitivity: row.sensitivity,
    visibility: row.visibility,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    sourceKind: row.source_kind,
    conflictGroupId: row.conflict_group_id,
    evidence: {
      occurrenceCount: readNumber(row.evidence, 'occurrence_count'),
      distinctConversationCount: readNumber(row.evidence, 'distinct_conversation_count'),
      firstSeenAt: readString(row.evidence, 'first_seen_at'),
      lastSeenAt: readString(row.evidence, 'last_seen_at'),
    },
    createdAt: row.created_at,
  }
}

/**
 * Pure grouping + ordering — separated from I/O so the ordering rule (the part
 * that carries the product decision) is unit-testable with plain fixtures and
 * no database at all.
 *
 * Within a kind, groups are ordered by the loudest evidence first: the highest
 * `distinct_conversation_count` in the group, then the most recent
 * `last_seen_at`. A price two staff disagree on that went to 51 different
 * customers must not sit below one that went to 2.
 */
export function groupCandidates(
  candidates: KnowledgeCandidate[],
  /** Already-approved facts keyed by `identityKey(factKey, scope)` — build it with `buildApprovedIndex`. */
  approvedIdentityKeys: ReadonlyMap<string, ApprovedCounterpart>,
): CandidateGroup[] {
  const groups = new Map<string, CandidateGroup>()

  for (const candidate of candidates) {
    const identity = identityKey(candidate.factKey, candidate.scope)
    const counterpart = approvedIdentityKeys.get(identity) ?? null

    // A conflict group id is assigned by the mining pipeline when two
    // candidates propose different values for the same unit+scope. It wins
    // over every other classification: an unresolved contradiction is the
    // most urgent thing on the page even if one side of it corroborates
    // something already approved.
    const key = candidate.conflictGroupId ?? identity
    const kind: CandidateGroupKind = candidate.conflictGroupId ? 'conflict' : counterpart ? 'corroborating' : 'new'

    const existing = groups.get(key)
    if (existing) {
      existing.candidates.push(candidate)
      // A group carrying a conflict id stays a conflict group even if a later
      // member would have classified differently on its own.
      if (kind === 'conflict') existing.kind = 'conflict'
      continue
    }
    groups.set(key, {
      kind,
      key,
      factKey: candidate.factKey,
      scope: candidate.scope,
      candidates: [candidate],
      approvedCounterpart: kind === 'corroborating' ? counterpart : null,
    })
  }

  const KIND_ORDER: Record<CandidateGroupKind, number> = { conflict: 0, new: 1, corroborating: 2 }

  function loudness(group: CandidateGroup): number {
    return Math.max(...group.candidates.map((c) => c.evidence.distinctConversationCount ?? 0), 0)
  }
  function recency(group: CandidateGroup): string {
    return group.candidates.reduce<string>((latest, c) => {
      const seen = c.evidence.lastSeenAt ?? ''
      return seen > latest ? seen : latest
    }, '')
  }

  return Array.from(groups.values()).sort((a, b) => {
    if (KIND_ORDER[a.kind] !== KIND_ORDER[b.kind]) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
    const loud = loudness(b) - loudness(a)
    if (loud !== 0) return loud
    const rec = recency(b).localeCompare(recency(a))
    if (rec !== 0) return rec
    // Final tie-break on a stable field so the list never reshuffles between reloads.
    return a.key.localeCompare(b.key)
  })
}

/**
 * The FDE review queue for one client: every `status='candidate'` row,
 * grouped and ordered per §3.3.
 *
 * 🔴 Fail-closed like every other read in this module: a DB error throws
 * `KnowledgeReadError`. An empty queue must mean "nothing to review", never
 * "the query broke" — an FDE who sees an empty page concludes the mining run
 * found nothing and moves on.
 */
export async function listKnowledgeCandidates(
  clientId: string,
  sb: KnowledgeWriteClient,
): Promise<CandidateGroup[]> {
  const candidateResult = await sb
    .from('client_knowledge_facts')
    .select(CANDIDATE_COLUMNS)
    .eq('client_id', clientId)
    .eq('status', 'candidate')
    .order('created_at', { ascending: false })
  if (candidateResult.error) {
    throw new KnowledgeReadError('读取待审知识候选（client_knowledge_facts）', candidateResult.error)
  }

  const approvedResult = await sb
    .from('client_knowledge_facts')
    .select(APPROVED_COLUMNS)
    .eq('client_id', clientId)
    .eq('status', 'approved')
  if (approvedResult.error) {
    throw new KnowledgeReadError('读取已批准知识事实（client_knowledge_facts）', approvedResult.error)
  }

  const candidates = asRows<CandidateRow>(candidateResult.data)
    // Second line of defence on cross-client isolation, matching read.ts: the
    // query is already scoped, but a future refactor that loosens it must not
    // silently leak another client's candidates onto this page.
    .filter((row) => row.client_id === clientId)
    .map(toCandidate)

  return groupCandidates(candidates, buildApprovedIndex(asRows<ApprovedRow>(approvedResult.data)))
}

/** Index already-approved facts by identity so a candidate can tell "am I new, or am I corroborating something live". */
function buildApprovedIndex(rows: ApprovedRow[]): Map<string, ApprovedCounterpart> {
  const index = new Map<string, ApprovedCounterpart>()
  for (const row of rows) {
    index.set(identityKey(row.fact_key, row.scope), {
      id: row.id,
      statement: row.statement,
      validUntil: row.valid_until,
      approvedByEmail: row.approved_by_email,
      clientConfirmedAt: row.client_confirmed_at,
    })
  }
  return index
}

// ── Approved-but-unconfirmed sensitive facts (what a confirmation link covers) ──

export interface PendingConfirmationFact {
  id: string
  factKey: string
  scope: Record<string, unknown>
  statement: string
  structuredValue: unknown
  sensitivity: Sensitivity
  visibility: Visibility
  validFrom: string
  validUntil: string | null
  approvedByEmail: string | null
  approvedAt: string | null
}

const PENDING_COLUMNS =
  'id, client_id, fact_key, scope, statement, structured_value, sensitivity, visibility, valid_from, valid_until, approved_by_email, approved_at, client_confirmed_at'

interface PendingRow {
  id: string
  client_id: string
  fact_key: string
  scope: Record<string, unknown> | null
  statement: string
  structured_value: unknown
  sensitivity: Sensitivity
  visibility: Visibility
  valid_from: string
  valid_until: string | null
  approved_by_email: string | null
  approved_at: string | null
  client_confirmed_at: string | null
}

/** The four sensitivity categories the dual-sign gate applies to — kept identical to `read.ts`'s SENSITIVE_CATEGORIES. */
const SENSITIVE_CATEGORIES: ReadonlySet<Sensitivity> = new Set(['price', 'timeline', 'commitment', 'policy'])

/**
 * Facts that are approved by ME but still waiting on the customer's own
 * signature — i.e. exactly the set a confirmation link may cover.
 *
 * `general` facts are excluded because they need no customer confirmation at
 * all (`read.ts` lets them through on the FDE approval alone); sending the
 * customer a link to confirm something that is already live would teach them
 * their click doesn't matter.
 */
export async function listFactsAwaitingCustomerConfirmation(
  clientId: string,
  sb: KnowledgeWriteClient,
): Promise<PendingConfirmationFact[]> {
  const result = await sb
    .from('client_knowledge_facts')
    .select(PENDING_COLUMNS)
    .eq('client_id', clientId)
    .eq('status', 'approved')
    .is('client_confirmed_at', null)
  if (result.error) {
    throw new KnowledgeReadError('读取待客户确认的知识事实（client_knowledge_facts）', result.error)
  }

  return asRows<PendingRow>(result.data)
    .filter((row) => row.client_id === clientId)
    .filter((row) => row.client_confirmed_at === null)
    .filter((row) => SENSITIVE_CATEGORIES.has(row.sensitivity))
    .map((row) => ({
      id: row.id,
      factKey: row.fact_key,
      scope: row.scope ?? {},
      statement: row.statement,
      structuredValue: row.structured_value,
      sensitivity: row.sensitivity,
      visibility: row.visibility,
      validFrom: row.valid_from,
      validUntil: row.valid_until,
      approvedByEmail: row.approved_by_email,
      approvedAt: row.approved_at,
    }))
}

// ── Decisions ───────────────────────────────────────────────────────────────

export type CandidateDecision =
  /** 批准：原样通过，对客可见。 */
  | { action: 'approve' }
  /** 改后批准：先改正文/结构化值/范围/有效期，再通过。 */
  | {
      action: 'approve_with_edits'
      statement?: string
      structuredValue?: unknown
      scope?: Record<string, unknown>
      validUntil?: string | null
    }
  /** 驳回：这条说法不成立。`note` 会写进 client_rejection_note 供下一轮萃取和复盘看。 */
  | { action: 'reject'; note?: string }
  /** 标"禁止对客说"：这是真事实，但 AI 一个字都不许提（停售团、地产报价这类）。 */
  | { action: 'forbid' }
  /** 设有效期：只改到期日，仍然留在待审队列里。 */
  | { action: 'set_valid_until'; validUntil: string | null }

export class KnowledgeReviewError extends Error {
  constructor(message: string) {
    super(`[knowledge] ${message}`)
    this.name = 'KnowledgeReviewError'
  }
}

/** Postgres surfaces our `single approved per identity` trigger as a plain message — turn it into something an FDE can act on. */
function translateWriteError(message: string | undefined): string {
  const raw = message ?? '未知错误'
  if (raw.includes('another approved row already exists')) {
    return '这条事实已经有一条生效中的版本了。要换成这一条，请先把旧的那条退役（retire），再批准这一条。'
  }
  if (raw.includes('approver_confirmer_differ')) {
    return '批准人和客户确认人不能是同一个人。'
  }
  return raw
}

/**
 * Apply one FDE decision to one candidate.
 *
 * 🔴 Three invariants this function exists to hold:
 *
 *  1. **It can only ever touch a `status='candidate'` row.** The UPDATE carries
 *     `.eq('status','candidate')` and the function fails if zero rows came
 *     back. Without that, a stale browser tab could re-approve (or silently
 *     edit) a fact the customer has already confirmed — and because the row
 *     would still read "approved + confirmed" afterwards, nothing anywhere
 *     would look wrong.
 *  2. **It never writes `client_confirmed_by_email` / `client_confirmed_at` /
 *     `client_confirmed_fingerprint`.** Approving a sensitive fact is only
 *     half the signature; the other half can only come from the customer's own
 *     confirmation link (`confirmation-requests.ts`). This is the single most
 *     important line in this file: if an approve path ever set those fields,
 *     the whole dual-sign design collapses into one person clicking twice.
 *  3. **It never changes `sensitivity`.** Design doc §9.5: downgrading a fact
 *     to `general` also needs the customer's confirmation — so it cannot be a
 *     side effect of an FDE approval, and there is deliberately no action here
 *     that offers it.
 */
export async function applyCandidateDecision(
  sb: KnowledgeWriteClient,
  params: {
    clientId: string
    factId: string
    actorEmail: string
    decision: CandidateDecision
    now?: () => Date
  },
): Promise<void> {
  const actorEmail = params.actorEmail.trim()
  if (!actorEmail) throw new KnowledgeReviewError('缺少审核人身份，拒绝写入')

  const nowIso = (params.now?.() ?? new Date()).toISOString()
  const fields = buildDecisionFields(params.decision, actorEmail, nowIso)

  const result = await sb
    .from('client_knowledge_facts')
    .update(fields)
    .eq('id', params.factId)
    // 🔴 Both of these matter. `client_id` stops a crafted fact id from another
    // client being edited through this client's page; `status` stops anything
    // that has already left the review queue from being rewritten.
    .eq('client_id', params.clientId)
    .eq('status', 'candidate')
    .select('id')

  if (result.error) throw new KnowledgeReviewError(translateWriteError(result.error.message))

  // 🔴 PostgREST returns an EMPTY ARRAY (not an error) when an UPDATE matches
  // no rows. Treating that as success is how "I clicked approve and nothing
  // happened" becomes invisible.
  if (asRows<{ id: string }>(result.data).length === 0) {
    throw new KnowledgeReviewError(
      '这条候选已经不在待审队列里了（可能刚被别人处理过，或不属于这个客户）。刷新页面再看一次。',
    )
  }
}

/** Split out so the exact field set each action writes is directly assertable in tests. */
export function buildDecisionFields(
  decision: CandidateDecision,
  actorEmail: string,
  nowIso: string,
): Record<string, unknown> {
  const approvalStamp = { status: 'approved', approved_by_email: actorEmail, approved_at: nowIso }

  switch (decision.action) {
    case 'approve':
      return { ...approvalStamp, visibility: 'customer_ok' }

    case 'approve_with_edits': {
      const edits: Record<string, unknown> = { ...approvalStamp, visibility: 'customer_ok' }
      if (decision.statement !== undefined) {
        const statement = decision.statement.trim()
        if (!statement) throw new KnowledgeReviewError('改后批准时正文不能为空')
        edits.statement = statement
      }
      if (decision.structuredValue !== undefined) edits.structured_value = decision.structuredValue
      if (decision.scope !== undefined) edits.scope = decision.scope
      if (decision.validUntil !== undefined) edits.valid_until = normaliseValidUntil(decision.validUntil)
      return edits
    }

    case 'reject':
      return {
        status: 'rejected',
        client_rejection_note: decision.note?.trim() || null,
      }

    case 'forbid':
      // 🔴 `forbidden` facts must still be `approved`: `getClientKnowledge`
      // only looks at approved rows, and a forbidden fact's whole job is to
      // appear in `forbiddenFactKeys` so the reply gate knows never to say
      // it. Leaving it as a candidate would make "禁止对客说" a no-op.
      return { ...approvalStamp, visibility: 'forbidden' }

    case 'set_valid_until':
      return { valid_until: normaliseValidUntil(decision.validUntil) }
  }
}

function normaliseValidUntil(value: string | null): string | null {
  if (value === null) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Date.parse(trimmed)
  if (Number.isNaN(parsed)) throw new KnowledgeReviewError(`有效期不是一个能识别的日期：${value}`)
  return new Date(parsed).toISOString()
}
