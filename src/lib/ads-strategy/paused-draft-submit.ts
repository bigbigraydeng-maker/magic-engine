/**
 * Issue the paused-draft card, and build only after that card is confirmed.
 * The build calls the existing paused publisher. It never activates a campaign.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { KernelDeps } from '@/lib/kernel/deps'
import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'
import { assertMayClick, contentFingerprint, decideConfirmationCard, issueConfirmationCard, normalizeFacts, type CardClicker, type CardResolution, type ConfirmationCardView } from '@/lib/confirmation-card'
import { notesFor } from '@/lib/confirmation-card/records'
import { voidStaleCard } from '@/lib/confirmation-card/settle'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import { isExpired, readStoredCard } from '@/lib/confirmation-card/view'
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

type HoldStatus = 'holding' | 'building' | 'declined' | 'built' | 'refused' | 'failed' | 'expired'

const PENDING_CAP = 50
const ACCOUNT_CHANGED = '广告账户已经换过了，这张卡不能用来建。请重新出一张确认卡。'
const CARD_GONE = '这张卡已经作废，没有去建。'

interface LinkedRun {
  status: string
  input: Record<string, unknown>
}

type HoldFate = 'live' | 'settled' | 'expired' | 'replaced'

interface HoldPayload {
  status: HoldStatus
  cardRunId: string
  subjectKey: string
  fingerprint: string
  draftHash: string
  draft: AdDraft
  adAccountId: string
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
  const draftHash = canonicalHashOfInput(draft)
  const fingerprint = contentFingerprint(normalizeFacts(facts))
  const now = args.now ?? args.kernel.now()
  await releaseDeadHolds(args.kernel.supabase, args.clientId, now, {
    subjectKey: facts.subjectKey,
    fingerprint,
  })
  await assertCanIssue(args.kernel.supabase, args.clientId, draftHash, fingerprint)
  const card = await issueConfirmationCard(args.kernel, {
    clientId: args.clientId,
    clicker: args.clicker,
    facts,
    now,
  })
  const existing = await rowsFor(args.kernel.supabase, args.clientId, 'payload->>cardRunId', card.runId)
  if (existing.length > 0) return card
  await insertHold(args.kernel.supabase, args.clientId, {
    status: 'holding',
    cardRunId: card.runId,
    subjectKey: facts.subjectKey,
    fingerprint: card.fingerprint,
    draftHash,
    draft,
    adAccountId: args.review.adAccountId,
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
  const now = args.now ?? args.kernel.now()
  await releaseDeadHolds(args.kernel.supabase, args.clientId, now, null)
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
  if (hold.payload.adAccountId !== args.review.adAccountId) return rejectAccountChange(args, hold)
  const card = await confirmedCard(args)
  if (!card) return { card: null, wroteMeta: false, queued: false, resultLine: '这张卡已经不能用来建草稿。', clickedBy: null }
  const who = await clickedBy(args.kernel, args.runId)
  const blocked = await pauseBlock(hold, args.review, args.kernel.supabase, args.clientId)
  if (blocked) return refuse(args, hold, who, blocked, card)
  const deps = args.resolveDeps ? await args.resolveDeps() : null
  if (!deps) return fail(args, hold, who, card, '拿不到广告授权，没有去建。', 'no-token')
  if (deps.adAccountId !== hold.payload.adAccountId) return rejectAccountChange(args, hold)
  if (!(await claim(args.kernel.supabase, args.clientId, hold.id, { ...hold.payload, clickedBy: who }))) {
    const again = await holdForRun(args.kernel.supabase, args.clientId, args.runId)
    return finished(again.payload, card)
  }
  return publish(args, hold, who, card, { ...deps, adAccountId: hold.payload.adAccountId })
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
  deps: CreateDraftDeps,
): Promise<PausedDraftSubmitResult> {
  try {
    const outcome = await (args.createPaused ?? createDraftForApproval)(hold.payload.draft, deps)
    return recordOutcome(args, hold, who, card, outcome)
  } catch {
    return fail(args, hold, who, card, '建暂停草稿没有完成，没有再试。', 'thrown')
  }
}

async function rejectAccountChange(
  args: Parameters<typeof submitPausedDraftCard>[0],
  hold: HoldRow,
): Promise<PausedDraftSubmitResult> {
  const run = await args.kernel.requireRun(args.runId)
  await voidStaleCard(args.kernel, run)
  await save(args.kernel.supabase, args.clientId, hold.id, {
    ...hold.payload,
    status: 'refused',
    resultLine: ACCOUNT_CHANGED,
    queued: false,
    wroteMeta: false,
  })
  return { card: null, wroteMeta: false, queued: false, resultLine: ACCOUNT_CHANGED, clickedBy: null }
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

function holdFate(
  payload: HoldPayload,
  run: LinkedRun | undefined,
  now: Date,
  incoming: { subjectKey: string; fingerprint: string } | null,
): HoldFate {
  if (!run) return 'live'
  if (run.status !== 'pending_approval') return 'settled'
  if (!incoming) return 'live'
  const stored = readStoredCard(run.input)
  if (stored && isExpired(stored.issuedAt, now)) return 'expired'
  const replaced = payload.subjectKey === incoming.subjectKey && payload.fingerprint !== incoming.fingerprint
  return stored && replaced ? 'replaced' : 'live'
}

async function linkedRuns(sb: SupabaseClient, ids: string[]): Promise<Map<string, LinkedRun>> {
  const found = new Map<string, LinkedRun>()
  const unique = [...new Set(ids)]
  if (unique.length === 0) return found
  const { data, error } = await sb.from('action_runs').select('id, status, input').in('id', unique)
  if (error) throw new ConfirmationCardError('invalid', '建草稿的记录读不出来，没有去建。')
  for (const row of (data ?? []) as Array<{ id?: unknown; status?: unknown; input?: unknown }>) {
    if (typeof row.id !== 'string' || typeof row.status !== 'string') continue
    if (!row.input || typeof row.input !== 'object') continue
    found.set(row.id, { status: row.status, input: row.input as Record<string, unknown> })
  }
  return found
}

/** Drop holds whose card has expired, been replaced, or already been settled. */
async function releaseDeadHolds(
  sb: SupabaseClient,
  clientId: string,
  now: Date,
  incoming: { subjectKey: string; fingerprint: string } | null,
): Promise<void> {
  const holding = await rowsFor(sb, clientId, 'payload->>status', 'holding')
  const runs = await linkedRuns(sb, holding.map((row) => row.payload.cardRunId))
  for (const row of holding) {
    const fate = holdFate(row.payload, runs.get(row.payload.cardRunId), now, incoming)
    if (fate === 'live') continue
    if (!incoming && fate !== 'settled') continue
    await save(sb, clientId, row.id, {
      ...row.payload,
      status: 'expired',
      resultLine: row.payload.resultLine ?? CARD_GONE,
    })
  }
}

async function assertCanIssue(
  sb: SupabaseClient,
  clientId: string,
  draftHash: string,
  fingerprint: string,
): Promise<void> {
  const holding = await rowsFor(sb, clientId, 'payload->>status', 'holding')
  const building = await rowsFor(sb, clientId, 'payload->>status', 'building')
  if (holding.length + building.length >= PENDING_CAP) {
    throw new ConfirmationCardError('invalid', '待处理的建草稿记录太多，没有再出新卡。')
  }
  const byDraft = await rowsFor(sb, clientId, 'payload->>draftHash', draftHash)
  const byPrint = await rowsFor(sb, clientId, 'payload->>fingerprint', fingerprint)
  const busy = [...byDraft, ...byPrint].some((row) => row.payload.status === 'building' || row.payload.status === 'built')
  if (busy) throw new ConfirmationCardError('invalid', '这份草稿已经在建或已经送审，没有再出一张卡。')
}

async function rowsFor(
  sb: SupabaseClient,
  clientId: string,
  column: string,
  value: string,
): Promise<HoldRow[]> {
  const { data, error } = await sb
    .from('flywheel_actions')
    .select('id, payload')
    .eq('client_id', clientId)
    .eq('action_type', PAUSED_DRAFT_HOLD)
    .eq(column, value)
  if (error) throw new ConfirmationCardError('invalid', '建草稿的记录读不出来，没有去建。')
  return ((data ?? []) as Array<{ id?: unknown; payload?: unknown }>).flatMap(asHold)
}

async function holdForRun(sb: SupabaseClient, clientId: string, runId: string): Promise<HoldRow> {
  const rows = await rowsFor(sb, clientId, 'payload->>cardRunId', runId)
  if (rows.length !== 1) throw new ConfirmationCardError('not_found', '找不到这张建草稿的确认卡。')
  const row = rows[0]
  if (!row) throw new ConfirmationCardError('not_found', '找不到这张建草稿的确认卡。')
  return row
}

async function priorFailures(sb: SupabaseClient, clientId: string, payload: HoldPayload): Promise<PriorPausedFailure[]> {
  return (await rowsFor(sb, clientId, 'payload->>subjectKey', payload.subjectKey))
    .filter((row) => row.payload.status === 'failed' && row.payload.cardRunId !== payload.cardRunId)
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
    const { data, error } = await sb
      .from('flywheel_actions')
      .select('id, payload')
      .eq('client_id', clientId)
      .eq('action_type', PAUSED_DRAFT_HOLD)
    if (error) return lines
    for (const row of ((data ?? []) as Array<{ id?: unknown; payload?: unknown }>).flatMap(asHold)) {
      if (row.payload.resultLine) lines.set(row.payload.cardRunId, row.payload.resultLine)
    }
  } catch {
    return lines
  }
  return lines
}
