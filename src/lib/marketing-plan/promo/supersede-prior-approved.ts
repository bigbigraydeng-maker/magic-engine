/**
 * When a plan is approved, older approved plans for the same client and goal
 * are archived. This file is the pure rule and the sentence a page can show.
 * It does not talk to the database.
 *
 * Goal identity is planLinkedGoalId: the promo form goal, otherwise the
 * blank-draft goal. A plan with neither has an empty goal. Approving that
 * plan archives other approved plans of the same client that also have an
 * empty goal, and leaves plans that do have a goal.
 */

import type { MarketingPlan } from '../types'
import { planLinkedGoalId } from './plan-pick'

const NZ_ZONE = 'Pacific/Auckland'

export interface PriorApprovedRow {
  id: string
  client_id: string
  status: string
  updated_at: string
  approved_at: string | null
  plan_data: unknown
  generation_meta: MarketingPlan['generation_meta']
}

export interface SupersededBy {
  plan_id: string
  at: string
}

type GoalPlan = Pick<PriorApprovedRow, 'id' | 'plan_data' | 'generation_meta'>

/**
 * Which approved plan to keep when more than one exists for the goal.
 * A later approval time wins. The same time keeps the higher id, so two
 * callers reading the same rows archive the same losers.
 */
export function keptApprovedPlanId(
  rows: readonly Pick<PriorApprovedRow, 'id' | 'approved_at'>[],
): string | null {
  let kept: Pick<PriorApprovedRow, 'id' | 'approved_at'> | null = null
  for (const row of rows) {
    if (kept === null || approvalIsNewer(row, kept)) kept = row
  }
  return kept?.id ?? null
}

function approvalIsNewer(
  row: Pick<PriorApprovedRow, 'id' | 'approved_at'>,
  kept: Pick<PriorApprovedRow, 'id' | 'approved_at'>,
): boolean {
  const byTime = (row.approved_at ?? '').localeCompare(kept.approved_at ?? '')
  if (byTime !== 0) return byTime > 0
  return row.id.localeCompare(kept.id) > 0
}

/** Approved rows for the same client and the same goal, including an empty goal. */
export function priorApprovedSameGoal(
  approving: GoalPlan,
  clientId: string,
  rows: readonly PriorApprovedRow[],
): PriorApprovedRow[] {
  const goalId = planLinkedGoalId(approving)
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
  const year = part(parts, 'year')
  const month = part(parts, 'month')
  const day = part(parts, 'day')
  if (year === '' || month === '' || day === '') return null
  return `${year}-${month}-${day}`
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find(item => item.type === type)?.value ?? ''
}

/** Sentence for an archived plan that was replaced. Null when it was not replaced. */
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
