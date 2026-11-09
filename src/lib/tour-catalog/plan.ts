/**
 * Departure import planning: pure function that turns parsed CSV rows into a
 * plan of adds/updates/warnings/rejections. No I/O, no clock access.
 */

import { daysBetween } from './dates'
import { matchTour } from './normalize'
import type { ParsedDepartureRow } from './departures-csv'
import type {
  CatalogAlias,
  CatalogDeparture,
  CatalogDepartureInternal,
  CatalogTour,
  DepartureStatus,
} from './types'

export interface PlanInput {
  rows: ParsedDepartureRow[]
  tours: CatalogTour[]
  aliases: CatalogAlias[]
  existing: CatalogDeparture[]
  today: string
}

export interface PlannedAdd {
  line: number
  tourId: string
  departOn: string
  returnOn: string
  status: DepartureStatus
  internal: CatalogDepartureInternal
}

export interface PlannedUpdate {
  line: number
  departureId: string
  tourId: string
  departOn: string
  before: CatalogDeparture
  after: {
    returnOn: string
    status: DepartureStatus
    internal: CatalogDepartureInternal
  }
}

export interface PlanRejected {
  line: number
  reason: string
  detail?: string
}

export type PlanWarning =
  | { kind: 'suspected_typo'; tourId: string; newDate: string; nearDate: string; days: number }
  | { kind: 'not_in_file'; tourId: string; departureId: string; departOn: string }
  | { kind: 'cancelled_kept'; tourId: string; departureId: string; departOn: string }
  | {
      kind: 'reopens_cancelled'
      tourId: string
      departureId: string
      departOn: string
      newStatus: DepartureStatus
    }

export interface ImportPlan {
  adds: PlannedAdd[]
  updates: PlannedUpdate[]
  unchangedCount: number
  rejected: PlanRejected[]
  warnings: PlanWarning[]
}

/** A row that survived matching, before duplicate resolution. */
interface MatchedRow {
  line: number
  tourId: string
  row: ParsedDepartureRow
}

/** Stable stringify with sorted keys for deep comparison. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']'
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}'
}

/** Match every row against the catalog, splitting into matched rows and rejections. */
function matchRows(
  rows: ParsedDepartureRow[],
  tours: CatalogTour[],
  aliases: CatalogAlias[],
): { matched: MatchedRow[]; rejected: PlanRejected[] } {
  const matched: MatchedRow[] = []
  const rejected: PlanRejected[] = []
  for (const row of rows) {
    const result = matchTour(row.tourName, tours, aliases)
    if (result.status === 'none') {
      rejected.push({ line: row.line, reason: 'tour_not_found', detail: row.tourName })
      continue
    }
    if (result.status === 'ambiguous') {
      const names = result.candidates.map((t) => t.name).join(' | ')
      rejected.push({ line: row.line, reason: 'tour_ambiguous', detail: names })
      continue
    }
    matched.push({ line: row.line, tourId: result.tour.id, row })
  }
  return { matched, rejected }
}

/** True when two matched rows carry identical returnOn/status/internal. */
function rowsEquivalent(a: MatchedRow, b: MatchedRow): boolean {
  return (
    a.row.returnOn === b.row.returnOn &&
    a.row.status === b.row.status &&
    stableStringify(a.row.internal) === stableStringify(b.row.internal)
  )
}

/**
 * Collapse identical duplicates (first line wins) and reject every copy of a
 * conflicting duplicate group. Groups are keyed by (tourId, departOn).
 */
function dedupeRows(matched: MatchedRow[]): { kept: MatchedRow[]; rejected: PlanRejected[] } {
  const groups = new Map<string, MatchedRow[]>()
  const order: string[] = []
  for (const m of matched) {
    const key = m.tourId + '\u0000' + m.row.departOn
    const existing = groups.get(key)
    if (existing === undefined) {
      groups.set(key, [m])
      order.push(key)
    } else {
      existing.push(m)
    }
  }

  const kept: MatchedRow[] = []
  const rejected: PlanRejected[] = []
  for (const key of order) {
    const group = groups.get(key)
    if (group === undefined) {
      continue
    }
    if (group.length === 1) {
      kept.push(group[0])
      continue
    }
    const first = group[0]
    const allSame = group.every((m) => rowsEquivalent(first, m))
    if (allSame) {
      kept.push(first)
    } else {
      for (const m of group) {
        rejected.push({ line: m.line, reason: 'conflicting_duplicate_rows' })
      }
    }
  }
  return { kept, rejected }
}

/** Find an existing departure for a tour on a given date, or undefined. */
function findExisting(
  existing: CatalogDeparture[],
  tourId: string,
  departOn: string,
): CatalogDeparture | undefined {
  return existing.find((d) => d.tourId === tourId && d.departOn === departOn)
}

/** Merge row internal over existing internal (row wins on shared keys). */
function mergeInternal(
  existing: CatalogDepartureInternal,
  row: CatalogDepartureInternal,
): CatalogDepartureInternal {
  return { ...existing, ...row }
}

/** Warning emitted when a cancelled departure is touched by a CSV row. */
function cancelledWarning(
  found: CatalogDeparture,
  tourId: string,
  rowStatus: DepartureStatus | null,
): PlanWarning | undefined {
  if (found.status !== 'cancelled') {
    return undefined
  }
  if (rowStatus === null) {
    return {
      kind: 'cancelled_kept',
      tourId,
      departureId: found.id,
      departOn: found.departOn,
    }
  }
  if (rowStatus !== 'cancelled') {
    return {
      kind: 'reopens_cancelled',
      tourId,
      departureId: found.id,
      departOn: found.departOn,
      newStatus: rowStatus,
    }
  }
  return undefined
}

/** Build the add/update/unchanged outcome for one surviving row. */
function planRow(
  m: MatchedRow,
  existing: CatalogDeparture[],
): { add?: PlannedAdd; update?: PlannedUpdate; unchanged: boolean; warning?: PlanWarning } {
  const found = findExisting(existing, m.tourId, m.row.departOn)
  if (found === undefined) {
    return {
      add: {
        line: m.line,
        tourId: m.tourId,
        departOn: m.row.departOn,
        returnOn: m.row.returnOn,
        status: m.row.status ?? 'open',
        internal: m.row.internal,
      },
      unchanged: false,
    }
  }

  const warning = cancelledWarning(found, m.tourId, m.row.status)
  const newReturnOn = m.row.returnOn
  const newStatus = m.row.status ?? found.status
  const newInternal = mergeInternal(found.internal, m.row.internal)

  const unchanged =
    newReturnOn === found.returnOn &&
    newStatus === found.status &&
    stableStringify(newInternal) === stableStringify(found.internal)

  if (unchanged) {
    return { unchanged: true, warning }
  }

  return {
    update: {
      line: m.line,
      departureId: found.id,
      tourId: m.tourId,
      departOn: m.row.departOn,
      before: found,
      after: { returnOn: newReturnOn, status: newStatus, internal: newInternal },
    },
    unchanged: false,
    warning,
  }
}

/** Tours that have at least one surviving row in this file. */
function toursInFile(kept: MatchedRow[]): Set<string> {
  const set = new Set<string>()
  for (const m of kept) {
    set.add(m.tourId)
  }
  return set
}

/** Dates present in the file for a given tour. */
function fileDatesForTour(kept: MatchedRow[], tourId: string): Set<string> {
  const set = new Set<string>()
  for (const m of kept) {
    if (m.tourId === tourId) {
      set.add(m.row.departOn)
    }
  }
  return set
}

/** Build 'not_in_file' warnings for tours present in the file. */
function notInFileWarnings(
  kept: MatchedRow[],
  existing: CatalogDeparture[],
  today: string,
): PlanWarning[] {
  const warnings: PlanWarning[] = []
  for (const tourId of toursInFile(kept)) {
    const dates = fileDatesForTour(kept, tourId)
    for (const dep of existing) {
      if (dep.tourId !== tourId) {
        continue
      }
      if (dep.departOn < today) {
        continue
      }
      if (dep.status !== 'open' && dep.status !== 'limited') {
        continue
      }
      if (dates.has(dep.departOn)) {
        continue
      }
      warnings.push({
        kind: 'not_in_file',
        tourId,
        departureId: dep.id,
        departOn: dep.departOn,
      })
    }
  }
  return warnings
}

/** Build 'suspected_typo' warnings for each add against near existing departures. */
function suspectedTypoWarnings(
  adds: PlannedAdd[],
  existing: CatalogDeparture[],
  today: string,
): PlanWarning[] {
  const warnings: PlanWarning[] = []
  for (const add of adds) {
    for (const dep of existing) {
      if (dep.tourId !== add.tourId) {
        continue
      }
      if (dep.status === 'cancelled') {
        continue
      }
      if (dep.departOn < today) {
        continue
      }
      const days = daysBetween(add.departOn, dep.departOn)
      if (days >= 1 && days <= 14) {
        warnings.push({
          kind: 'suspected_typo',
          tourId: add.tourId,
          newDate: add.departOn,
          nearDate: dep.departOn,
          days,
        })
      }
    }
  }
  return warnings
}

/** Plan a departure import from parsed CSV rows against the current catalog. */
export function planDepartureImport(input: PlanInput): ImportPlan {
  const { rows, tours, aliases, existing, today } = input

  const { matched, rejected: matchRejected } = matchRows(rows, tours, aliases)
  const { kept, rejected: dupRejected } = dedupeRows(matched)

  const adds: PlannedAdd[] = []
  const updates: PlannedUpdate[] = []
  const rowWarnings: PlanWarning[] = []
  let unchangedCount = 0

  for (const m of kept) {
    const outcome = planRow(m, existing)
    if (outcome.add !== undefined) {
      adds.push(outcome.add)
    } else if (outcome.update !== undefined) {
      updates.push(outcome.update)
    } else if (outcome.unchanged) {
      unchangedCount += 1
    }
    if (outcome.warning !== undefined) {
      rowWarnings.push(outcome.warning)
    }
  }

  const warnings: PlanWarning[] = [
    ...notInFileWarnings(kept, existing, today),
    ...suspectedTypoWarnings(adds, existing, today),
    ...rowWarnings,
  ]

  return {
    adds,
    updates,
    unchangedCount,
    rejected: [...matchRejected, ...dupRejected].sort((x, y) => x.line - y.line),
    warnings,
  }
}
