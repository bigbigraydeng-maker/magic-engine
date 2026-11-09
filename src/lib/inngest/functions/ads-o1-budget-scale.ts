/** Human-approved O1 increases run through the Kernel in the durable worker. */
import { z } from 'zod'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { ADS_O1_BUDGET_SCALE_APPROVED } from '../ads-events'
import { supabaseAdmin } from '@/lib/supabase'
import { createKernel } from '@/lib/kernel'
import { runApprovedAdsO1BudgetScale } from '@/lib/action-submission/ads-o1-budget-scale'

export const ADS_O1_BUDGET_SCALE_FN_ID = `${CLOUD_FN_PREFIX}ads-o1-budget-scale`
const Payload = z.object({ client_id: z.string().uuid(), action_run_id: z.string().uuid() })

export function createAdsO1BudgetScaleFunction(
  execute: typeof runApprovedAdsO1BudgetScale = runApprovedAdsO1BudgetScale,
) {
  return inngest.createFunction(
    {
      id: ADS_O1_BUDGET_SCALE_FN_ID,
      name: 'Ads: execute human-approved O1 budget increase',
      retries: 1,
      concurrency: { limit: 1, key: 'event.data.client_id' },
    },
    { event: ADS_O1_BUDGET_SCALE_APPROVED },
    async ({ event, step }) => {
      const parsed = Payload.safeParse(event.data)
      if (!parsed.success) return { status: 'invalid_payload' as const }
      const { client_id: clientId, action_run_id: runId } = parsed.data
      const outcome = await step.run(`execute-${runId}`, () => execute(createKernel(supabaseAdmin), clientId, runId))
      if (outcome.kind === 'in_progress') throw new Error('The approved O1 run is already claimed; retry the durable execution.')
      return { status: outcome.kind, action_run_id: runId, reason: outcome.humanReason }
    },
  )
}

export const adsO1BudgetScale = createAdsO1BudgetScaleFunction()
