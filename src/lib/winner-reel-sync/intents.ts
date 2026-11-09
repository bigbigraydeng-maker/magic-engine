/** What the daily scan would have written. The scan itself does not write. */

export interface AddIntent {
  postId: string
  name: string
  score: number
  pageId: string
  adAccountId: string
  adsetId: string
}

export interface PauseIntent {
  adId: string
  name: string
  reason: string
  ctr: number
  pageId: string
  adAccountId: string
  adsetId: string
}

export type ProposalKind = 'add_paused' | 'pause_ad' | 'activate'
export type ProposalStatus = 'holding' | 'writing' | 'executed' | 'failed' | 'declined'
export type MetricDirection = 'up' | 'down'

export interface ProposalHold {
  kind: ProposalKind
  status: ProposalStatus
  cardRunId: string
  subjectKey: string
  fingerprint: string
  metric: string
  direction: MetricDirection
  observationWindowDays: number
  before: number | null
  after: number | null
  writeAttempted: boolean
  wroteMeta: boolean
  readback: string | null
  confirmedBy: string | null
  configAskedActive: boolean
  postId: string | null
  pageId: string
  adAccountId: string
  adsetId: string
  adId: string | null
  name: string
  score: number | null
  ctr: number | null
  resultLine?: string
  /** Approved ads plan this activate was checked against. */
  planId?: string
}
