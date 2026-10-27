import { sendInngestEvent } from '@/lib/workflows/inngest-event'
import type { PlanDraftEventData } from './plan-draft-types'

export const PLAN_DRAFT_EVENT = 'prescription.draft.plan_draft.requested'

export async function schedulePlanDraftRetry(data: PlanDraftEventData): Promise<void> {
  await sendInngestEvent({
    id: `plan_draft:${data.prescription_id}:${data.version}:${data.attempt}`,
    name: PLAN_DRAFT_EVENT,
    data,
  })
}
