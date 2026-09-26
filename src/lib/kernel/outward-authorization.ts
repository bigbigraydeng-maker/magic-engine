/**
 * 逐动作的对外副作用授权判据。
 *
 * 🔴 **这一条替代的是「注册表里一律不许出现 outward 动作」那道全局禁令，
 *    但默认仍然是拒绝。** 区别只有一个：以前是「不可能」，现在是
 *    「除非这个动作**逐条**说清了它凭什么可以对外写」。
 *
 * 🔴 **没有全局开关、没有环境变量旁路、没有通用 bypass。**
 *    唯一放宽的方式是给某一个 `ActionDefinition` 补一份完整声明 ——
 *    那是一行写在版本控制里、必须过 review 的 diff。
 *
 * 🔴 **一个 predicate，两处调用**（`authorize.ts` 的授权层、`gateway.ts` 的执行层）。
 *    共用是为了防两边判据漂移；但两层各自**独立**生效 ——
 *    拆掉任意一层，另一层仍然拦得住，且各有只有它能满足的测试。
 */

import type { ActionDefinition, ActionRun, OutwardApproval } from './types'
import type { EnvelopeFactsResolver } from './deps'
import { isWithinEnvelope } from './autonomy-envelope'

/** 有限、非负的真实金额。NaN / ±Infinity / 负数 / 非数字一律不算。 */
function isRealCeiling(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** 信封允许的最大单次预算变动比例。跟 Meta 护栏的 ±20% 对齐，不许声明得更宽。 */
const MAX_ALLOWED_BUDGET_DELTA_RATIO = 0.2
/** 同一单位两次变动之间的最小间隔。低于这个数会反复重置 Meta 学习期。 */
const MIN_ALLOWED_HOURS_SINCE_LAST_CHANGE = 72

/**
 * 审批声明本身完不完整合法。
 *
 * 🔴 四个布尔项在类型上已经写死成字面量 `true`，这里**仍然**逐项运行时再查一遍：
 *    类型只在编译期管得住本仓库的代码，管不住 `as` 强转、`JSON.parse` 出来的东西、
 *    或者以后有人把声明挪到库外。放行对外副作用这件事不靠「应该不会发生」。
 */
function approvalBlockReason(approval: OutwardApproval | undefined): string | null {
  if (!approval || typeof approval !== 'object') {
    return '对外授权声明必须写明要不要人点头（approval: human_only 或 bounded）'
  }

  if (approval.mode === 'human_only') return null

  if (approval.mode !== 'bounded') {
    return `对外授权声明的 approval.mode 只能是 human_only 或 bounded，收到「${String((approval as { mode?: unknown }).mode)}」`
  }

  const e = approval.envelope
  if (!e || typeof e !== 'object') {
    return 'approval.mode = bounded 必须同时给出完整的自治信封（envelope）'
  }

  if (!(typeof e.maxBudgetDeltaRatio === 'number' && Number.isFinite(e.maxBudgetDeltaRatio))
      || e.maxBudgetDeltaRatio <= 0
      || e.maxBudgetDeltaRatio > MAX_ALLOWED_BUDGET_DELTA_RATIO) {
    return `信封的 maxBudgetDeltaRatio 必须在 (0, ${MAX_ALLOWED_BUDGET_DELTA_RATIO}] 之间，收到「${String(e.maxBudgetDeltaRatio)}」`
  }
  if (e.respectDailyCapCents !== true) {
    return '信封的 respectDailyCapCents 必须是 true —— 不尊重日预算上限的自治不许存在'
  }
  if (!(typeof e.minHoursSinceLastChange === 'number' && Number.isFinite(e.minHoursSinceLastChange))
      || e.minHoursSinceLastChange < MIN_ALLOWED_HOURS_SINCE_LAST_CHANGE) {
    return `信封的 minHoursSinceLastChange 不得低于 ${MIN_ALLOWED_HOURS_SINCE_LAST_CHANGE} 小时，收到「${String(e.minHoursSinceLastChange)}」`
  }
  if (e.excludeLearningPhase !== true) {
    return '信封的 excludeLearningPhase 必须是 true —— 学习期里自动调整会让指标失真'
  }
  if (e.excludeAdStudies !== true) {
    return '信封的 excludeAdStudies 必须是 true —— 对比测试期间动手会毁掉实验结论'
  }
  if (e.requiresRollbackHandler !== true) {
    return '信封的 requiresRollbackHandler 必须是 true —— 撤不回来的事不自动做'
  }

  return null
}

/**
 * 这个动作现在**不能**对外执行的原因；可以对外执行则返回 `null`。
 *
 * 非 outward 的动作一律返回 `null` —— 本判据只管「对外许可」这一件事，
 * 它们的 `outwardAuthorization` 保持 `null` 即可。
 */
export function outwardBlockReason(definition: ActionDefinition): string | null {
  if (definition.sideEffect !== 'outward') return null

  const declaration = definition.outwardAuthorization
  if (!declaration) {
    // 🔴 「不是等你点头，是根本不做」这半句要留着：没有声明的对外动作，
    //    **人点头也批不出来**（approveRun 走同一个 preflight）。
    //    换成一句听起来像「待审批」的话，等于告诉人这条还有戏。
    return (
      '这个动作会作用到客户自己的资产之外，但契约里没有逐动作的对外授权声明 —— ' +
      '这条不是「等你点头」，是根本不做（补声明要改代码、过 PR，不是配置项）'
    )
  }

  // 出处必须写得出来。空白等于没写 —— 出了事没人知道这条许可是谁、按哪份文件给的。
  if (typeof declaration.declaredIn !== 'string' || declaration.declaredIn.trim().length === 0) {
    return '对外授权声明必须写明出处（declaredIn），空白不算 —— 这条许可要能被追到是谁批的'
  }

  // 🔴 这一段只查**声明本身完不完整合法**，不看这一次要做什么。
  //    「这一次的具体改动在不在信封内」是实例级判断，在 authorize.ts ⑥b 和
  //    gateway.ts 碰 provider 之前各算一次（用真实快照，不用提交方给的数字）。
  //    两层分工刻意分开：结构闸拆了也拦不住越界的实例，实例闸拆了也拦不住
  //    一份残缺的声明——两边各有只有它能满足的测试。
  const approvalBlock = approvalBlockReason(declaration.approval)
  if (approvalBlock) return approvalBlock

  if (declaration.rollback !== 'provider_native' && declaration.rollback !== 'snapshot_restore') {
    return '对外授权声明必须写明怎么撤回（provider_native 或 snapshot_restore）'
  }

  // 🔴 **声明不许覆盖或欺骗 `reversible`。**
  //    v1 只允许 `reversible === true` 的对外动作。填一个 `snapshot_restore`
  //    并不能把一个自称不可逆的动作变成可逆 —— 那是拿声明去盖事实。
  //    真要放开不可逆的对外动作，那是一次单独的、要重新评估风险的决定。
  if (definition.reversible !== true) {
    return (
      '这个动作声明了自己撤不回来（reversible: false）—— v1 不放行不可逆的对外动作。' +
      '填 rollback 不能替代 reversible：撤回路径写得再清楚，也改不了「它自称撤不回来」这个事实'
    )
  }

  // 🔴 对外动作**一定**碰外部服务，所以「不调外部服务」这个声明自相矛盾。
  //    诚实只有两个选项：认幂等键（supported）或不认（unsupported）。
  if (definition.providerIdempotency === 'not_applicable') {
    return (
      '对外动作必须如实声明外部服务的幂等能力：supported 或 unsupported。' +
      'not_applicable 的意思是「根本不调外部服务」，跟对外副作用自相矛盾'
    )
  }

  // 🔴 每一步都要有显式上界。
  //    这里**刻意不**接受 `nextStepCostCeiling` 对内部动作的那个兜底
  //    （整体 estimate 为 0 就视为每步 0）——「它不花钱」对一个真的会打到
  //    外部服务的动作来说，是要逐步写下来的承诺，不是推断出来的。
  for (const stepKey of definition.steps) {
    if (!isRealCeiling(definition.costModel.stepCeilingUsd?.[stepKey])) {
      return `对外动作的每一步都要显式声明成本上界，「${stepKey}」没有（要一个有限的非负金额）`
    }
  }

  return null
}

/**
 * 「碰 provider 之前」用真实事实再算一次信封（spec 2026-09-24 §3 G5 第 3 道）。
 *
 * 授权层 `authorize.ts` ⑥c 已经算过一次；这里用**同一个**解析器再算一次，
 * 传 `at: 'pre_provider'`，让域层用刚由 `snapshot_pre` 抓的 `kernel_pre` 快照
 * 重读事实。两次判决之间可能相隔几秒，这段窗口里 PM 可能刚把日预算上限改低、
 * 别的动作可能刚改了同一个单位。没有第二道核算就等于承认「授权那一刻算对了 =
 * 现在还算对」，跟同一个文件自己的模块头注释「两处查声明+两处查实例」直接矛盾。
 *
 * 非 outward、非 bounded、当前是 `snapshot_pre` 步骤 → 返回 null（不检查）：
 *   `snapshot_pre` 就是为了给这道闸供数据的一步，前置查它自相矛盾。
 * 没有解析器 → 返回 unavailable 原因（等同越界）。
 * 越界或事实读不到 → 返回带原因的字符串（调用方按 dead_letter 处理）。
 */
export async function preProviderEnvelopeBlockReason(args: {
  definition: ActionDefinition
  run: Pick<ActionRun, 'id' | 'client_id' | 'action_key' | 'input'>
  stepKey: string
  resolveFacts: EnvelopeFactsResolver | undefined
}): Promise<string | null> {
  const approval = args.definition.outwardAuthorization?.approval
  if (args.definition.sideEffect !== 'outward') return null
  if (approval?.mode !== 'bounded') return null
  if (args.stepKey === 'snapshot_pre') return null
  if (!args.resolveFacts) {
    return '这个 Kernel 实例没装信封事实解析器，读不到真实预算 → 不敢碰 Meta'
  }

  const resolved = await args.resolveFacts({
    clientId: args.run.client_id,
    actionKey: args.run.action_key,
    input: (args.run.input ?? {}) as Record<string, unknown>,
    at: 'pre_provider',
    runId: args.run.id,
  })

  if ('unavailable' in resolved) {
    return `碰 Meta 之前重读信封事实失败：${resolved.unavailable}`
  }
  const verdict = isWithinEnvelope(resolved.request, resolved.facts, approval.envelope)
  if (verdict.within) return null
  return `碰 Meta 之前重算信封已越界：${verdict.reasons.join('；')}`
}
