/**
 * Winner-sync rows live in flywheel_actions.
 * expected_metric and expected_delta are the existing columns.
 * Observation days and before/after stay in the existing payload.
 * A row left in `writing` is not retried.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { ADS_ACTION_TYPE, ADS_METRIC_KEY } from '@/lib/flywheel/vocabulary'
import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import { WINNER_OBSERVATION_DAYS } from './copy'
import type { AddIntent, MetricDirection, PauseIntent, ProposalHold, ProposalKind } from './intents'

export const WINNER_ACTION = ADS_ACTION_TYPE.WINNER_REEL_PROPOSAL
export const WINNER_METRIC = ADS_METRIC_KEY.CTR

export interface HoldRow {
  readonly id: string
  readonly payload: ProposalHold
}

export function directionDelta(direction: MetricDirection): number {
  return direction === 'up' ? 1 : -1
}

export function addSubject(intent: AddIntent): string {
  return stamp('winner-add', { adsetId: intent.adsetId, postId: intent.postId })
}

export function pauseSubject(intent: PauseIntent): string {
  return stamp('winner-pause', { adsetId: intent.adsetId, adId: intent.adId })
}

export function activateSubject(adsetId: string, adId: string): string {
  return stamp('winner-live', { adsetId, adId })
}

export async function holdForCard(sb: SupabaseClient, clientId: string, runId: string): Promise<HoldRow | null> {
  const rows = await rowsWhere(sb, clientId, 'payload->>cardRunId', runId)
  return rows.length === 1 ? rows[0] ?? null : null
}

export async function openHold(sb: SupabaseClient, clientId: string, subjectKey: string): Promise<HoldRow | null> {
  const rows = await rowsWhere(sb, clientId, 'payload->>subjectKey', subjectKey)
  return rows.find((row) => busy(row.payload.status)) ?? null
}

export async function insertHold(sb: SupabaseClient, clientId: string, payload: ProposalHold): Promise<void> {
  const existing = await holdForCard(sb, clientId, payload.cardRunId)
  if (existing) return
  const { error } = await sb.from('flywheel_actions').insert(actionRow(clientId, payload))
  if (error) throw new ConfirmationCardError('invalid', '确认卡记下了，但台账没存住，没有改广告。')
}

export async function claimHold(
  sb: SupabaseClient,
  clientId: string,
  row: HoldRow,
  confirmedBy: string,
): Promise<boolean> {
  const next: ProposalHold = { ...row.payload, status: 'writing', confirmedBy, writeAttempted: true }
  const { data, error } = await sb.from('flywheel_actions')
    .update(actionUpdate(next))
    .eq('id', row.id)
    .eq('client_id', clientId)
    .eq('payload->>status', 'holding')
    .select('id')
    .maybeSingle()
  return !error && Boolean((data as { id?: string } | null)?.id)
}

export async function saveHold(
  sb: SupabaseClient,
  clientId: string,
  row: HoldRow,
  payload: ProposalHold,
): Promise<void> {
  const { error } = await sb.from('flywheel_actions')
    .update(actionUpdate(payload))
    .eq('id', row.id)
    .eq('client_id', clientId)
  if (error) throw new ConfirmationCardError('invalid', '结果没能记下。没有再改一次广告。')
}

export function holdFromAdd(intent: AddIntent, cardRunId: string, fingerprint: string, configAskedActive: boolean): ProposalHold {
  return baseHold('add_paused', addSubject(intent), cardRunId, fingerprint, configAskedActive, 'up', intent.score, {
    postId: intent.postId,
    pageId: intent.pageId,
    adAccountId: intent.adAccountId,
    adsetId: intent.adsetId,
    adId: null,
    name: intent.name,
    score: intent.score,
    ctr: null,
  })
}

export function holdFromPause(intent: PauseIntent, cardRunId: string, fingerprint: string, configAskedActive: boolean): ProposalHold {
  return baseHold('pause_ad', pauseSubject(intent), cardRunId, fingerprint, configAskedActive, 'up', intent.ctr, {
    postId: null,
    pageId: intent.pageId,
    adAccountId: intent.adAccountId,
    adsetId: intent.adsetId,
    adId: intent.adId,
    name: intent.name,
    score: null,
    ctr: intent.ctr,
  })
}

export function holdFromActivate(args: {
  cardRunId: string
  fingerprint: string
  pageId: string
  adAccountId: string
  adsetId: string
  adId: string
  name: string
  configAskedActive: boolean
}): ProposalHold {
  return baseHold('activate', activateSubject(args.adsetId, args.adId), args.cardRunId, args.fingerprint, args.configAskedActive, 'up', null, {
    postId: null,
    pageId: args.pageId,
    adAccountId: args.adAccountId,
    adsetId: args.adsetId,
    adId: args.adId,
    name: args.name,
    score: null,
    ctr: null,
  })
}

function busy(status: ProposalHold['status']): boolean {
  return status === 'holding' || status === 'writing' || status === 'executed'
}

function stamp(prefix: string, body: Record<string, string>): string {
  return `${prefix}:${canonicalHashOfInput(body).slice(0, 12)}`
}

function baseHold(
  kind: ProposalKind,
  subjectKey: string,
  cardRunId: string,
  fingerprint: string,
  configAskedActive: boolean,
  direction: MetricDirection,
  before: number | null,
  source: Pick<ProposalHold, 'postId' | 'pageId' | 'adAccountId' | 'adsetId' | 'adId' | 'name' | 'score' | 'ctr'>,
): ProposalHold {
  return {
    kind, status: 'holding', cardRunId, subjectKey, fingerprint,
    metric: WINNER_METRIC, direction, observationWindowDays: WINNER_OBSERVATION_DAYS,
    before, after: null, writeAttempted: false, wroteMeta: false, readback: null,
    confirmedBy: null, configAskedActive, ...source,
  }
}

function actionRow(clientId: string, payload: ProposalHold) {
  return {
    client_id: clientId,
    flywheel: 'ads',
    action_type: WINNER_ACTION,
    execution_mode: 'third_party',
    vendor: 'meta',
    payload,
    expected_metric: payload.metric,
    expected_delta: directionDelta(payload.direction),
  }
}

function actionUpdate(payload: ProposalHold) {
  return {
    payload,
    expected_metric: payload.metric,
    expected_delta: directionDelta(payload.direction),
  }
}

async function rowsWhere(
  sb: SupabaseClient,
  clientId: string,
  column: string,
  value: string,
): Promise<HoldRow[]> {
  const { data, error } = await sb.from('flywheel_actions')
    .select('id, payload')
    .eq('client_id', clientId)
    .eq('action_type', WINNER_ACTION)
    .eq(column, value)
  if (error) throw new ConfirmationCardError('invalid', '建议卡的台账读不出来，没有改广告。')
  return ((data ?? []) as Array<{ id?: unknown; payload?: unknown }>).flatMap(asHold)
}

function asHold(row: { id?: unknown; payload?: unknown }): HoldRow[] {
  if (typeof row.id !== 'string' || !row.payload || typeof row.payload !== 'object') return []
  const payload = row.payload as ProposalHold
  if (!payload.cardRunId || !payload.subjectKey || !payload.kind) return []
  return [{ id: row.id, payload }]
}
