/**
 * Production wiring for the auto-publish sweep: reads the plan and scope from
 * the database and hands the sweep the real runner and stores. Kept apart from
 * the sweep itself so the sweep stays testable without a database.
 */
import { supabaseAdmin } from '@/lib/supabase'
import { isGlobalAdminEmail } from '@/lib/auth/whitelist'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'
import { runDailyPlanPublish } from './daily-plan-publish-runner'
import { getActiveAuthorization } from './daily-plan-auto-publish-store'
import { claimAttempt, finishAttempt, listAttempts, listLiveAuthorizations } from './daily-plan-auto-publish-worker-store'
import { readAutoPublishSwitches } from './daily-plan-auto-publish-decide'
import type { AutoPublishWorkerDeps, PlanState, ScopeState } from './daily-plan-auto-publish-worker'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Latest `recalled_at` per date from a receipt's `recalled[]`. */
function latestRecalledAt(list: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!Array.isArray(list)) return out
  for (const entry of list) {
    if (!isRecord(entry) || typeof entry.date !== 'string' || typeof entry.recalled_at !== 'string') continue
    const previous = out[entry.date]
    if (previous === undefined || Date.parse(entry.recalled_at) > Date.parse(previous)) out[entry.date] = entry.recalled_at
  }
  return out
}

/** Dates of `failed[]` entries whose certainty is not a definite refusal (unknown or missing). */
function unknownFailedDates(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  const out: string[] = []
  for (const entry of list) {
    if (!isRecord(entry) || typeof entry.date !== 'string') continue
    const certainty = entry.certainty
    if (certainty !== 'rejected' && certainty !== 'rate_limited') out.push(entry.date)
  }
  return Array.from(new Set(out))
}

/** Post id per published date from `published[]`. */
function postIdsOf(list: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!Array.isArray(list)) return out
  for (const entry of list) {
    if (isRecord(entry) && typeof entry.date === 'string' && typeof entry.post_id === 'string') out[entry.date] = entry.post_id
  }
  return out
}

function datesOf(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  return list
    .map(entry => (isRecord(entry) ? entry.date : undefined))
    .filter((date): date is string => typeof date === 'string')
}

/** The plan's current revisions and receipt facts; null when the plan row is gone. Throws on a read error. */
export async function loadPlanState(planId: string, clientId: string): Promise<PlanState | null> {
  const { data, error } = await supabaseAdmin
    .from('social_plans')
    .select('plan_data')
    .eq('id', planId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) throw error
  const planData = (data as { plan_data?: unknown } | null)?.plan_data
  if (!isRecord(planData)) return null

  const commandMeta = isRecord(planData.command_meta) ? planData.command_meta : {}
  const reviewMeta = isRecord(planData.review_meta) ? planData.review_meta : {}
  const publishMeta = isRecord(planData.publish_meta) ? planData.publish_meta : {}
  const planRevision = typeof commandMeta.received_at === 'string' ? commandMeta.received_at : ''
  const reviewRevision = typeof reviewMeta.revision === 'string' ? reviewMeta.revision : ''
  // A plan without both revisions can never match a grant: fail closed.
  if (!planRevision || !reviewRevision) return null

  return {
    planRevision,
    reviewRevision,
    publishedDates: datesOf(publishMeta.published),
    receiptRecalledDates: datesOf(publishMeta.recalled),
    receiptRecalledAt: latestRecalledAt(publishMeta.recalled),
    receiptUnknownFailedDates: unknownFailedDates(publishMeta.failed),
    publishedPostIds: postIdsOf(publishMeta.published),
  }
}

/** Client and campaign status. Throws on a read error (a failed read must never look like "active"). */
export async function loadScope(clientId: string, campaignId: string): Promise<ScopeState> {
  const [client, campaign] = await Promise.all([
    supabaseAdmin.from('clients').select('client_status').eq('id', clientId).maybeSingle(),
    supabaseAdmin.from('campaign_briefs').select('status').eq('id', campaignId).eq('client_id', clientId).maybeSingle(),
  ])
  if (client.error) throw client.error
  if (campaign.error) throw campaign.error
  return {
    clientStatus: (client.data as { client_status?: string | null } | null)?.client_status ?? null,
    campaignStatus: (campaign.data as { status?: string | null } | null)?.status ?? null,
  }
}

/** Real dependencies for one sweep. */
export function buildProductionDeps(now: Date, env: NodeJS.ProcessEnv = process.env): AutoPublishWorkerDeps {
  return {
    now,
    switches: readAutoPublishSwitches({
      DAILY_PLAN_AUTO_PUBLISH_LIVE: env.DAILY_PLAN_AUTO_PUBLISH_LIVE,
      DAILY_PLAN_AUTO_PUBLISH_CLIENTS: env.DAILY_PLAN_AUTO_PUBLISH_CLIENTS,
    }),
    listLiveAuthorizations,
    isGlobalAdmin: email => isGlobalAdminEmail(email),
    getActiveAuthorization,
    loadPlanState,
    loadScope,
    listAttempts,
    claimAttempt,
    finishAttempt,
    runPublish: input => runDailyPlanPublish(input),
    emit: async event => {
      await sendInngestEvent(event)
    },
  }
}
