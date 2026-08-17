/**
 * Authorization —— DAPE 的 A(uthorization) 段。
 *
 * 🔴 这一段的目标是**减少**审批，不是制造审批（ADR-001）：
 *    低风险 + 已预批准 → 自动跑；超阈值或中高风险 → 等人点；
 *    未注册 / 禁止 → 拒绝。**默认 deny**。
 *
 * 🔴 「默认 deny」的实现是「查不到政策行 = 拒绝」，不是给 mode 一个默认值。
 *    默认值会让「忘了配」和「明确配成自动」在库里长得一模一样。
 *
 * 这个文件是**唯一**能造出 `AuthorizedExecutionContext` 的地方。
 * 但它造出来的东西也不是通行证 —— Gateway 会把每一条授权事实
 * 从 append-only 的决策表里重读一遍再比对（见 gateway.ts）。
 */

import type {
  ActionDefinition,
  ActionRun,
  AuthorizationDecision,
  AuthorizedExecutionContext,
  ClientAutomationPolicy,
  DenyCode,
  Verdict,
} from './types'
import type { KernelDeps } from './deps'
import { validateAgainstSchema } from './registry'
import { outwardBlockReason } from './outward-authorization'
import {
  getActivePolicy,
  getDecision,
  hasExpiredPolicy,
  insertDecision,
  recordFencedDeny,
  resolvePendingApproval,
  updateRun,
  updateRunFenced,
} from './store'
import { KernelError } from './errors'

/**
 * 🔴 `kernel_record_fenced_deny` 里**只读返回、一个字没写**的那几条原因。
 *
 *    共同点：run 仍然停在 `pending_approval` —— 那件事还等着人点。
 *    所以它们一律翻成 `STALE_DECISION`（非终态），**不许**压成 `INVALID_STATE`。
 *    清单跟 `human-approval.ts` 的 `PENDING_INCONSISTENT_REASONS` 同源，
 *    有一条一致性测试盯着两边不许分家。
 */
export const PENDING_NOT_TERMINAL_REASONS: ReadonlySet<string> = new Set([
  'decision_not_current',
  'pending_identity_mismatch',
  'pending_run_mismatch',
  'pending_not_found',
  'not_require_approval',
])

export interface AuthorizationOutcome {
  verdict: Verdict
  decision: AuthorizationDecision
  run: ActionRun
  /** 只有 verdict === 'allow' 时才有。其余情况拿不到执行凭证。 */
  ctx: AuthorizedExecutionContext | null
}

/** 政策快照 —— 判定当时的样子。政策后来改了也能复盘「当时凭什么放行」。 */
/** @internal 供 human-approval.ts 用 —— 不是对外 API。 */
export function snapshotOf(
  policy: ClientAutomationPolicy | null,
  definition: ActionDefinition | null,
): Record<string, unknown> {
  return {
    policy: policy
      ? {
          id: policy.id,
          mode: policy.mode,
          policy_version: policy.policy_version,
          spend_cap_per_run_usd: policy.spend_cap_per_run_usd,
          spend_cap_per_period_usd: policy.spend_cap_per_period_usd,
          spend_cap_period: policy.spend_cap_period,
          decision_ttl_seconds: policy.decision_ttl_seconds,
          effective_from: policy.effective_from,
        }
      : null,
    definition: definition
      ? {
          action_key: definition.actionKey,
          version: definition.version,
          risk: definition.risk,
          side_effect: definition.sideEffect,
          reversible: definition.reversible,
          capability: definition.capability,
          required_tier: definition.requiredCapabilityTier,
          // 🔴 对外动作的**授权依据**必须进快照，否则 append-only 的决策记录
          //    说不清「这次凭什么允许它对外写」—— 而契约后来改过之后，
          //    再回头看就只剩一个 side_effect: 'outward'，等于没有依据。
          //    非对外动作是 null（它们本来就没有这份依据）。
          outward_authorization: definition.outwardAuthorization
            ? {
                declared_in: definition.outwardAuthorization.declaredIn,
                requires_human_approval: definition.outwardAuthorization.requiresHumanApproval,
                rollback: definition.outwardAuthorization.rollback,
              }
            : null,
          // 决定「收费步骤结果未知时能不能自动重试」—— 复盘时必须看得见当时声明的是什么
          provider_idempotency: definition.providerIdempotency,
          // 每步成本上界。🔴 只取这一个字段，**不放整个 costModel** ——
          //    里面的 estimate 是函数，JSON 存不住（会变成 undefined 被悄悄丢掉）。
          step_ceiling_usd: definition.costModel.stepCeilingUsd
            ? { ...definition.costModel.stepCeilingUsd }
            : null,
        }
      : null,
  }
}

/**
 * 🔴 全仓唯一一处把普通对象抬成 `AuthorizedExecutionContext` 的地方。
 *
 * 架构测试 `no forged authorized contexts` 会扫全仓，
 * 除本文件外任何地方出现同形状的类型断言都直接判失败。
 */
/** @internal 供 human-approval.ts 用 —— 不是对外 API。 */
export function mintContext(
  decision: AuthorizationDecision,
  costCapUsd: number | null,
): AuthorizedExecutionContext {
  return {
    decisionId: decision.id,
    runId: decision.action_run_id,
    clientId: decision.client_id,
    actionKey: decision.action_key,
    actionVersion: decision.action_version,
    policyVersion: decision.policy_version,
    costCapUsd,
    idempotencyKey: decision.idempotency_key,
    expiresAt: decision.expires_at,
  } as unknown as AuthorizedExecutionContext
}

export interface DenyArgs {
  run: ActionRun
  definition: ActionDefinition | null
  policy: ClientAutomationPolicy | null
  code: DenyCode
  reason: string
  costEstimate: number | null
  /**
   * 🔴 只在 run **仍然**停在这个状态时才落 denied。
   *    人工批准的失败路径必须带上它（'pending_approval'）——
   *    不带的话，一次迟到的「批不了」会把并发赢家已经推进 running 的 run
   *    拽回 denied。守卫没命中 = 别人赢了，这里抛错停手，绝不覆盖。
   */
  onlyIfStatus?: ActionRun['status']
  /**
   * 🔴 审批人当时看到的那份审批请求的 id（见 `HumanDecisionOptions`）。
   *
   *    人工批准的**失败落地**必须带上它，一路传进数据库锁内的 CAS。
   *    只有 `onlyIfStatus: 'pending_approval'` 是不够的：它只保证这条 run
   *    还没被批准或拒绝过，**保证不了**它没有在期间被重新排成**另一份**
   *    待审批请求 —— 那时状态照样是 pending_approval，而一次迟到的「批不了」
   *    会把那份新的、还没人看过的请求直接盖成 denied。
   */
  expectedDecisionId?: string | null
  /**
   * 🔴 F2：推进这条 run 的那一代。
   *    授权前置校验（读政策、读注册表）是有耗时的 —— A 卡在那儿的时候租约可能
   *    已经过期、B 已经接管并把这件事跑完了。A 醒过来接着落拒绝，
   *    无条件的 update 会把 succeeded 改成 denied，**当场毁掉一次已经成功的执行**。
   */
  fence?: { generation: number }
}

/**
 * 落一条拒绝 + 推 run 状态。
 *
 * 🔴 两件事必须在**一个事务**里（`kernel_record_fenced_deny`）：
 *    先插决策、再判代际的话，代际对不上时会留下一条孤立的 deny 决策 ——
 *    run 状态没跟着变，审计表里多一条说不清归属的记录。
 */
/** @internal 供 human-approval.ts 用 —— 不是对外 API。 */
export async function recordDeny(deps: KernelDeps, args: DenyArgs): Promise<AuthorizationOutcome> {
  const written = await recordFencedDeny(deps.supabase, {
    runId: args.run.id,
    expectedGeneration: args.fence?.generation ?? null,
    expectedStatus: args.onlyIfStatus ?? null,
    expectedDecisionId: args.expectedDecisionId ?? null,
    reason: args.reason,
    decision: {
      client_id: args.run.client_id,
      action_key: args.run.action_key,
      action_version: args.run.action_version,
      deny_code: args.code,
      policy_snapshot: snapshotOf(args.policy, args.definition),
      policy_id: args.policy?.id ?? null,
      policy_version: args.policy?.policy_version ?? null,
      decided_by: 'policy',
      decided_by_user: null,
      cost_cap_usd: args.policy?.spend_cap_per_run_usd ?? null,
      cost_estimate_usd: args.costEstimate,
      idempotency_key: args.run.idempotency_key,
    },
  })

  if (!written.ok) {
    if (written.reason.startsWith('stale_generation')) {
      throw new KernelError(
        'STALE_CLAIM',
        '这次执行的所有权已经被别人接管了（你手里那一代已经作废）—— 已停手，不会重复做',
        { detail: { runId: args.run.id, denyCode: args.code, reason: written.reason } },
      )
    }
    // 🔴 **锁内的这几条都是「只读返回、一个字没写」—— 全都不是终态。**（Codex P2）
    //
    //    `decision_not_current` = 期间被重新排成了另一份待审批请求；
    //    另外四条 = 锚的身份对不上（库里数据不一致）。
    //    两类的共同点是：run **仍然停在 `pending_approval`**，那件事还等着人点。
    //    压成 `INVALID_STATE`（→ 接口的 `not_pending`）等于告诉界面「已经有结论了」，
    //    界面会把一条还活着的待办从列表里抹掉 —— 从此没有人看得见它，
    //    也没有人会去修它。那正是铁律里「发现不许死在日志里」的那种烂尾。
    if (PENDING_NOT_TERMINAL_REASONS.has(written.reason)) {
      throw new KernelError(
        'STALE_DECISION',
        `这条动作指着的那份审批请求对不上或已经不是最新的（${written.reason}）——` +
          '这次操作没有生效，也没有改动任何东西。它仍然停在「等人点头」',
        { detail: { runId: args.run.id, denyCode: args.code, reason: written.reason } },
      )
    }
    throw new KernelError(
      'INVALID_STATE',
      '这条动作刚刚已经被别人处理了（批准或拒绝发生在你前面），这次操作没有生效',
      { detail: { runId: args.run.id, denyCode: args.code, reason: written.reason } },
    )
  }

  const decision = await getDecision(deps.supabase, written.decisionId!)
  if (!decision) {
    throw new KernelError('INVALID_STATE', '刚落下的拒绝决策读不回来 —— 库里状态不一致，先别继续')
  }
  const run = await deps.requireRun(args.run.id)
  return { verdict: 'deny', decision, run, ctx: null }
}

// ── 授权前置校验（authorizeRun 与 approveRun 共用同一套） ────────────────────

/**
 * 🔴 这一段是 P1-1 的核心：**人工批准和自动放行必须过同一套闸。**
 *
 * 早先 `approveRun` 只检查「run 是不是在等审批」，于是等审批期间：
 * 政策被删掉 / 政策从「要审批」改成「禁止」/ 契约升版 / 输入已不合法 /
 * 动作被改成对外副作用 —— 人一点同意，全都被绕过去了。
 * 最阴的一种是政策被删：签出来的决策 `policy_version = null`，
 * Gateway 重读也拿到 null，`null === null` 直接放行。
 *
 * 所以两条路走同一个 `preflight`，谁都不能少判一项。
 */
type PreflightResult =
  | {
      ok: true
      definition: ActionDefinition
      policy: ClientAutomationPolicy
      costEstimate: number
      costCap: number
    }
  | {
      ok: false
      code: DenyCode
      reason: string
      definition: ActionDefinition | null
      policy: ClientAutomationPolicy | null
      costEstimate: number | null
    }

/** @internal 供 human-approval.ts 用 —— 不是对外 API。 */
export async function preflight(deps: KernelDeps, run: ActionRun, now: Date): Promise<PreflightResult> {
  const bad = (
    code: DenyCode,
    reason: string,
    definition: ActionDefinition | null = null,
    policy: ClientAutomationPolicy | null = null,
    costEstimate: number | null = null,
  ): PreflightResult => ({ ok: false, code, reason, definition, policy, costEstimate })

  // ① 认不认识这个动作。认不出 → deny，且必须留痕。
  const definition = deps.registry.get(run.action_key)
  if (!definition) {
    return bad(
      'unknown_action',
      `「${run.action_key}」不是系统认识的动作 —— 没有人给它定过风险、幂等和验证方式，所以不能跑。要么它该被实现，要么这条建议本身提错了`,
    )
  }

  // ② 版本。授权是给「这个版本的契约」签的，不能拿旧版授权跑新版实现。
  if (definition.version !== run.action_version) {
    return bad(
      'unknown_action_version',
      `这条动作是按第 ${run.action_version} 版契约排的，系统现在跑的是第 ${definition.version} 版 —— 契约变过，得重新排一次`,
      definition,
    )
  }

  // ③ 输入结构。
  const schemaCheck = validateAgainstSchema(definition.inputSchema, run.input)
  if (!schemaCheck.ok) {
    return bad('invalid_input', `这条动作的参数不对：${schemaCheck.reason}`, definition)
  }

  // ④ purpose。同一个动作不许一会儿算增长、一会儿算维护。
  if (!definition.allowedPurposes.includes(run.purpose)) {
    return bad(
      'purpose_not_allowed',
      `这个动作只能作为「${definition.allowedPurposes.join('/')}」类任务提交，这条提交的是「${run.purpose}」`,
      definition,
    )
  }

  // ⑤ 🔴 对外副作用：**默认拒绝**，除非这个动作逐条说清了它凭什么可以对外写。
  //    判据在 outward-authorization.ts，Gateway 执行前会拿同一个判据再判一次。
  //    没有全局开关、没有环境变量旁路 —— 放宽的唯一方式是给某个动作补一份完整声明。
  const outwardBlocked = outwardBlockReason(definition)
  if (outwardBlocked) {
    return bad('outward_side_effect_blocked', outwardBlocked, definition)
  }

  // ⑥ 客户政策。**查不到 = 拒绝。**
  const policy = await getActivePolicy(deps.supabase, run.client_id, run.action_key, now)
  const costEstimate = definition.costModel.estimate(run.input)
  if (!policy) {
    // getActivePolicy 已按时间窗过滤（C5）—— 走到这里就是真没有生效的规则。
    // 但「规则到期了」和「从来没配过」要分开说：前者该续一条，后者该新配一条。
    const expired = await hasExpiredPolicy(deps.supabase, run.client_id, run.action_key, now)
    if (expired) {
      return bad('policy_expired', '这个客户的自动化规则已经过期了，需要重新设一条', definition, null, costEstimate)
    }
    return bad(
      'no_policy',
      `这个客户还没有为「${definition.title}」设过自动化规则（也可能是刚被删掉了）—— 没有规则就是不许做，需要先在设置里给它一个规则`,
      definition,
      null,
      costEstimate,
    )
  }
  if (policy.mode === 'deny') {
    return bad(
      'policy_deny',
      `这个客户明确关掉了「${definition.title}」的自动执行`,
      definition,
      policy,
      costEstimate,
    )
  }

  // ⑥b 🔴 对外动作**永远**要人点头 —— `auto_approve` 不足以放行。
  //     这里拒绝而不是"悄悄升级成要审批"：把客户明确配成自动的规则
  //     在背后改判成人工，会让设置页显示的和实际发生的两回事。
  //     配错了就说清楚该怎么配，而不是替他兜着。
  //
  //     🔴 用的是**专用**拒绝码，不是结构性的 outward_side_effect_blocked。
  //     后者不可恢复（动作定义本身不合规，改条件救不了）；而这一条是环境问题，
  //     必须可恢复 —— 否则拒绝文案让人去改规则，人改完了还是做不了：
  //     幂等键会让同一件事命中旧的 denied run，而不可恢复的码连
  //     recoverDeniedRun 都救不回来，等于把这个动作**永久**锁死。
  if (definition.sideEffect === 'outward' && policy.mode === 'auto_approve') {
    return bad(
      'outward_requires_human_policy',
      `「${definition.title}」会作用到客户自己的资产之外，这类动作一律要人点头 —— ` +
        '这个客户的规则却配成了「自动执行」。先把规则改成「要审批」，在那之前一律不做',
      definition,
      policy,
      costEstimate,
    )
  }

  // ⑦ 钱。上限没写 = 0，不是「不限」。
  const costCap = policy.spend_cap_per_run_usd ?? 0

  // 🔴 T2c：**上限本身**也必须是个真实金额。
  //    NaN 最阴：`x > NaN` 恒假，于是授权时的估算闸、开跑前的硬上限、
  //    事后的兜底断言**同时**失效 —— 整条花钱链路一句话都拦不住。
  //    Infinity 则等于「不限」，但那必须是有人显式写一个大数，不能靠一个特殊值悄悄生效。
  //    数据库那条 CHECK 是同一套判据的第二层。
  if (!Number.isFinite(costCap) || costCap < 0) {
    return bad(
      'over_cost_cap',
      `这个客户给「${definition.title}」设的单次花费上限不是一个有效金额（${String(costCap)}）—— ` +
        `先把规则里的上限改成一个具体数字，在那之前一律不做`,
      definition,
      policy,
      costEstimate,
    )
  }

  if (costEstimate > costCap) {
    return bad(
      'over_cost_cap',
      `这次预计要花 $${costEstimate.toFixed(2)}，超过了这个客户给这类动作设的单次上限 $${costCap.toFixed(2)}`,
      definition,
      policy,
      costEstimate,
    )
  }

  return { ok: true, definition, policy, costEstimate, costCap }
}

// ── 自动授权 ──────────────────────────────────────────────────────────────────

/**
 * 判定一个 run 能不能跑。
 *
 * 每一道闸失败都落一条 append-only 的决策记录 —— 包括未知动作。
 */
export async function authorizeRun(
  deps: KernelDeps,
  input: ActionRun,
  /**
   * 🔴 F1：推进这条 run 的那一代。给了就每一次状态写入都出示它 ——
   *    被接管之后这一代作废，过期的执行者连 `authorizing` 都推不动，
   *    更不可能再签一份授权。
   *    只有直接调 authorizeRun 的测试才会不传（那时没有第二个执行者）。
   */
  fence?: { generation: number },
): Promise<AuthorizationOutcome> {
  const now = deps.now()

  const writeRun = async (patch: Parameters<typeof updateRun>[2]): Promise<ActionRun> => {
    if (!fence) return updateRun(deps.supabase, input.id, patch)
    const updated = await updateRunFenced(deps.supabase, input.id, fence.generation, patch)
    if (!updated) {
      throw new KernelError(
        'STALE_CLAIM',
        '这次执行的所有权已经被别人接管了（你手里那一代已经作废）—— 已停手，不会重复做',
        { detail: { runId: input.id, generation: fence.generation } },
      )
    }
    return updated
  }

  const run = await writeRun({ status: 'authorizing' })

  const pf = await preflight(deps, run, now)
  if (!pf.ok) {
    return recordDeny(deps, {
      run,
      definition: pf.definition,
      policy: pf.policy,
      code: pf.code,
      reason: pf.reason,
      costEstimate: pf.costEstimate,
      fence,
    })
  }

  const { definition, policy, costEstimate, costCap } = pf
  const expiresAt = new Date(now.getTime() + policy.decision_ttl_seconds * 1000).toISOString()

  // 要人点头。
  if (policy.mode === 'require_approval') {
    const decision = await insertDecision(deps.supabase, {
      action_run_id: run.id,
      client_id: run.client_id,
      action_key: run.action_key,
      action_version: run.action_version,
      verdict: 'require_approval',
      deny_code: null,
      reason: `按这个客户的规则，「${definition.title}」要你点头才做`,
      policy_snapshot: snapshotOf(policy, definition),
      policy_id: policy.id,
      policy_version: policy.policy_version,
      decided_by: 'policy',
      decided_by_user: null,
      cost_cap_usd: costCap,
      cost_estimate_usd: costEstimate,
      idempotency_key: run.idempotency_key,
      expires_at: null,
    })
    const updated = await writeRun({
      status: 'pending_approval',
      authorization_decision_id: decision.id,
      cost_cap_usd: costCap,
      cost_estimate_usd: costEstimate,
      needs_human: true,
      // 🔴 T1：挂起等人点头 = **交接给人**，推进这条 run 的人到此为止。
      //    租约留着的话，等它自己过期之前这条 run 看起来一直「有人在做」。
      //    可接管的三个状态里，「租约活着」必须严格等于「真的有人在推进」。
      claimed_by: null,
      claimed_at: null,
      heartbeat_at: null,
      lease_expires_at: null,
    })
    return { verdict: 'require_approval', decision, run: updated, ctx: null }
  }

  // 放行。
  const decision = await insertDecision(deps.supabase, {
    action_run_id: run.id,
    client_id: run.client_id,
    action_key: run.action_key,
    action_version: run.action_version,
    verdict: 'allow',
    deny_code: null,
    reason: `这个客户已经允许系统自己做「${definition.title}」，且这次不花钱、不对外`,
    policy_snapshot: snapshotOf(policy, definition),
    policy_id: policy.id,
    policy_version: policy.policy_version,
    decided_by: 'policy',
    decided_by_user: null,
    cost_cap_usd: costCap,
    cost_estimate_usd: costEstimate,
    idempotency_key: run.idempotency_key,
    expires_at: expiresAt,
  })
  const updated = await writeRun({
    status: 'authorized',
    authorization_decision_id: decision.id,
    cost_cap_usd: costCap,
    cost_estimate_usd: costEstimate,
    needs_human: false,
  })

  return { verdict: 'allow', decision, run: updated, ctx: mintContext(decision, costCap) }
}

/**
 * 接管一条**已经授权过**的 run：复用它当前那份授权，**不重新签一条**（T1）。
 *
 * 场景：进程签完 allow、把 run 推到 authorized，然后在开跑之前崩了。
 * 接管者拿到运行所有权之后，这条 run 已经有一份**没被消费过**的 allow ——
 * 再签一份会让同一件事出现两个「谁批的」，审计表里多一条纯噪音的记录。
 *
 * 🔴 但复用绝不是「照单全收」：
 *    · 决策必须真的属于这条 run、这个客户（跨客户当场拦）；
 *    · 必须是 allow、必须没被消费过（消费过说明已经有人开跑了 —— 这是不一致，抛）；
 *    · 过期了就**不复用**（返回 null），由调用方走一次完整的重新授权 ——
 *      过期的授权本来就该重新判，这不是绕过。
 *
 *    政策有没有变（身份 / 版本 / 模式 / 时间窗）**这里也要查**（见函数末尾）。
 *    早先是交给 Gateway 的 —— 那样只是「拿旧授权去撞一堵墙」：抛错之后 run
 *    仍停在 authorized、租约也没清，于是反复报同一个错一直卡到 TTL 到期。
 *
 * @returns 可复用的授权结果；`null` = 不可复用但可以重新授权。
 */
export async function reuseLiveAuthorization(
  deps: KernelDeps,
  run: ActionRun,
): Promise<AuthorizationOutcome | null> {
  if (!run.authorization_decision_id) return null

  const decision = await getDecision(deps.supabase, run.authorization_decision_id)
  if (!decision) return null

  if (decision.client_id !== run.client_id) {
    throw new KernelError(
      'CROSS_CLIENT',
      '安全告警：这条动作当前指着的授权不属于这个客户 —— 已阻止',
      { detail: { runId: run.id, decisionId: decision.id } },
    )
  }
  if (decision.action_run_id !== run.id) {
    throw new KernelError(
      'NOT_AUTHORIZED',
      '这条动作当前指着的授权记的是另一件事 —— 库里状态不一致，先别继续',
      { detail: { runId: run.id, decisionId: decision.id } },
    )
  }
  if (decision.verdict !== 'allow') return null
  if (decision.consumed_at) {
    // authorized + 授权已被兑换 = 已经有人开跑了，状态却没跟上。
    // 这不是并发的正常结果，是不一致，必须炸出来而不是再跑一遍。
    throw new KernelError(
      'DECISION_ALREADY_CONSUMED',
      '这条动作停在「已授权」，但它的授权已经被用掉了 —— 库里状态不一致，先别继续',
      { detail: { runId: run.id, decisionId: decision.id, consumedBy: decision.consumed_by } },
    )
  }
  if (decision.expires_at && Date.parse(decision.expires_at) <= deps.now().getTime()) return null

  // 🔴 P2-1：政策**现在**还跟签这份授权时一样吗。
  //
  //    早先这一层交给 Gateway：反正它开跑前会重查身份 / 版本 / 模式。
  //    但那样只是「拿旧授权去撞一堵墙」—— Gateway 抛错之后 run 仍停在
  //    authorized、接管者的租约也还在，于是后续请求先被答成 in_progress，
  //    租约过期后又重复同一个错，**一直卡到授权 TTL 自己到期**。
  //    政策变了就直接认定「不可复用」，走完整重新授权 ——
  //    那条路会如实落一条 deny / require_approval，而不是反复抛错。
  const policy = await getActivePolicy(deps.supabase, run.client_id, run.action_key, deps.now())
  if (!policy) return null
  if (policy.id !== decision.policy_id) return null
  if (policy.policy_version !== decision.policy_version) return null
  // 机器签的放行只在「现在仍是自动」时有效；人签的只在「现在仍要人审」时有效
  const modeStillMatches =
    decision.decided_by === 'human'
      ? policy.mode === 'require_approval'
      : policy.mode === 'auto_approve'
  if (!modeStillMatches) return null

  return { verdict: 'allow', decision, run, ctx: mintContext(decision, decision.cost_cap_usd) }
}
