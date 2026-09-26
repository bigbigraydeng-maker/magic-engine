/**
 * In-memory Supabase/PostgREST fake for the knowledge module's WRITE paths
 * (`review.ts`, `confirmation-requests.ts`, `kill-switch.ts`).
 *
 * 🔴 It deliberately models the behaviours that a lenient fake would paper
 * over — the exact class of gap that let a real bug ship in this module area
 * on 2026-09-14 and pass review:
 *
 *   - `insert(...)` / `update(...)` WITHOUT a trailing `.select()` resolve
 *     with `data: null`. Code that forgets `.select()` and then reads ids or
 *     row counts out of the result must fail here, not in production.
 *   - An `update` that matches no rows resolves with an EMPTY ARRAY and
 *     `error: null` — it is NOT an error. Any "did my write land?" check has
 *     to be an explicit length check.
 *   - The table's real CHECK constraints and triggers are enforced here and
 *     surface as `{ error: { message } }`, not as thrown exceptions:
 *       · `token_hash_is_sha256_hex` — a raw token stored by mistake is
 *         rejected by the database, so it must be rejected here too;
 *       · `confirmation_request_sender_is_not_confirmer`;
 *       · `confirmation_request_expiry_in_future`;
 *       · `confirmation_request_batch_not_empty`;
 *       · the append-only "terminal state cannot reopen" trigger;
 *       · `client_knowledge_facts.approver_confirmer_differ`.
 *   - A unique violation arrives as `error.code === '23505'`.
 *
 * An unmodelled table throws — "this table is empty" must never be the way a
 * typo in a table name presents itself.
 */

import type {
  KnowledgeInsertBuilder,
  KnowledgeSelectBuilder,
  KnowledgeUpdateBuilder,
  KnowledgeWriteClient,
  KnowledgeWriteResult,
  KnowledgeWriteTable,
} from '../write-client'

export type Row = Record<string, unknown>

export interface FakeWriteOptions {
  /** Any operation on these tables resolves as a Postgres-shaped failure. */
  errorTables?: ReadonlySet<string>
  /**
   * Any `.rpc(name, …)` call whose name is in this set resolves as a
   * Postgres-shaped failure WITHOUT mutating any table — models a real
   * Postgres function's transaction rolling back on error, so a test can
   * assert atomicity (nothing partially written) instead of only checking
   * that an error surfaced.
   */
  rpcErrors?: ReadonlySet<string>
  /** Turn off constraint emulation for a test that deliberately seeds "impossible" data. */
  enforceConstraints?: boolean
  /**
   * Clock used to stamp `created_at` on rows inserted without one. Defaults to the
   * real system clock. A test that also freezes `now()` for the module under test
   * (e.g. `now: () => NOW`) must pass the same clock here — otherwise an expiry-style
   * CHECK constraint compares a caller-supplied `expires_at` (relative to the frozen
   * clock) against a `created_at` stamped from the real wall clock, which drifts out
   * of sync as real time moves past the frozen date.
   */
  now?: () => Date
}

const SHA256_HEX = /^[0-9a-f]{64}$/

function lowerTrim(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

/** Returns an error message if the row would violate a real DB constraint, else null. */
function checkConstraints(table: string, row: Row): string | null {
  if (table === 'client_knowledge_confirmation_requests') {
    const tokenHash = row.token_hash
    if (typeof tokenHash !== 'string' || !SHA256_HEX.test(tokenHash)) {
      return 'new row for relation "client_knowledge_confirmation_requests" violates check constraint "token_hash_is_sha256_hex"'
    }
    if (lowerTrim(row.created_by_email) === lowerTrim(row.confirmer_email)) {
      return 'violates check constraint "confirmation_request_sender_is_not_confirmer"'
    }
    const batch = row.fact_fingerprints
    if (!Array.isArray(batch) || batch.length === 0) {
      return 'violates check constraint "confirmation_request_batch_not_empty"'
    }
    const expires = typeof row.expires_at === 'string' ? Date.parse(row.expires_at) : NaN
    const created = typeof row.created_at === 'string' ? Date.parse(row.created_at) : Date.now()
    if (!(expires > created)) {
      return 'violates check constraint "confirmation_request_expiry_in_future"'
    }
  }

  if (table === 'client_knowledge_facts') {
    const confirmer = lowerTrim(row.client_confirmed_by_email)
    const approver = lowerTrim(row.approved_by_email)
    if (confirmer && approver && confirmer === approver) {
      return 'violates check constraint "approver_confirmer_differ"'
    }
    const confirmedAt = row.client_confirmed_at ?? null
    const confirmedBy = row.client_confirmed_by_email ?? null
    if ((confirmedAt === null) !== (confirmedBy === null)) {
      return 'violates check constraint "confirmation_pairing"'
    }
    const fingerprint = row.client_confirmed_fingerprint ?? null
    if ((fingerprint === null) !== (confirmedAt === null)) {
      return 'violates check constraint "confirmation_fingerprint_pairing"'
    }
  }

  if (table === 'client_knowledge_rollout_advance_requests') {
    const tokenHash = row.token_hash
    if (typeof tokenHash !== 'string' || !SHA256_HEX.test(tokenHash)) {
      return 'new row for relation "client_knowledge_rollout_advance_requests" violates check constraint "rollout_advance_token_hash_is_sha256_hex"'
    }
    if (lowerTrim(row.created_by_email) === lowerTrim(row.confirmer_email)) {
      return 'violates check constraint "rollout_advance_sender_is_not_confirmer"'
    }
    const expires = typeof row.expires_at === 'string' ? Date.parse(row.expires_at) : NaN
    const created = typeof row.created_at === 'string' ? Date.parse(row.created_at) : Date.now()
    if (!(expires > created)) {
      return 'violates check constraint "rollout_advance_expiry_in_future"'
    }
    const fromStage = row.from_stage
    const toStage = row.to_stage
    if (
      typeof fromStage === 'string' &&
      typeof toStage === 'string' &&
      Number(toStage) !== Number(fromStage) + 1
    ) {
      return 'violates check constraint "rollout_advance_is_one_step_forward"'
    }
    const leavingStage1 = fromStage === '1'
    const hasSampleCheck = row.sample_check !== null && row.sample_check !== undefined
    if (leavingStage1 !== hasSampleCheck) {
      return 'violates check constraint "rollout_advance_sample_check_required_leaving_stage_1"'
    }
  }

  return null
}

/** The append-only trigger on the confirmation-request table. */
function checkUpdateTrigger(table: string, oldRow: Row, newRow: Row): string | null {
  if (table === 'client_knowledge_rollout_advance_requests') {
    if (oldRow.status !== 'pending' && newRow.status !== oldRow.status) {
      return `client_knowledge_rollout_advance_requests: request ${String(oldRow.id)} is already ${String(oldRow.status)} and cannot change state again`
    }
    for (const immutable of ['token_hash', 'client_id', 'confirmer_email', 'from_stage', 'to_stage']) {
      if (immutable in newRow && JSON.stringify(newRow[immutable]) !== JSON.stringify(oldRow[immutable])) {
        return 'client_knowledge_rollout_advance_requests: token/stage/recipient are immutable after the link is issued'
      }
    }
    return null
  }
  if (table === 'client_knowledge_events') {
    // 🔴 照抄真实迁移的 append-only 触发器：没有任何例外，任何 UPDATE 一律拒绝。
    return `client_knowledge_events is append-only: rows cannot be updated (insert a new event instead)`
  }
  if (table !== 'client_knowledge_confirmation_requests') return null
  if (oldRow.status !== 'pending' && newRow.status !== oldRow.status) {
    return `client_knowledge_confirmation_requests: request ${String(oldRow.id)} is already ${String(oldRow.status)} and cannot change state again`
  }
  for (const immutable of ['token_hash', 'fact_fingerprints', 'client_id', 'confirmer_email']) {
    if (immutable in newRow && JSON.stringify(newRow[immutable]) !== JSON.stringify(oldRow[immutable])) {
      return 'client_knowledge_confirmation_requests: token/batch/recipient are immutable after the link is issued'
    }
  }
  return null
}

/**
 * Column DEFAULTs the real tables declare. Without these a fake insert leaves
 * `status` undefined, and every later `status === 'pending'` check silently
 * takes the wrong branch — a fake being more forgiving than Postgres in
 * exactly the direction that hides bugs.
 */
const COLUMN_DEFAULTS: Record<string, Row> = {
  client_knowledge_confirmation_requests: { status: 'pending', outcome: {}, confirmed_at: null },
  client_knowledge_facts: { status: 'candidate', scope: {}, evidence: {} },
  client_knowledge_confirmers: { revoked_at: null, revoked_by_email: null, registered_at: new Date().toISOString() },
  client_knowledge_events: { payload: {}, reason: null },
  client_knowledge_rollout_advance_requests: { status: 'pending', confirmed_at: null, sample_check: null },
}

type Predicate = (row: Row) => boolean

class Builder implements KnowledgeSelectBuilder, KnowledgeUpdateBuilder, KnowledgeInsertBuilder {
  private predicates: Predicate[] = []
  private orderCol: string | null = null
  private orderAsc = true
  private limitN: number | null = null
  private selectCalled = false

  constructor(
    private readonly db: FakeWriteSupabase,
    private readonly table: string,
    private readonly mode: 'select' | 'update' | 'insert',
    private readonly payload: Row | null,
  ) {}

  eq(column: string, value: unknown): this {
    this.predicates.push((row) => row[column] === value)
    return this
  }
  is(column: string, value: null): this {
    this.predicates.push((row) => (row[column] ?? null) === value)
    return this
  }
  in(column: string, values: readonly unknown[]): this {
    const set = new Set(values)
    this.predicates.push((row) => set.has(row[column]))
    return this
  }
  order(column: string, opts?: { ascending?: boolean }): this {
    this.orderCol = column
    this.orderAsc = opts?.ascending !== false
    return this
  }
  limit(n: number): this {
    this.limitN = n
    return this
  }
  select(_columns: string): this {
    this.selectCalled = true
    return this
  }

  then<TResult1 = KnowledgeWriteResult, TResult2 = never>(
    onfulfilled?: ((value: KnowledgeWriteResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected)
  }

  private run(): KnowledgeWriteResult {
    if (this.db.options.errorTables?.has(this.table)) {
      return { data: null, error: { message: `simulated failure on ${this.table}` } }
    }
    const rows = this.db.rowsFor(this.table)
    const enforce = this.db.options.enforceConstraints !== false

    if (this.mode === 'select') {
      let matched = rows.filter((row) => this.predicates.every((p) => p(row)))
      if (this.orderCol) {
        const col = this.orderCol
        const dir = this.orderAsc ? 1 : -1
        matched = [...matched].sort((a, b) => {
          const av = a[col]
          const bv = b[col]
          if (av === bv) return 0
          if (av === null || av === undefined) return -dir
          if (bv === null || bv === undefined) return dir
          return av < bv ? -dir : dir
        })
      }
      if (this.limitN !== null) matched = matched.slice(0, this.limitN)
      return { data: matched.map((row) => ({ ...row })), error: null }
    }

    if (this.mode === 'insert') {
      const row: Row = {
        id: `${this.table}-${rows.length + 1}`,
        created_at: this.db.stampCreatedAt(),
        ...(COLUMN_DEFAULTS[this.table] ?? {}),
        ...this.payload,
      }
      if (enforce) {
        const violation = checkConstraints(this.table, row)
        if (violation) return { data: null, error: { message: violation } }
        const duplicate = this.db.findUniqueViolation(this.table, row)
        if (duplicate) {
          return { data: null, error: { message: `duplicate key value violates unique constraint "${duplicate}"`, code: '23505' } }
        }
      }
      rows.push(row)
      // 🔴 真实 PostgREST：不接 .select() 就没有 data。
      return { data: this.selectCalled ? [{ ...row }] : null, error: null }
    }

    // update
    const matched = rows.filter((row) => this.predicates.every((p) => p(row)))
    for (const row of matched) {
      const next: Row = { ...row, ...this.payload }
      if (enforce) {
        const triggerError = checkUpdateTrigger(this.table, row, next)
        if (triggerError) return { data: null, error: { message: triggerError } }
        const violation = checkConstraints(this.table, next)
        if (violation) return { data: null, error: { message: violation } }
      }
    }
    for (const row of matched) Object.assign(row, this.payload)
    // 🔴 真实 PostgREST：匹配不到行不是错误，是空数组；不接 .select() 是 null。
    return { data: this.selectCalled ? matched.map((row) => ({ ...row })) : null, error: null }
  }
}

export class FakeWriteSupabase implements KnowledgeWriteClient {
  /** Ticks forward on every stamped row so insertion order always matches `created_at` order, even when `options.now` is frozen to a fixed instant across a whole test. */
  private stampCounterMs = 0

  constructor(
    private readonly tables: Record<string, Row[]>,
    readonly options: FakeWriteOptions = {},
  ) {}

  rowsFor(table: string): Row[] {
    const rows = this.tables[table]
    if (!rows) throw new Error(`fake supabase: unmodelled table "${table}"`)
    return rows
  }

  /**
   * `created_at` for a row inserted without one. Base clock is `options.now()` (or the
   * real clock) evaluated fresh each call, plus a strictly-increasing offset — so two
   * rows inserted back-to-back never tie even when `options.now` is a frozen constant,
   * regardless of which insert path (`.insert()` vs an RPC) wrote them.
   */
  stampCreatedAt(): string {
    const base = this.options.now?.() ?? new Date()
    const stamped = new Date(base.getTime() + this.stampCounterMs)
    this.stampCounterMs += 1
    return stamped.toISOString()
  }

  /** Only the unique indexes that actually exist on these tables. */
  findUniqueViolation(table: string, row: Row): string | null {
    if (table === 'client_knowledge_confirmation_requests') {
      const clash = this.tables[table].some((existing) => existing.token_hash === row.token_hash)
      return clash ? 'uq_client_knowledge_confirmation_requests_token' : null
    }
    if (table === 'client_knowledge_confirmers') {
      const clash = this.tables[table].some(
        (existing) =>
          existing.client_id === row.client_id &&
          lowerTrim(existing.confirmer_email) === lowerTrim(row.confirmer_email) &&
          (existing.revoked_at ?? null) === null,
      )
      return clash ? 'uq_client_knowledge_confirmers_active' : null
    }
    if (table === 'client_knowledge_rollout_advance_requests') {
      const clash = this.tables[table].some((existing) => existing.token_hash === row.token_hash)
      return clash ? 'uq_client_knowledge_rollout_advance_requests_token' : null
    }
    return null
  }

  from(table: string): KnowledgeWriteTable {
    this.rowsFor(table) // throw early on an unmodelled table
    return {
      select: (_columns: string) => new Builder(this, table, 'select', null).select(_columns),
      insert: (row: Row) => new Builder(this, table, 'insert', row),
      update: (fields: Row) => new Builder(this, table, 'update', fields),
    }
  }

  /**
   * Models `consume_knowledge_confirmation_request` — the one Postgres
   * function this module's write paths call. `rpcErrors` simulates the
   * function raising mid-transaction: real Postgres would roll the whole
   * call back, so this branch returns the error WITHOUT touching either
   * table — that's the exact property (all-or-nothing) the real migration
   * exists to guarantee, and what regression tests assert against.
   */
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<KnowledgeWriteResult> {
    return Promise.resolve(this.runRpc(fn, args))
  }

  private runRpc(fn: string, args: Record<string, unknown>): KnowledgeWriteResult {
    if (fn === 'consume_knowledge_rollout_advance_request') {
      return this.runConsumeRolloutAdvanceRpc(args)
    }
    if (fn !== 'consume_knowledge_confirmation_request') {
      throw new Error(`fake supabase: unmodelled rpc "${fn}"`)
    }
    if (this.options.rpcErrors?.has(fn)) {
      return { data: null, error: { message: `simulated failure inside rpc "${fn}" — no table touched` } }
    }

    const requests = this.rowsFor('client_knowledge_confirmation_requests')
    const facts = this.rowsFor('client_knowledge_facts')
    const request = requests.find((row) => row.id === args.p_request_id)
    if (!request || request.status !== 'pending') {
      return { data: [{ claimed: false }], error: null }
    }

    request.status = args.p_final_status
    request.confirmed_at = args.p_confirmed_at
    request.outcome = args.p_outcome

    for (const item of (args.p_confirmed as Array<{ fact_id: string; fingerprint: string | null }>) ?? []) {
      const fact = facts.find(
        (row) =>
          row.id === item.fact_id &&
          row.client_id === args.p_client_id &&
          row.status === 'approved' &&
          (row.client_confirmed_at ?? null) === null,
      )
      if (fact) {
        fact.client_confirmed_by_email = args.p_confirmer_email
        fact.client_confirmed_at = args.p_confirmed_at
        fact.client_confirmed_fingerprint = item.fingerprint
        fact.client_rejection_note = null
      }
    }

    for (const item of (args.p_rejected as Array<{ fact_id: string; note: string | null }>) ?? []) {
      const fact = facts.find(
        (row) => row.id === item.fact_id && row.client_id === args.p_client_id && row.status === 'approved',
      )
      if (fact) {
        fact.client_rejection_note = item.note?.trim() || '客户表示需要修改，未写原因'
      }
    }

    return { data: [{ claimed: true }], error: null }
  }

  /**
   * Models `consume_knowledge_rollout_advance_request` (issue #1648) — claim
   * the advance-request row AND insert the `client_knowledge_events` phase
   * event, atomically. `rpcErrors` simulates the function raising mid-
   * transaction: nothing is touched, same "all or nothing" property the
   * real migration's SECURITY DEFINER function guarantees.
   *
   * 🔴 2026-09-15 子牙+魏征联合复审：this fake used to only check
   * `status !== 'pending'` before writing the phase event — exactly the gap
   * the real RPC had (see the migration's own header comment for the attack
   * scenario: rollback supersedes a still-pending advance link). A fake more
   * lenient than the corrected real function would hide this exact class of
   * bug again, so this re-derives the client's ACTUAL current stage from
   * `client_knowledge_events` (same "latest row by created_at where
   * dimension='phase', no row = '0'" logic as `getCurrentRolloutStage`) and
   * refuses — WITHOUT writing anything, and WITHOUT flipping the request's
   * status — when it no longer matches the request's frozen `from_stage`.
   */
  private runConsumeRolloutAdvanceRpc(args: Record<string, unknown>): KnowledgeWriteResult {
    if (this.options.rpcErrors?.has('consume_knowledge_rollout_advance_request')) {
      return { data: null, error: { message: 'simulated failure inside rpc "consume_knowledge_rollout_advance_request" — no table touched' } }
    }

    const requests = this.rowsFor('client_knowledge_rollout_advance_requests')
    const events = this.rowsFor('client_knowledge_events')
    const request = requests.find((row) => row.id === args.p_request_id)
    if (!request || request.status !== 'pending') {
      return { data: [{ claimed: false, event_id: null, stale: false }], error: null }
    }

    const actualStage = this.actualPhaseValue(request.client_id)
    if (actualStage !== request.from_stage) {
      // 阶段已经被别的东西（典型：一键回退）改到跟这条请求冻死的 from_stage
      // 不一样了——拒绝，不写事件，也不把请求标记成终态（跟真实 RPC 一致）。
      return { data: [{ claimed: false, event_id: null, stale: true }], error: null }
    }

    request.status = 'confirmed'
    request.confirmed_at = args.p_confirmed_at

    const eventId = `client_knowledge_events-${events.length + 1}`
    events.push({
      id: eventId,
      client_id: request.client_id,
      dimension: 'phase',
      value: request.to_stage,
      reason: 'knowledge.rollout.stage_advanced',
      actor_email: request.created_by_email,
      payload: {
        clientId: request.client_id,
        fromStage: request.from_stage,
        toStage: request.to_stage,
        meSignerEmail: request.created_by_email,
        customerSignerEmail: request.confirmer_email,
        sampleCheck: request.sample_check ?? null,
        confirmedAt: args.p_confirmed_at,
        requestId: request.id,
      },
      created_at: this.stampCreatedAt(),
    })

    return { data: [{ claimed: true, event_id: eventId, stale: false }], error: null }
  }

  /** Same query shape as `getCurrentRolloutStage`: latest `dimension='phase'` row by `created_at`, no row = '0'. */
  private actualPhaseValue(clientId: unknown): string {
    const events = this.rowsFor('client_knowledge_events')
    const phaseEvents = events.filter((row) => row.client_id === clientId && row.dimension === 'phase')
    if (phaseEvents.length === 0) return '0'
    const latest = [...phaseEvents].sort((a, b) => {
      const at = typeof a.created_at === 'string' ? Date.parse(a.created_at) : 0
      const bt = typeof b.created_at === 'string' ? Date.parse(b.created_at) : 0
      return bt - at
    })[0]
    return typeof latest.value === 'string' ? latest.value : '0'
  }
}

export function createFakeWriteSupabase(tables: Record<string, Row[]>, options?: FakeWriteOptions): FakeWriteSupabase {
  return new FakeWriteSupabase(tables, options)
}
