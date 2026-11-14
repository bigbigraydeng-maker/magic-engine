import { toMs } from './time'
import { LEVEL_ORDER, type Distributor, type DistributorLevel } from './types'

export class DistributorTreeError extends Error {}

/** Level in force at `at` (ISO). Throws if the distributor had no level yet. */
export function levelAt(distributor: Distributor, at: string): DistributorLevel {
  const atMs = toMs(at)
  let best: { level: DistributorLevel; ms: number } | null = null
  for (const change of distributor.levelHistory) {
    const ms = toMs(change.effectiveFrom)
    if (ms <= atMs && (best === null || ms >= best.ms)) best = { level: change.level, ms }
  }
  if (best === null) {
    throw new DistributorTreeError(`distributor ${distributor.id} has no level at ${at}`)
  }
  return best.level
}

/** Like levelAt, but null for someone with no level yet (a pending or rejected applicant). */
export function levelAtOrNull(distributor: Distributor, at: string): DistributorLevel | null {
  const atMs = toMs(at)
  return distributor.levelHistory.some((c) => toMs(c.effectiveFrom) <= atMs) ? levelAt(distributor, at) : null
}

export function levelRank(level: DistributorLevel): number {
  return LEVEL_ORDER.indexOf(level)
}

export interface DistributorIndex {
  byId: ReadonlyMap<string, Distributor>
  children: ReadonlyMap<string, readonly string[]>
  roots: readonly string[]
}

/** Builds lookup maps and rejects unknown parents and cycles. */
export function indexDistributors(distributors: readonly Distributor[]): DistributorIndex {
  const byId = new Map(distributors.map((d) => [d.id, d]))
  const children = new Map<string, string[]>()
  const roots: string[] = []
  for (const d of distributors) {
    if (d.parentId === null) {
      roots.push(d.id)
      continue
    }
    if (!byId.has(d.parentId)) {
      throw new DistributorTreeError(`distributor ${d.id} has unknown parent ${d.parentId}`)
    }
    const list = children.get(d.parentId) ?? []
    list.push(d.id)
    children.set(d.parentId, list)
  }
  for (const d of distributors) ancestorsOf(byId, d.id)
  return { byId, children, roots }
}

/** Upline chain from the direct parent upward. Throws on a cycle. */
export function ancestorsOf(byId: ReadonlyMap<string, { parentId: string | null }>, id: string): string[] {
  const chain: string[] = []
  const seen = new Set<string>([id])
  let current = byId.get(id)?.parentId ?? null
  while (current !== null) {
    if (seen.has(current)) throw new DistributorTreeError(`cycle at distributor ${current}`)
    seen.add(current)
    chain.push(current)
    current = byId.get(current)?.parentId ?? null
  }
  return chain
}

/** Parent/child index for any id→parent rows. Same cycle rules as indexDistributors, without levels. */
export function indexParents<T extends { id: string; parentId: string | null }>(rows: readonly T[]) {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const children = new Map<string, string[]>()
  const roots: string[] = []
  for (const row of rows) {
    if (row.parentId === null) {
      roots.push(row.id)
      continue
    }
    if (!byId.has(row.parentId)) {
      throw new DistributorTreeError(`distributor ${row.id} has unknown parent ${row.parentId}`)
    }
    const list = children.get(row.parentId) ?? []
    list.push(row.id)
    children.set(row.parentId, list)
  }
  for (const row of rows) ancestorsOf(byId, row.id)
  return { byId, children: children as ReadonlyMap<string, readonly string[]>, roots }
}
