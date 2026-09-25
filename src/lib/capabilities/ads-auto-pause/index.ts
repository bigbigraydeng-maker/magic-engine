/**
 * Capability · `ads.auto_pause_on_d3`
 *
 * 把 D3（花钱没结果）命中的那一个广告组暂停。两步：`pause`（写）、
 * `verify`（回读，确认真的是 PAUSED——不是「写入没报错就算数」）。
 *
 * 🔴 **只暂停 D3 命中的那一个 adset，从不碰 campaign 级接口。** D3 诊断
 *    （`src/lib/ads-strategy/portfolio/diagnostics/d3-spend-no-result.ts`）
 *    只在 adset 级命中，所以这里没有「一个 campaign 下多个 adset，只有一个
 *    命中就不能连累其他」的问题——那个问题只在复用 campaign 级
 *    `executeStopLoss` 时才存在，本 capability 从设计上就不用它。
 *
 * 🔴 **不重新判断"要不要暂停"**——那是 Growth 候选 + Kernel 授权层的事
 *    （`src/lib/inngest/functions/ads-d3-auto-pause.ts` 在提交前已经判过
 *    共用账户、dry-run、幂等）。capability 只管「把这一个 adset 变成
 *    PAUSED，并证明它真的变了」。
 *
 * 🔴 本文件是 kernel/capabilities 边界之内唯一 import Meta 写路径
 *    （`@/lib/meta/adsets`）的位置。
 */

import type {
  CapabilityImplementation,
  CapabilityStepResult,
  OutwardRollbackResult,
  VerificationResult,
} from '@/lib/kernel/types'
import { KernelError, RetryableCapabilityError } from '@/lib/kernel/errors'
import type { AdsAutoPauseDeps } from './deps'
import { defaultDeps } from './deps'

// ── Input shape（从 ctx.runInput 读——Gateway 已 hash-check + 深冻结） ──────
//
// 🔴 不许从 `action_runs.input` 回读，唯一入口是 `parseRunInput()`
//    （同 page-apply-optimization 的 TOCTOU 防线）。

interface RunInput {
  readonly ad_account_id: string
  readonly adset_id: string
  readonly diagnosis_code: string
  readonly insight_date: string
}

function parseRunInput(runInput: Readonly<Record<string, unknown>>): RunInput {
  const adAccountId = runInput.ad_account_id
  const adsetId = runInput.adset_id
  const diagnosisCode = runInput.diagnosis_code
  const insightDate = runInput.insight_date
  if (
    typeof adAccountId !== 'string' ||
    typeof adsetId !== 'string' ||
    typeof diagnosisCode !== 'string' ||
    typeof insightDate !== 'string'
  ) {
    throw new KernelError('INVALID_INPUT', '执行输入缺字段或类型不对（ctx.runInput）')
  }
  return { ad_account_id: adAccountId, adset_id: adsetId, diagnosis_code: diagnosisCode, insight_date: insightDate }
}

interface PauseOutput {
  readonly adset_id: string
  readonly paused: true
}

// ── Step: pause ──────────────────────────────────────────────────────────────

async function stepPause(
  deps: AdsAutoPauseDeps,
  args: { clientId: string; input: RunInput },
): Promise<CapabilityStepResult> {
  const token = await deps.resolveToken(args.clientId)
  if (!token) {
    // 配置问题，不是瞬时故障——重试不会变好。
    throw new KernelError('INVALID_INPUT', '这个客户现在没有可用的 Meta 令牌，暂停不了广告组')
  }

  let ok: boolean
  try {
    ok = await deps.setAdSetStatus(args.input.adset_id, token, 'PAUSED')
  } catch (e) {
    throw new RetryableCapabilityError(
      `调 Meta 暂停广告组失败：${e instanceof Error ? e.message : String(e)}`,
    )
  }
  if (!ok) {
    throw new RetryableCapabilityError('Meta 没有确认这次暂停写入成功')
  }

  const output: PauseOutput = { adset_id: args.input.adset_id, paused: true }
  return { costActualUsd: 0, output: output as unknown as Record<string, unknown> }
}

// ── Step: verify ─────────────────────────────────────────────────────────────

async function stepVerify(
  deps: AdsAutoPauseDeps,
  args: { clientId: string; input: RunInput },
): Promise<CapabilityStepResult> {
  const token = await deps.resolveToken(args.clientId)
  if (!token) {
    throw new KernelError('INVALID_INPUT', '这个客户现在没有可用的 Meta 令牌，验证不了暂停结果')
  }

  const checks: VerificationResult['checks'] = []
  let status: string | null = null
  try {
    const summary = await deps.getAdSetStatus(args.input.adset_id, token)
    status = summary?.status ?? null
  } catch (e) {
    checks.push({ name: '广告组状态可回读', passed: false, detail: e instanceof Error ? e.message : String(e) })
  }
  if (status !== null) {
    checks.push({ name: '广告组状态可回读', passed: true })
  }
  checks.push({
    name: '广告组状态为 PAUSED',
    passed: status === 'PAUSED',
    detail: status ?? undefined,
  })

  const failed = checks.filter((c) => !c.passed)
  const verification: VerificationResult = {
    method: 'ads_pause_integrity',
    passed: failed.length === 0,
    checks,
    ...(failed.length > 0
      ? { failure_reason: failed.map((c) => `${c.name}${c.detail ? `（${c.detail}）` : ''}`).join('；') }
      : {}),
  }

  return {
    costActualUsd: 0,
    verification,
    output: { adset_id: args.input.adset_id, paused: true, verified_status: status ?? 'unknown' },
  }
}

// ── Rollback（provider_native：暂停是幂等状态置位，撤回 = 设回 ACTIVE） ────
//
// 🔴 跟 page-apply-optimization 的 rollback 不是同一类问题：这里没有「分支 /
//    PR 归属」这种第三方可能巧合创建同名资源的歧义——`adset_id` 是我们授权
//    时就锁定的那一个实体，直接设回 ACTIVE 即可。唯一要判的是「这次执行
//    真的碰过它吗」：`pause` 步骤没跑成 → 零副作用 → noop。

async function rollbackHandler(
  deps: AdsAutoPauseDeps,
  step: { runInput: Readonly<Record<string, unknown>>; ctx: { clientId: string } },
  priorOutputs: Readonly<Record<string, Record<string, unknown>>>,
): Promise<OutwardRollbackResult> {
  const paused = priorOutputs.pause as unknown as PauseOutput | undefined
  if (!paused) {
    return { ok: true, rollbackKind: 'noop', detail: { reason: 'pause 未完成，没有产生过外部副作用' } }
  }

  const input = parseRunInput(step.runInput)
  const token = await deps.resolveToken(step.ctx.clientId)
  if (!token) {
    return {
      ok: false,
      rollbackKind: 'provider_native',
      detail: { adset_id: input.adset_id, reason: 'token_missing' },
      failure_reason: '拒绝 rollback：这个客户现在没有可用的 Meta 令牌',
    }
  }

  try {
    const ok = await deps.setAdSetStatus(input.adset_id, token, 'ACTIVE')
    if (!ok) {
      return {
        ok: false,
        rollbackKind: 'provider_native',
        detail: { adset_id: input.adset_id, reason: 'reactivate_not_confirmed' },
        failure_reason: 'Meta 没有确认重新开启这条广告组',
      }
    }
    return { ok: true, rollbackKind: 'provider_native', detail: { adset_id: input.adset_id, reactivated: true } }
  } catch (e) {
    return {
      ok: false,
      rollbackKind: 'provider_native',
      detail: { adset_id: input.adset_id, reason: 'reactivate_call_failed' },
      failure_reason: `重新开启广告组失败：${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createAdsAutoPauseCapability(
  overrideDeps?: Partial<AdsAutoPauseDeps>,
): CapabilityImplementation {
  const deps: AdsAutoPauseDeps = { ...defaultDeps(), ...(overrideDeps ?? {}) }

  return {
    actionKey: 'ads.auto_pause_on_d3',
    version: 1,
    steps: {
      async pause({ ctx, runInput }) {
        return stepPause(deps, { clientId: ctx.clientId, input: parseRunInput(runInput) })
      },
      async verify({ ctx, runInput }) {
        return stepVerify(deps, { clientId: ctx.clientId, input: parseRunInput(runInput) })
      },
    },
    rollback: (step, priorOutputs) => rollbackHandler(deps, step, priorOutputs),
  }
}
