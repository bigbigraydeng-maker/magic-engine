/**
 * Client Knowledge Base — unified read entry point (Issue #1644 §getClientKnowledge).
 *
 * This is the ONLY place downstream code (a customer-facing reply generator,
 * an internal brief, a lead classifier) should read `client_knowledge_facts`
 * from. It exists to answer one question safely: "what is ME actually
 * allowed to say to this specific audience, right now?" — and to make it
 * structurally impossible to get a false "nothing is known" answer.
 *
 * ## The gate order (every one of these can turn a row invisible)
 *
 *   1. Entitlement (`getKnowledgeEntitlement`) — no grant, no read. Fail-
 *      closed: an entitlement check that itself fails (DB error) propagates
 *      as an error, never as "not entitled" and never as "just show nothing".
 *   2. `status = 'approved'` — a `candidate`/`rejected`/`retired`/
 *      `superseded` row is never usable, for any purpose.
 *   3. Validity window — `valid_from <= now <= valid_until` (or no
 *      `valid_until`), checked against the clock at read time, never a
 *      batch job that flips `status` on a schedule.
 *   4. Visibility for `purpose` — `customer_reply` only ever sees
 *      `customer_ok` bodies; `internal_brief` / `lead_classification` also
 *      see `internal_only`; nobody's *body* ever comes back for
 *      `forbidden` — that fact_key surfaces only in `forbiddenFactKeys`.
 *   5. Dual-sign, `customer_reply` only — sensitivity `price` / `timeline` /
 *      `commitment` / `policy` additionally require:
 *        a. `client_confirmed_at` is set,
 *        b. the confirmer is not also the approver (defence in depth — the
 *           DB CHECK `approver_confirmer_differ` should already prevent this
 *           from ever being written, but a reader must not trust a write
 *           path it doesn't control to have enforced every invariant),
 *        c. the confirmer is not a global admin impersonating the customer
 *           (`isGlobalAdminEmail` — an env-driven judgement the database
 *           cannot make, so it can only be enforced here, not as a CHECK),
 *        d. the confirmer's email is a currently-registered confirmer for
 *           THIS client (`client_knowledge_confirmers`, §9.14 E.2 step 2 —
 *           only a global admin can register one) — otherwise any email a
 *           write path happened to store would count, with no gate at all,
 *        e. the stored `client_confirmed_fingerprint` still matches
 *           `computeContentFingerprint()` of the row's current content —
 *           if the fact was edited after confirmation, the old confirmation
 *           no longer counts.
 *      `sensitivity = 'general'` skips (a)-(e) entirely — `approved` is
 *      enough.
 *   6. Rollout stage + channel switch, `customer_reply` only (Issue #1648,
 *      design doc §9.14 A) — regardless of sensitivity, `visibility`, or the
 *      dual-sign outcome above: the client's rollout stage
 *      (`client_knowledge_events`, `dimension='phase'`) must currently be
 *      `LIVE_STAGE` (2, "上线") AND `clients.messenger_agent_enabled_messenger`
 *      must be `true`. This is decided by `isKnowledgeLiveForCustomerReply`
 *      (`rollout.ts`), called exactly ONCE per `getClientKnowledge` call,
 *      right here — never re-derived by a caller. Any read failure on either
 *      underlying query resolves this to `false` (fail-closed as "not live"),
 *      the one deliberate exception to this file's "never swallow a DB
 *      error" rule: an AI inventing facts from silence is the risk gate 1-5
 *      exist to prevent, but here the fail-closed direction is unambiguous
 *      (staying off is always safe), so collapsing the error to `false`
 *      instead of throwing is the correct, documented choice — not an
 *      oversight.
 *
 * 🔴 **Never return an empty array on a read failure.** An empty result is
 * indistinguishable from "this client has no facts" and a downstream AI will
 * fill that silence with invented answers from training data — the exact
 * accident (CTS "AI 报停售团价格") this capability exists to prevent. Any DB
 * error throws `KnowledgeReadError`; "genuinely zero facts qualify" is the
 * only path that legitimately returns `{ entries: [], forbiddenFactKeys: [] }`.
 */

import { getRegisteredConfirmerEmails } from './confirmers'
import { isAcceptableConfirmerIdentity } from './dual-sign'
import type { KnowledgeSupabaseClient } from './db-client'
import { computeContentFingerprint } from './fingerprint'
import { getKnowledgeEntitlement } from './entitlement'
import { KnowledgeNotEntitledError, KnowledgeReadError } from './errors'
import { isKnowledgeLiveForCustomerReply } from './rollout'
import type { Sensitivity } from './sensitivity'
import type {
  FactStatus,
  GetClientKnowledgeOptions,
  KnowledgeEntry,
  KnowledgeReadResult,
  Visibility,
} from './types'

/** Sensitivity categories the dual-sign (customer confirmation) gate applies to. */
const SENSITIVE_CATEGORIES: ReadonlySet<Sensitivity> = new Set([
  'price',
  'timeline',
  'commitment',
  'policy',
])

interface FactRow {
  id: string
  client_id: string
  fact_key: string
  scope: Record<string, unknown>
  statement: string
  structured_value: unknown
  conflict_group_id: string | null
  status: FactStatus
  visibility: Visibility
  sensitivity: Sensitivity
  valid_from: string
  valid_until: string | null
  last_verified_at: string | null
  approved_by_email: string | null
  approved_at: string | null
  client_confirmed_by_email: string | null
  client_confirmed_at: string | null
  client_confirmed_fingerprint: string | null
  /**
   * Issue #1647 / design doc §9.14 B "CTS 历史未确认"有条件接受：非空表示这
   * 一行在这个时间点之前可以跳过下面 (a)-(e) 的客户确认判据。哪一行能非空
   * 由 migration 里的 CHECK 约束锁定成固定 id 白名单——这里只负责按这个值
   * 判断"现在还在宽限期内吗"，不负责判断"这行有没有资格用这个字段"。
   */
  historical_confirmation_grandfather_until: string | null
}

async function defaultSupabase(): Promise<KnowledgeSupabaseClient> {
  // Same "initialise inside the handler, not at module load" rule as
  // entitlement.ts — see that file's comment for why.
  const { supabaseAdmin } = await import('@/lib/supabase')
  // 桥接 unknown：同 entitlement.ts 的 defaultSupabase() —— supabase-js 的深层泛型
  // 让 tsc 结构比对 "excessively deep"，实测本文件全部单测（真实调用链走一遍
  // fake client）验证方法名和参数形状都对得上。
  return supabaseAdmin as unknown as KnowledgeSupabaseClient
}

export interface GetClientKnowledgeDeps {
  supabase?: KnowledgeSupabaseClient
  now?: () => Date
}

function isWithinValidityWindow(row: FactRow, now: Date): boolean {
  const nowMs = now.getTime()
  if (Date.parse(row.valid_from) > nowMs) return false
  if (row.valid_until && Date.parse(row.valid_until) <= nowMs) return false
  return true
}

function visibilityAllowedFor(purpose: GetClientKnowledgeOptions['purpose'], visibility: Visibility): boolean {
  if (visibility === 'forbidden') return false
  if (purpose === 'customer_reply') return visibility === 'customer_ok'
  // internal_brief / lead_classification: both customer_ok and internal_only bodies are usable.
  return true
}

/**
 * The dual-sign check — `customer_reply` only. See file header §5 for the
 * five sub-conditions; each is its own `if` so a mutation test can delete
 * exactly one and watch exactly one behaviour go red.
 *
 * `registeredConfirmerEmails` must be the CURRENT registry for this row's
 * client (already lower-cased) — see §9.14 E.2 step 2. Passed in rather than
 * queried per-row so a multi-row read does one registry lookup per client,
 * not one per fact.
 *
 * `now` is the same clock `getClientKnowledge` already uses for the validity
 * window check — needed here too for the historical-grandfather bypass below.
 */
function isCustomerReplyEligible(
  row: FactRow,
  registeredConfirmerEmails: ReadonlySet<string>,
  now: Date,
): boolean {
  if (!SENSITIVE_CATEGORIES.has(row.sensitivity)) return true // 'general' — no dual-sign required

  // 🔴 魏征复审（2026-09-14）实测发现：这里原来只做 falsy 检查，一个仅含空格
  // 的确认人邮箱是 truthy，会漏过这一关。跟 whitelist.ts `isGlobalAdminEmail`
  // 的 `.toLowerCase().trim()` 标准对齐——三处比较（这里、approver_confirmer
  // 比较、registeredConfirmerEmails 查找）都必须先 trim 再比较，否则一个带
  // 尾随空格的邮箱能同时躲过全部三道检查（狄仁杰攻击验证实测：DB CHECK 层确
  // 实放行了带空格的邮箱写入，唯一没被打穿是因为 client_knowledge_confirmers
  // 本身被 RLS 锁死，外部攻击者摸不到——但这道闸不该靠"攻击者刚好摸不到别的
  // 洞"才成立，读取入口自己必须先堵死这条口子）。
  if (!row.client_confirmed_at) {
    // 历史未确认宽限（issue #1647 / design doc §9.14 B "有条件接受"）：迁移
    // 脚本赋值的固定几条历史事实，在宽限截止日之前可以跳过客户确认。过期
    // 之后自动落回"return false"这条正常路径——client_confirmed_at 届时仍
    // 是 null，不需要另一套"过期检查"逻辑，判断只在这一处。哪一行有资格
    // 填这个字段，由 migration 的 CHECK 约束锁定，这里只信这一列的值。
    const grandfatherUntil = row.historical_confirmation_grandfather_until
    return typeof grandfatherUntil === 'string' && now.getTime() <= Date.parse(grandfatherUntil)
  }

  // 🔴 issue #1646：这三条身份判据（确认人≠批准人 / 确认人不是全局管理员 /
  // 确认人当前登记有效）从这里抽到 `dual-sign.ts`，因为**写入**确认的那条
  // 路径（客户确认链接）必须用一模一样的判据。两边各写一份的话，写入侧会
  // 愉快地记下一条读取侧永远不认的确认——事实静悄悄地永远不生效，两边都
  // 不报错。判据本身逐字未改，仍然是三个各自独立的 if（见 dual-sign.ts），
  // 变异测试逐条删除仍然各自变红。
  if (
    !isAcceptableConfirmerIdentity({
      confirmerEmail: row.client_confirmed_by_email,
      approverEmail: row.approved_by_email,
      registeredConfirmerEmails,
    })
  ) {
    return false
  }

  const currentFingerprint = computeContentFingerprint({
    statement: row.statement,
    structuredValue: row.structured_value,
    scope: row.scope,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    visibility: row.visibility,
    sensitivity: row.sensitivity,
  })
  if (row.client_confirmed_fingerprint !== currentFingerprint) return false

  return true
}

function scopeMatches(entryScope: Record<string, unknown>, wantedScope: Record<string, unknown>): boolean {
  return Object.entries(wantedScope).every(([key, value]) => entryScope[key] === value)
}

function toKnowledgeEntry(row: FactRow): KnowledgeEntry {
  return {
    id: row.id,
    clientId: row.client_id,
    factKey: row.fact_key,
    scope: row.scope,
    statement: row.statement,
    structuredValue: row.structured_value,
    conflictGroupId: row.conflict_group_id,
    status: row.status,
    visibility: row.visibility,
    sensitivity: row.sensitivity,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    lastVerifiedAt: row.last_verified_at,
    approvedByEmail: row.approved_by_email,
    approvedAt: row.approved_at,
    clientConfirmedByEmail: row.client_confirmed_by_email,
    clientConfirmedAt: row.client_confirmed_at,
  }
}

/**
 * Read this client's usable knowledge for a given purpose.
 *
 * 🔴 Cross-client isolation: the DB query is scoped by `client_id` at the
 * SQL layer (`.eq('client_id', clientId)`) — there is no application-layer
 * "filter afterwards" step a caller could accidentally skip.
 */
export async function getClientKnowledge(
  clientId: string,
  options: GetClientKnowledgeOptions,
  deps: GetClientKnowledgeDeps = {},
): Promise<KnowledgeReadResult> {
  const sb = deps.supabase ?? (await defaultSupabase())
  const now = deps.now ?? (() => new Date())

  // ① Entitlement — fail-closed. A DB error here propagates (getKnowledgeEntitlement
  // itself throws KnowledgeReadError rather than resolving to `entitled: false`).
  const entitlement = await getKnowledgeEntitlement(clientId, { supabase: sb, now })
  if (!entitlement.entitled) {
    throw new KnowledgeNotEntitledError(clientId)
  }

  // ② Base scoping at the SQL layer: this client, approved rows only.
  // Everything else (validity window, visibility-for-purpose, dual-sign,
  // fingerprint, requested scope) is filtered in application code below —
  // deliberately, so each rule is one isolated, independently mutation-
  // testable `if`, not a single opaque query string.
  const FACT_COLUMNS =
    'id, client_id, fact_key, scope, statement, structured_value, conflict_group_id, status, visibility, sensitivity, valid_from, valid_until, last_verified_at, approved_by_email, approved_at, client_confirmed_by_email, client_confirmed_at, client_confirmed_fingerprint, historical_confirmation_grandfather_until'

  const { data, error } = await sb
    .from('client_knowledge_facts')
    .select(FACT_COLUMNS)
    .eq('client_id', clientId)
    .eq('status', 'approved')

  if (error) throw new KnowledgeReadError('读取客户知识事实（client_knowledge_facts）', error)

  // 桥接 unknown：`data` 的列表值类型是 Record<string, unknown>，tsc 拒绝直接转
  // FactRow。实测：本机 PG 沙盘对着真实 client_knowledge_facts 表已跑过一次同样
  // 的 select（见 PR 描述验证记录），列名和类型跟 FactRow 逐一核对一致。
  const rows = (data ?? []) as unknown as FactRow[]
  const nowDate = now()

  // One registry lookup per call, not per row — only needed at all for
  // customer_reply (the only purpose the dual-sign gate applies to).
  const registeredConfirmerEmails =
    options.purpose === 'customer_reply' ? await getRegisteredConfirmerEmails(clientId, sb) : new Set<string>()

  // 🔴 Gate 6, computed exactly once per call — see file header §6. Never
  // throws (see `isKnowledgeLiveForCustomerReply`'s own doc): a DB failure
  // on either underlying query collapses to `false` here, not an exception.
  const liveForCustomerReply =
    options.purpose === 'customer_reply' ? await isKnowledgeLiveForCustomerReply(clientId, sb) : true

  const forbiddenFactKeys = new Set<string>()
  const entries: KnowledgeEntry[] = []

  for (const row of rows) {
    // 🔴 Cross-client isolation, second line of defence: even though the
    // query above is already scoped to `clientId`, assert it row-by-row so
    // a future refactor that loosens the query can't silently leak another
    // client's facts past this function.
    if (row.client_id !== clientId) continue

    if (row.visibility === 'forbidden') {
      forbiddenFactKeys.add(row.fact_key)
      continue // forbidden bodies never enter `entries`, for any purpose
    }

    if (!isWithinValidityWindow(row, nowDate)) continue
    if (!visibilityAllowedFor(options.purpose, row.visibility)) continue
    if (options.purpose === 'customer_reply' && !isCustomerReplyEligible(row, registeredConfirmerEmails, nowDate))
      continue
    if (options.purpose === 'customer_reply' && !liveForCustomerReply) continue
    if (options.scope && !scopeMatches(row.scope, options.scope)) continue

    entries.push(toKnowledgeEntry(row))
  }

  return { entries, forbiddenFactKeys: Array.from(forbiddenFactKeys) }
}
