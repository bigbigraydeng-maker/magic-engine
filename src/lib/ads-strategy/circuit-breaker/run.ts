/**
 * One client pass: read facts, judge, propose an existing pause card.
 * The card is the only way to pause. This pass never writes Meta.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { requestCampaignStatusCard, type CampaignRequest } from '@/lib/action-submission/campaign-status-card'
import { applyBreaker, BREAKER_ACTION, type ApplyDeps, type BreakerEvent } from './apply'
import { loadBreakerFacts } from './load'
import { judgeBreaker } from './rules'

export interface BreakerRunResult {
  readonly paused: false
  readonly cards: number
  readonly alerts: number
  readonly error?: string
}

export async function runAdsCircuitBreaker(
  sb: SupabaseClient,
  clientId: string,
  now = new Date(),
): Promise<BreakerRunResult> {
  const facts = await loadBreakerFacts(sb, clientId, now)
  if (facts === 'unreadable') return { paused: false, cards: 0, alerts: 0, error: '读不到熔断需要的广告记录' }
  const judged = judgeBreaker(facts)
  const applied = await applyBreaker({
    day: facts.localDate ?? now.toISOString().slice(0, 10),
    pauses: judged.pauses,
    alerts: judged.alerts,
    deps: depsFor(sb, clientId),
  })
  if (!applied.recorded) return { paused: false, cards: applied.cards, alerts: applied.alerts, error: '熔断提醒没能记下' }
  return { paused: false, cards: applied.cards, alerts: applied.alerts }
}

function depsFor(sb: SupabaseClient, clientId: string): ApplyDeps {
  return {
    issuePause: (args) => issueCampaign(sb, clientId, args),
    alreadyOpen: (subjectKey) => openEvent(sb, clientId, subjectKey),
    record: (event) => insertEvent(sb, clientId, event),
  }
}

async function issueCampaign(
  sb: SupabaseClient,
  clientId: string,
  args: { campaignId: string; accountId: string; name: string },
): Promise<{ ok: true; runId: string } | { ok: false; reason: string }> {
  try {
    const out = await requestCampaignStatusCard(sb, {
      clientId,
      access: askerAccess(clientId),
      kind: 'pause',
      campaignId: args.campaignId,
      adAccountId: args.accountId,
      name: args.name,
      liveStatus: 'ACTIVE',
      dailyBudget: null,
      objective: null,
      executionItemId: null,
    })
    const runId = typeof out.body.runId === 'string' ? out.body.runId : ''
    if (out.status !== 202 || runId.length === 0 || out.body.wroteMeta !== false) return { ok: false, reason: 'card_failed' }
    return { ok: true, runId }
  } catch {
    return { ok: false, reason: 'card_failed' }
  }
}

function askerAccess(clientId: string): CampaignRequest['access'] {
  return {
    ok: true,
    user: { id: 'circuit-breaker', email: 'circuit-breaker@internal' } as CampaignRequest['access']['user'],
    role: 'client-viewer',
    tier: 'paid_client',
    allowedClientId: clientId,
  }
}

async function openEvent(sb: SupabaseClient, clientId: string, subjectKey: string): Promise<boolean> {
  const { data, error } = await sb.from('flywheel_actions').select('id')
    .eq('client_id', clientId)
    .eq('action_type', BREAKER_ACTION)
    .eq('payload->>subject_key', subjectKey)
    .limit(1)
  if (error) return true
  return Array.isArray(data) && data.length > 0
}

async function insertEvent(sb: SupabaseClient, clientId: string, event: BreakerEvent): Promise<boolean> {
  const { error } = await sb.from('flywheel_actions').insert({
    client_id: clientId,
    execution_item_id: null,
    flywheel: 'ads',
    action_type: BREAKER_ACTION,
    execution_mode: 'third_party',
    vendor: 'meta',
    payload: {
      subject_key: event.subjectKey,
      status: event.status,
      summary: event.summary,
      card_run_id: event.cardRunId,
      wrote: false,
      rules: [...event.rules],
      day: event.day,
      campaign_name: event.campaignName,
    },
    expected_metric: null,
  })
  return !error
}
