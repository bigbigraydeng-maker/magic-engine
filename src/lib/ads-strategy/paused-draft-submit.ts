/**
 * Issue the paused-draft card, and build only after that card is confirmed.
 * The build calls the existing paused publisher. It never activates a campaign.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { KernelDeps } from '@/lib/kernel/deps'
import { assertMayClick, decideConfirmationCard, issueConfirmationCard, type CardClicker, type CardResolution, type ConfirmationCardView } from '@/lib/confirmation-card'
import { notesFor } from '@/lib/confirmation-card/records'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import type { AdDraft } from './ad-draft'
import { createDraftForApproval, type CreateDraftDeps, type CreateDraftOutcome } from './draft-and-gate'
import {
  PAUSED_DRAFT_HOLD,
  metaErrorClass,
  pausedDraftBlock,
  pausedDraftFacts,
  pausedDraftRetry,
  plainMetaError,
  type PausedDraftReview,
  type PriorPausedFailure,
} from './paused-draft-facts'

type HoldStatus = 'holding' | 'building' | 'declined' | 'built' | 'refused' | 'failed'

interface HoldPayload {
  status: HoldStatus
  cardRunId: string
  subjectKey: string
  fingerprint: string
  draft: AdDraft
  accountLabel: string
  resultLine?: string
  errorClass?: string
  clickedBy?: string | null
  queued?: boolean
  wroteMeta?: boolean
}

interface HoldRow {
  id: string
  payload: HoldPayload
}

export interface PausedDraftSubmitResult {
  card: ConfirmationCardView | null
  wroteMeta: boolean
  queued: boolean
  resultLine: string
  clickedBy: string | null
}

type CreatePaused = (draft: AdDraft, deps: CreateDraftDeps) => Promise<CreateDraftOutcome>

export async function issuePausedDraftCard(args: {
  kernel: KernelDeps
  clientId: string
  clicker: CardClicker
  draft: AdDraft
  accountLabel: string
  review: PausedDraftReview
  now?: Date
}): Promise<ConfirmationCardView> {
  const draft = { ...args.draft, clientId: args.clientId }
  const facts = pausedDraftFacts(draft, args.accountLabel, args.review)
  const card = await issueConfirmationCard(args.kernel, {
    clientId: args.clientId,
    clicker: args.clicker,
    facts,
    now: args.now,
  })
  const rows = await listHolds(args.kernel.supabase, args.clientId)
  if (rows.some((row) => row.payload.cardRunId === card.runId)) return card
  await insertHold(args.kernel.supabase, args.clientId, {
    status: 'holding',
    cardRunId: card.runId,
    subjectKey: facts.subjectKey,
    fingerprint: card.fingerprint,
    draft,
    accountLabel: args.accountLabel,
  })
  return card
}

export async function submitPausedDraftCard(args: {
  kernel: KernelDeps
  clientId: string
  runId: string
  clicker: CardClicker
  resolution: CardResolution
  expectedDecisionId: string
  fingerprint: string
  review: PausedDraftReview
  resolveDeps?: () => Promise<CreateDraftDeps | null>
  createPaused?: CreatePaused
  now?: Date
}): Promise<PausedDraftSubmitResult> {
  assertMayClick(args.clicker, args.clientId)
  const hold = await holdForRun(args.kernel.supabase, args.clientId, args.runId)
  if (hold.payload.fingerprint !== args.fingerprint) {
    throw new ConfirmationCardError('stale', '你看到的内容已经不是这一张卡了。请刷新后再点。')
  }
  if (hold.payload.status !== 'holding') return finished(hold.payload)
  if (args.resolution === 'decline') return decline(args, hold)
  return confirmAndBuild(args, hold)
}

async function decline(
  args: Parameters<typeof submitPausedDraftCard>[0],
  hold: HoldRow,
): Promise<PausedDraftSubmitResult> {
  const card = await decideConfirmationCard(args.kernel, decisionArgs(args))
  const who = await clickedBy(args.kernel, args.runId)
  const next = { ...hold.payload, status: 'declined' as const, clickedBy: who, queued: false }
  await save(args.kernel.supabase, args.clientId, hold.id, next)
  return { card, wroteMeta: false, queued: false, resultLine: card.statusLine, clickedBy: who }
}

async function confirmAndBuild(
  args: Parameters<typeof submitPausedDraftCard>[0],
  hold: HoldRow,
): Promise<PausedDraftSubmitResult> {
  const card = await confirmedCard(args)
  if (!card) return { card: null, wroteMeta: false, queued: false, resultLine: '这张卡已经不能用来建草稿。', clickedBy: null }
  const who = await clickedBy(args.kernel, args.runId)
  const blocked = await pauseBlock(hold, args.review, args.kernel.supabase, args.clientId)
  if (blocked) return refuse(args, hold, who, blocked, card)
  if (!(await claim(args.kernel.supabase, args.clientId, hold.id, { ...hold.payload, clickedBy: who }))) {
    const again = await holdForRun(args.kernel.supabase, args.clientId, args.runId)
    return finished(again.payload, card)
  }
  return publish(args, hold, who, card)
}

async function confirmedCard(
  args: Parameters<typeof submitPausedDraftCard>[0],
): Promise<ConfirmationCardView | null> {
  const run = await args.kernel.requireRun(args.runId)
  if (run.client_id !== args.clientId) return null
  if (run.status === 'authorized') return null
  if (run.status !== 'pending_approval') return null
  const card = await decideConfirmationCard(args.kernel, decisionArgs(args))
  return card.status === 'confirmed' ? card : null
}

async function pauseBlock(
  hold: HoldRow,
  review: PausedDraftReview,
  sb: SupabaseClient,
  clientId: string,
): Promise<string | null> {
  const reason = pausedDraftBlock(hold.payload.draft, hold.payload.accountLabel, review)
  if (reason) return `没有去建。${reason}`
  return retryBlock(sb, clientId, hold.payload)
}

async function retryBlock(sb: SupabaseClient, clientId: string, payload: HoldPayload): Promise<string | null> {
  const prior = await priorFailures(sb, clientId, payload)
  const retry = pausedDraftRetry(prior, payload.fingerprint)
  if (retry === 'allow') return null
  if (retry === 'same') return '这份草稿上次没建成，内容没变，没有再去建。'
  return '同一类错误已经出现过，这次没有再去建，请交给开发处理。'
}

async function publish(
  args: Parameters<typeof submitPausedDraftCard>[0],
  hold: HoldRow,
  who: string | null,
  card: ConfirmationCardView,
): Promise<PausedDraftSubmitResult> {
  const deps = args.resolveDeps ? await args.resolveDeps() : null
  if (!deps) return fail(args, hold, who, card, '拿不到广告授权，没有去建。', 'no-token')
  try {
    const outcome = await (args.createPaused ?? createDraftForApproval)(hold.payload.draft, deps)
    return recordOutcome(args, hold, who, card, outcome)
  } catch {
    return fail(args, hold, who, card, '建暂停草稿没有完成，没有再试。', 'thrown')
  }
}

async function recordOutcome(
  args: Parameters<typeof submitPausedDraftCard>[0],
  hold: HoldRow,
  who: string | null,
  card: ConfirmationCardView,
  outcome: CreateDraftOutcome,
): Promise<PausedDraftSubmitResult> {
  const queued = outcome.status === 'awaiting_approval'
  const wroteMeta = queued || outcome.status === 'blocked'
  const line = outcomeLine(who, outcome)
  const errorClass = outcome.status === 'failed' ? metaErrorClass(outcome.error ?? '') : undefined
  const status: HoldStatus = queued ? 'built' : outcome.status === 'blocked' ? 'built' : 'failed'
  await save(args.kernel.supabase, args.clientId, hold.id, {
    ...hold.payload,
    status,
    resultLine: line,
    errorClass,
    clickedBy: who,
    queued,
    wroteMeta,
  })
  return { card, wroteMeta, queued, resultLine: line, clickedBy: who }
}

function outcomeLine(who: string | null, outcome: CreateDraftOutcome): string {
  const name = who ?? '有人'
  if (outcome.status === 'awaiting_approval') return `${name} 点了确认。暂停草稿已进审批队列。`
  if (outcome.status === 'blocked') return `${name} 点了确认。已经建成暂停，回读对不上，保持暂停，不删除。`
  return `${name} 点了确认。${plainMetaError(outcome.error ?? '没有建成')}`
}

async function fail(
  args: Parameters<typeof submitPausedDraftCard>[0],
  hold: HoldRow,
  who: string | null,
  card: ConfirmationCardView,
  line: string,
  errorClass: string,
): Promise<PausedDraftSubmitResult> {
  await save(args.kernel.supabase, args.clientId, hold.id, {
    ...hold.payload,
    status: 'failed',
    resultLine: line,
    errorClass,
    clickedBy: who,
    queued: false,
  })
  return { card, wroteMeta: false, queued: false, resultLine: line, clickedBy: who }
}

async function refuse(
  args: Parameters<typeof submitPausedDraftCard>[0],
  hold: HoldRow,
  who: string | null,
  line: string,
  card: ConfirmationCardView,
): Promise<PausedDraftSubmitResult> {
  await save(args.kernel.supabase, args.clientId, hold.id, {
    ...hold.payload,
    status: 'refused',
    resultLine: line,
    clickedBy: who,
    queued: false,
  })
  return { card, wroteMeta: false, queued: false, resultLine: line, clickedBy: who }
}

function finished(payload: HoldPayload, card: ConfirmationCardView | null = null): PausedDraftSubmitResult {
  const stuck = payload.status === 'building'
  return {
    card,
    wroteMeta: payload.wroteMeta === true,
    queued: payload.queued === true,
    resultLine: payload.resultLine ?? (stuck ? '上次建到一半，没有再自动建一次。' : '这张卡已经有结果了，没有再去建。'),
    clickedBy: payload.clickedBy ?? null,
  }
}

function decisionArgs(args: Parameters<typeof submitPausedDraftCard>[0]) {
  return {
    clientId: args.clientId,
    runId: args.runId,
    clicker: args.clicker,
    resolution: args.resolution,
    expectedDecisionId: args.expectedDecisionId,
    fingerprint: args.fingerprint,
    now: args.now,
  }
}

async function clickedBy(kernel: KernelDeps, runId: string): Promise<string | null> {
  const run = await kernel.requireRun(runId)
  if (!run.authorization_decision_id) return null
  const notes = await notesFor(kernel.supabase, [run.authorization_decision_id])
  return notes.get(run.authorization_decision_id)?.decidedBy ?? null
}

async function listHolds(sb: SupabaseClient, clientId: string): Promise<HoldRow[]> {
  const { data, error } = await sb
    .from('flywheel_actions')
    .select('id, payload')
    .eq('client_id', clientId)
    .eq('action_type', PAUSED_DRAFT_HOLD)
    .limit(50)
  if (error) throw new ConfirmationCardError('invalid', '建草稿的记录读不出来，没有去建。')
  const rows = ((data ?? []) as Array<{ id?: unknown; payload?: unknown }>).flatMap(asHold)
  if (rows.length >= 50) throw new ConfirmationCardError('invalid', '待处理的建草稿记录太多，没有再出新卡。')
  return rows
}

async function holdForRun(sb: SupabaseClient, clientId: string, runId: string): Promise<HoldRow> {
  const row = (await listHolds(sb, clientId)).find((item) => item.payload.cardRunId === runId)
  if (!row) throw new ConfirmationCardError('not_found', '找不到这张建草稿的确认卡。')
  return row
}

async function priorFailures(sb: SupabaseClient, clientId: string, payload: HoldPayload): Promise<PriorPausedFailure[]> {
  return (await listHolds(sb, clientId))
    .filter((row) => row.payload.subjectKey === payload.subjectKey && row.payload.status === 'failed')
    .filter((row) => row.payload.cardRunId !== payload.cardRunId)
    .map((row) => ({ fingerprint: row.payload.fingerprint, errorClass: row.payload.errorClass ?? 'meta-other' }))
}

async function insertHold(sb: SupabaseClient, clientId: string, payload: HoldPayload): Promise<void> {
  const { error } = await sb.from('flywheel_actions').insert({
    client_id: clientId,
    flywheel: 'ads',
    action_type: PAUSED_DRAFT_HOLD,
    execution_mode: 'in_house',
    payload,
  })
  if (error) throw new ConfirmationCardError('invalid', '确认卡记下了，但建草稿的底稿没存住，没有去建。')
}

async function claim(sb: SupabaseClient, clientId: string, id: string, payload: HoldPayload): Promise<boolean> {
  const { data, error } = await sb
    .from('flywheel_actions')
    .update({ payload: { ...payload, status: 'building' } })
    .eq('id', id)
    .eq('client_id', clientId)
    .eq('payload->>status', 'holding')
    .select('id')
    .maybeSingle()
  return !error && Boolean((data as { id?: string } | null)?.id)
}

async function save(sb: SupabaseClient, clientId: string, id: string, payload: HoldPayload): Promise<void> {
  const { error } = await sb
    .from('flywheel_actions')
    .update({ payload })
    .eq('id', id)
    .eq('client_id', clientId)
  if (error) throw new ConfirmationCardError('invalid', '结果没能记下。没有再去建一次。')
}

function asHold(row: { id?: unknown; payload?: unknown }): HoldRow[] {
  if (typeof row.id !== 'string' || !row.payload || typeof row.payload !== 'object') return []
  const payload = row.payload as HoldPayload
  if (payload.cardRunId && payload.fingerprint && payload.draft) return [{ id: row.id, payload }]
  return []
}

export async function pausedDraftResultLines(
  sb: SupabaseClient,
  clientId: string,
): Promise<Map<string, string>> {
  const lines = new Map<string, string>()
  try {
    for (const row of await listHolds(sb, clientId)) {
      if (row.payload.resultLine) lines.set(row.payload.cardRunId, row.payload.resultLine)
    }
  } catch {
    return lines
  }
  return lines
}
