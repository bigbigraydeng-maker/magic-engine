/**
 * Delivery / review issues from latest entity snapshots (read-only).
 */

import type { EntityLevel } from './refs'

export type DeliveryCategory =
  | 'rejected'
  | 'with_issues'
  | 'learning_limited'
  | 'paused_by_parent'

export interface SnapshotLite {
  level: EntityLevel
  entity_id: string
  entity_name: string | null
  effective_status: string | null
  status: string | null
  learning_stage: string | null
}

export interface DeliveryIssue {
  category: DeliveryCategory
  level: EntityLevel
  entity_id: string
  name: string | null
  effective_status: string | null
  learning_stage: string | null
  detail: string
}

export function classifyDeliveryIssues(snaps: readonly SnapshotLite[]): DeliveryIssue[] {
  const out: DeliveryIssue[] = []
  for (const s of snaps) {
    const eff = s.effective_status ?? ''
    const st = s.status ?? ''
    const learn = (s.learning_stage ?? '').toUpperCase()

    if (eff === 'DISAPPROVED' || eff.includes('DISAPPROVED')) {
      out.push({
        category: 'rejected',
        level: s.level,
        entity_id: s.entity_id,
        name: s.entity_name,
        effective_status: s.effective_status,
        learning_stage: s.learning_stage,
        detail: '审核被拒（DISAPPROVED）',
      })
      continue
    }

    if (eff === 'WITH_ISSUES') {
      out.push({
        category: 'with_issues',
        level: s.level,
        entity_id: s.entity_id,
        name: s.entity_name,
        effective_status: s.effective_status,
        learning_stage: s.learning_stage,
        detail: '投放有问题（WITH_ISSUES）',
      })
      continue
    }

    if (learn.includes('LEARNING_LIMITED') || learn === 'LEARNING') {
      out.push({
        category: 'learning_limited',
        level: s.level,
        entity_id: s.entity_id,
        name: s.entity_name,
        effective_status: s.effective_status,
        learning_stage: s.learning_stage,
        detail: '学习阶段受限',
      })
      continue
    }

    const parentPaused =
      (eff === 'CAMPAIGN_PAUSED' || eff === 'ADSET_PAUSED') && st === 'ACTIVE'
    if (parentPaused) {
      out.push({
        category: 'paused_by_parent',
        level: s.level,
        entity_id: s.entity_id,
        name: s.entity_name,
        effective_status: s.effective_status,
        learning_stage: s.learning_stage,
        detail: '上层被暂停，本条本身仍是 ACTIVE',
      })
    }
  }
  return out
}
