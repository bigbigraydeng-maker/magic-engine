export interface BriefActivationRow {
  id: string
  status?: string | null
  is_active: boolean | null
  project_id?: string | null
}

export type BriefActivationKind =
  | 'consistent_active'
  | 'consistent_none'
  | 'multiple_status_active'
  | 'status_active_but_is_active_false'
  | 'is_active_without_active_status'

export interface BriefActivationReport {
  kind: BriefActivationKind
  status_active_ids: string[]
  is_active_ids: string[]
  /** is_active=true rows whose status is 'draft' (the database default makes AI drafts look like this). */
  draft_with_is_active_ids: string[]
  /** is_active=true rows whose status is null (pre-status legacy rows; the only rows the fallback accepts). */
  legacy_null_status_is_active_ids: string[]
}

function isClientLevelRow(row: BriefActivationRow): boolean {
  return row.project_id === null || row.project_id === undefined
}

function pickKind(
  statusActiveIds: readonly string[],
  isActiveIds: readonly string[],
  statusActiveIsActive: boolean,
): BriefActivationKind {
  if (statusActiveIds.length > 1) return 'multiple_status_active'
  if (statusActiveIds.length === 1 && !statusActiveIsActive) {
    return 'status_active_but_is_active_false'
  }
  const activeSet = new Set(statusActiveIds)
  const hasOrphanIsActive = isActiveIds.some((id) => !activeSet.has(id))
  if (hasOrphanIsActive) return 'is_active_without_active_status'
  if (statusActiveIds.length === 1) return 'consistent_active'
  return 'consistent_none'
}

export function classifyBriefActivation(rows: readonly BriefActivationRow[]): BriefActivationReport {
  const statusActiveIds: string[] = []
  const isActiveIds: string[] = []
  const draftWithIsActiveIds: string[] = []
  const legacyNullStatusIsActiveIds: string[] = []
  let statusActiveIsActive = false

  for (const row of rows) {
    if (!isClientLevelRow(row)) continue
    if (row.status === 'active') {
      statusActiveIds.push(row.id)
      if (row.is_active === true) statusActiveIsActive = true
    }
    if (row.is_active === true) {
      isActiveIds.push(row.id)
      if (row.status === 'draft') draftWithIsActiveIds.push(row.id)
      if (row.status === null || row.status === undefined) legacyNullStatusIsActiveIds.push(row.id)
    }
  }

  const kind = pickKind(statusActiveIds, isActiveIds, statusActiveIsActive)
  return {
    kind,
    status_active_ids: statusActiveIds,
    is_active_ids: isActiveIds,
    draft_with_is_active_ids: draftWithIsActiveIds,
    legacy_null_status_is_active_ids: legacyNullStatusIsActiveIds,
  }
}
