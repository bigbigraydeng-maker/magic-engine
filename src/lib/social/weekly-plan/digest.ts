/**
 * Identity of one week's slots. Approval is stamped beside it and is not part of the identity.
 */

import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'

import type { WeeklySocialPlan } from './types'

export interface PlanApproval {
  status: 'confirmed' | 'declined'
  at: string
}

export function slotDigest(plan: WeeklySocialPlan): string {
  return canonicalHashOfInput({
    week: plan.weekStart,
    stage: plan.stage,
    counts: plan.counts,
    items: plan.items.map((item) => ({
      index: item.index,
      format: item.format,
      group: item.contentGroup,
      themeId: item.themeId,
      ...(item.date ? { date: item.date } : {}),
      ...(item.draftRef ? { ref: item.draftRef } : {}),
    })),
  })
}

export function mergeApproval(planData: Record<string, unknown>, approval: PlanApproval): Record<string, unknown> {
  return { ...planData, approval }
}

export function readApproval(raw: unknown): PlanApproval | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  if (row.status !== 'confirmed' && row.status !== 'declined') return null
  if (typeof row.at !== 'string' || row.at.length < 10 || row.at.length > 40) return null
  return { status: row.status, at: row.at }
}
