import type { LedgerStatus } from '@/lib/ledger/types'

export type PointState =
  | 'learning'
  | 'pm_decision'
  | 'verifying'
  | 'adopted'
  | 'not_applicable'
  | 'tried_failed'
  | 'cannot_check'
  | 'already_in_me'
  | 'merged'

export const POINT_STATES: readonly PointState[] = [
  'learning',
  'pm_decision',
  'verifying',
  'adopted',
  'not_applicable',
  'tried_failed',
  'cannot_check',
  'already_in_me',
  'merged',
]

/** Optional field names on a point, as written in the JSON */
export type PointField = 'handoff' | 'rule' | 'note' | 'merged_into'

/** Fields that MUST be a non-empty string for each state */
export const REQUIRED_FIELDS: Record<PointState, readonly PointField[]> = {
  learning: [],
  pm_decision: [],
  verifying: ['handoff'],
  adopted: ['rule'],
  not_applicable: ['note'],
  tried_failed: ['handoff', 'note'],
  cannot_check: ['note'],
  already_in_me: ['rule'],
  merged: ['merged_into'],
}

export interface SkillPoint {
  key: string
  text: string
  state: PointState
  handoff: string | null
  rule: string | null
  note: string | null
  /** "<card id>#<point key>" */
  mergedInto: string | null
}

export interface SkillCard {
  /** file name without .md */
  id: string
  file: string
  title: string
  sourceUrl: string | null
  hasCorrection: boolean
  /** which Agent owns this card; defaults to DEFAULT_AGENT when the index has no "agent" */
  agent: string
  points: SkillPoint[]
}

export interface SkillCardError {
  file: string
  reason: string
}

export type SkillCardParseResult =
  | { ok: true; card: SkillCard }
  | { ok: false; error: SkillCardError }

export type IssueLevel = 'error' | 'warning'

export interface BoardIssue {
  level: IssueLevel
  cardId: string
  pointKey: string | null
  message: string
}

/** re-export so callers only import from here */
export type { LedgerStatus }
