/**
 * Previous daily budget = the start of the unbroken run of executed increases
 * that ends on the current ad set amount. A gap, a decrease, or two rows with
 * the same time means we do not guess.
 */

export interface ChainStep {
  readonly adsetId: string
  readonly beforeCents: number
  readonly afterCents: number
  readonly executedAt: string
  readonly wroteMeta: boolean
  readonly status: string
}

const OPEN = new Set(['holding', 'writing', 'awaiting'])

export function hasOpenBudgetHold(steps: readonly ChainStep[], adsetId: string): boolean {
  return steps.some((step) => step.adsetId === adsetId && OPEN.has(step.status))
}

export function restoreCents(
  steps: readonly ChainStep[],
  adsetId: string,
  currentCents: number,
): number | null {
  const mine = chronological(steps.filter((step) => (
    step.adsetId === adsetId && step.status === 'executed' && step.wroteMeta
  )))
  if (!mine) return null
  const last = mine[mine.length - 1]
  if (!last || last.afterCents !== currentCents || last.afterCents <= last.beforeCents) return null
  return walk(mine, last.beforeCents)
}

function chronological(steps: readonly ChainStep[]): ChainStep[] | null {
  if (steps.length === 0 || steps.some((step) => !step.executedAt)) return null
  const times = steps.map((step) => step.executedAt)
  if (new Set(times).size !== times.length) return null
  return [...steps].sort((left, right) => (left.executedAt < right.executedAt ? -1 : 1))
}

function walk(steps: readonly ChainStep[], start: number): number | null {
  let restore = start
  for (let index = steps.length - 2; index >= 0; index -= 1) {
    const step = steps[index]
    const next = steps[index + 1]
    if (!step || !next || step.afterCents !== next.beforeCents || step.afterCents <= step.beforeCents) break
    restore = step.beforeCents
  }
  const current = steps[steps.length - 1]?.afterCents
  return current !== undefined && restore < current ? restore : null
}
