/** Issues a confirm card. An add-image confirm reuses the existing write path. */
import type { KernelDeps } from '@/lib/kernel/deps'
import type { CardClicker } from '@/lib/confirmation-card/actor'
import { issueConfirmationCard } from '@/lib/confirmation-card'
import type { CardResolution } from '@/lib/confirmation-card/decide'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import { isExpired, readStoredCard } from '@/lib/confirmation-card/view'
import { DATA_UNREAD, NZ_DAY_EXPIRED, RULE_CLEARED } from '@/lib/ads-strategy/daily-card-guard'
import { ADD_CREATIVE_WHAT } from '@/lib/ads-strategy/paused-draft-copy'
import { creativeFacts } from '@/lib/ads-creative-card/facts'
import { guardCreative, type Inspect } from '@/lib/ads-creative-card/guard'
import { insertHold, type CreativeHold } from '@/lib/ads-creative-card/ledger'
import { orderKey } from '@/lib/ads-creative-card/order'
import type { CreativeDeps } from '@/lib/ads-creative-card/flow'
import { ADS_TREND_JOB, TUNE_ACTION, conditionStillHolds, findingsFromSummary, type TuneDecision, type TuneMarker } from './plan'
import { readTuneSwitch } from './switch'
const AGENT: CardClicker = { kind: 'agent', email: null }
const FRESH_MS = 36 * 60 * 60 * 1000
const CREATIVE_REFUSAL = '这张加图卡不能在这里点。'
export interface TuneGate {
  readonly tune: boolean
  readonly block: string | null
  readonly remedy: TuneMarker['remedy'] | null
}
export interface TuneResult {
  readonly kind: TuneDecision['kind']
  readonly issued: boolean
  readonly wroteMeta: false
  readonly reason: string
  readonly runId: string | null
  readonly subjectKey: string | null
}
export function tuneAwareDeps(base: CreativeDeps, tune: boolean, readTune: CreativeDeps['switchState']): CreativeDeps {
  return tune ? { ...base, switchState: readTune } : base
}
export async function issueTune(args: {
  kernel: KernelDeps
  clientId: string
  decision: TuneDecision
  now?: Date
}): Promise<TuneResult> {
  const now = args.now ?? args.kernel.now()
  if (args.decision.kind === 'skip') return skipped(args.decision.reason, args.decision.subjectKey)
  if (args.decision.kind === 'ticket') return writeTicket(args.kernel, args.clientId, args.decision.marker)
  try {
    return await issueCreative(args.kernel, args.clientId, args.decision, now)
  } catch (error) {
    const reason = error instanceof ConfirmationCardError ? error.humanReason : '没有出卡，也没有改广告。'
    return skipped(reason, args.decision.subjectKey)
  }
}
export async function blockTuneOnConfirm(
  kernel: KernelDeps,
  clientId: string,
  runId: string,
  resolution: CardResolution,
  now = new Date(),
): Promise<TuneGate> {
  const marker = await markerForRun(kernel, clientId, runId)
  if (!marker) return { tune: false, block: null, remedy: null }
  if (resolution !== 'confirm') return { tune: true, block: null, remedy: marker.remedy }
  const stored = await storedOf(kernel, clientId, runId)
  if (stored && isExpired(stored.issuedAt, now, 'nz_day')) return blocked(marker.remedy, NZ_DAY_EXPIRED)
  if (await readTuneSwitch(kernel.supabase, clientId) !== 'on') return blocked(marker.remedy, '这个客户没开调方确认卡。')
  const still = conditionStillHolds(marker, await freshFindings(kernel, clientId, now))
  if (still === 'unread') return blocked(marker.remedy, DATA_UNREAD)
  if (!still) return blocked(marker.remedy, RULE_CLEARED)
  return { tune: true, block: null, remedy: marker.remedy }
}
export function genericTuneRefusal(gate: TuneGate): string | null {
  if (gate.block) return gate.block
  return gate.remedy === 'creative' ? CREATIVE_REFUSAL : null
}
async function issueCreative(
  kernel: KernelDeps,
  clientId: string,
  decision: Extract<TuneDecision, { kind: 'creative' }>,
  now: Date,
): Promise<TuneResult> {
  const guard = guardCreative(inspectOf(decision))
  if (guard.block || !guard.copy) return writeTicket(kernel, clientId, decision.marker)
  const facts = {
    ...creativeFacts(decision.order, guard.checks),
    subjectKey: decision.subjectKey,
    what: ADD_CREATIVE_WHAT,
    date: '确认之后才建，新广告先暂停，当天有效',
  }
  const card = await issueConfirmationCard(kernel, { clientId, clicker: AGENT, facts, now, lifetime: 'nz_day' })
  await insertHold(kernel.supabase, clientId, holdFrom(decision, guard.copy, card.runId, card.fingerprint))
  await insertMarker(kernel, clientId, { ...decision.marker, cardRunId: card.runId, remedy: 'creative' })
  return { kind: 'creative', issued: true, wroteMeta: false, reason: '已出加图确认卡。没有改广告。', runId: card.runId, subjectKey: decision.subjectKey }
}
async function writeTicket(kernel: KernelDeps, clientId: string, marker: TuneMarker): Promise<TuneResult> {
  const saved = await insertMarker(kernel, clientId, { ...marker, remedy: 'ticket', cardRunId: null })
  if (!saved) return skipped('内容待办没记下，没有改广告。', marker.subjectKey)
  return { kind: 'ticket', issued: true, wroteMeta: false, reason: '已交给内容侧出一条新素材。没有改广告。', runId: null, subjectKey: marker.subjectKey }
}
function inspectOf(decision: Extract<TuneDecision, { kind: 'creative' }>): Inspect {
  return {
    plan: { ok: true, planId: decision.planId },
    live: { accountKnown: true, adSetStatus: 'ACTIVE', copy: decision.copy },
    imageUrl: decision.imageUrl,
  }
}
function holdFrom(decision: Extract<TuneDecision, { kind: 'creative' }>, copy: Extract<TuneDecision, { kind: 'creative' }>['copy'], runId: string, fingerprint: string): CreativeHold {
  return {
    kind: 'add_ad_creative', status: 'holding', cardRunId: runId, subjectKey: decision.subjectKey, fingerprint,
    orderKey: orderKey(decision.order, copy), order: decision.order, copy, planId: decision.planId,
    imageHash: null, creativeId: null, adId: null, wrote: false,
  }
}
async function insertMarker(kernel: KernelDeps, clientId: string, marker: TuneMarker): Promise<boolean> {
  const { error } = await kernel.supabase.from('flywheel_actions').insert({
    client_id: clientId, flywheel: 'ads', action_type: TUNE_ACTION, execution_mode: 'external_manual',
    vendor: null, payload: marker, expected_metric: null,
  })
  return !error
}
async function markerForRun(kernel: KernelDeps, clientId: string, runId: string): Promise<TuneMarker | null> {
  const { data, error } = await kernel.supabase.from('flywheel_actions').select('payload')
    .eq('client_id', clientId).eq('action_type', TUNE_ACTION).eq('payload->>cardRunId', runId)
  if (error) return null
  const rows = ((data ?? []) as Array<{ payload?: unknown }>).map((row) => asMarker(row.payload)).filter((row): row is TuneMarker => row !== null)
  return rows.length === 1 ? rows[0] ?? null : null
}
async function freshFindings(kernel: KernelDeps, clientId: string, now: Date): Promise<unknown[] | 'unread'> {
  const { data, error } = await kernel.supabase.from('cron_run_logs').select('finished_at, summary, status')
    .eq('job_name', ADS_TREND_JOB).order('finished_at', { ascending: false }).limit(5)
  if (error) return 'unread'
  for (const row of (data ?? []) as Array<{ finished_at?: unknown; summary?: unknown; status?: unknown }>) {
    if (row.status !== 'completed' && row.status !== 'partial') continue
    const at = typeof row.finished_at === 'string' ? Date.parse(row.finished_at) : Number.NaN
    if (!Number.isFinite(at) || now.getTime() - at > FRESH_MS || now.getTime() < at) continue
    const found = findingsFromSummary(row.summary, clientId)
    if (found !== 'unread') return found
  }
  return 'unread'
}
async function storedOf(kernel: KernelDeps, clientId: string, runId: string) {
  if (typeof kernel.requireRun !== 'function') return null
  const run = await kernel.requireRun(runId)
  if (run.client_id !== clientId) return null
  return readStoredCard(run.input)
}
function asMarker(value: unknown): TuneMarker | null {
  if (!value || typeof value !== 'object') return null
  const row = value as TuneMarker
  if (row.kind !== 'ads_tune' || !row.subjectKey || !row.subjectRef || !row.diagnosis) return null
  if (row.remedy !== 'creative' && row.remedy !== 'ticket') return null
  return row
}
function blocked(remedy: TuneMarker['remedy'], block: string): TuneGate {
  return { tune: true, block, remedy }
}
function skipped(reason: string, subjectKey: string | null): TuneResult {
  return { kind: 'skip', issued: false, wroteMeta: false, reason, runId: null, subjectKey }
}
