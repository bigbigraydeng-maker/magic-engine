/**
 * 受限自治信封（spec `docs/specs/2026-09-24-ads-goal-driven-autonomous-impact-loop-v1.md` §3 G5）。
 *
 * PM 2026-09-24 把广告支柱从「逐次审批」改成「AI 在信封内自主执行、PM 只做日检」。
 * 这个文件是那个「信封」的**唯一判据**，纯函数、无 I/O，被三处共用：
 *   1. 提交前预检（孔明）—— 不在信封内就根本不提交，避免制造一条注定被拒的 run
 *   2. 授权层 `authorize.ts` ⑥b —— 纵深防御，用授权那一刻的真实快照重算
 *   3. 执行层 `gateway.ts` —— 碰 provider 之前用 `kernel_pre` 快照再算一次
 *
 * 🔴 **事实一律服务端自己读，绝不接受提交方传进来的数字。**
 *    提交方只说「我想把这个单位的日预算从 X 改成 Y」；X 是多少、账户合计多少、
 *    距上次改动几小时、在不在学习期、在不在实验里——全部由 `EnvelopeFacts` 从
 *    `ad_entity_snapshots` / `ad_strategy_configs` 读出来。让提交方报自己的约束
 *    等于没有约束。
 *
 * 🔴 **任何一项读不到（null）一律拒绝，不给默认值。**
 *    「读不到日预算上限」和「上限很宽」在代码里必须长得不一样，否则一次读失败
 *    就等于一次静默放行。同 `§14 M4`「缺行按锁定处理」。
 */

import type { AutonomyEnvelope } from './types'

/**
 * 这次动作对花费的性质。不同性质走不同判据——把暂停也套上「变动不超过 20%」
 * 会让暂停永远过不了闸（暂停等于降到 0，变动率 100%），而暂停恰恰是 PM 明确
 * 授权可以自动做的「收」类动作。
 */
export type EnvelopeChangeKind =
  /** 改某个单位的日预算（加或减）。走变动比例 + 日上限。 */
  | 'budget_change'
  /** 暂停 / 关停。只会让花费变少，不走变动比例。 */
  | 'pause'
  /** 新增会花钱的东西（加广告组）。不走变动比例，但必须过日上限。 */
  | 'new_spend'
  /** 只换素材，不碰钱。 */
  | 'creative_only'

/** 提交方说的「要做什么」——只有意图，没有事实。 */
export interface EnvelopeRequest {
  kind: EnvelopeChangeKind
  /**
   * 这个单位改动后的日预算（分）。
   * `pause` 传 0；`creative_only` 传改动前的值（等于不变）；`new_spend` 传新单位的日预算。
   */
  afterCents: number
}

/** 服务端读出来的事实。每一项 null 都表示「读不到」，不是「没有」。 */
export interface EnvelopeFacts {
  /** 这个单位改动前的日预算（分）。新增单位传 0。 */
  beforeCents: number | null
  /** 改动前，这个账户全部预算单位的日预算合计（分）。 */
  accountDailyTotalBeforeCents: number | null
  /** 客户配置的日预算上限（分）。null = 没设 → 拒绝。 */
  dailyCapCents: number | null
  /** 距这个单位上一次**真实**设置变化过了多少小时（按快照算，含人工改动，§14 K12）。 */
  hoursSinceLastChange: number | null
  /**
   * 学习期这条判据对这次动作**适不适用**。
   *
   * 🔴 新建一条还不存在的广告组时，没有任何东西在学习——这时判据不适用，
   *    跟「读不到学习期状态」必须分开。混在一起的话，新建类动作会因为
   *    「读不到 → 当作在学习期」而永远被拒，等于这个动作从来没上线过。
   */
  learningPhaseApplicable: boolean
  /** Meta 学习期状态原文。适用时：非 null 且不是「已退出学习期」一律当作在学习期。 */
  learningStage: string | null
  /** 这个单位当前所在的 Meta 实验个数。 */
  adStudyCount: number
  /** 这个动作的 capability 有没有注册撤回处理函数。 */
  hasRollbackHandler: boolean
}

export interface EnvelopeVerdict {
  within: boolean
  /** 不在信封内的原因（人话，进 deny 记录和 PM 待办）。在信封内时为空数组。 */
  reasons: string[]
}

/**
 * Meta 的学习期状态值里，只有这两个表示**已经出了**学习期。
 * 其余任何值（含读不到）都当作还在学习期——宁可不动，不要在学习期里瞎调。
 */
const LEARNING_DONE = new Set(['SUCCESS', 'FAIL'])

function inLearningPhase(stage: string | null): boolean {
  if (stage === null) return true // 读不到 → 当作在学习期
  return !LEARNING_DONE.has(stage.toUpperCase())
}

/**
 * 这次具体的动作在不在信封内。纯函数。
 *
 * 顺序刻意从「读不到」开始：先把事实不全的情况全部拒掉，再谈数值判断。
 * 这样任何一条读失败都不可能走到「数值看起来没超」的分支。
 */
export function isWithinEnvelope(
  request: EnvelopeRequest,
  facts: EnvelopeFacts,
  envelope: AutonomyEnvelope,
): EnvelopeVerdict {
  const reasons: string[] = []

  // ── 先拒「读不到」──────────────────────────────────────────────────────
  if (facts.beforeCents === null) reasons.push('读不到这个单位改动前的日预算')
  if (facts.accountDailyTotalBeforeCents === null) reasons.push('读不到这个账户当前的日预算合计')
  if (facts.hoursSinceLastChange === null) reasons.push('读不到这个单位上次设置变动的时间')
  if (envelope.respectDailyCapCents && facts.dailyCapCents === null) {
    reasons.push('这个客户还没设日预算上限，没有上限就不自动动钱')
  }

  // ── 再拒「明确不该动」──────────────────────────────────────────────────
  if (envelope.requiresRollbackHandler && !facts.hasRollbackHandler) {
    reasons.push('这个动作没有注册撤回处理函数，撤不回来的事不自动做')
  }
  if (envelope.excludeAdStudies && facts.adStudyCount > 0) {
    reasons.push(`这个单位正在 ${facts.adStudyCount} 个 Meta 对比测试里，测试期间不动它`)
  }
  if (envelope.excludeLearningPhase && facts.learningPhaseApplicable && inLearningPhase(facts.learningStage)) {
    reasons.push(
      facts.learningStage === null
        ? '读不到学习期状态，按还在学习期处理，不动它'
        : `这个单位还在 Meta 学习期（${facts.learningStage}），动了要重新学 7 天`,
    )
  }
  if (facts.hoursSinceLastChange !== null && facts.hoursSinceLastChange < envelope.minHoursSinceLastChange) {
    reasons.push(
      `距上次设置变动只过了 ${Math.floor(facts.hoursSinceLastChange)} 小时，` +
        `不足 ${envelope.minHoursSinceLastChange} 小时（反复改会一直重置学习期）`,
    )
  }

  if (reasons.length > 0) return { within: false, reasons }

  // 到这里 beforeCents / accountDailyTotalBeforeCents 必然非 null（上面已拒）。
  const before = facts.beforeCents as number
  const accountBefore = facts.accountDailyTotalBeforeCents as number
  const after = request.afterCents

  if (!Number.isFinite(after) || after < 0) {
    return { within: false, reasons: [`改动后的日预算不是一个有效金额（${String(after)}）`] }
  }

  // ── 变动比例：只管「改预算」这一类 ───────────────────────────────────────
  if (request.kind === 'budget_change') {
    if (before <= 0) {
      return { within: false, reasons: ['改动前的日预算是 0 或读成了 0，算不出变动比例，不自动改'] }
    }
    const ratio = Math.abs(after - before) / before
    if (ratio > envelope.maxBudgetDeltaRatio) {
      reasons.push(
        `一次改动 ${Math.round(ratio * 100)}%，超过信封允许的 ` +
          `${Math.round(envelope.maxBudgetDeltaRatio * 100)}%`,
      )
    }
  }

  // ── 日上限：PM 2026-09-24 拍板的三档 ────────────────────────────────────
  //   ① 改完 ≤ 上限                → 放行（本来就在规则内）
  //   ② 上限 < 改完 ≤ 上限×(1+缓冲) → 放行（缓冲区，真投手也会留几个百分点应对波动）
  //   ③ 改完 > 上限×(1+缓冲)       → 拒绝**加**类，同时**放行**减类
  //                                （账户已远超上限 → 让 AI 立刻自动往下降）
  //
  //   🔴 「减」的判据是 accountAfter < accountBefore，不是 request.kind：
  //     一个改预算动作既可能把这个单位加钱、也可能把它减钱；决定的是**账户**
  //     的总方向。信封在这一刻只放行「让账户往下走」的动作。
  //   🔴 暂停 / 换素材从来只会让花费变少或不变 → 一直放行，不进这段判据。
  //   🔴 new_spend 一律会让账户变多 → 走加类通道，超过缓冲上限就拒。
  const OVERSHOOT_TOLERANCE = 0.2
  if (envelope.respectDailyCapCents && request.kind !== 'pause' && request.kind !== 'creative_only') {
    const cap = facts.dailyCapCents as number
    const accountAfter = accountBefore - before + after
    const capWithBuffer = cap * (1 + OVERSHOOT_TOLERANCE)
    const isReducing = accountAfter < accountBefore
    if (accountAfter > capWithBuffer && !isReducing) {
      reasons.push(
        `改完账户当日预算合计 ${accountAfter} 分，超过上限 ${cap} 分的 ${Math.round(OVERSHOOT_TOLERANCE * 100)}% 缓冲` +
          `（${Math.floor(capWithBuffer)} 分）`,
      )
    }
  }

  return { within: reasons.length === 0, reasons }
}
