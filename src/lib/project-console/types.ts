import type { ChainStatus, ChainStepState } from '@/lib/prescription-chain/types'

/** One client's current IMPACT run. Derived, never stored. */
export const PROJECT_STAGE_IDS = [
  'inspect',
  'measure',
  'confirm',
  'prescribe',
  'act',
  'check',
  'tune',
] as const

export type ProjectStageId = (typeof PROJECT_STAGE_IDS)[number]

export const PROJECT_STAGE_LABEL: Readonly<Record<ProjectStageId, string>> = {
  inspect: '看',
  measure: '量',
  confirm: '确认',
  prescribe: '开方',
  act: '去做',
  check: '看结果',
  tune: '记教训',
}

export interface ProjectLink {
  label: string
  href: string
}

export interface ProjectStageView {
  id: ProjectStageId
  label: string
  state: ChainStepState
  stateLabel: string
  detail: string
  links: ProjectLink[]
}

export interface ProjectWaiting {
  /** Which card or page needs a person. */
  card: string
  /** Who is allowed to click, in plain words. */
  who: string
  href: string
}

export interface ProjectNumber {
  label: string
  value: string
}

export interface ProjectFigures {
  monthlyBudget: number | null
  budgetCurrency: string | null
  metricLabel: string | null
  targetValue: number | null
  currentValue: number | null
  dailyCapCents: number | null
  /** True when at least one source failed and its number was left out. */
  partial: boolean
}

/** Facts already read. The derivation does not query anything. */
export interface ProjectInput {
  clientId: string
  clientName: string
  goalId: string | null
  goalTitle: string | null
  prescriptionId: string | null
  brandScan: 'confirmed' | 'missing' | 'unread'
  chain: ChainStatus | null
  pausedDraftPending: boolean | 'unread'
  goLiveDraftIds: readonly string[] | 'unread'
  review: { createdAt: string } | null | 'unread'
  figures: ProjectFigures | 'unread'
}

export interface ProjectView {
  clientId: string
  clientName: string
  goalId: string | null
  goalTitle: string | null
  prescriptionId: string | null
  current: ProjectStageView
  stages: ProjectStageView[]
  waiting: ProjectWaiting | null
  numbers: ProjectNumber[]
  numbersNote: string | null
  /** Draft prescription is waiting for the existing agree buttons. */
  showConsent: boolean
  /** Go-live card ids already matched to this prescription. */
  goLiveDraftIds: readonly string[]
  goLiveUnread: boolean
}
