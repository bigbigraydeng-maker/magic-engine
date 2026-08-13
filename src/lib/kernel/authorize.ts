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

export interface AuthorizationOutcome {
  verdict: Verdict
  decision: AuthorizationDecision
  run: ActionRun
  /** 只有 verdict === 'allow' 时才有。其余情况拿不到执行凭证。 */
  ctx: AuthorizedExecutionContext | null
}

/** 政策快照 —— 判定当时的样子。政策后来改了也能复盘「当时凭什么放行」。 */
function snapshotOf(
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
function mintContext(
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

interface DenyArgs {
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
   * 🔴 审批人当时在页面上看到的那份审批请求的 id（见 HumanDecisionOptions）。
   *    人工批准的失败分支必须带上它，一路传进数据库锁内的 CAS ——
   *    不带的话，`onlyIfStatus: 'pending_approval'` 只保证 run 还没被批准
   *    或拒绝过，保证不了它没有在期间被重新排成**另一份**待审批请求；
   *    这种情况下失败分支会把新请求直接覆盖成 denied。
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
async function recordDeny(deps: KernelDeps, args: DenyArgs): Promise<AuthorizationOutcome> {
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
    if (written.reason === 'decision_not_current') {
      throw new KernelError(
        'STALE_DECISION',
        '你看到的那份审批请求已经不是最新的了（这条动作期间被重新排过或规则改过）——' +
          '这次操作没有生效，也没有改动任何东西。刷新一下再决定',
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

async function preflight(deps: KernelDeps, run: ActionRun, now: Date): Promise<PreflightResult> {
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

// ── 人工批准 ──────────────────────────────────────────────────────────────────

/**
 * 人工决定的可选参数。
 *
 * 🔴 `expectedDecisionId` = **审批人当时在页面上真正看到的那份审批请求的 id**。
 *
 *    没有它的时候，服务端是这么干的：拿 runId 去库里重读一遍
 *    `run.authorization_decision_id`，读到什么就批什么。于是这条时间线是通的：
 *
 *      10:00  人打开审批页，看到「花 $2 发这条」
 *      10:05  政策改了 / 系统重新排了一次 → run 换上了**另一份**审批请求（$40）
 *      10:06  人点「同意」——服务端重读到的是新那份，**照批不误**
 *
 *    人点头点的是他看见的那一份，不是「这条 run 此刻恰好挂着的任意一份」。
 *    所以这个 id 由调用方带上来，并且**一路传到数据库**当作
 *    `p_pending_decision_id` —— 数据库拿到 run 行锁之后会再比对一次
 *    （`kernel_resolve_pending_approval` 第 ③ 步）。
 *
 *    两层缺一不可：
 *      · 应用层这一道让「明显过期」当场失败，**一个字都不写库**，并给人话；
 *      · 数据库那一道守的是「比完到提交之间」的那个窗口 —— 那里有行锁，是真原子。
 *
 *    不传 = 保持老行为（服务端重读）。**新的审批 API 一律必须传**；
 *    保留可选是为了不改动现有那些非 HTTP 调用方（测试、恢复路径）。
 */
export interface HumanDecisionOptions {
  readonly expectedDecisionId?: string
  /**
   * 🔴 批准时人写的备注（可选）。跟 rejectRun 的 `reason` 参数一样要落进
   *    append-only 的决策记录 —— 不落的话，接口按契约收下了这段话，
   *    审计表里却只剩自动生成的通用理由，备注被静默丢弃。
   */
  readonly reason?: string
}

/**
 * 应用层的过期审批闸。
 *
 * 🔴 命中就抛，**在任何写入之前**。不落决策、不动 run —— 因为这次操作
 *    从一开始就不该发生：人批的是另一份东西。
 */
function assertDecisionStillCurrent(
  run: ActionRun,
  expectedDecisionId: string | undefined,
  actor: string,
): void {
  if (expectedDecisionId === undefined) return
  if (run.authorization_decision_id === expectedDecisionId) return
  throw new KernelError(
    'STALE_DECISION',
    `${actor} 看到的那份审批请求已经不是最新的了（这条动作期间被重新排过或规则改过）——` +
      '这次操作没有生效，也没有改动任何东西。刷新一下再决定',
    {
      detail: {
        runId: run.id,
        expectedDecisionId,
        currentDecisionId: run.authorization_decision_id,
      },
    },
  )
}

/**
 * 人点了「同意」。
 *
 * 🔴 人工批准能做的**只有一件事**：把「当前仍然是 require_approval、
 *    而且跟当初挂起时是同一版」的那条政策，从「等你点头」变成「可以做」。
 *
 *    它**不能**覆盖：没有政策 / 政策改成禁止 / 政策换了版本 / 契约升版 /
 *    输入已不合法 / purpose 不符 / 对外副作用 / 超预算。
 *    任何一项变了 —— 一律 fail closed，并落一条拒绝记录说清楚变了什么。
 *
 * 走的是**新签一条决策**，不是把原来那条 require_approval 改成 allow ——
 * 决策表是 append-only，改写审计记录等于没有审计。
 */
export async function approveRun(
  deps: KernelDeps,
  runId: string,
  approvedByUser: string,
  options: HumanDecisionOptions = {},
): Promise<AuthorizationOutcome> {
  const now = deps.now()
  const run = await deps.requireRun(runId)

  if (run.status !== 'pending_approval') {
    throw new KernelError(
      'INVALID_STATE',
      `这条动作现在的状态是「${run.status}」，不是在等人点头，不能批准`,
    )
  }

  // 🔴 在任何写入之前 —— 批的必须是他看见的那一份（见 HumanDecisionOptions）
  assertDecisionStillCurrent(run, options.expectedDecisionId, approvedByUser)

  // ① 当初挂起时那条 require_approval 决策必须还在 —— 它是「同一版政策」的锚。
  const pending = run.authorization_decision_id
    ? await getDecision(deps.supabase, run.authorization_decision_id)
    : null
  if (!pending || pending.verdict !== 'require_approval') {
    return recordDeny(deps, {
      run,
      definition: deps.registry.get(run.action_key),
      policy: null,
      code: 'approval_context_lost',
      reason: `${approvedByUser} 点了同意，但找不到当初挂起这条动作的那份审批请求了 —— 不能凭空签一份放行，请重新排一次`,
      costEstimate: null,
      onlyIfStatus: 'pending_approval',
      expectedDecisionId: options.expectedDecisionId ?? run.authorization_decision_id ?? null,
    })
  }

  // ② 全套授权不变量重跑一遍（跟自动放行同一套闸）—— 这里说人话；
  //    数据库 RPC 之后还会重查所有「这里和提交之间可能变化」的库内事实。
  const pf = await preflight(deps, run, now)
  if (!pf.ok) {
    return recordDeny(deps, {
      run,
      definition: pf.definition,
      policy: pf.policy,
      code: pf.code,
      reason: `${approvedByUser} 点了同意，但这条现在已经不能做了：${pf.reason}`,
      costEstimate: pf.costEstimate,
      onlyIfStatus: 'pending_approval',
      expectedDecisionId: options.expectedDecisionId ?? pending.id,
    })
  }

  const { definition, policy, costEstimate } = pf

  // ③ 当前政策必须**仍然**是「要审批」。
  if (policy.mode !== 'require_approval') {
    return recordDeny(deps, {
      run,
      definition,
      policy,
      code: 'policy_changed_since_request',
      reason: `${approvedByUser} 点了同意，但这个客户的规则在挂起之后被改成了「${policy.mode === 'auto_approve' ? '自动执行' : policy.mode}」—— 规则变了就不能按旧的审批请求放行，请重新排一次`,
      costEstimate,
      onlyIfStatus: 'pending_approval',
      expectedDecisionId: options.expectedDecisionId ?? pending.id,
    })
  }

  // ④ 而且必须是**同一行**政策（C2）。
  if (policy.id !== pending.policy_id) {
    return recordDeny(deps, {
      run,
      definition,
      policy,
      code: 'policy_changed_since_request',
      reason: `${approvedByUser} 点了同意，但这个客户的规则在挂起之后被删掉重建过 —— 你看到的还是旧规则下的请求，请重新排一次`,
      costEstimate,
      onlyIfStatus: 'pending_approval',
      expectedDecisionId: options.expectedDecisionId ?? pending.id,
    })
  }

  // ⑤ 而且必须是**同一版**。
  if (policy.policy_version !== pending.policy_version) {
    return recordDeny(deps, {
      run,
      definition,
      policy,
      code: 'policy_changed_since_request',
      reason: `${approvedByUser} 点了同意，但这个客户的规则在挂起之后改过（第 ${pending.policy_version} 版 → 第 ${policy.policy_version} 版）—— 你看到的还是旧规则下的请求，请重新排一次`,
      costEstimate,
      onlyIfStatus: 'pending_approval',
      expectedDecisionId: options.expectedDecisionId ?? pending.id,
    })
  }

  // ⑥ 🔴 原子转换：签放行 + run → authorized 在数据库同一个事务里完成。
  //    两个人同时批准（或一次双击）时，抢的是同一把 run 行锁 ——
  //    输的一方在这里拿到 not_pending / decision_not_current，绝不覆盖赢家。
  //    RPC 内部会把政策三连（行身份 / 版本 / 模式）再查一遍，
  //    挡住「preflight 和这里之间政策又变了」的窗口。
  //    🔴 交给数据库的是**调用方带上来的那个 id**（没带才退回服务端重读的）。
  //    这一句就是「人批的是他看见的那一份」这条契约在数据库侧的落点。
  const resolved = await resolvePendingApproval(deps.supabase, {
    runId: run.id,
    pendingDecisionId: options.expectedDecisionId ?? pending.id,
    resolution: 'approve',
    resolvedBy: approvedByUser,
    reason:
      `${approvedByUser} 点了同意（规则自挂起以来没变过，仍是第 ${policy.policy_version} 版）` +
      (options.reason ? `：${options.reason}` : ''),
    policySnapshot: snapshotOf(policy, definition),
    costEstimateUsd: costEstimate,
  })
  if (!resolved.ok || !resolved.decisionId) {
    throw new KernelError(
      'INVALID_STATE',
      `这条动作刚刚已经被别人处理了或状态变了（${resolved.reason}），这次批准没有生效`,
      { detail: { reason: resolved.reason } },
    )
  }

  const decision = await getDecision(deps.supabase, resolved.decisionId)
  if (!decision) {
    throw new KernelError('INVALID_STATE', '批准已生效但读不回新签的决策 —— 库状态不一致，先别继续')
  }
  const updated = await deps.requireRun(run.id)

  return { verdict: 'allow', decision, run: updated, ctx: mintContext(decision, decision.cost_cap_usd) }
}

/** 人点了「不做」。同样是新签一条决策。 */
export async function rejectRun(
  deps: KernelDeps,
  runId: string,
  rejectedByUser: string,
  reason: string,
  options: HumanDecisionOptions = {},
): Promise<AuthorizationOutcome> {
  const run = await deps.requireRun(runId)
  const definition = deps.registry.get(run.action_key)

  // 🔴 只能拒绝**仍在等审批**的 run。running / succeeded / denied 一律不许覆盖 ——
  //    「对已过期页面重复点不做」和「拒绝跟批准赛跑」都会走到这里。
  if (run.status !== 'pending_approval') {
    throw new KernelError(
      'INVALID_STATE',
      `这条动作现在的状态是「${run.status}」，不是在等审批，不能拒绝（它可能已经被批准执行了）`,
    )
  }

  // 🔴 拒绝同样只能对「他看见的那一份」生效。人说「不做」说的是那件事，
  //    不是这条 run 此刻恰好挂着的任意一件事 —— 期间换过内容就得重看再决定。
  assertDecisionStillCurrent(run, options.expectedDecisionId, rejectedByUser)

  const pending = run.authorization_decision_id
    ? await getDecision(deps.supabase, run.authorization_decision_id)
    : null
  if (!pending || pending.verdict !== 'require_approval') {
    throw new KernelError(
      'INVALID_STATE',
      '找不到当初挂起这条动作的那份审批请求，不能拒绝 —— 请刷新后重试',
    )
  }

  // 原子转换：跟批准抢同一把 run 行锁，输的一方拿到机器可读原因。
  const resolved = await resolvePendingApproval(deps.supabase, {
    runId: run.id,
    pendingDecisionId: options.expectedDecisionId ?? pending.id,
    resolution: 'reject',
    resolvedBy: rejectedByUser,
    reason: `${rejectedByUser} 点了不做：${reason}`,
    policySnapshot: snapshotOf(null, definition),
    costEstimateUsd: run.cost_estimate_usd,
  })
  if (!resolved.ok || !resolved.decisionId) {
    throw new KernelError(
      'INVALID_STATE',
      `这条动作刚刚已经被别人处理了或状态变了（${resolved.reason}），这次拒绝没有生效`,
      { detail: { reason: resolved.reason } },
    )
  }

  const decision = await getDecision(deps.supabase, resolved.decisionId)
  if (!decision) {
    throw new KernelError('INVALID_STATE', '拒绝已生效但读不回新签的决策 —— 库状态不一致')
  }
  const updated = await deps.requireRun(run.id)

  return { verdict: 'deny', decision, run: updated, ctx: null }
}
