/**
 * When a plan is approved, older approved plans for the same client and goal
 * are archived. This file is the pure rule and the sentence the page shows.
 * It does not talk to the database.
 */

import type { MarketingPlan } from '../types'
import { planLinkedGoalId } from './plan-pick'

const NZ_ZONE = 'Pacific/Auckland'

export interface PriorApprovedRow {
  id: string
  client_id: string
  status: string
  updated_at: string
  plan_data: unknown
  generation_meta: MarketingPlan['generation_meta']
}

export interface SupersededBy {
  plan_id: string
  at: string
}

type GoalPlan = Pick<PriorApprovedRow, 'id' | 'plan_data' | 'generation_meta'>

/** Approved rows for the same non-empty goal. Drafts, other goals, and this plan are left out. */
export function priorApprovedSameGoal(
  approving: GoalPlan,
  clientId: string,
  rows: readonly PriorApprovedRow[],
): PriorApprovedRow[] {
  const goalId = planLinkedGoalId(approving)
  if (goalId === '') return []
  return rows.filter(row =>
    row.client_id === clientId
    && row.id !== approving.id
    && row.status === 'approved'
    && planLinkedGoalId(row) === goalId
  )
}

export function readSupersededBy(meta: MarketingPlan['generation_meta']): SupersededBy | null {
  const raw = meta?.superseded_by
  if (!raw) return null
  const planId = typeof raw.plan_id === 'string' ? raw.plan_id.trim() : ''
  const at = typeof raw.at === 'string' ? raw.at.trim() : ''
  if (planId === '' || at === '') return null
  return { plan_id: planId, at }
}

/** Calendar date in New Zealand. Invalid timestamps return null. */
export function nzCalendarDate(iso: string): string | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: NZ_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? ''
  const year = get('year')
  const month = get('month')
  const day = get('day')
  if (year === '' || month === '' || day === '') return null
  return `${year}-${month}-${day}`
}

/** Sentence for an archived plan that was replaced. Null when this plan was not replaced. */
export function supersededReplacementText(meta: MarketingPlan['generation_meta']): string | null {
  const stamp = readSupersededBy(meta)
  if (!stamp) return null
  const day = nzCalendarDate(stamp.at)
  return day ? `已被新计划替换（${day}）` : '已被新计划替换'
}

/** Status text for a plan list. Replaced plans say so in plain language. */
export function planStatusLabel(
  status: MarketingPlan['status'],
  meta: MarketingPlan['generation_meta'],
): string {
  if (status === 'archived') return supersededReplacementText(meta) ?? '已归档'
  if (status === 'draft') return '草稿'
  if (status === 'approved') return '执行中'
  return '已完成'
}
