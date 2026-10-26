import type { AccountCapFacts } from './budget-caps'
import type { PromoSpec } from './spec'
import type { AdPlay } from '@/lib/ads-strategy/plan-seed/ad-plays'
import type { PlanSeed } from '@/lib/ads-strategy/plan-seed/types'

export type PlanDraftStatus = 'created' | 'skipped' | 'already_exists' | 'failed' | 'dry_run'

export interface PlanDraftReceipt {
  request_id: string
  attempt: number
  status: PlanDraftStatus
  reason_code: string
  reason_text: string
  plan_id?: string
  graph_reads: number
  no_publish: true
  authorization: 'none'
  triggered_by: 'agent'
  overlap_note?: string
  escalated?: boolean
  at: string
}

export interface PlanDraftRequest {
  clientId: string
  prescriptionId: string
  version: number
  attempt: number
  requestId: string
  dryRun?: boolean
}

export interface DraftPrescriptionRow {
  id: string
  client_id: string
  status: string
  version: number
  goal_id: string | null
  content: unknown
  generation_meta: unknown
  updated_at: string | null
}

export interface PlanDraftInsert {
  id: string
  client_id: string
  campaign_id: null
  master_brief_id: null
  initiative_id: null
  title: string
  status: 'draft'
  start_date: string
  end_date: string
  plan_data: {
    social: Record<string, never>
    blog: { monthly_count: 0; topics: [] }
    kpis: Record<string, never>
    tasks: []
    promo: PromoSpec
  }
  generation_meta: {
    from_prescription: { prescription_id: string; version: number; facts_as_of: string }
    step_notes?: string[]
  }
  approved_at: null
}

export interface PlanDraftRunRecord {
  clientId: string
  goalId: string | null
  attempt: number
  requestId: string
  prescriptionId: string
  version: number
  status: 'succeeded' | 'failed'
  reasonCode: string
  reasonText: string
  needsHuman: boolean
}

export interface PlanDraftEventData extends Record<string, unknown> {
  request_id: string
  attempt: number
  client_id: string
  prescription_id: string
  version: number
}

export interface PlanDraftDeps {
  now: () => Date
  enabledClientIds: () => readonly string[]
  loadPrescription: (clientId: string, prescriptionId: string) => Promise<DraftPrescriptionRow | null>
  readPlays: (content: unknown) => AdPlay[]
  loadPeriod: (clientId: string, goalId: string) => Promise<{ start_date: string; end_date: string } | null>
  loadGoalTitle: (clientId: string, goalId: string) => Promise<string | null>
  loadCountry: (clientId: string) => Promise<'AU' | 'NZ' | null>
  loadAccounts: (clientId: string) => Promise<AccountCapFacts[]>
  loadClientCapCents: (clientId: string) => Promise<number | null>
  buildSeed: (args: {
    clientId: string
    plays: AdPlay[]
    period: { start_date: string; end_date: string } | null
  }) => Promise<PlanSeed>
  hasApprovedPlan: (clientId: string, goalId: string) => Promise<boolean>
  insertPlan: (row: PlanDraftInsert) => Promise<'created' | 'already_exists'>
  writeReceipt: (clientId: string, prescriptionId: string, receipt: PlanDraftReceipt) => Promise<void>
  recordRun: (record: PlanDraftRunRecord) => Promise<void>
  scheduleRetry: (event: PlanDraftEventData) => Promise<void>
}

export interface BuiltDraft {
  status: PlanDraftStatus
  reasonCode: string
  reasonText: string
  retryable: boolean
  escalated: boolean
  planId?: string
  insert?: PlanDraftInsert
}

export function isUsableDraft(row: DraftPrescriptionRow | null): row is DraftPrescriptionRow {
  if (!row) return false
  return row.status === 'draft'
    && typeof row.version === 'number'
    && typeof row.goal_id === 'string'
    && row.goal_id.trim() !== ''
    && typeof row.content === 'object'
    && row.content !== null
}
