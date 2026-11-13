/** Old direct campaign-budget events are refused here and do not write Meta. */

import { z } from 'zod'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { ADS_CAMPAIGN_BUDGET_DECREASE_REQUESTED } from '../ads-events'
import { supabaseAdmin } from '@/lib/supabase'
import { getRun } from '@/lib/kernel/store'

export const ADS_CAMPAIGN_BUDGET_DECREASE_FN_ID = `${CLOUD_FN_PREFIX}ads-campaign-budget-decrease`

const Payload = z.object({ client_id: z.string().uuid(), action_run_id: z.string().uuid() })

async function executeBudgetDecrease(_clientId: string, runId: string): Promise<{
  status: string
  action_run_id: string
  human_reason?: string
  receipt_id?: string
}> {
  return {
    status: 'refused',
    action_run_id: runId,
    human_reason: 'Direct campaign budget changes are closed. Use a confirmation card.',
  }
}

export function createAdsCampaignBudgetDecreaseFunction(
  execute: typeof executeBudgetDecrease = executeBudgetDecrease,
) {
  return inngest.createFunction(
    {
      id: ADS_CAMPAIGN_BUDGET_DECREASE_FN_ID,
      name: 'Ads: refuse direct campaign budget decrease',
      retries: 1,
      concurrency: { limit: 1, key: 'event.data.action_run_id' },
      onFailure: async ({ event, error }) => {
        const nested = (event.data as { event?: { data?: unknown } } | undefined)?.event?.data
        const parsed = Payload.safeParse(nested)
        if (!parsed.success) return
        const { client_id: clientId, action_run_id: runId } = parsed.data
        try {
          const run = await getRun(supabaseAdmin, runId)
          if (!run || run.client_id !== clientId || run.action_key !== 'ads.cut_campaign_budget') return
          const prior = await supabaseAdmin.from('flywheel_actions').select('id')
            .eq('client_id', clientId).eq('payload->>action_run_id', runId).maybeSingle()
          if (prior.error) throw prior.error
          const reason = error instanceof Error ? error.message : String(error)
          const payload = {
            campaign_id: (run.input as { campaign_id?: unknown }).campaign_id,
            action_run_id: runId,
            status: 'workflow_failed',
            reason: reason.slice(0, 500),
          }
          if (prior.data) {
            const { error: updateError } = await supabaseAdmin.from('flywheel_actions')
              .update({ payload }).eq('id', (prior.data as { id: string }).id)
            if (updateError) throw updateError
          } else {
            const { error: insertError } = await supabaseAdmin.from('flywheel_actions').insert({
              client_id: clientId,
              execution_item_id: run.execution_item_id,
              flywheel: 'ads',
              action_type: 'ads.adjust_bid',
              execution_mode: 'third_party',
              vendor: 'meta',
              payload,
              expected_metric: null,
            })
            if (insertError) throw insertError
          }
        } catch (receiptError) {
          console.error('[ads-campaign-budget-decrease] failure receipt write failed', receiptError)
        }
      },
    },
    { event: ADS_CAMPAIGN_BUDGET_DECREASE_REQUESTED },
    async ({ event, step }) => {
      const parsed = Payload.safeParse(event.data)
      if (!parsed.success) return { status: 'invalid_payload' as const }
      return step.run(`execute-${parsed.data.action_run_id}`, () =>
        execute(parsed.data.client_id, parsed.data.action_run_id),
      )
    },
  )
}

export const adsCampaignBudgetDecrease = createAdsCampaignBudgetDecreaseFunction()
