/**
 * 提交 → 授权 → 执行 的编排。
 *
 * 这是 Kernel 对外的**唯一入口**。业务侧要让系统做一件事，只能提交一个
 * action_run；不能自己去调 capability，也不能自己去写业务表。
 *
 * 幂等的判定在**提交阶段**，不在执行阶段：同一把键已经成功跑完过，
 * 连授权都不会重签一次。授权是有审计成本的东西，重复签发会把审计表
 * 变成噪音，也会让「这次执行是谁批的」出现两个答案。
 */

import type {
  ActionPurpose,
  ActionRun,
  AuthorizationDecision,
  AuthorizedExecutionContext,
  TriggeredBy,
} from './types'
import type { KernelDeps } from './deps'
import type { ExecutionResult } from './gateway'
import { KernelError } from './errors'
import { authorizeRun, reuseLiveAuthorization } from './authorize'
import { approveRun, rejectRun } from './human-approval'
import { executeAuthorizedRun, rehydrateSucceededRun, type ExecutionFence } from './gateway'
import { computeIdempotencyKey, computeUnknownActionKey } from './idempotency'
import {
  claimOrTakeoverRun,
  parkRunForHuman,
  claimRunRecovery,
  findRunByIdempotencyKey,
  getDecision,
  insertRun,
  listSteps,
  updateRun,
  updateStep,
  UniqueViolationError,
  type RecoveryKind,
} from './store'

export interface SubmitActionInput {
  clientId: string
  actionKey: string
  purpose: ActionPurpose
  goalId?: string | null
  executionItemId?: string | null
  triggeredBy: TriggeredBy
  triggeredByRef?: string | null
  input: Record<string, unknown>
  /** 为什么做这件事（一句话，人话）。 */
  rationale?: string | null
  /** 依据什么。形状通用，词汇不属于任何域。 */
  evidence?: Record<string, unknown>
  correlationId?: string
}

export interface SubmitResult {
  run: ActionRun
  /** 这次提交撞上了一个已经存在的 run（同客户 + 同幂等键）。 */
  existing: boolean
}

/** 提交一次执行请求。幂等键相同 → 拿回同一个 run，不新建。 */
export async function submitActionRun(
  deps: KernelDeps,
  input: SubmitActionInput,
): Promise<SubmitResult> {
  // growth 必须挂目标；非 growth 挂了目标也拒绝。
  // 数据库有同样的双向 CHECK —— 这里先说人话，别让 PM 看到一条约束名。
  const hasGoal = Boolean(input.goalId)
  if (input.purpose === 'growth' && !hasGoal) {
    throw new KernelError(
      'INVALID_INPUT',
      '这是一件为客户增长做的事，必须说清它服务哪个目标',
    )
  }
  if (input.purpose !== 'growth' && hasGoal) {
    throw new KernelError(
      'INVALID_INPUT',
      `「${input.purpose}」类任务不该挂在某个增长目标下 —— 为了让它挂上而编一个目标，正是我们要防的事`,
    )
  }

  // 🔴 C4：Goal 必须属于**同一个客户**。只验证「目标存在」拦不住
  //    「A 客户的 run 挂 B 客户的目标」—— 那会把 lineage 串台到别的客户身上。
  //    数据库还有一道复合外键兜底（fk_action_runs_goal_same_client），
  //    这里先拦是为了把话说人话，而不是抛一条外键约束名。
  if (input.goalId) {
    const { data, error } = await deps.supabase
      .from('goals')
      .select('id, client_id')
      .eq('id', input.goalId)
      .limit(1)
    // 读失败必须炸 —— 当成「目标不存在」会把一次数据库抖动变成一条错误的拒绝
    if (error) throw new Error(`[kernel] 校验目标归属失败：${error.message}`)
    const goal = ((data ?? []) as unknown as Array<{ id: string; client_id: string }>)[0]
    if (!goal) {
      throw new KernelError('INVALID_INPUT', '这条动作挂的目标不存在，可能已经被删了 —— 重新选一个目标')
    }
    if (goal.client_id !== input.clientId) {
      throw new KernelError(
        'CROSS_CLIENT',
        '安全告警：这条动作挂的目标不属于这个客户 —— 已阻止（跨客户的执行记录会把两个客户的数据串在一起）',
        { detail: { goalId: input.goalId, goalClient: goal.client_id, runClient: input.clientId } },
      )
    }
  }

  // 🔴 S2：执行看板卡片也必须属于**同一个客户**。跟 goalId 完全同一个洞：
  //    挂错客户的卡片 = 执行按 A 的授权跑，lineage / 看板关系却挂到 B，
  //    归因和「这件事为谁做的」当场串台。数据库还有复合外键兜底。
  if (input.executionItemId) {
    const { data, error } = await deps.supabase
      .from('execution_items')
      .select('id, client_id')
      .eq('id', input.executionItemId)
      .limit(1)
    // 读失败必须炸 —— 当成「卡片不存在」会把一次数据库抖动变成一条错误的拒绝
    if (error) throw new Error(`[kernel] 校验执行卡片归属失败：${error.message}`)
    const item = ((data ?? []) as unknown as Array<{ id: string; client_id: string }>)[0]
    if (!item) {
      throw new KernelError(
        'INVALID_INPUT',
        '这条动作挂的执行卡片不存在，可能已经被删了 —— 重新选一张卡片',
      )
    }
    if (item.client_id !== input.clientId) {
      throw new KernelError(
        'CROSS_CLIENT',
        '安全告警：这条动作挂的执行卡片不属于这个客户 —— 已阻止（跨客户的执行记录会把两个客户的数据串在一起）',
        { detail: { executionItemId: input.executionItemId, itemClient: item.client_id, runClient: input.clientId } },
      )
    }
  }

  const definition = deps.registry.get(input.actionKey)

  // 未知动作也要有稳定身份，否则每天会新增一条一模一样的拒绝记录
  const idempotencyKey = definition
    ? computeIdempotencyKey(definition, input.clientId, input.input)
    : computeUnknownActionKey(input.actionKey, input.clientId, input.input)

  const existing = await findRunByIdempotencyKey(deps.supabase, input.clientId, idempotencyKey)
  if (existing) return { run: existing, existing: true }

  const run = await insertRunHandlingRace(deps, input, idempotencyKey, definition?.version ?? 0)
  return run
}

/**
 * 插入 run，并把「唯一约束冲突」当成**正常的并发结果**处理。
 *
 * 🔴 先 SELECT 再 INSERT 不是原子幂等：两个调用方可以同时查到「没有」，
 *    然后同时插。数据库的 `UNIQUE(client_id, idempotency_key)` 会让其中一个赢，
 *    输的那个必须**回头把赢家那行读出来返回** —— 而不是把一次正常竞争抛成 500。
 *    真正保证「只跑一次」的是这条唯一约束 + `kernel_begin_authorized_run`
 *    的原子执行权领取，不是那句 SELECT。
 */
async function insertRunHandlingRace(
  deps: KernelDeps,
  input: SubmitActionInput,
  idempotencyKey: string,
  actionVersion: number,
): Promise<SubmitResult> {
  try {
    const created = await insertRunRow(deps, input, idempotencyKey, actionVersion)
    return { run: created, existing: false }
  } catch (err) {
    if (!(err instanceof UniqueViolationError)) throw err
    const winner = await findRunByIdempotencyKey(deps.supabase, input.clientId, idempotencyKey)
    if (!winner) {
      // 撞了约束却读不到那一行 —— 这不是并发，是数据不一致，必须炸出来。
      throw new KernelError(
        'INVALID_STATE',
        '这件事的提交撞上了重复，但又读不回已有的那一条 —— 库里状态不一致，先别继续',
        { detail: { idempotencyKey } },
      )
    }
    return { run: winner, existing: true }
  }
}

async function insertRunRow(
  deps: KernelDeps,
  input: SubmitActionInput,
  idempotencyKey: string,
  actionVersion: number,
): Promise<ActionRun> {
  return insertRun(deps.supabase, {
    client_id: input.clientId,
    purpose: input.purpose,
    goal_id: input.goalId ?? null,
    execution_item_id: input.executionItemId ?? null,
    triggered_by: input.triggeredBy,
    triggered_by_ref: input.triggeredByRef ?? null,
    action_key: input.actionKey,
    // 未知动作记 0 版 —— 它不会被执行，但拒绝记录里得看得出「当时没有版本」
    action_version: actionVersion,
    input: input.input,
    rationale: input.rationale ?? null,
    evidence: input.evidence ?? {},
    idempotency_key: idempotencyKey,
    status: 'queued',
    ...(input.correlationId ? { correlation_id: input.correlationId } : {}),
  })
}

/**
 * 这一次推进的租约身份。
 *
 * 🔴 每一次「我要来推进这条 run」都是一个**独立的 owner**，
 *    哪怕它们在同一个进程里。共用进程身份的话，同进程的两个并发调用
 *    会互相被当成「自己续租」而同时放行 —— 租约那道锁就形同虚设。
 */
let claimSeq = 0
function nextOwnerId(deps: KernelDeps): string {
  claimSeq += 1
  return `${deps.ownerId}#${claimSeq}`
}

export type ActionOutcomeKind =
  | 'succeeded'
  | 'idempotent_hit'
  /**
   * 这件事已经有人在做了（另一个并发调用正拿着它）。
   * 🔴 不是错误，也不是「什么都没发生」—— 调用方拿到的是**同一个 run**，
   *    只是这一次不由它来推进。
   */
  | 'in_progress'
  | 'pending_approval'
  | 'denied'
  | 'dead_letter'

export interface ActionRunOutcome {
  kind: ActionOutcomeKind
  run: ActionRun
  decision: AuthorizationDecision | null
  execution: ExecutionResult | null
  /** 给人看的一句话 —— 直接能进今日待办。 */
  humanReason: string | null
}

/**
 * 走完一条动作：提交 → 授权 → （放行才）执行。
 *
 * 🔴 每一个分支都落库、都有人话理由。没有「静默什么都没做」这个出口。
 */
export async function runAction(
  deps: KernelDeps,
  input: SubmitActionInput,
): Promise<ActionRunOutcome> {
  const submitted = await submitActionRun(deps, input)

  // 已经有定论的 run（做完 / 等审批 / 被拒 / 死信）直接如实回答，不再往下走
  const settled = await outcomeForSettledRun(deps, submitted.run)
  if (settled) return settled

  return driveIntermediateRun(deps, submitted.run.id)
}

/**
 * run 已经有定论了吗。有 → 如实回答；没有（还在中间态）→ null，由调用方继续推进。
 *
 * 抽出来是因为**两个地方要用同一套判据**：提交之后的第一次判断，
 * 以及领运行所有权失败（`not_claimable:<status>`）之后的复查 ——
 * 后者意味着「期间被别人推进到了另一个状态」，此时必须按**新状态**回答，
 * 不能一律说「已经有人在做了」。
 */
async function outcomeForSettledRun(
  deps: KernelDeps,
  run: ActionRun,
): Promise<ActionRunOutcome | null> {
  // 幂等命中：已经做完的事不再做第二遍，capability 一次都不调。
  // 🔴 但返回的必须是**第一次的真实结果**（产物 + 验证），不是一个空壳 ——
  //    调用方丢了首次响应重试时，拿到 null 等于逼它自己去翻步骤表。
  //    历史数据对不上契约时 rehydrate 会抛错（fail closed），不假装成功。
  if (run.status === 'succeeded') {
    return {
      kind: 'idempotent_hit',
      run,
      decision: null,
      execution: await rehydrateSucceededRun(deps, run),
      humanReason: '这件事之前已经做过了，没有重复做（返回的是第一次的结果）',
    }
  }

  // 已经在等人点头 / 已经被拒 —— 不重新授权，避免审计表里出现两个答案
  if (run.status === 'pending_approval') {
    return { kind: 'pending_approval', run, decision: null, execution: null, humanReason: '这条还在等你点头' }
  }
  if (run.status === 'denied' || run.status === 'dead_letter') {
    return {
      kind: run.status === 'denied' ? 'denied' : 'dead_letter',
      run,
      decision: null,
      execution: null,
      humanReason: run.last_error,
    }
  }

  // 🔴 `failed` / `superseded` 也是终态。Kernel 现在不写它们，但 CHECK 允许，
  //    接管 RPC 也会对它们回 `not_claimable`。不认的话，共用件会抛 INVALID_STATE ——
  //    等于把一个「这件事早结束了」抛给点了同意的人。宁可说人话。
  if (run.status === 'failed' || run.status === 'superseded') {
    return {
      kind: 'dead_letter',
      run,
      decision: null,
      execution: null,
      humanReason:
        run.last_error ??
        (run.status === 'superseded'
          ? '这条动作已经被另一条取代了，不会再跑'
          : '这条动作之前失败了，需要人看一眼'),
    }
  }

  // 🔴 `running` **不在这里早退**。
  //
  //    早先这里直接答「正在做」，于是 SQL 那边虽然允许接管租约已过期的 running，
  //    实际上永远走不到 —— 执行者崩在半路，这条 run 就永远停在 running，
  //    调用方永远只拿到 in_progress。接管入口形同虚设。
  //
  //    现在它跟其他三个中间态一样往下走：租约还活着 → 领不到 → 才答 in_progress；
  //    租约过期 → 允许接管。判据只有一个 —— **有没有一个没过期的 owner**。
  return null
}

/**
 * 推进一条**中间态**的 run（queued / authorizing / authorized）。
 *
 * 🔴 T1 的核心：先**原子领取运行所有权**，再决定自己推不推。
 *
 *    早先这里是「已经存在的 run 一律返回 in_progress」。那句话有个致命前提：
 *    「已经存在」意味着有人在推进它。可进程会崩 —— run 停在 queued / authorizing /
 *    authorized，没有 worker、没有清扫器，而幂等唯一键让相同请求再也插不进来。
 *    结果是幂等键把这件事**永久锁死**，调用方永远只拿到 in_progress。
 *
 *    现在 in_progress 只在两种情况下出现：
 *      ① 租约还没过期（`already_owned`）—— 真的还有一个活着的 owner；
 *      ② run 已经进 running —— 执行权已被原子领走。
 *    其余情况一律允许显式接管。
 *
 *    租约同时也是「同一时刻只有一个人在签授权」的那把锁：
 *    没有它，两个调用方能同时给一条 queued 的 run 各签一份 allow。
 */
async function driveIntermediateRun(
  deps: KernelDeps,
  runId: string,
): Promise<ActionRunOutcome> {
  const ownerId = nextOwnerId(deps)
  const claim = await claimOrTakeoverRun(deps.supabase, {
    runId,
    ownerId,
    leaseSeconds: deps.leaseSeconds,
  })

  if (!claim.ok) return outcomeForFailedClaim(deps, runId, claim.reason)

  // 领到了。拿最新一行（带上刚写下的租约和代际）。
  const owned = await deps.requireRun(runId)

  // 🔴 接管的是一条**正在跑**的 run（上一个执行者崩在 handler 调用中途）——
  //    这跟「收费步骤抛出结果未知的异常」是**同一个场景**：
  //    我们不知道 provider 那边到底做没做、扣没扣。
  //    所以处置也必须一样：provider 不保证幂等重放时，**不许自动重跑**，
  //    转人工判断。否则同一个 PR 里一边用 UNSAFE_RETRY 挡住重试、
  //    一边让接管路径把 handler 又调一遍，自相矛盾。
  //
  //    只在真的接管了 running 时才判（claim.resetSteps）；
  //    零成本 / provider 认幂等键的动作不受影响。
  if (claim.resetSteps) {
    const blocked = await parkTakeoverForHuman(deps, owned, claim.claimGeneration)
    if (blocked) return blocked
  }
  // 🔴 F1：从这里往后每一次推进性写入都出示这一代。
  //    被接管之后这一代就作废了 —— 写不进去，也不会覆盖接管者的结果。
  const fence: ExecutionFence = { ownerId, generation: claim.claimGeneration }

  // 🔴 停在 authorized、且当前那份 allow 还活着 → **复用它，不重新签**。
  //    重新签会让同一件事在审计表里出现两个「谁批的」。
  //    过期 / 不可复用时返回 null，走下面完整的重新授权。
  if (owned.status === 'authorized') {
    const reused = await reuseLiveAuthorization(deps, owned)
    if (reused?.ctx) return executeAndWrap(deps, reused.decision, reused.ctx, fence)
  }

  const auth = await authorizeRun(deps, owned, fence)

  if (auth.verdict === 'deny') {
    return { kind: 'denied', run: auth.run, decision: auth.decision, execution: null, humanReason: auth.decision.reason }
  }
  if (auth.verdict === 'require_approval' || !auth.ctx) {
    return {
      kind: 'pending_approval',
      run: auth.run,
      decision: auth.decision,
      execution: null,
      humanReason: auth.decision.reason,
    }
  }

  return executeAndWrap(deps, auth.decision, auth.ctx, fence)
}

/**
 * 接管一条**跑到一半**的 run 时，能不能直接重跑？
 *
 * 🔴 上一个执行者是崩在 handler 调用中途的 —— 结果未知，跟「收费步骤抛出
 *    结果未知的异常」是同一个场景。provider 不保证幂等重放时，重跑可能
 *    再收一次钱（内部动作）或再对外做一遍（对外动作），所以一律 fail closed，转人工。
 *
 * 返回 null = 可以接着跑（provider 认幂等键；或非对外的零成本动作）。
 * 对外动作不看成本 —— 零成本的对外动作一样要转人工。
 */
/**
 * 接管了一条**正在跑**的付费或对外 run，而 provider 不保证幂等重放 → 停到「等人处理」。
 *
 * 🔴 **必须真的落库，不能只返回一个内存里的 dead_letter。**
 *
 *    领取 RPC 这时**已经**把 run 重置成 queued 并写了新租约。只返回不落库的话，
 *    数据库里那条 run 仍然是「可以继续自动推进」的样子 —— 等这次租约一过期，
 *    下一次同幂等键提交就会从 queued 重新授权、再调一次 handler，钱可能被扣第二次。
 *    那样这道闸就是**装饰性**的。
 *
 *    `kernel_park_for_human` 在当前这一代的围栏下原子地：
 *    推 dead_letter + needs_human + 清租约。dead_letter 不在接管白名单里，
 *    所以之后只能走**显式的人工恢复**回到 queued。
 */
async function parkTakeoverForHuman(
  deps: KernelDeps,
  run: ActionRun,
  generation: number,
): Promise<ActionRunOutcome | null> {
  const definition = deps.registry.get(run.action_key)
  if (!definition) return null // 认不出的动作由授权层去拒，不在这里判
  if (definition.providerIdempotency === 'supported') return null

  // 🔴 对外动作：重放的风险是「外部世界已经发生的写入」被再做一遍
  //    （重复发帖、重复改客户资产），跟这一步花不花钱无关 ——
  //    零成本的对外动作一样不能被接管重跑。付费的非对外动作维持原判据。
  const isOutward = definition.sideEffect === 'outward'
  const mightCost =
    definition.costModel.estimate(run.input) > 0 ||
    Object.values(definition.costModel.stepCeilingUsd ?? {}).some((v) => Number(v) > 0)
  if (!isOutward && !mightCost) return null

  const humanReason = isOutward
    ? `上一个执行者在跑「${definition.title}」的中途没了，而这个动作会写到客户资产之外、` +
      `它的外部服务又不保证「同一把幂等键重放不会重复执行」—— ` +
      `系统不敢自动重跑（可能再做一遍）。请人工确认那边到底做没做，再决定重跑还是作废。`
    : `上一个执行者在跑「${definition.title}」的中途没了，而这个动作会花钱、` +
      `它的外部服务又不保证「同一把幂等键重放不会重复收费」—— ` +
      `系统不敢自动重跑（可能再扣一次）。请人工确认那边到底做没做、扣没扣，再决定重跑还是作废。`

  const parked = await parkRunForHuman(deps.supabase, {
    runId: run.id,
    expectedGeneration: generation,
    reason: humanReason,
    evidenceKey: 'parked_unsafe_takeover',
  })
  if (!parked.ok) {
    // 代际对不上 = 我已经被接管了，连「把它钉成终态」都不该由我来做
    throw new KernelError(
      'STALE_CLAIM',
      '这次执行的所有权已经被别人接管了（你手里那一代已经作废）—— 已停手，不会重复做',
      { detail: { runId: run.id, generation, reason: parked.reason } },
    )
  }

  return {
    kind: 'dead_letter',
    run: await deps.requireRun(run.id),
    decision: null,
    execution: null,
    humanReason,
  }
}

/**
 * 领不到运行所有权之后，**如实回答现在到底是什么状况**。
 *
 * 🔴 不能一律答 `in_progress`。领不到分两类：
 *    · `already_owned:*` —— 真的还有一个活着的 owner，答「正在做」是对的；
 *    · `not_claimable:<终态>` —— 期间已经跑完 / 死信 / 被拒了。
 *      这时答「正在做」等于告诉调用方事情还在进行，而它其实已经结束了 ——
 *      成功的产物和失败的原因都拿不到。
 *
 * 抽成共用件是因为 `runAction` 和 `approveAndRun` 都要用；
 * 两处各写一份必然分家（`approveAndRun` 早先就是无条件 in_progress）。
 */
async function outcomeForFailedClaim(
  deps: KernelDeps,
  runId: string,
  reason: string,
): Promise<ActionRunOutcome> {
  const fresh = await deps.requireRun(runId)

  if (reason.startsWith('already_owned')) {
    return {
      kind: 'in_progress',
      run: fresh,
      decision: null,
      execution: null,
      humanReason: '这件事已经有人在做了，这次不重复做',
    }
  }

  // `not_claimable:<status>` —— 期间被推进到了另一个状态，按新状态如实回答
  const settled = await outcomeForSettledRun(deps, fresh)
  if (settled) return settled

  throw new KernelError(
    'INVALID_STATE',
    '这条动作的状态在这次操作期间变过了，没能接手 —— 刷新后再看',
    { detail: { runId, reason, status: fresh.status } },
  )
}

async function executeAndWrap(
  deps: KernelDeps,
  decision: AuthorizationDecision,
  ctx: AuthorizedExecutionContext,
  fence: ExecutionFence,
): Promise<ActionRunOutcome> {
  const execution = await executeAuthorizedRun(deps, ctx, fence)
  return {
    kind: execution.status === 'succeeded' ? 'succeeded' : 'dead_letter',
    run: execution.run,
    decision,
    execution,
    humanReason: execution.failure?.humanReason ?? null,
  }
}

/**
 * 人点了同意之后接着跑。
 *
 * 注意这里**重新签了一条决策**（`decided_by='human'`），
 * 而不是把原来那条 require_approval 改成 allow —— 决策表是 append-only。
 */
export async function approveAndRun(
  deps: KernelDeps,
  runId: string,
  approvedByUser: string,
): Promise<ActionRunOutcome> {
  const auth = await approveRun(deps, runId, approvedByUser)
  if (auth.verdict !== 'allow' || !auth.ctx) {
    return {
      kind: 'denied',
      run: auth.run,
      decision: auth.decision,
      execution: null,
      humanReason: auth.decision.reason,
    }
  }

  // 🔴 T1：批准是原子的（RPC 里只有一个人能签），但**批准和执行是两件事**。
  //    签完之后这条 run 就是一条无主的 authorized —— 不领运行所有权的话，
  //    并发的 runAction 会同时接管它，两边各跑一遍授权重读。
  //    （真正的双执行还有 kernel_begin_authorized_run 兜底，但白跑一趟没必要。）
  //    领不到 = 已经有活着的 owner 在推进它，如实说，不硬抢。
  const approverOwnerId = nextOwnerId(deps)
  const claim = await claimOrTakeoverRun(deps.supabase, {
    runId,
    ownerId: approverOwnerId,
    leaseSeconds: deps.leaseSeconds,
  })
  //    🔴 P2-2：领不到分两类。`already_owned` 才是「正在做」；
  //    `not_claimable:<终态>` 说明期间已经跑完 / 死信 / 被拒 ——
  //    那时候必须把**真实的终态和产物**给点了同意的人，而不是让他一直看到「进行中」。
  if (!claim.ok) {
    const settled = await outcomeForFailedClaim(deps, runId, claim.reason)
    return { ...settled, decision: settled.decision ?? auth.decision }
  }

  return executeAndWrap(deps, auth.decision, auth.ctx, {
    ownerId: approverOwnerId,
    generation: claim.claimGeneration,
  })
}

/**
 * 把「领到恢复权之后」的那一段共用逻辑抽出来。
 *
 * 恢复权已经原子领到了（run 现在是 queued、指针已清、**租约也已清空**），
 * 接下来走的是**跟第一次完全相同的那条路** —— 恢复之后世界可能已经变了
 * （客户把规则改成禁止、规则被删、契约升版），必须重新过全部闸。
 *
 * 🔴 T1：恢复提交（事务已提交）和重新授权之间还有一个崩溃窗口。
 *    走同一条 `driveIntermediateRun` 就是为了覆盖它 ——
 *    先领运行所有权，崩在这之后租约会过期，这条 queued 还能被别人接走；
 *    而不是变成一条永远没人推进、相同请求又插不进来的僵尸。
 */
async function authorizeAndRunRecovered(
  deps: KernelDeps,
  runId: string,
): Promise<ActionRunOutcome> {
  return driveIntermediateRun(deps, runId)
}

/** 把 RPC 的机器可读原因翻成人话。认不出的一律当失败，没有「默认放过」。 */
function recoveryFailureToError(reason: string, kind: RecoveryKind): KernelError {
  const head = reason.split(':')[0]
  switch (head) {
    case 'not_recoverable':
      return new KernelError(
        'INVALID_STATE',
        `这条动作现在是「${reason.split(':')[1] ?? '未知'}」—— 已经有人先恢复了，或者它正在跑 / 已经跑完，这次恢复没有生效`,
        { detail: { reason, kind } },
      )
    case 'decision_not_current':
      return new KernelError(
        'INVALID_STATE',
        '这条动作的状态在你操作期间变过了（可能已经被别人恢复），请刷新后再看',
        { detail: { reason, kind } },
      )
    case 'human_reject_not_recoverable':
      return new KernelError(
        'NOT_AUTHORIZED',
        '这条是有人明确点了「不做」的 —— 系统不替人改主意。要做的话请重新排一条',
        { detail: { reason } },
      )
    case 'deny_code_not_recoverable':
      return new KernelError(
        'NOT_AUTHORIZED',
        `这条被拒的原因是「${reason.split(':')[1] ?? '未知'}」—— 那是这次提交本身的问题，改条件救不了它，请修正后重新排一条`,
        { detail: { reason } },
      )
    case 'deny_decision_missing':
    case 'not_a_deny':
    case 'decision_not_found':
    case 'decision_run_mismatch':
      return new KernelError(
        'INVALID_STATE',
        '找不到当初拒绝这条动作的记录，说不清它为什么被拒 —— 不能凭空恢复，请重新排一条',
        { detail: { reason } },
      )
    default:
      return new KernelError('INVALID_STATE', `这次恢复没有生效（${reason}）`, { detail: { reason } })
  }
}

/**
 * 死信重跑 —— **断点续跑**的入口。
 *
 * 🔴 已经成功的步骤原样保留（连同它们的产物和**已经花掉的钱**），只把没跑成的放回待跑。
 *    这跟「整条重来」是两件事：重来会把已经写出去的东西再写一遍，
 *    而 Kernel 的幂等承诺是「同一件事只做一次」。
 *
 * 🔴 恢复权是**原子领取**的（`kernel_claim_run_recovery`）：状态 CAS + 指针 CAS +
 *    步骤重置在同一个数据库事务里。两个人同时重跑只有一个赢，
 *    而且晚到的那个绝不能把已经 running/succeeded 的 run 拽回 queued。
 *
 * 重跑必须由人发起并留下是谁发起的 —— 死信意味着系统自己已经放弃过一次，
 * 不该再由系统自己决定要不要再试。
 */
export async function resumeDeadLetterRun(
  deps: KernelDeps,
  runId: string,
  resumedByUser: string,
  reason = '人工重跑',
): Promise<ActionRunOutcome> {
  const run = await deps.requireRun(runId)
  if (run.status !== 'dead_letter') {
    throw new KernelError(
      'INVALID_STATE',
      `这条动作现在是「${run.status}」，不是停手待查的状态，不用重跑`,
    )
  }

  const claimed = await claimRunRecovery(deps.supabase, {
    runId,
    expectedDecisionId: run.authorization_decision_id,
    kind: 'dead_letter',
    actor: resumedByUser,
    reason,
  })
  if (!claimed.ok) throw recoveryFailureToError(claimed.reason, 'dead_letter')

  return authorizeAndRunRecovered(deps, runId)
}

/**
 * 哪些拒绝是**修好条件之后可以重新授权**的（C3）。
 *
 * 🔴 白名单，不是黑名单。判据：拒绝的原因是不是「环境问题」——
 *    政策没配 / 过期 / 改过、预算上限后来被提高 —— 这些修好之后同一件事
 *    理应能做；而「参数不对 / 动作不认识 / 对外副作用 / 用途不符」是
 *    **这次提交本身**的问题，重新授权一万次结论也一样，必须重新排一条新的。
 *
 * 🔴 这份清单在数据库的 `kernel_claim_run_recovery` 里还有一份（真正的强制在那边）。
 *    有一条架构测试盯着两边一字不差 —— 两处各写一份清单必然分家。
 */
export const RECOVERABLE_DENY_CODES: ReadonlySet<string> = new Set([
  'no_policy',
  'policy_expired',
  'policy_changed_since_request',
  'over_cost_cap',
  // 对外动作被配成了「自动执行」。规则改成「要审批」之后同一件事就能做了 ——
  // 所以它属于「环境问题」这一类。🔴 结构性的 outward_side_effect_blocked
  // **不在**这份清单里，那一条是动作定义本身不合规，改条件救不了。
  'outward_requires_human_policy',
])

/**
 * 可恢复的 deny → 显式重新授权（C3）。
 *
 * 背景：第一次因「客户没配规则」被拒后，人按待办去把规则配好了 ——
 * 但同样的输入再提交会命中同一把幂等键，直接拿回旧的 denied，永远好不了。
 *
 * 🔴 四条边界，一条都不许松：
 *    ① **普通重复提交不会走到这里** —— runAction 对 denied 仍然只返回旧结果。
 *       恢复必须是一次显式动作，带着是谁、为什么。
 *    ② 旧的 deny 决策**原样保留**（append-only 本来也改不了）——
 *       重新授权是新签一条，不是改写历史。
 *    ③ 只有白名单里的拒绝码能恢复；人明确点过「不做」的（decided_by='human'）
 *       不能被这条路悄悄翻案 —— 那要人自己改主意，不是系统替他改。
 *    ④ 恢复权是**原子领取**的：两个人同时恢复只有一个赢，
 *       输的那个绝不能把赢家已经推进的 run 拽回去。
 *
 * run id / 幂等键保持不变 —— 恢复的是**同一件事**，不是另一件。
 * 下面这些应用层检查只是为了**把话说人话**；真正的强制在 RPC 里，两边都测。
 */
export async function recoverDeniedRun(
  deps: KernelDeps,
  runId: string,
  recoveredByUser: string,
  reason: string,
): Promise<ActionRunOutcome> {
  const run = await deps.requireRun(runId)
  if (run.status !== 'denied') {
    throw new KernelError(
      'INVALID_STATE',
      `这条动作现在是「${run.status}」，不是被拒绝的状态，不用恢复`,
    )
  }

  // 拿当初拒绝它的那条决策 —— 只为把「为什么不能恢复」说清楚
  const denyDecision = run.authorization_decision_id
    ? await getDecision(deps.supabase, run.authorization_decision_id)
    : null
  if (!denyDecision || denyDecision.verdict !== 'deny') {
    throw new KernelError(
      'INVALID_STATE',
      '找不到当初拒绝这条动作的记录，说不清它为什么被拒 —— 不能凭空恢复，请重新排一条',
    )
  }
  if (denyDecision.decided_by === 'human') {
    throw new KernelError(
      'NOT_AUTHORIZED',
      `这条是 ${denyDecision.decided_by_user} 明确点了「不做」的 —— 系统不替人改主意。要做的话请重新排一条`,
    )
  }
  if (!denyDecision.deny_code || !RECOVERABLE_DENY_CODES.has(denyDecision.deny_code)) {
    throw new KernelError(
      'NOT_AUTHORIZED',
      `这条被拒的原因是「${denyDecision.deny_code ?? '未知'}」—— 那是这次提交本身的问题，改条件救不了它，请修正后重新排一条`,
      { detail: { denyCode: denyDecision.deny_code } },
    )
  }

  const claimed = await claimRunRecovery(deps.supabase, {
    runId,
    expectedDecisionId: run.authorization_decision_id,
    kind: 'denied',
    actor: recoveredByUser,
    reason,
  })
  if (!claimed.ok) throw recoveryFailureToError(claimed.reason, 'denied')

  return authorizeAndRunRecovered(deps, runId)
}

/** 人点了不做。 */
export async function rejectPendingRun(
  deps: KernelDeps,
  runId: string,
  rejectedByUser: string,
  reason: string,
): Promise<ActionRunOutcome> {
  const auth = await rejectRun(deps, runId, rejectedByUser, reason)
  return {
    kind: 'denied',
    run: auth.run,
    decision: auth.decision,
    execution: null,
    humanReason: auth.decision.reason,
  }
}
