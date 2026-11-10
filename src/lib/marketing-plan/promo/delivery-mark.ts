/**
 * 已批准计划只改投放阶段。
 *
 * 允许：任何阶段，或还没标 → 稳住；稳住 → 试投。
 * 放量不在这里：放量要更多预算，只能另起一份草稿（POST .../promo/stage-proposal）。
 * 不改每天总上限、不改步骤预算、不写广告后台。
 */
import { STAGE_GOAL } from './delivery-stage'
import { stableStringify } from '../plan-guard'
import type { DeliveryStage, PromoSpec } from './spec'

/** 记在 flywheel_actions。不进可执行词汇，广告适配器认不出它，也就不会去写广告后台。 */
export const MARK_DELIVERY_ACTION = 'ads.mark_delivery_stage'

export type MarkStage = 'steady' | 'test'

export type StageRequest =
  | { ok: true; stage: MarkStage }
  | { ok: false; status: 400 | 409; error: string }

const EXTRA = '只改阶段。每天总上限、预算和其他内容不能从这里改。'
const SCALE = '放量要另起一份计划，不在正在跑的计划上改。请用「生成放量草稿」。'

export function readStageRequest(body: unknown): StageRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, error: EXTRA }
  }
  const record = body as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length !== 1 || keys[0] !== 'stage') return { ok: false, status: 400, error: EXTRA }
  if (record.stage === 'scale') return { ok: false, status: 409, error: SCALE }
  if (record.stage !== 'steady' && record.stage !== 'test') {
    return { ok: false, status: 400, error: '阶段只能标成稳住，或从稳住改回试投。' }
  }
  return { ok: true, stage: record.stage }
}

/** 任何阶段或没标都可以到稳住；只有稳住可以回到试投。 */
export function markAllowed(from: DeliveryStage | null, to: MarkStage): boolean {
  if (to === 'steady') return true
  return from === 'steady'
}

export function refusedMark(): string {
  return '只有稳住可以改回试投。放量请另起草稿。'
}

type DeliveryRow = NonNullable<PromoSpec['delivery']>

/** 阶段句子是结构必填。比例只在原来两份都有时原样留下，不新造。 */
export function nextDelivery(
  existing: PromoSpec['delivery'] | undefined,
  stage: MarkStage,
  startedOn: string,
): DeliveryRow {
  const row: DeliveryRow = { stage, goal: STAGE_GOAL[stage], started_on: startedOn }
  if (existing?.test_share !== undefined && existing.proven_share !== undefined) {
    row.test_share = existing.test_share
    row.proven_share = existing.proven_share
  }
  return row
}

export function planDataWithDelivery(planData: unknown, delivery: DeliveryRow): unknown {
  const root = recordOf(planData)
  const promo = recordOf(root?.promo)
  if (!root || !promo) return null
  return { ...root, promo: { ...promo, delivery } }
}

export function sameExceptDelivery(before: unknown, after: unknown): boolean {
  return stableStringify(withoutDelivery(before)) === stableStringify(withoutDelivery(after))
}

function withoutDelivery(planData: unknown): unknown {
  const root = recordOf(planData)
  if (!root) return planData
  const promo = recordOf(root.promo)
  if (!promo) return root
  const nextPromo = { ...promo }
  delete nextPromo.delivery
  return { ...root, promo: nextPromo }
}

function recordOf(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function auditRow(input: {
  clientId: string
  planId: string
  from: DeliveryStage | null
  to: MarkStage
  by: string
  at: string
}): Record<string, unknown> {
  return {
    client_id: input.clientId,
    flywheel: 'ads',
    action_type: MARK_DELIVERY_ACTION,
    execution_mode: 'in_house',
    payload: {
      plan_id: input.planId,
      from_stage: input.from ?? 'none',
      to_stage: input.to,
      by: input.by,
      at: input.at,
      wrote_meta: false,
    },
    expected_metric: null,
    expected_delta: null,
    executed_at: input.at,
  }
}
