/**
 * 广告自治「熔断器」的落库那一半。
 *
 * 为什么先记账后止损：
 *   事件行是 append-only 的审计账本，先写账本再动档位，任何一次熔断都能在
 *   ads_circuit_events 里查到「为什么切了」。顺序反过来会出现「档位已经降级、
 *   但账本里查不到原因」的黑箱状态，事后无法复盘。
 *
 * 为什么记账失败不阻断止损：
 *   第 2 步是「记账」，第 3 步是「止损」。让记账失败挡住止损，等于因为账没记上
 *   就放着客户的钱继续烧 —— 那是 fail-open。所以 insert 失败只把 eventWriteError
 *   带回去，让调用方知道「这笔没落账」，但止损照做。
 *
 * 为什么这里只写 'observe' 而永远不写 'deny'：
 *   1. ad_strategy_configs.autonomy_mode 的数据库 CHECK 只允许 'observe' 和
 *      'bounded_auto' 两档，根本没有 'deny' 这一档，写 'deny' 会被数据库直接拒绝。
 *   2. deny 是管理员级别的硬闸，本模块不是它的写入者。熔断器只负责把自治降级回
 *      只观察，让「人」来决定要不要重新打开。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  evaluateCircuitBreaker,
  type CircuitBreakerDecision,
  type CircuitBreakerEvidence,
} from './circuit-breaker'

/** 写进 autonomy_mode_updated_by 的审计标签。 */
export const CIRCUIT_BREAKER_ACTOR = 'system:ads-circuit-breaker'

export type ModeSwitchResult =
  | 'switched_to_observe'
  | 'not_required'
  | 'already_observe'
  | 'no_config'

export interface CircuitBreakerApplyResult {
  readonly decision: CircuitBreakerDecision
  readonly eventsWritten: number
  readonly modeSwitch: ModeSwitchResult
  /** 事件写失败时的原因；成功为 null。**不为 null 时调用方必须当成没落账处理。** */
  readonly eventWriteError: string | null
}

interface InsertEventsResult {
  readonly eventsWritten: number
  readonly eventWriteError: string | null
}

/**
 * 把每条判据映射成一行 append-only 事件，一次批量写。
 * 失败不抛错，只把原因带回去 —— 记账失败不许挡住止损。
 */
async function insertEvents(
  sb: SupabaseClient,
  evidence: CircuitBreakerEvidence,
  decision: CircuitBreakerDecision,
): Promise<InsertEventsResult> {
  const rows = decision.verdicts.map((verdict) => ({
    client_id: evidence.clientId,
    occurred_on: evidence.cycleDate,
    trigger_code: verdict.code,
    outcome: verdict.outcome,
    evidence: verdict.evidence,
  }))

  const { error } = await sb.from('ads_circuit_events').insert(rows)

  if (error) {
    return { eventsWritten: 0, eventWriteError: error.message }
  }
  return { eventsWritten: rows.length, eventWriteError: null }
}

/**
 * 把自治档位降回只观察。
 * 读不到现状就 fail closed（抛错）；同值不写，避免无谓 updated_at 变化触发另一个同步 worker 空转。
 */
async function switchToObserve(
  sb: SupabaseClient,
  clientId: string,
): Promise<ModeSwitchResult> {
  const { data, error: readError } = await sb
    .from('ad_strategy_configs')
    .select('autonomy_mode')
    .eq('client_id', clientId)
    .maybeSingle()

  if (readError) {
    throw new Error(
      `熔断器读不到当前自治档位，无法判断要不要写：${readError.message}`,
    )
  }
  if (data === null) {
    return 'no_config'
  }
  if (data.autonomy_mode === 'observe') {
    return 'already_observe'
  }

  const { error: updateError } = await sb
    .from('ad_strategy_configs')
    .update({
      autonomy_mode: 'observe',
      autonomy_mode_updated_by: CIRCUIT_BREAKER_ACTOR,
    })
    .eq('client_id', clientId)

  if (updateError) {
    throw new Error(`熔断器止损失败，自治档位没能降回只观察：${updateError.message}`)
  }
  return 'switched_to_observe'
}

export async function applyCircuitBreaker(
  sb: SupabaseClient,
  evidence: CircuitBreakerEvidence,
): Promise<CircuitBreakerApplyResult> {
  const decision = evaluateCircuitBreaker(evidence)

  // 第 2 步：先记账。失败也不 return、不 throw，继续走止损。
  const { eventsWritten, eventWriteError } = await insertEvents(
    sb,
    evidence,
    decision,
  )

  // 第 3 步：再止损。只在需要切档位时才做。
  let modeSwitch: ModeSwitchResult
  if (decision.switchToObserve) {
    modeSwitch = await switchToObserve(sb, evidence.clientId)
  } else {
    modeSwitch = 'not_required'
  }

  return { decision, eventsWritten, modeSwitch, eventWriteError }
}
