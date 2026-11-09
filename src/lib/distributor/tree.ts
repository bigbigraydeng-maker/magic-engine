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
export function ancestorsOf(byId: ReadonlyMap<string, Distributor>, id: string): string[] {
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
