/**
 * 止损 → Kernel 的提交适配器（WP3.1b 收编）。
 *
 * ── 在此之前是什么样 ────────────────────────────────────────────────────────
 * `api/clients/[id]/ad-health/stop-loss` 是一条**完整绕过执行内核**的第二执行路径：
 * 路由自己 import Meta 写函数、自己打 Meta，事后往 `flywheel_actions` 插一行当审计。
 * 没有 `action_runs` 回执、没有幂等键、没有撤回处理函数、没有策略检查、没有信封检查。
 * 也就是说：ME2「所有对外写只有一个入口」这条铁律，在会动真钱的那条路上是空的。
 *
 * ── 现在是什么样 ────────────────────────────────────────────────────────────
 * 按 spec §3 G4/G5 提交 WP2 已经注册好的两个动作，一个投放单位一条 run：
 *   · 暂停   → `ads.pause_unit`
 *   · 砍预算 → `ads.cut_unit_budget`
 * 授权、信封、幂等、回读验证、撤回，全部由 Kernel 与 `capabilities/ads/*` 负责，
 * 本文件一行 Meta 都不碰、一个 provider 模块都不 import。
 *
 * 🔴 **为什么按广告组（adset）提交，而不是按广告系列**：
 *    这两个 ActionKey 的 input 契约是 `adset_id`（见 `kernel/registry-ads.ts`），
 *    执行器也只写广告组。广告系列级的写入面（`setCampaignStatus` /
 *    `setCampaignDailyBudget`）本轮**没有**对应的 ActionKey —— 所以「预算挂在广告系列上」
 *    （CBO）的砍预算请求在路由层就 fail closed 并下发人工任务，不在这里假装能做。
 *
 * 🔴 **逐个串行提交，不并发**：spec §3 G11 要求所有触达 Kernel 授权的广告路径串行化，
 *    同账户多单位的信封加总靠这个串行天然成立（并发提交会让两条 run 各自拿着
 *    「改之前」的账户合计去算日上限，两条都判过、加起来超上限）。
 *
 * 🔴 **某个单位失败不打断后面的单位**：止损是**收**类动作，中途停下等于让剩下的钱继续烧。
 *    每个单位如实记下自己的结局，不粉饰、不合并。
 */

import { runAction } from '@/lib/kernel/runner'
import type { KernelDeps } from '@/lib/kernel/deps'
import type { ActionRunOutcome, SubmitActionInput } from '@/lib/kernel/runner'

export type StopLossKernelAction = 'pause' | 'cut'

/** 一个要动的投放单位。`afterCents` 只有砍预算时有值。 */
export interface StopLossUnit {
  readonly adsetId: string
  readonly name: string
  readonly currentCents: number
  readonly afterCents: number | null
}

export interface StopLossSubmissionInput {
  readonly clientId: string
  /** 必须是**登记在册**的那一种写法（带不带 `act_` 前缀按库里的来）—— 信封事实按它查快照。 */
  readonly adAccountId: string
  /** 'YYYY-MM-DD'。同时是幂等键的一部分（见 registry-ads 的 `idempotency.keyFields`）。 */
  readonly cycleDate: string
  /** 这两个动作都只允许 `purpose: 'growth'`，所以目标 id 是硬要求，不能为空。 */
  readonly goalId: string
  readonly action: StopLossKernelAction
  readonly units: readonly StopLossUnit[]
  /** 谁按的这一下（邮箱）。进 `triggered_by_ref`，用来查「是谁让系统做的」。 */
  readonly pressedBy: string | null
  readonly campaignId: string
}

/** 一个单位的结局。`kernel_error` = Kernel 抛错（不是 Kernel 给出的某个结论）。 */
export interface StopLossUnitOutcome {
  readonly adsetId: string
  readonly name: string
  readonly runId: string | null
  readonly kind: ActionRunOutcome['kind'] | 'kernel_error' | 'invalid_unit'
  readonly humanReason: string | null
}

export interface StopLossSubmissionResult {
  readonly action: StopLossKernelAction
  readonly units: readonly StopLossUnitOutcome[]
}

const ACTION_KEYS: Record<StopLossKernelAction, string> = {
  pause: 'ads.pause_unit',
  cut: 'ads.cut_unit_budget',
}

/**
 * 构造一个单位的 `SubmitActionInput`。
 *
 * 🔴 `input` 里只说「动哪个实体、想改成多少」。改之前是多少、账户合计多少、日上限多少
 *    —— 一个字都不从这里传：那些事实由 `capabilities/ads/envelope-facts.ts` 自己去读快照。
 *    让被约束者自报约束等于没有约束。
 */
function buildSubmitInput(
  input: StopLossSubmissionInput,
  unit: StopLossUnit,
): SubmitActionInput {
  const base = {
    cycle_date: input.cycleDate,
    ad_account_id: input.adAccountId,
    adset_id: unit.adsetId,
  }
  return {
    clientId: input.clientId,
    actionKey: ACTION_KEYS[input.action],
    purpose: 'growth',
    goalId: input.goalId,
    triggeredBy: 'human',
    triggeredByRef: input.pressedBy,
    rationale:
      input.action === 'pause'
        ? '有人在广告健康看板上按了「止损 · 暂停」'
        : '有人在广告健康看板上按了「止损 · 砍预算」',
    evidence: {
      source: 'ads_health_stop_loss',
      campaign_id: input.campaignId,
      unit_name: unit.name,
      current_daily_budget_cents: unit.currentCents,
    },
    input:
      input.action === 'cut' && unit.afterCents !== null
        ? { ...base, after_cents: unit.afterCents }
        : base,
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 提交一次止损。一个投放单位一条 `action_run`，串行。
 *
 * 不抛错：每个单位的失败都被收成它自己的一条 outcome，交给路由如实回给人看。
 * 这里唯一「不做」的情况是砍预算却没给 `afterCents` —— 那是调用方算漏了，
 * 记成 `invalid_unit` 而不是拿一个猜出来的预算去提交。
 */
export async function submitStopLossThroughKernel(
  deps: KernelDeps,
  input: StopLossSubmissionInput,
): Promise<StopLossSubmissionResult> {
  const units: StopLossUnitOutcome[] = []

  for (const unit of input.units) {
    if (input.action === 'cut' && unit.afterCents === null) {
      units.push({
        adsetId: unit.adsetId,
        name: unit.name,
        runId: null,
        kind: 'invalid_unit',
        humanReason: '没算出这个投放单位砍完是多少预算，没有提交（不拿猜出来的数字动钱）',
      })
      continue
    }

    try {
      const outcome = await runAction(deps, buildSubmitInput(input, unit))
      units.push({
        adsetId: unit.adsetId,
        name: unit.name,
        runId: outcome.run.id,
        kind: outcome.kind,
        humanReason: outcome.humanReason,
      })
    } catch (err) {
      units.push({
        adsetId: unit.adsetId,
        name: unit.name,
        runId: null,
        kind: 'kernel_error',
        humanReason: messageOf(err),
      })
    }
  }

  return { action: input.action, units }
}
