/**
 * Read-only chain position for one prescription.
 * Computed from rows that already exist. Nothing here is stored back.
 */

export const CHAIN_STEP_IDS = [
  'inspect',
  'measure',
  'confirm',
  'prescribe',
  'consent',
  'plan',
  'creative',
  'draft',
  'launch',
] as const

export type ChainStepId = (typeof CHAIN_STEP_IDS)[number]

export const CHAIN_STEP_LABEL: Readonly<Record<ChainStepId, string>> = {
  inspect: '看',
  measure: '量',
  confirm: '确认',
  prescribe: '开方',
  consent: '同意',
  plan: '计划',
  creative: '素材',
  draft: '草稿',
  launch: '开投',
}

/** waiting = the chain has not reached this step. It is not a filled-in default. */
export type ChainStepState = 'done' | 'active' | 'blocked' | 'unread' | 'waiting'

export const CHAIN_STATE_LABEL: Readonly<Record<ChainStepState, string>> = {
  done: '完成',
  active: '进行中',
  blocked: '卡住',
  unread: '读不到',
  waiting: '还没到',
}

export interface ChainStep {
  id: ChainStepId
  label: string
  state: ChainStepState
  stateLabel: string
  /** Plain sentence. Unread steps always say 读不到 and never a guessed number. */
  detail: string
}

export interface ChainStatus {
  prescriptionId: string
  steps: ChainStep[]
  /** True only when a snapshot time was read and it is older than 12 hours. */
  snapshotStale: boolean
}

/** A successful read, a failed read, or a query we did not run. */
export type Loaded<T> =
  | { read: 'ok'; value: T }
  | { read: 'unread' }
  | { read: 'skipped' }

export interface IntakeFact {
  businessGoal: string | null
  monthlyBudget: number | null
  /** 个人 IP 方子：没有广告打法也不算卡住，「量」不要求目标线索成本。缺省 = 普通客户。 */
  personalIp?: boolean
}

export interface PrescriptionFact {
  status: string
  goalId: string | null
  approvedAt: string | null
  errorMessage: string | null
  intake: IntakeFact | null
  contentPresent: boolean
  adPlayCount: number
  /** Costs whose metric name is a cost. Empty means the prescription did not write one. */
  targetCosts: number[]
  reviewAnchor: string | null
}

export interface GoalFact {
  targetValue: number | null
  baselineValue: number | null
  currentValue: number | null
  periodStart: string | null
  periodEnd: string | null
}

export interface OutcomeFact {
  configured: boolean
  targetCostPerPrimary: number | null
}

export interface PoolFact {
  ref: string
  status: string
  aliasRefs: string[]
  promoWindow: { kind: 'dated'; start: string; end: string } | { kind: 'evergreen' } | null
}

export interface StrategyFact {
  dailyCapCents: number | null
  /** null means the pool column was not a list. Do not treat that as an empty pool. */
  pool: PoolFact[] | null
}

export interface PlanFact {
  id: string
  status: string
  createdAt: string
  goalId: string
  adsStepCount: number
  creativeRefs: string[]
}

export interface WorkOrderFact {
  status: string
  updatedAt: string | null
}

export interface DraftFact {
  status: string
}

/** One ads.create_ad ledger row with the ids it links by. Used only to find this prescription's drafts. */
export interface DraftRow {
  id: string
  status: string
  /** execution_items link written before 10-25. Null on newer drafts. */
  executionItemId: string | null
  /** Meta video ids and image hashes the draft uses. */
  creativeIds: string[]
}

export interface ChainFacts {
  nowIso: string
  prescriptionId: string
  prescription: Loaded<PrescriptionFact | null>
  goal: Loaded<GoalFact | null>
  outcome: Loaded<OutcomeFact | null>
  strategy: Loaded<StrategyFact | null>
  plans: Loaded<PlanFact[]>
  workOrders: Loaded<WorkOrderFact[]>
  drafts: Loaded<DraftFact[]>
  snapshot: Loaded<{ capturedAt: string } | null>
}

export const SNAPSHOT_STALE_MS = 12 * 60 * 60 * 1000
export const REVIEW_WAIT_MS = 24 * 60 * 60 * 1000
