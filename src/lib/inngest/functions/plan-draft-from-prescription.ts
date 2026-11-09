import { inngest, CLOUD_FN_PREFIX } from '../client'
import { attemptPlanDraft } from '@/lib/marketing-plan/promo/plan-draft-attempt'
import { productionPlanDraftDeps } from '@/lib/marketing-plan/promo/plan-draft-deps'
import { delayBeforePlanDraftAttempt } from '@/lib/marketing-plan/promo/plan-draft-retry'
import { PLAN_DRAFT_EVENT } from '@/lib/marketing-plan/promo/plan-draft-schedule'
import type { PlanDraftDeps, PlanDraftEventData } from '@/lib/marketing-plan/promo/plan-draft-types'

function eventData(raw: unknown): PlanDraftEventData | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Record<string, unknown>
  if (typeof data.request_id !== 'string' || typeof data.client_id !== 'string') return null
  if (typeof data.prescription_id !== 'string' || typeof data.version !== 'number') return null
  if (typeof data.attempt !== 'number') return null
  return {
    request_id: data.request_id,
    attempt: data.attempt,
    client_id: data.client_id,
    prescription_id: data.prescription_id,
    version: data.version,
  }
}

export function createPlanDraftFromPrescription(deps: PlanDraftDeps = productionPlanDraftDeps()) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}plan-draft-from-prescription`,
      name: 'Draft an unapproved promo plan from a prescription',
      retries: 0,
      concurrency: { limit: 1, key: 'event.data.prescription_id' },
    },
    { event: PLAN_DRAFT_EVENT },
    async ({ event, step }) => {
      const data = eventData(event.data)
      if (!data) return { status: 'skipped' }
      const delay = delayBeforePlanDraftAttempt(data.attempt)
      if (delay !== null) await step.sleep('backoff', `${Math.round(delay / 1000)}s`)
      return step.run('draft', () => attemptPlanDraft({
        clientId: data.client_id,
        prescriptionId: data.prescription_id,
        version: data.version,
        attempt: data.attempt,
        requestId: data.request_id,
      }, deps))
    },
  )
}

export const planDraftFromPrescription = createPlanDraftFromPrescription()
