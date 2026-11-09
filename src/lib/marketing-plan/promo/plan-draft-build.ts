import { planDraftId } from './plan-draft-id'
import { mapSeedToPromo } from './plan-draft-map'
import {
  planDraftCreatedLine,
  planDraftMissingPlaysLine,
  planDraftNoPeriodLine,
  planDraftNotEnabledLine,
} from './plan-draft-card'
import type { BuiltDraft, DraftPrescriptionRow, PlanDraftDeps, PlanDraftInsert, PlanDraftRequest } from './plan-draft-types'
import type { PlanSeed } from '@/lib/ads-strategy/plan-seed/types'
import type { PromoSpec } from './spec'

function skipped(reasonCode: string, reasonText: string): BuiltDraft {
  return { status: 'skipped', reasonCode, reasonText, retryable: false, escalated: false }
}

function planInsert(
  req: PlanDraftRequest,
  row: DraftPrescriptionRow,
  spec: PromoSpec,
  seed: PlanSeed,
  title: string | null,
  dropped: string[],
): PlanDraftInsert {
  const phase = spec.phases[0]
  const notes = dropped.length > 0 ? { step_notes: dropped } : {}
  return {
    id: planDraftId(req.prescriptionId, req.version),
    client_id: req.clientId,
    campaign_id: null,
    master_brief_id: null,
    initiative_id: null,
    title: title?.trim() || '推广计划草稿',
    status: 'draft',
    start_date: phase.start_date,
    end_date: phase.end_date,
    plan_data: {
      social: {},
      blog: { monthly_count: 0, topics: [] },
      kpis: {},
      tasks: [],
      promo: spec,
    },
    generation_meta: {
      from_prescription: {
        prescription_id: req.prescriptionId,
        version: req.version,
        facts_as_of: seed.facts_as_of,
      },
      ...notes,
    },
    approved_at: null,
  }
}

/** Reads and maps. Throws on a retryable read failure. Does not write. */
export async function buildPlanDraft(
  req: PlanDraftRequest,
  row: DraftPrescriptionRow,
  deps: PlanDraftDeps,
): Promise<BuiltDraft> {
  if (!deps.enabledClientIds().includes(req.clientId)) {
    return skipped('not_enabled', planDraftNotEnabledLine())
  }
  const plays = deps.readPlays(row.content)
  if (plays.length === 0) return skipped('missing_ad_plays', planDraftMissingPlaysLine())
  const goalId = row.goal_id ?? ''
  const period = await deps.loadPeriod(req.clientId, goalId)
  if (!period) return skipped('no_period', planDraftNoPeriodLine())
  const seed = await deps.buildSeed({ clientId: req.clientId, plays, period })
  const accounts = await deps.loadAccounts(req.clientId)
  const country = await deps.loadCountry(req.clientId)
  const cap = await deps.loadClientCapCents(req.clientId)
  const title = await deps.loadGoalTitle(req.clientId, goalId)
  const mapped = mapSeedToPromo({
    goalId, period, plays, seed, country, accounts, clientCapCents: cap,
  })
  if (!mapped.ok) {
    if (mapped.retryable) throw new Error('timeout')
    return skipped(mapped.code, mapped.text)
  }
  const insert = planInsert(req, row, mapped.spec, seed, title, mapped.dropped)
  return {
    status: 'created',
    reasonCode: 'created',
    reasonText: planDraftCreatedLine(req.version),
    retryable: false,
    escalated: false,
    planId: insert.id,
    insert,
  }
}
