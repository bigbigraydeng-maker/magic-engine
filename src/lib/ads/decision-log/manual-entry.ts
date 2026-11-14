/**
 * Build manual / agent ads_decision_v1 rows for flywheel_actions.
 */

import type { AdsDecisionV1 } from './types'
import { ADS_DECISION_SCHEMA_VERSION } from './types'
import { nzBusinessDateFromIso } from './persist'

export interface ManualDecisionInput {
  readonly subjectLevel: AdsDecisionV1['subject']['level']
  readonly subjectRef: string
  readonly subjectLabel: string
  readonly decisionType: string
  readonly whatDoneZh: string
  readonly reasoningZh: string
  readonly stopOrRollbackZh: string
  readonly reviewHorizonDays: number
  readonly decidedByLabel: string
  readonly status: 'active' | 'pending_confirm'
  readonly expectationNotesZh?: string
  readonly evidenceNoteZh?: string
  readonly entityRefsForCtr?: readonly string[]
}

export function buildManualDecision(input: ManualDecisionInput, decidedAt: string): AdsDecisionV1 {
  const items: AdsDecisionV1['expectation']['items'] = []
  if (input.entityRefsForCtr && input.entityRefsForCtr.length > 0) {
    items.push({
      metric: 'per_ad_link_ctr',
      target: '≥ 1.8%',
      horizon_days: input.reviewHorizonDays,
      scope: 'each_new_static_ad',
      entity_refs: input.entityRefsForCtr,
    })
  }
  items.push({
    metric: 'cpl_ratio_to_target',
    target: '≤ 1.0',
    horizon_days: input.reviewHorizonDays,
    scope: 'adset',
    consecutive_days: 2,
  })
  return {
    schema_version: ADS_DECISION_SCHEMA_VERSION,
    decided_at: decidedAt,
    decided_by: {
      kind: input.status === 'pending_confirm' ? 'agent_draft' : 'human',
      label: input.decidedByLabel,
    },
    subject: {
      level: input.subjectLevel,
      ref: input.subjectRef,
      label_zh: input.subjectLabel,
    },
    decision_type: input.decisionType,
    what_done_zh: input.whatDoneZh,
    evidence_at_decision: { note_zh: input.evidenceNoteZh ?? '人工录入' },
    reasoning_zh: input.reasoningZh,
    expectation: {
      items,
      notes_zh: input.expectationNotesZh,
    },
    stop_or_rollback_zh: input.stopOrRollbackZh,
    review_due_on: nzBusinessDateFromIso(decidedAt, input.reviewHorizonDays),
    status: input.status,
    review_result: null,
  }
}
