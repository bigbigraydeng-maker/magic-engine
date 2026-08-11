/**
 * Kernel 的唯一数据访问层。
 *
 * 🔴 这个文件**不 import supabaseAdmin**。客户端由调用方注入。
 *    理由不是洁癖：Kernel 一旦自己抓着 service-role 客户端，
 *    「谁在什么授权下写了什么」就退化成「进程里任何地方都能写」。
 *    注入还让全部授权/幂等/重试逻辑能在内存里跑真实测试，
 *    不用把「授权闸有没有生效」寄托在生产库上。
 *
 * 🔴 **查询失败一律抛错，绝不 `return []`。**
 *    「查不到」和「查炸了」返回同一个值，是这个仓库反复踩的那个坑
 *    （静默失效 + 被 catch 吞掉 + 测试假件配合着一直绿）。
 *    授权层尤其不能这样：读不到 decision 就当没授权是对的，
 *    但读**炸了**也当没授权，会把一次数据库抖动变成一次静默的「什么都没做」。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ActionRun,
  ActionRunStep,
  AuthorizationDecision,
  ClientAutomationPolicy,
  RunStatus,
  StepStatus,
  VerificationResult,
} from './types'

export const TABLE_RUNS = 'action_runs'
export const TABLE_STEPS = 'action_run_steps'
export const TABLE_DECISIONS = 'authorization_decisions'
export const TABLE_POLICIES = 'client_automation_policies'

function fail(op: string, error: { message?: string } | null): never {
  throw new Error(`[kernel/store] ${op} 失败：${error?.message ?? '未知错误'}`)
}

/**
 * 唯一约束冲突 —— **这是正常的并发结果，不是故障。**
 *
 * 两个调用方同时提交同一件事时，数据库让其中一个赢，另一个撞约束。
 * 输的那个应该回头把赢家那行读出来返回，而不是抛一个 500 出去 ——
 * 「你们俩要做的是同一件事，那件事已经在做了」不是错误。
 */
export class UniqueViolationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UniqueViolationError'
  }
}

function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  return error?.code === '23505' || /duplicate key value violates unique constraint/.test(error?.message ?? '')
}

// ── 政策 ──────────────────────────────────────────────────────────────────────

const POLICY_COLUMNS =
  'id, client_id, action_key, mode, policy_version, spend_cap_per_run_usd, ' +
  'spend_cap_per_period_usd, spend_cap_period, decision_ttl_seconds, ' +
  'effective_from, effective_to, updated_by'

/**
 * 这条政策**此刻**生效吗。
 *
 * 🔴 判据是时间窗，不是「有没有结束时间」（C5）：
 *    `effective_from <= now < effective_to`。带结束时间但还没到期的政策
 *    一样是生效的 —— 用 `effective_to IS NULL` 当过滤条件，会把一条
 *    明明还在管事的政策当成「客户没配政策」。
 *    这个判定必须跟 `kernel_begin_authorized_run` 里的 SQL 完全一致。
 */
export function isPolicyActive(policy: ClientAutomationPolicy, now: Date): boolean {
  if (Date.parse(policy.effective_from) > now.getTime()) return false
  if (policy.effective_to && Date.parse(policy.effective_to) <= now.getTime()) return false
  return true
}

/**
 * 拿这个客户对这个动作现在生效的政策。
 *
 * 没有生效的行 = 没有政策 = **deny**（调用方负责把这一点变成一条 deny 决策）。
 * 多条候选时取 `effective_from` 最晚的那条（跟 RPC 的 ORDER BY 一致）。
 * 注意「没有行」和「读失败」在这里被严格分开：后者抛。
 */
export async function getActivePolicy(
  sb: SupabaseClient,
  clientId: string,
  actionKey: string,
  now: Date,
): Promise<ClientAutomationPolicy | null> {
  // 🔴 时间窗过滤必须发生在**数据库侧、截断之前**。
  //    早先是「先取最近 20 行、再在内存里挑」—— 客户排了 20+ 条未来生效的
  //    定时政策时，真正在生效的那条（effective_from 更早）会被截掉，
  //    应用层报「没配政策」而 RPC 却查得到它 —— 两边口径又分家了。
  const nowIso = now.toISOString()
  const { data, error } = await sb
    .from(TABLE_POLICIES)
    .select(POLICY_COLUMNS)
    .eq('client_id', clientId)
    .eq('action_key', actionKey)
    .lte('effective_from', nowIso)
    .or(`effective_to.is.null,effective_to.gt.${nowIso}`)
    .order('effective_from', { ascending: false })
    .limit(1)
  if (error) fail('读取客户自动化政策', error)

  return ((data ?? [])[0] as unknown as ClientAutomationPolicy | undefined) ?? null
}

/**
 * 这个客户对这个动作**曾经有过**、但现在已经到期的政策吗。
 *
 * 只用于把 deny 的理由说准（「规则过期了」vs「从来没配过规则」）——
 * 两句话引导人做的事不一样：前者是续一条，后者是新配一条。
 * 判据同样下推到数据库（effective_to <= now 的行存在即可），不受行数截断影响。
 */
export async function hasExpiredPolicy(
  sb: SupabaseClient,
  clientId: string,
  actionKey: string,
  now: Date,
): Promise<boolean> {
  const { data, error } = await sb
    .from(TABLE_POLICIES)
    .select('id')
    .eq('client_id', clientId)
    .eq('action_key', actionKey)
    .lte('effective_to', now.toISOString())
    .limit(1)
  if (error) fail('读取客户自动化政策历史', error)
  return ((data ?? []) as unknown as Array<{ id: string }>).length > 0
}

// ── Run ───────────────────────────────────────────────────────────────────────

const RUN_COLUMNS =
  'id, client_id, purpose, goal_id, execution_item_id, triggered_by, triggered_by_ref, ' +
  'action_key, action_version, input, rationale, evidence, idempotency_key, status, ' +
  'authorization_decision_id, correlation_id, cost_cap_usd, cost_estimate_usd, ' +
  'needs_human, last_error, ' +
  'claimed_by, claimed_at, heartbeat_at, lease_expires_at, ' +
  'previous_claimed_by, reclaim_count, last_reclaimed_at, claim_generation, ' +
  'created_at, updated_at, started_at, finished_at'

export async function findRunByIdempotencyKey(
  sb: SupabaseClient,
  clientId: string,
  idempotencyKey: string,
): Promise<ActionRun | null> {
  const { data, error } = await sb
    .from(TABLE_RUNS)
    .select(RUN_COLUMNS)
    .eq('client_id', clientId)
    .eq('idempotency_key', idempotencyKey)
    .limit(1)
  if (error) fail('按幂等键查已有执行', error)
  return ((data ?? [])[0] as unknown as ActionRun | undefined) ?? null
}

export async function getRun(sb: SupabaseClient, runId: string): Promise<ActionRun | null> {
  const { data, error } = await sb.from(TABLE_RUNS).select(RUN_COLUMNS).eq('id', runId).limit(1)
  if (error) fail('读取执行实例', error)
  return ((data ?? [])[0] as unknown as ActionRun | undefined) ?? null
}

export async function insertRun(
  sb: SupabaseClient,
  row: Partial<ActionRun> & Pick<ActionRun, 'client_id' | 'purpose' | 'action_key'>,
): Promise<ActionRun> {
  const { data, error } = await sb.from(TABLE_RUNS).insert(row).select(RUN_COLUMNS)
  // 撞唯一约束 = 另一个调用方刚刚抢先提交了同一件事。这是并发的正常结果，
  // 调用方应该回头读那一行（见 runner.submitActionRun），不是把它当故障。
  if (error && isUniqueViolation(error)) {
    throw new UniqueViolationError(`action_runs 幂等键冲突：${error.message}`)
  }
  if (error) fail('创建执行实例', error)
  const created = (data ?? [])[0] as unknown as ActionRun | undefined
  if (!created) fail('创建执行实例', { message: '插入成功但没拿回行' })
  return created
}

export async function updateRun(
  sb: SupabaseClient,
  runId: string,
  patch: Partial<ActionRun> & { status?: RunStatus },
): Promise<ActionRun> {
  const { data, error } = await sb
    .from(TABLE_RUNS)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', runId)
    .select(RUN_COLUMNS)
  if (error) fail('更新执行实例', error)
  const updated = (data ?? [])[0] as unknown as ActionRun | undefined
  if (!updated) fail('更新执行实例', { message: `没有匹配到 run ${runId}` })
  return updated
}

/**
 * 带状态守卫的 run 更新：只有 run **仍然**停在 expectedStatus 时才写。
 *
 * 🔴 用在人工路径的失败落地上。无条件的 update 会让一次迟到的「拒绝落库」
 *    把已经在跑（甚至已经跑完）的 run 拽回 denied —— 状态是别人赢来的，
 *    输家不许覆盖。返回 null = 守卫没命中（run 已被别人推进），调用方停手。
 */
export async function updateRunIf(
  sb: SupabaseClient,
  runId: string,
  expectedStatus: RunStatus,
  patch: Partial<ActionRun> & { status?: RunStatus },
): Promise<ActionRun | null> {
  const { data, error } = await sb
    .from(TABLE_RUNS)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', runId)
    .eq('status', expectedStatus)
    .select(RUN_COLUMNS)
  if (error) fail('条件更新执行实例', error)
  return ((data ?? [])[0] as unknown as ActionRun | undefined) ?? null
}

// ── 授权决策（append-only） ───────────────────────────────────────────────────

const DECISION_COLUMNS =
  'id, action_run_id, client_id, action_key, action_version, verdict, deny_code, reason, ' +
  'policy_snapshot, policy_id, policy_version, decided_by, decided_by_user, cost_cap_usd, ' +
  'cost_estimate_usd, idempotency_key, expires_at, consumed_at, consumed_by, created_at'

export async function insertDecision(
  sb: SupabaseClient,
  row: Omit<AuthorizationDecision, 'id' | 'created_at' | 'consumed_at' | 'consumed_by'> &
    Partial<Pick<AuthorizationDecision, 'id' | 'created_at'>>,
): Promise<AuthorizationDecision> {
  const { data, error } = await sb.from(TABLE_DECISIONS).insert(row).select(DECISION_COLUMNS)
  if (error) fail('写入授权决策', error)
  const created = (data ?? [])[0] as unknown as AuthorizationDecision | undefined
  if (!created) fail('写入授权决策', { message: '插入成功但没拿回行' })
  return created
}

export async function getDecision(
  sb: SupabaseClient,
  decisionId: string,
): Promise<AuthorizationDecision | null> {
  const { data, error } = await sb
    .from(TABLE_DECISIONS)
    .select(DECISION_COLUMNS)
    .eq('id', decisionId)
    .limit(1)
  if (error) fail('读取授权决策', error)
  return ((data ?? [])[0] as unknown as AuthorizationDecision | undefined) ?? null
}

/**
 * 原子领取「这个 run 的唯一执行权」（走 `kernel_begin_authorized_run` RPC）。
 *
 * 🔴 这里刻意**没有**「先兑换 decision、再把 run 改成 running」那两句 ——
 *    它们之间有竞态窗口。更关键的是：兑换的是决策，不是执行权。
 *    一个 run 理论上可以存在多条 allow 决策，各自原子地兑换各自那条，
 *    照样能让两个 capability 同时开跑。
 *
 *    所以锁的是 **run**：一个 run 从 authorized 进 running 只可能发生一次，
 *    而且只有 `run.authorization_decision_id` 当前指着的那条决策能兑换。
 *
 * 返回 `ok=false` 时 `reason` 是机器可读的（`already_consumed` / `stale_policy_version` /
 * `no_active_policy` / `decision_not_current` / …），由 Gateway 翻成人话。
 */
export interface BeginRunResult {
  ok: boolean
  reason: string
}

export async function beginAuthorizedRun(
  sb: SupabaseClient,
  runId: string,
  decisionId: string,
  workerId: string,
  /** 🔴 F1：兑换授权也要出示自己那一代 —— 授权一旦被消费就再也签不回来。 */
  expectedGeneration?: number | null,
): Promise<BeginRunResult> {
  const { data, error } = await sb.rpc('kernel_begin_authorized_run', {
    p_run_id: runId,
    p_decision_id: decisionId,
    p_worker_id: workerId,
    p_expected_generation: expectedGeneration ?? null,
  })
  if (error) fail('领取执行权', error)
  const row = (data ?? [])[0] as unknown as { ok: boolean; reason: string } | undefined
  // 🔴 拿不到返回行不能当成「成功」。RPC 一定会返回一行；返回不了说明调用本身有问题。
  if (!row) fail('领取执行权', { message: 'RPC 没有返回结果行' })
  return { ok: Boolean(row.ok), reason: String(row.reason ?? 'unknown') }
}

/**
 * 人工批准 / 拒绝的原子状态转换（走 `kernel_resolve_pending_approval` RPC）。
 *
 * 🔴 批准和拒绝抢的是**同一把 run 行锁**：谁先锁到谁说了算。
 *    输的一方拿到机器可读的 reason（not_pending / decision_not_current / …），
 *    绝不覆盖赢家写下的状态 —— 这条 RPC 是「capability 不会被人工双击执行两次」
 *    的唯一保证，应用层的 preflight 只负责把话说人话。
 */
export interface ResolveApprovalResult {
  ok: boolean
  reason: string
  decisionId: string | null
}

export async function resolvePendingApproval(
  sb: SupabaseClient,
  args: {
    runId: string
    pendingDecisionId: string
    resolution: 'approve' | 'reject'
    resolvedBy: string
    reason: string
    policySnapshot: Record<string, unknown>
    costEstimateUsd: number | null
  },
): Promise<ResolveApprovalResult> {
  const { data, error } = await sb.rpc('kernel_resolve_pending_approval', {
    p_run_id: args.runId,
    p_pending_decision_id: args.pendingDecisionId,
    p_resolution: args.resolution,
    p_resolved_by: args.resolvedBy,
    p_reason: args.reason,
    p_policy_snapshot: args.policySnapshot,
    p_cost_estimate_usd: args.costEstimateUsd,
  })
  if (error) fail('人工批准/拒绝', error)
  const row = (data ?? [])[0] as unknown as
    | { ok: boolean; reason: string; decision_id: string | null }
    | undefined
  if (!row) fail('人工批准/拒绝', { message: 'RPC 没有返回结果行' })
  return { ok: Boolean(row.ok), reason: String(row.reason ?? 'unknown'), decisionId: row.decision_id ?? null }
}

/**
 * 恢复权的原子领取（走 `kernel_claim_run_recovery` RPC）。
 *
 * 🔴 跟人工批准是同一类竞态：两个操作者都看到 denied/dead_letter，
 *    晚到的那个如果无条件 update，就能把赢家已经推进到 running/succeeded 的 run
 *    改回 queued 并再签一份 allow → capability 做第二遍。
 *
 *    RPC 里锁 run + 双 CAS（状态仍是那个终态 / 指针仍是看到的那条决策），
 *    死信的步骤重置也在同一个事务里 —— 不留「步骤放回待跑但 run 还是死信」的半恢复态。
 */
export type RecoveryKind = 'denied' | 'dead_letter'

export interface ClaimRecoveryResult {
  ok: boolean
  reason: string
}

export async function claimRunRecovery(
  sb: SupabaseClient,
  args: {
    runId: string
    expectedDecisionId: string | null
    kind: RecoveryKind
    actor: string
    reason: string
  },
): Promise<ClaimRecoveryResult> {
  const { data, error } = await sb.rpc('kernel_claim_run_recovery', {
    p_run_id: args.runId,
    p_expected_decision_id: args.expectedDecisionId,
    p_recovery_kind: args.kind,
    p_actor: args.actor,
    p_reason: args.reason,
  })
  if (error) fail('领取恢复权', error)
  const row = (data ?? [])[0] as unknown as { ok: boolean; reason: string } | undefined
  if (!row) fail('领取恢复权', { message: 'RPC 没有返回结果行' })
  return { ok: Boolean(row.ok), reason: String(row.reason ?? 'unknown') }
}

/**
 * 中间态 run 的运行所有权：领租约 / 接管（走 `kernel_claim_or_takeover_run` RPC）。
 *
 * 🔴 这是「已经有人在做了」这句话的**唯一依据**。
 *    没有它，进程在 queued / authorizing / authorized 崩掉之后，
 *    幂等唯一键会把这件事永久锁死 —— 相同请求永远只拿到 in_progress，
 *    而实际上没有任何人在推进它。
 *
 *    领不到（`already_owned`）= 真的还有一个活着的 owner，这才配叫 in_progress。
 */
export interface ClaimOrTakeoverResult {
  ok: boolean
  /** `claimed` / `taken_over` / `already_owned:<owner>` / `not_claimable:<status>` / … */
  reason: string
  /** 领到的那一刻 run 的状态（决定接下来是复用授权还是重新授权）。 */
  runStatus: string | null
  /** 领到的那一刻 run 当前指着的决策。authorized 时用来复用授权。 */
  decisionId: string | null
  /** 是不是**从别人手里**接走的（自己续租不算）。 */
  reclaimed: boolean
  reclaimCount: number
  /** 🔴 领到的那一代。之后所有推进性写入都要出示它。 */
  claimGeneration: number
  /** 接管的是一个正在跑的 run —— 没跑成的步骤已经在同一个事务里放回待跑了。 */
  resetSteps: boolean
}

export async function claimOrTakeoverRun(
  sb: SupabaseClient,
  args: {
    runId: string
    ownerId: string
    leaseSeconds: number
    /** 续租 / 再进一次时带上自己那一代 —— 对不上就领不到（防旧调用复活）。 */
    expectedGeneration?: number | null
  },
): Promise<ClaimOrTakeoverResult> {
  const { data, error } = await sb.rpc('kernel_claim_or_takeover_run', {
    p_run_id: args.runId,
    p_owner_id: args.ownerId,
    p_lease_seconds: args.leaseSeconds,
    p_expected_generation: args.expectedGeneration ?? null,
  })
  if (error) fail('领取运行所有权', error)
  const row = (data ?? [])[0] as unknown as
    | {
        ok: boolean
        reason: string
        run_status: string | null
        decision_id: string | null
        reclaimed: boolean
        reclaim_count: number
        claim_generation: number | null
        reset_steps: boolean
      }
    | undefined
  if (!row) fail('领取运行所有权', { message: 'RPC 没有返回结果行' })
  return {
    ok: Boolean(row.ok),
    reason: String(row.reason ?? 'unknown'),
    runStatus: row.run_status ?? null,
    decisionId: row.decision_id ?? null,
    reclaimed: Boolean(row.reclaimed),
    reclaimCount: Number(row.reclaim_count ?? 0),
    claimGeneration: Number(row.claim_generation ?? 0),
    resetSteps: Boolean(row.reset_steps),
  }
}

/**
 * 落一条拒绝 + 推 run 状态，**一个事务**（走 `kernel_record_fenced_deny`）。
 *
 * 🔴 不能「先插决策、再 update run」：preflight 是有耗时的，A 卡在那儿的时候
 *    租约可能已经过期、B 已经接管并跑完了。A 醒过来接着落拒绝 ——
 *    无条件的 update 会把 succeeded 改成 denied，当场毁掉一次已经成功的执行。
 *    先插后判还会留下孤立的 deny 决策，所以插入之前就在锁里把代际验掉。
 */
export interface FencedDenyResult {
  ok: boolean
  reason: string
  decisionId: string | null
}

export async function recordFencedDeny(
  sb: SupabaseClient,
  args: {
    runId: string
    expectedGeneration?: number | null
    expectedStatus?: RunStatus | null
    reason: string
    decision: Record<string, unknown>
  },
): Promise<FencedDenyResult> {
  const { data, error } = await sb.rpc('kernel_record_fenced_deny', {
    p_run_id: args.runId,
    p_expected_generation: args.expectedGeneration ?? null,
    p_expected_status: args.expectedStatus ?? null,
    p_decision: args.decision,
    p_reason: args.reason,
  })
  if (error) fail('落拒绝决策', error)
  const row = (data ?? [])[0] as unknown as { ok: boolean; reason: string; decision_id: string | null } | undefined
  if (!row) fail('落拒绝决策', { message: 'RPC 没有返回结果行' })
  return { ok: Boolean(row.ok), reason: String(row.reason ?? 'unknown'), decisionId: row.decision_id ?? null }
}

/**
 * 把一条 run 原子地停到「等人处理」的终态（走 `kernel_park_for_human`）。
 *
 * 🔴 用在「接管了一条正在跑的付费 run，而 provider 不保证幂等重放」那条路上。
 *    只返回一个内存里的 dead_letter 是**安全假象**：领取 RPC 这时已经把 run
 *    重置成 queued + 写了新租约，租约一过期，下一次同键提交就会重新授权、
 *    再调一次 handler，钱可能被扣第二次。必须真的落库。
 */
export async function parkRunForHuman(
  sb: SupabaseClient,
  args: { runId: string; expectedGeneration: number | null; reason: string; evidenceKey?: string },
): Promise<{ ok: boolean; reason: string }> {
  const { data, error } = await sb.rpc('kernel_park_for_human', {
    p_run_id: args.runId,
    p_expected_generation: args.expectedGeneration,
    p_reason: args.reason,
    p_evidence_key: args.evidenceKey ?? 'parked_for_human',
  })
  if (error) fail('停到等人处理', error)
  const row = (data ?? [])[0] as unknown as { ok: boolean; reason: string } | undefined
  if (!row) fail('停到等人处理', { message: 'RPC 没有返回结果行' })
  return { ok: Boolean(row.ok), reason: String(row.reason ?? 'unknown') }
}

/**
 * handler 跑着的时候续租（走 `kernel_renew_lease`）。
 *
 * 🔴 四项 CAS：run 存在 · owner 还是我 · 代际还是我这一代 · 状态还是 running。
 *    任何一项不成立 = 我已经失去了执行权，调用方必须当场停手，
 *    **不许再把执行结果当自己的提交**。
 */
export async function renewLease(
  sb: SupabaseClient,
  args: { runId: string; ownerId: string; expectedGeneration: number; leaseSeconds: number },
): Promise<{ ok: boolean; reason: string }> {
  const { data, error } = await sb.rpc('kernel_renew_lease', {
    p_run_id: args.runId,
    p_owner_id: args.ownerId,
    p_expected_generation: args.expectedGeneration,
    p_lease_seconds: args.leaseSeconds,
  })
  if (error) fail('续租', error)
  const row = (data ?? [])[0] as unknown as { ok: boolean; reason: string } | undefined
  if (!row) fail('续租', { message: 'RPC 没有返回结果行' })
  return { ok: Boolean(row.ok), reason: String(row.reason ?? 'unknown') }
}

// ── Step ──────────────────────────────────────────────────────────────────────

const STEP_COLUMNS =
  'id, run_id, client_id, step_key, step_index, status, claimed_by, claimed_at, heartbeat_at, ' +
  'attempt, reclaim_count, next_attempt_at, output, verification, cost_actual_usd, last_error, ' +
  'claim_generation, ' +
  'created_at, updated_at, started_at, finished_at'

export async function listSteps(sb: SupabaseClient, runId: string): Promise<ActionRunStep[]> {
  const { data, error } = await sb
    .from(TABLE_STEPS)
    .select(STEP_COLUMNS)
    .eq('run_id', runId)
    .order('step_index', { ascending: true })
  if (error) fail('读取执行步骤', error)
  return (data ?? []) as unknown as ActionRunStep[]
}

/**
 * 把这个 run 的步骤行补齐（已存在的不动）。
 *
 * 断点续跑靠的就是这个：步骤行是**一个 run 一份**，重跑时已完成的行还在，
 * 带着它们的 output —— 不是「重新建一批然后跳过前几个」。
 */
/**
 * 建齐这条 run 的步骤（走 `kernel_ensure_run_steps` RPC）。
 *
 * 🔴 **必须走 RPC，不能在这里裸 INSERT。** 少了代际闸就有一个窗口：
 *    A 已经拿到授权、卡在建步骤之前，租约过期，B 接管（代际 +1）。
 *    A 醒过来仍然能插一批**带旧代际**的步骤行 —— 而步骤写入的守卫只看
 *    step 自己那一列，于是 A 拿着自己造的行继续调 handler，整套 fencing 被绕过。
 *
 * 返回 null = 代际已经不是自己那一代了（被接管），调用方必须停手。
 */
export async function ensureSteps(
  sb: SupabaseClient,
  runId: string,
  clientId: string,
  stepKeys: readonly string[],
  claimGeneration: number,
): Promise<ActionRunStep[] | null> {
  const { data, error } = await sb.rpc('kernel_ensure_run_steps', {
    p_run_id: runId,
    p_client_id: clientId,
    p_step_keys: [...stepKeys],
    p_expected_generation: claimGeneration,
  })
  if (error) fail('创建执行步骤', error)
  const row = (data ?? [])[0] as unknown as { ok: boolean; reason: string } | undefined
  if (!row) fail('创建执行步骤', { message: 'RPC 没有返回结果行' })
  if (!row.ok) {
    if (String(row.reason).startsWith('stale_generation')) return null
    fail('创建执行步骤', { message: String(row.reason) })
  }
  return listSteps(sb, runId)
}

/**
 * 🔴 **带代际守卫的步骤写入（F1）。**
 *
 * 过期的执行者手里握着有效的 `step_id`，普通的「按 id 更新」它照写不误 ——
 * 产物、花费、状态全都会被一个已经没有执行权的进程覆盖掉。
 * 加一句 `AND claim_generation = ?`，它就只能影响 0 行。
 *
 * 返回 null = 被 fence 掉了（不是「行不存在」）。调用方必须停手，
 * 绝不能把它当成一次成功的写入。
 */
export async function updateStepFenced(
  sb: SupabaseClient,
  stepId: string,
  expectedGeneration: number,
  patch: Partial<Omit<ActionRunStep, 'verification'>> & {
    status?: StepStatus
    verification?: VerificationResult | null
  },
): Promise<ActionRunStep | null> {
  const { data, error } = await sb
    .from(TABLE_STEPS)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', stepId)
    .eq('claim_generation', expectedGeneration)
    .select(STEP_COLUMNS)
  if (error) fail('更新执行步骤（带代际守卫）', error)
  return ((data ?? [])[0] as unknown as ActionRunStep | undefined) ?? null
}

/**
 * 🔴 带代际守卫的 run 写入（F1）。同上：返回 null = 被 fence 掉了。
 */
export async function updateRunFenced(
  sb: SupabaseClient,
  runId: string,
  expectedGeneration: number,
  patch: Partial<ActionRun> & { status?: RunStatus },
): Promise<ActionRun | null> {
  const { data, error } = await sb
    .from(TABLE_RUNS)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', runId)
    .eq('claim_generation', expectedGeneration)
    .select(RUN_COLUMNS)
  if (error) fail('更新执行实例（带代际守卫）', error)
  return ((data ?? [])[0] as unknown as ActionRun | undefined) ?? null
}

export async function updateStep(
  sb: SupabaseClient,
  stepId: string,
  patch: Partial<Omit<ActionRunStep, 'verification'>> & {
    status?: StepStatus
    verification?: VerificationResult | null
  },
): Promise<ActionRunStep> {
  const { data, error } = await sb
    .from(TABLE_STEPS)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', stepId)
    .select(STEP_COLUMNS)
  if (error) fail('更新执行步骤', error)
  const updated = (data ?? [])[0] as unknown as ActionRunStep | undefined
  if (!updated) fail('更新执行步骤', { message: `没有匹配到 step ${stepId}` })
  return updated
}

/**
 * 原子认领一个待跑步骤（走 `kernel_claim_run_step` RPC）。
 *
 * 形状原样提取自 `factory_claim_work_order` —— `FOR UPDATE SKIP LOCKED`，
 * 全仓唯一并发正确的认领实现。`clientIds` 白名单本身是一个授权维度。
 */
export interface ClaimedStep {
  step_id: string
  run_id: string
  client_id: string
  step_key: string
  attempt: number
}

export async function claimNextStep(
  sb: SupabaseClient,
  workerId: string,
  clientIds: string[] | null,
): Promise<ClaimedStep | null> {
  const { data, error } = await sb.rpc('kernel_claim_run_step', {
    p_worker_id: workerId,
    p_client_ids: clientIds,
  })
  if (error) fail('认领执行步骤', error)
  const row = (data ?? [])[0] as
    | { ok: boolean; step_id: string; run_id: string; client_id: string; step_key: string; attempt: number }
    | undefined
  if (!row || !row.ok) return null
  return {
    step_id: row.step_id,
    run_id: row.run_id,
    client_id: row.client_id,
    step_key: row.step_key,
    attempt: row.attempt,
  }
}

// ── 死信（下发给人的入口） ────────────────────────────────────────────────────

export async function listDeadLetterRuns(
  sb: SupabaseClient,
  sinceIso: string,
): Promise<ActionRun[]> {
  const { data, error } = await sb
    .from(TABLE_RUNS)
    .select(RUN_COLUMNS)
    .in('status', ['dead_letter', 'pending_approval', 'denied'])
    .eq('needs_human', true)
    .gte('updated_at', sinceIso)
    .order('updated_at', { ascending: false })
    .limit(50)
  if (error) fail('读取需要人处理的执行', error)
  return (data ?? []) as unknown as ActionRun[]
}
