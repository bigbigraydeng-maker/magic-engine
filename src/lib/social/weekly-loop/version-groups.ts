export interface VersionRow {
  id: string
  created_at: string
  brief: unknown
  overlay: string | null
}

export interface VersionGroup {
  latestId: string
  memberIds: string[]
}

export interface AmbiguousVersions {
  ids: string[]
  reason: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function readNestedString(
  record: Record<string, unknown>,
  key: string,
  nestedKey: string,
): string | null {
  const nested = record[key]
  if (!isRecord(nested)) {
    return null
  }
  return readString(nested[nestedKey])
}

function readLinkTargets(brief: unknown): string[] {
  if (!isRecord(brief)) {
    return []
  }
  const targets: string[] = []
  const variantOf = readNestedString(brief, 'variant_of', 'base_work_order_id')
  if (variantOf !== null) {
    targets.push(variantOf)
  }
  const reopenedFrom = readString(brief['reopened_from'])
  if (reopenedFrom !== null) {
    targets.push(reopenedFrom)
  }
  return targets
}

function normaliseOverlay(overlay: string | null): string | null {
  if (overlay === null) {
    return null
  }
  const normalised = overlay.trim().replace(/\s+/g, ' ').toLowerCase()
  return normalised.length === 0 ? null : normalised
}

class UnionFind {
  private readonly parent: Map<string, string> = new Map()

  add(id: string): void {
    if (!this.parent.has(id)) {
      this.parent.set(id, id)
    }
  }

  find(id: string): string {
    let root = id
    let current = this.parent.get(root)
    while (current !== undefined && current !== root) {
      root = current
      current = this.parent.get(root)
    }
    let walker = id
    let next = this.parent.get(walker)
    while (next !== undefined && next !== root) {
      this.parent.set(walker, root)
      walker = next
      next = this.parent.get(walker)
    }
    return root
  }

  union(a: string, b: string): void {
    const rootA = this.find(a)
    const rootB = this.find(b)
    if (rootA !== rootB) {
      this.parent.set(rootB, rootA)
    }
  }

  clone(): UnionFind {
    const copy = new UnionFind()
    for (const [id, parent] of this.parent.entries()) {
      copy.parent.set(id, parent)
    }
    return copy
  }
}

interface ValidRow {
  row: VersionRow
  time: number
  overlay: string | null
  linkTargets: string[]
}

function collectValidRows(
  rows: readonly VersionRow[],
  ambiguous: AmbiguousVersions[],
): ValidRow[] {
  const valid: ValidRow[] = []
  for (const row of rows) {
    const time = Date.parse(row.created_at)
    if (Number.isNaN(time)) {
      ambiguous.push({ ids: [row.id], reason: 'bad_created_at' })
      continue
    }
    valid.push({
      row,
      time,
      overlay: normaliseOverlay(row.overlay),
      linkTargets: readLinkTargets(row.brief),
    })
  }
  return valid
}

function buildIdLinks(valid: readonly ValidRow[]): UnionFind {
  const uf = new UnionFind()
  const ids = new Set<string>()
  for (const entry of valid) {
    ids.add(entry.row.id)
    uf.add(entry.row.id)
  }
  for (const entry of valid) {
    for (const target of entry.linkTargets) {
      if (ids.has(target) && target !== entry.row.id) {
        uf.union(entry.row.id, target)
      }
    }
  }
  return uf
}

function groupIdsByOverlay(valid: readonly ValidRow[]): Map<string, string[]> {
  const byOverlay = new Map<string, string[]>()
  for (const entry of valid) {
    if (entry.overlay === null) {
      continue
    }
    const bucket = byOverlay.get(entry.overlay)
    if (bucket === undefined) {
      byOverlay.set(entry.overlay, [entry.row.id])
    } else {
      bucket.push(entry.row.id)
    }
  }
  return byOverlay
}

function buildOverlayLinks(
  valid: readonly ValidRow[],
  base: UnionFind,
): UnionFind {
  const uf = base.clone()
  const byOverlay = groupIdsByOverlay(valid)
  for (const ids of byOverlay.values()) {
    if (ids.length < 2) {
      continue
    }
    const first = ids[0]
    for (let i = 1; i < ids.length; i += 1) {
      uf.union(first, ids[i])
    }
  }
  return uf
}

function collectComponents(
  uf: UnionFind,
  ids: readonly string[],
): Map<string, string[]> {
  const components = new Map<string, string[]>()
  for (const id of ids) {
    const root = uf.find(id)
    const bucket = components.get(root)
    if (bucket === undefined) {
      components.set(root, [id])
    } else {
      bucket.push(id)
    }
  }
  return components
}

function countComponentSizes(
  valid: readonly ValidRow[],
  idLinks: UnionFind,
): Map<string, number> {
  const sizes = new Map<string, number>()
  for (const entry of valid) {
    const root = idLinks.find(entry.row.id)
    sizes.set(root, (sizes.get(root) ?? 0) + 1)
  }
  return sizes
}

function isConflictingOverlayGroup(
  ids: readonly string[],
  idLinks: UnionFind,
  sizes: Map<string, number>,
): boolean {
  if (ids.length < 2) {
    return false
  }
  const idRoots = new Set<string>()
  for (const id of ids) {
    idRoots.add(idLinks.find(id))
  }
  if (idRoots.size <= 1) {
    return false
  }
  for (const root of idRoots) {
    if ((sizes.get(root) ?? 0) > 1) {
      return true
    }
  }
  return false
}

function findConflictingComponents(
  valid: readonly ValidRow[],
  idLinks: UnionFind,
  overlayLinks: UnionFind,
): string[][] {
  const byOverlay = groupIdsByOverlay(valid)
  const sizes = countComponentSizes(valid, idLinks)

  const conflictingRoots = new Set<string>()
  for (const ids of byOverlay.values()) {
    if (!isConflictingOverlayGroup(ids, idLinks, sizes)) {
      continue
    }
    conflictingRoots.add(overlayLinks.find(ids[0]))
  }

  const result: string[][] = []
  for (const root of conflictingRoots) {
    const members: string[] = []
    for (const entry of valid) {
      if (overlayLinks.find(entry.row.id) === root) {
        members.push(entry.row.id)
      }
    }
    members.sort()
    result.push(members)
  }
  return result
}

function pickLatest(members: readonly ValidRow[]): string {
  let best = members[0]
  for (let i = 1; i < members.length; i += 1) {
    const candidate = members[i]
    if (candidate.time > best.time) {
      best = candidate
    } else if (candidate.time === best.time && candidate.row.id > best.row.id) {
      best = candidate
    }
  }
  return best.row.id
}

export function groupVersions(rows: readonly VersionRow[]): {
  groups: VersionGroup[]
  ambiguous: AmbiguousVersions[]
} {
  const ambiguous: AmbiguousVersions[] = []
  const valid = collectValidRows(rows, ambiguous)

  if (valid.length === 0) {
    return { groups: [], ambiguous }
  }

  const idLinks = buildIdLinks(valid)
  const overlayLinks = buildOverlayLinks(valid, idLinks)

  const ids = valid.map((entry) => entry.row.id)
  const components = collectComponents(overlayLinks, ids)

  const validById = new Map<string, ValidRow>()
  for (const entry of valid) {
    validById.set(entry.row.id, entry)
  }

  const groups: VersionGroup[] = []
  for (const memberIds of components.values()) {
    const members: ValidRow[] = []
    for (const id of memberIds) {
      const entry = validById.get(id)
      if (entry !== undefined) {
        members.push(entry)
      }
    }
    const sortedIds = members.map((entry) => entry.row.id).sort()
    groups.push({ latestId: pickLatest(members), memberIds: sortedIds })
  }

  groups.sort((a, b) => (a.latestId < b.latestId ? -1 : a.latestId > b.latestId ? 1 : 0))

  const conflicts = findConflictingComponents(valid, idLinks, overlayLinks)
  for (const conflictIds of conflicts) {
    ambiguous.push({ ids: conflictIds, reason: 'conflicting_links' })
  }

  return { groups, ambiguous }
}
