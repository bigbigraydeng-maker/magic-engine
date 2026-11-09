/** Human-requested campaign budget decreases, executed as a durable Inngest job. */

import { z } from 'zod'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { ADS_CAMPAIGN_BUDGET_DECREASE_REQUESTED } from '../ads-events'
import { supabaseAdmin } from '@/lib/supabase'
import { createKernel } from '@/lib/kernel'
import { getRun } from '@/lib/kernel/store'
import { runQueuedAdsCampaignBudgetDecrease } from '@/lib/action-submission/ads-campaign-budget'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { assertCampaignOwnedByClient } from '@/lib/meta/campaign-ownership'
import { getCampaignDetails } from '@/lib/meta/client'
import { resolveAndLogAdsExpectedMetric } from '@/lib/flywheel/ads-expected-metric'

export const ADS_CAMPAIGN_BUDGET_DECREASE_FN_ID = `${CLOUD_FN_PREFIX}ads-campaign-budget-decrease`

const Payload = z.object({ client_id: z.string().uuid(), action_run_id: z.string().uuid() })

type BeforeAfter = { status: string; name: string; daily_budget: string | null }

async function executeBudgetDecrease(clientId: string, runId: string) {
  const sb = supabaseAdmin
  const run = await getRun(sb, runId)
  if (!run || run.client_id !== clientId || run.action_key !== 'ads.cut_campaign_budget' || run.triggered_by !== 'human') {
    throw new Error('Queued budget action does not match its client or action.')
  }
  const existing = await sb.from('flywheel_actions').select('id, payload')
    .eq('client_id', clientId).eq('payload->>action_run_id', runId).maybeSingle()
  if (existing.error) throw new Error(`Could not check the budget action receipt: ${existing.error.message}`)
  const existingRow = existing.data as { id: string; payload: Record<string, unknown> } | null
  if (existingRow?.payload.status === 'succeeded') {
    return { status: 'succeeded' as const, action_run_id: runId, receipt_id: existingRow.id }
  }

  const actionInput = run.input as { campaign_id?: unknown; ad_account_id?: unknown; after_cents?: unknown }
  if (typeof actionInput.campaign_id !== 'string' || typeof actionInput.ad_account_id !== 'string' || typeof actionInput.after_cents !== 'number') {
    throw new Error('Persisted campaign budget action input is invalid.')
  }
  const token = await getMetaTokenForClient(clientId)
  if (!token) throw new Error('No Meta token is configured for this client.')
  const ownership = await assertCampaignOwnedByClient(actionInput.campaign_id, clientId, token)
  if (!ownership.ok) throw new Error(ownership.error)
  const beforeDetails = ownership.campaign
  const before: BeforeAfter = {
    status: beforeDetails.status,
    name: beforeDetails.name,
    daily_budget: beforeDetails.daily_budget ?? null,
  }
  const expectedMetric = resolveAndLogAdsExpectedMetric({ objective: beforeDetails.objective }, 'meta-ads/execute')

  const outcome = await runQueuedAdsCampaignBudgetDecrease(createKernel(sb), clientId, runId)
  let after: BeforeAfter = { ...before }
  let guardWarning: string | null = null
  let guardMarker: 'reread_failed' | 'reactivate_failed' | null = null

  // Read actual values even for non-success outcomes: a provider can have applied
  // the change before a readback/network error reached the Kernel.
  const reread = await getCampaignDetails(actionInput.campaign_id, token)
  if (!reread) {
    guardMarker = 'reread_failed'
    guardWarning = '无法确认广告系列的最终状态；请到 Meta 广告后台核对。'
  } else {
    after = { status: reread.status, name: reread.name, daily_budget: reread.daily_budget ?? null }
    if (before.status === 'ACTIVE' && reread.status !== 'ACTIVE') {
      guardMarker = 'reactivate_failed'
      guardWarning = '广告系列目前已暂停；预算操作不会在 Kernel 外自动重新启动，请到 Meta 广告后台核对。'
    }
  }

  const status = outcome.kind === 'succeeded' || outcome.kind === 'idempotent_hit'
    ? 'succeeded'
    : outcome.kind
  const payload = {
    campaign_id: actionInput.campaign_id,
    action_run_id: runId,
    status,
    before,
    after,
    ...(guardWarning ? { warning: guardWarning } : {}),
    ...(outcome.humanReason ? { reason: outcome.humanReason } : {}),
    ...(guardMarker ? { force_pause_guard: guardMarker } : {}),
  }
  if (existingRow) {
    const { error } = await sb.from('flywheel_actions').update({ payload }).eq('id', existingRow.id)
    if (error) throw new Error(`Could not update the budget action receipt: ${error.message}`)
  } else {
    const { error } = await sb.from('flywheel_actions').insert({
      client_id: clientId,
      execution_item_id: run.execution_item_id,
      flywheel: 'ads',
      action_type: 'ads.adjust_bid',
      execution_mode: 'third_party',
      vendor: 'meta',
      payload,
      expected_metric: expectedMetric,
    })
    if (error) throw new Error(`Could not write the budget action receipt: ${error.message}`)
  }

  return {
    status,
    action_run_id: runId,
    human_reason: outcome.humanReason,
    warning: guardWarning,
    before,
    after,
  }
}

export function createAdsCampaignBudgetDecreaseFunction(
  execute: typeof executeBudgetDecrease = executeBudgetDecrease,
) {
  return inngest.createFunction(
    {
      id: ADS_CAMPAIGN_BUDGET_DECREASE_FN_ID,
      name: 'Ads: execute human-approved campaign budget decrease',
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
