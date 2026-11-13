/**
 * Build ads_decision_v1 after a budget or pause confirmation card executes successfully.
 */

import type { BudgetHold } from '@/lib/ads-budget-card/ledger'
import type { PauseHold } from '@/lib/ads-pause-card/ledger'
import { BUDGET_CARD_ACTION, PAUSE_CARD_ACTION } from '@/lib/flywheel/attribution/executed-review'
import type { AdsDecisionV1 } from './types'
import { ADS_DECISION_SCHEMA_VERSION } from './types'
import { nzBusinessDateFromIso } from './persist'

function actor(email: string | null): AdsDecisionV1['decided_by'] {
  return { kind: 'card_execution', label: email?.trim() || 'card' }
}

function budgetWhatDone(hold: BudgetHold): string {
  const before = (hold.beforeCents / 100).toFixed(2)
  const after = (hold.afterCents / 100).toFixed(2)
  return hold.direction === 'up'
    ? `日预算从 ${before} 提高到 ${after}`
    : `日预算从 ${before} 降到 ${after}`
}

export function decisionFromBudgetCard(input: {
  actionId: string
  hold: BudgetHold
  confirmedEmail: string | null
  executedAt: string
}): AdsDecisionV1 {
  const windowDays = input.hold.observationWindowDays
  const adsetRef = input.hold.order.adsetId
  return {
    schema_version: ADS_DECISION_SCHEMA_VERSION,
    decided_at: input.executedAt,
    decided_by: actor(input.confirmedEmail),
    subject: {
      level: 'adset',
      ref: adsetRef,
      label_zh: '已执行的预算确认卡',
    },
    decision_type: 'budget_change',
    what_done_zh: budgetWhatDone(input.hold),
    evidence_at_decision: { note_zh: '来自确认卡执行瞬间的台账' },
    reasoning_zh: '人在 ME 点了确认卡并执行成功。',
    expectation: {
      items: [{
        metric: 'cpl_ratio_to_target',
        target: '≤ 1.0',
        horizon_days: windowDays,
        scope: 'adset',
      }],
    },
    stop_or_rollback_zh: '若观察期内获客成本持续明显高于目标，再开调预算或暂停确认卡。',
    review_due_on: nzBusinessDateFromIso(input.executedAt, windowDays),
    status: 'active',
    review_result: null,
    linked_card_action_id: input.actionId,
  }
}

export function decisionFromPauseCard(input: {
  actionId: string
  hold: PauseHold
  executedAt: string
}): AdsDecisionV1 {
  const windowDays = input.hold.order.observationDays
  const adsetRef = input.hold.order.adsetId
  return {
    schema_version: ADS_DECISION_SCHEMA_VERSION,
    decided_at: input.executedAt,
    decided_by: actor(null),
    subject: {
      level: 'adset',
      ref: adsetRef,
      label_zh: '已执行的暂停确认卡',
    },
    decision_type: 'execute',
    what_done_zh: '暂停了这一组广告',
    evidence_at_decision: { note_zh: '来自确认卡执行瞬间的台账' },
    reasoning_zh: '人在 ME 点了暂停确认卡并执行成功。',
    expectation: {
      items: [{
        metric: 'cpl_ratio_to_target',
        target: '≤ 1.0',
        horizon_days: windowDays,
        scope: 'adset',
      }],
    },
    stop_or_rollback_zh: '若暂停后账户花费或成效异常，复核是否误停。',
    review_due_on: nzBusinessDateFromIso(input.executedAt, windowDays),
    status: 'active',
    review_result: null,
    linked_card_action_id: input.actionId,
  }
}

export const CARD_DECISION_ACTION_TYPES = [BUDGET_CARD_ACTION, PAUSE_CARD_ACTION] as const
