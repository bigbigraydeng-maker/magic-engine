/**
 * 单条蒸馏（L56-P1.R12 / L6c）：预留 → 一次外呼 → 按实际结算。
 * 不写库、不读库、不记录也不返回正文；正文只作为内存入参交给 prompt。
 * 机器永不写 `adopted`：本文件不产生、也不返回任何 `state` 字段。
 */

import type { DistilledRule, ExpertDomain, Result } from '@/lib/agent-learning/contracts'
import type { BudgetLedger } from '@/lib/agent-learning/budget/types'
import { newAttemptId } from '@/lib/agent-learning/budget/reserve'
import { contentHash } from '@/lib/agent-learning/collect/feeds'
import { costUsd, type DeepSeekClient } from '@/lib/agent-learning/llm/deepseek-client'
import {
  DISTILL_MAX_INPUT_TOKENS,
  DISTILL_MAX_OUTPUT_TOKENS,
  estimateWorstCaseUsd,
  reserveDistillBudget,
  settleDistillBudget,
} from '@/lib/agent-learning/distill/cost-gate'
import { buildDistillPrompt } from '@/lib/agent-learning/distill/prompt'
import { parseDistillOutput, type DroppedRule } from '@/lib/agent-learning/distill/parse'

/** 只依赖客户端的两个能力，便于测试注入替身 */
export type DistillLlm = Pick<DeepSeekClient, 'completeJson' | 'price'>

/** 蒸馏所需的来源字段（名册子集，不含任何客户数据） */
export interface DistillSource {
  sourceKey: string
  expert: string
  domain: ExpertDomain
}

/** 一条待蒸馏内容；正文只在内存里传递，不落库、不进回执 */
export interface DistillItem {
  externalRef: string
  title: string
  text: string
  publishedAt: string | null
}

/** 一次 distillOne 的结果；只含规则、丢弃原因、用量与预留 ID，绝不含正文 */
export interface DistillOutcome {
  rules: DistilledRule[]
  dropped: DroppedRule[]
  actualUsd: number
  inputTokens: number
  outputTokens: number
  truncated: boolean
  reservationId: string
}

/** 外呼结果类型：直接从注入的客户端签名推导，不额外 import */
type LlmCall = Awaited<ReturnType<DistillLlm['completeJson']>>

/** 提示词返回类型：直接从 prompt 模块推导，不额外定义形状 */
type DistillPrompt = ReturnType<typeof buildDistillPrompt>

/**
 * 业务单元标识：`<sourceKey>#<正文 hash 前 12 位>`。
 * 只用于生成预留 ID，不含正文，可安全写进回执与日志。
 */
export function distillUnitId(sourceKey: string, text: string): string {
  return `${sourceKey}#${contentHash(text).slice(0, 12)}`
}

/**
 * 单次外呼（最多一次，不重试）：抛错与返回失败都换算成"结果未知"。
 * 这两种情况下调用方不结算，占用按 2.7 规则 1 保留。
 */
async function callLlmOnce(llm: DistillLlm, prompt: DistillPrompt): Promise<LlmCall> {
  try {
    const completion = await llm.completeJson({
      system: prompt.system,
      user: prompt.user,
      maxOutputTokens: DISTILL_MAX_OUTPUT_TOKENS,
      maxInputTokens: DISTILL_MAX_INPUT_TOKENS,
    })
    if (!completion.ok) {
      return { ok: false, error: `llm_failed_hold_kept:${completion.error}`, code: 'db_error' }
    }
    return completion
  } catch {
    return { ok: false, error: 'llm_threw_hold_kept', code: 'db_error' }
  }
}

/**
 * 蒸馏一条内容：先按最坏用量预留，再一次外呼，再按实际 token 结算。
 * 预留被拒 → 不外呼（fail-closed）；外呼抛错/失败 → 保留占用；解析失败 → 已结算，返回 validation。
 * 每次调用都生成新的预留 ID，重试必须重新预留；同一 `now` 用于预留与结算，保证日 key 一致。
 */
export async function distillOne(
  deps: { llm: DistillLlm; ledger: BudgetLedger; now: () => Date },
  item: DistillItem,
  source: DistillSource,
  attempt: number,
): Promise<Result<DistillOutcome>> {
  const now = deps.now()
  const worst = estimateWorstCaseUsd(
    { maxInputTokens: DISTILL_MAX_INPUT_TOKENS, maxOutputTokens: DISTILL_MAX_OUTPUT_TOKENS },
    deps.llm.price,
  )
  const reservationId = newAttemptId('distill', distillUnitId(source.sourceKey, item.text), attempt)

  // 先建提示词（纯函数）：整份请求的 token 上界必须在预留所依据的上限之内，否则不预留、不外呼
  const prompt = buildDistillPrompt({
    title: item.title,
    text: item.text,
    source: { expert: source.expert, domain: source.domain },
  })

  if (prompt.inputTokenUpperBound > DISTILL_MAX_INPUT_TOKENS) {
    return { ok: false, error: 'prompt_exceeds_input_cap', code: 'validation' }
  }

  const reserved = await reserveDistillBudget(deps.ledger, reservationId, worst, now)
  if (!reserved.ok) {
    return {
      ok: false,
      error: reserved.reason,
      code: reserved.reason === 'budget_ledger_unavailable' ? 'db_error' : 'gate_blocked',
    }
  }

  const called = await callLlmOnce(deps.llm, prompt)
  // 请求已发出但结果未知：不结算，hold 保留（2.7 规则 1）
  if (!called.ok) return called

  const { inputTokens, outputTokens } = called.value
  const actualUsd = costUsd(deps.llm.price, { inputTokens, outputTokens })

  const settled = await settleDistillBudget(deps.ledger, reservationId, actualUsd, now)
  if (!settled.ok) {
    return { ok: false, error: `settle_failed:${settled.error}`, code: 'db_error' }
  }

  const parsed = parseDistillOutput(called.value.text, {
    expert: source.expert,
    url: item.externalRef,
    publishedAt: item.publishedAt ?? now.toISOString(),
    domain: source.domain,
  })
  if (!parsed.ok) return { ok: false, error: parsed.error, code: 'validation' }

  return {
    ok: true,
    value: {
      rules: parsed.value.rules,
      dropped: parsed.value.dropped,
      actualUsd,
      inputTokens,
      outputTokens,
      truncated: prompt.truncated,
      reservationId,
    },
  }
}
