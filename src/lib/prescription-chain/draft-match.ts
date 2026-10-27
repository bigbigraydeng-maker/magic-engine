import { matchPoolEntry } from '@/lib/ads-strategy/promo-window'
import { planForGoal } from './creative'
import type { DraftFact, DraftRow, Loaded, PlanFact, PoolFact } from './types'

/** Every id a plan's creative refs can appear as in a draft: the ref itself plus its pool aliases. */
function identifiersOf(plan: PlanFact, pool: PoolFact[] | null): Set<string> {
  const ids = new Set<string>()
  for (const ref of plan.creativeRefs) {
    ids.add(ref)
    if (!pool) continue
    const match = matchPoolEntry(pool.map((entry) => ({ ref: entry.ref, alias_refs: entry.aliasRefs })), ref)
    if (match.kind !== 'found') continue
    ids.add(match.entry.ref)
    for (const alias of match.entry.alias_refs ?? []) ids.add(alias)
  }
  return ids
}

function overlaps(left: readonly string[], right: Set<string>): boolean {
  return left.some((id) => right.has(id))
}

export interface DraftMatchInput {
  rows: DraftRow[]
  /** Execution items of this prescription (old path, exact link). */
  itemIds: ReadonlySet<string>
  goalId: string | null
  plans: Loaded<PlanFact[]>
  pool: PoolFact[] | null
}

/**
 * Find the ads.create_ad drafts that belong to one prescription.
 * Exact link first (execution item), then the creatives the prescription's own plan names.
 * A draft whose creative is also named by another goal's plan is not attributed to either:
 * the whole answer becomes unread. No match at all is unread too, because
 * "no draft" cannot be told apart from "drafts we cannot link".
 */
export function matchDrafts(input: DraftMatchInput): Loaded<DraftFact[]> {
  const exact = input.rows.filter((row) => row.executionItemId !== null && input.itemIds.has(row.executionItemId))
  const found = new Map<string, DraftRow>(exact.map((row) => [row.id, row]))
  if (input.goalId && input.plans.read === 'ok') {
    const mine = planForGoal(input.plans.value, input.goalId)
    if (mine) {
      const own = identifiersOf(mine, input.pool)
      const others = new Set<string>()
      for (const plan of input.plans.value) {
        if (plan.id === mine.id || plan.status === 'archived' || plan.goalId === input.goalId) continue
        for (const id of identifiersOf(plan, input.pool)) others.add(id)
      }
      for (const row of input.rows) {
        if (found.has(row.id) || !overlaps(row.creativeIds, own)) continue
        if (overlaps(row.creativeIds, others)) return { read: 'unread' }
        found.set(row.id, row)
      }
    }
  }
  if (found.size === 0) return { read: 'unread' }
  return { read: 'ok', value: [...found.values()].map((row) => ({ status: row.status })) }
}
