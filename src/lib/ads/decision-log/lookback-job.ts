/**
 * Due-date look-back for ads_decision_v1 entries (per-client switch).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { ADS_ACTION_TYPE } from '@/lib/flywheel/vocabulary'
import { BUDGET_CARD_ACTION, PAUSE_CARD_ACTION } from '@/lib/flywheel/attribution/executed-review'
import { resolveTargetCplMajor } from '@/lib/ads-strategy/client-target-cpl'
import { persistReviewExperience } from '@/lib/flywheel/attribution/review-experience'
import { evaluateDecisionLookback } from './lookback-evaluate'
import { listClientsWithDecisionReviewOn } from './switch'
import { patchDecisionOnRow, readAdsDecisionV1 } from './persist'
import type { AdsDecisionV1, DecisionDailyInsightRow } from './types'

export interface DecisionLookbackJobResult {
  readonly clients: number
  readonly due: number
  readonly reviewed: number
  readonly skipped: number
  readonly failed: number
}

export async function runAdsDecisionLookbackJob(
  supabase: SupabaseClient,
  options?: { clientId?: string; asOf?: string },
): Promise<DecisionLookbackJobResult> {
  const asOf = options?.asOf ?? nzToday()
  const clients = options?.clientId
    ? [{ id: options.clientId }]
    : await listClientsWithDecisionReviewOn(supabase)

  let due = 0
  let reviewed = 0
  let skipped = 0
  let failed = 0

  for (const client of clients) {
    const rows = await loadDueDecisions(supabase, client.id, asOf)
    for (const row of rows) {
      due += 1
      const decision = readAdsDecisionV1(row.payload)
      if (!decision || decision.status !== 'active' || decision.review_result) {
        skipped += 1
        continue
      }
      const target = await loadTargetCpl(supabase, client.id)
      const insights = await loadInsights(supabase, client.id, decision, asOf)
      const evaluated = evaluateDecisionLookback({
        decision,
        insights,
        targetCplMajor: target,
        reviewAsOf: asOf,
        adsetRef: decision.subject.level === 'adset' ? decision.subject.ref : decision.subject.ref,
      })
      const next: AdsDecisionV1 = { ...decision, review_result: evaluated.result }
      const ok = await patchDecisionOnRow(supabase, {
        clientId: client.id,
        actionId: row.id,
        decision: next,
        currentPayload: row.payload,
      })
      if (!ok) {
        failed += 1
        continue
      }
      reviewed += 1
      const tier = evaluated.result.verdict === 'met'
        ? 'useful'
        : evaluated.result.verdict === 'not_met'
          ? 'not_useful'
          : 'unclear'
      await persistReviewExperience(supabase, {
        clientId: client.id,
        actionId: row.id,
        kindLabel: '广告决策',
        reviewCase: {
          verdict: tier,
          reason: evaluated.result.reason_zh,
          text: evaluated.reviewCaseText,
        },
      })
    }
  }

  return { clients: clients.length, due, reviewed, skipped, failed }
}

async function loadDueDecisions(
  supabase: SupabaseClient,
  clientId: string,
  asOf: string,
): Promise<Array<{ id: string; payload: Record<string, unknown> | null }>> {
  const { data, error } = await supabase
    .from('flywheel_actions')
    .select('id, payload, action_type, executed_at')
    .eq('client_id', clientId)
    .eq('flywheel', 'ads')
    .in('action_type', [ADS_ACTION_TYPE.DECISION_LOG, BUDGET_CARD_ACTION, PAUSE_CARD_ACTION])
    .order('created_at', { ascending: false })
    .limit(200)
  if (error || !Array.isArray(data)) return []
  return data.flatMap((row) => {
    if (typeof row.id !== 'string') return []
    const payload = record(row.payload)
    const decision = readAdsDecisionV1(payload)
    if (!decision || decision.status !== 'active') return []
    if (decision.review_result) return []
    if (decision.review_due_on > asOf) return []
    return [{ id: row.id, payload }]
  })
}

async function loadInsights(
  supabase: SupabaseClient,
  clientId: string,
  decision: AdsDecisionV1,
  asOf: string,
): Promise<DecisionDailyInsightRow[]> {
  const horizon = Math.max(
    3,
    ...decision.expectation.items.map((i) => i.horizon_days),
  )
  const from = dayMinus(asOf, horizon + 2)
  const { data, error } = await supabase
    .from('ad_daily_insights')
    .select('insight_date, level, entity_id, spend, impressions, clicks, ctr, leads, results')
    .eq('client_id', clientId)
    .eq('platform', 'meta')
    .gte('insight_date', from)
    .lte('insight_date', asOf)
  if (error || !Array.isArray(data)) return []
  return data.flatMap((row) => asInsight(row))
}

async function loadTargetCpl(supabase: SupabaseClient, clientId: string): Promise<number | null> {
  const { data } = await supabase.from('clients').select('leads_config, strategy_config').eq('id', clientId).maybeSingle()
  if (!data) return null
  return resolveTargetCplMajor({
    strategyMajor: (data as { strategy_config?: unknown }).strategy_config,
    leadsConfig: (data as { leads_config?: unknown }).leads_config,
    planRows: [],
  })
}

function nzToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970'
  const m = parts.find((p) => p.type === 'month')?.value ?? '01'
  const d = parts.find((p) => p.type === 'day')?.value ?? '01'
  return `${y}-${m}-${d}`
}

function dayMinus(iso: string, days: number): string {
  const ms = Date.parse(`${iso}T00:00:00Z`) - days * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asInsight(row: unknown): DecisionDailyInsightRow[] {
  if (!row || typeof row !== 'object') return []
  const r = row as Record<string, unknown>
  const insight_date = typeof r.insight_date === 'string' ? r.insight_date : ''
  const entity_id = typeof r.entity_id === 'string' ? r.entity_id : ''
  const level = typeof r.level === 'string' ? r.level : ''
  if (!insight_date || !entity_id) return []
  return [{
    insight_date,
    level,
    entity_id,
    spend: num(r.spend),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    ctr: num(r.ctr),
    leads: num(r.leads),
    results: num(r.results),
  }]
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
