/**
 * Listing drafts reuse the paused-draft card.
 * Upload and the paused build run only after a person confirms an unexpired card.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { KernelDeps } from '@/lib/kernel/deps'
import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'
import {
  decideConfirmationCard,
  issueConfirmationCard,
  normalizeFacts,
  type CardClicker,
  type CardFacts,
  type CardResolution,
  type ConfirmationCardView,
} from '@/lib/confirmation-card'
import { assertMayClick } from '@/lib/confirmation-card/actor'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import { PAUSED_DRAFT_WHAT } from './paused-draft-copy'
import { markOrHold } from './independent-review-gate'
import type { AdLang, AgentFacts, ListingFacts } from './listing-draft-builder'

export const LISTING_DRAFT_HOLD = 'ads.listing_draft_hold'

export interface ListingIntent {
  kind: 'lead_form' | 'video_thruplay'
  lang: AdLang
  listingId: string
  assetIds: string[]
  listing: ListingFacts | null
  agent: AgentFacts
  dailyBudget: number
  durationDays: number
  geoCountries: string[]
  geoCityKeys?: string[]
  ageMin?: number
  ageMax?: number
  linkUrl?: string
  formName?: string
  pageId: string
  adAccountId: string
  country: string | null
  industry: string | null
}

interface ListingHold {
  status: 'holding' | 'building' | 'declined' | 'built' | 'failed'
  cardRunId: string
  fingerprint: string
  subjectKey: string
  intent: ListingIntent
  wroteMeta: boolean
  resultLine?: string
}

export interface ListingPerformResult {
  wroteMeta: boolean
  error?: string
}

interface DecideArgs {
  clientId: string
  runId: string
  clicker: CardClicker
  resolution: CardResolution
  expectedDecisionId: string
  fingerprint: string
}

export interface ListingCardDeps {
  issue(clientId: string, clicker: CardClicker, facts: CardFacts): Promise<ConfirmationCardView>
  decide(args: DecideArgs): Promise<ConfirmationCardView>
}

type HoldRow = { id: string; payload: ListingHold }

export function listingCardDeps(kernel: KernelDeps): ListingCardDeps {
  return {
    issue: (clientId, clicker, facts) => issueConfirmationCard(kernel, { clientId, clicker, facts }),
    decide: (args) => decideConfirmationCard(kernel, args),
  }
}

export async function issueListingDraftCard(args: {
  sb: SupabaseClient
  clientId: string
  clicker: CardClicker
  intent: ListingIntent
  accountLabel: string
  deps: ListingCardDeps
}): Promise<ConfirmationCardView> {
  const facts = await reviewedFacts(args.sb, args.clientId, args.intent, args.accountLabel)
  const open = await holdingFor(args.sb, args.clientId, facts.subjectKey)
  if (open) {
    throw new ConfirmationCardError('invalid', '已经有一张卡在等确认，没有再出一张，也没有去建。')
  }
  const card = await args.deps.issue(args.clientId, args.clicker, facts)
  await insertHold(args.sb, args.clientId, {
    status: 'holding',
    cardRunId: card.runId,
    fingerprint: card.fingerprint,
    subjectKey: facts.subjectKey,
    intent: args.intent,
    wroteMeta: false,
  })
  return card
}

export async function confirmListingDraftCard(args: {
  sb: SupabaseClient
  clientId: string
  runId: string
  clicker: CardClicker
  resolution: CardResolution
  expectedDecisionId: string
  fingerprint: string
  deps: ListingCardDeps
  perform: (intent: ListingIntent) => Promise<ListingPerformResult>
}): Promise<{ handled: false } | { handled: true; status: number; body: Record<string, unknown> }> {
  assertMayClick(args.clicker, args.clientId)
  const row = await holdForRun(args.sb, args.clientId, args.runId)
  if (!row) return { handled: false }
  if (row.payload.fingerprint !== args.fingerprint) {
    return stopped(409, '你看到的内容已经不是这一张卡了。请刷新后再点。')
  }
  if (row.payload.status !== 'holding') {
    return stopped(409, row.payload.resultLine ?? '这张卡已经有结果了，没有再去建。')
  }
  if (args.resolution === 'decline') return decline(args, row)
  const card = await args.deps.decide(decisionArgs(args))
  if (card.status !== 'confirmed') return closeUnconfirmed(args, row, card)
  if (!(await claim(args.sb, args.clientId, row))) {
    return stopped(409, '上次写到一半，没有再自动写一次。')
  }
  return performOnce(args, row, card)
}

async function reviewedFacts(
  sb: SupabaseClient,
  clientId: string,
  intent: ListingIntent,
  accountLabel: string,
): Promise<CardFacts> {
  const facts = listingFacts(clientId, intent, accountLabel)
  const marked = await markOrHold(sb, clientId, facts.hardChecks, false, '先出确认卡。确认之后才上传素材并建成暂停广告，不开启。')
  if (marked.kind === 'return') {
    throw new ConfirmationCardError('rule_blocked', `独立复核退回：${marked.reason}`)
  }
  return { ...facts, hardChecks: marked.checks }
}

function listingFacts(clientId: string, intent: ListingIntent, accountLabel: string): CardFacts {
  const hash = canonicalHashOfInput({
    clientId,
    listingId: intent.listingId,
    assetIds: intent.assetIds,
    kind: intent.kind,
  }).slice(0, 12)
  const facts: CardFacts = {
    subjectKey: `meta-listing-draft:${hash}`,
    what: PAUSED_DRAFT_WHAT,
    account: plainAccount(accountLabel),
    amount: '确认之后才上传并建成暂停',
    date: '从点确认当天算起',
    scope: '先上传这套房的素材，再建成一个暂停系列，不开启',
    hardChecks: [{ label: '确认后才上传和建', state: 'green', reason: '这一步只出卡' }],
  }
  return normalizeFacts(facts)
}

async function decline(
  args: Parameters<typeof confirmListingDraftCard>[0],
  row: HoldRow,
): Promise<{ handled: true; status: number; body: Record<string, unknown> }> {
  const card = await args.deps.decide(decisionArgs(args))
  await save(args.sb, args.clientId, row.id, { ...row.payload, status: 'declined', wroteMeta: false, resultLine: '没有去建。' })
  return { handled: true, status: 200, body: { wroteMeta: false, card, statusLine: '没有去建。' } }
}

async function closeUnconfirmed(
  args: Parameters<typeof confirmListingDraftCard>[0],
  row: HoldRow,
  card: ConfirmationCardView,
): Promise<{ handled: true; status: number; body: Record<string, unknown> }> {
  const reason = card.status === 'expired' || card.status === 'voided' ? card.statusLine : '这张卡没有确认成功，没有去建。'
  await save(args.sb, args.clientId, row.id, { ...row.payload, status: 'failed', wroteMeta: false, resultLine: reason })
  return { handled: true, status: 200, body: { wroteMeta: false, card, statusLine: reason } }
}

async function performOnce(
  args: Parameters<typeof confirmListingDraftCard>[0],
  row: HoldRow,
  card: ConfirmationCardView,
): Promise<{ handled: true; status: number; body: Record<string, unknown> }> {
  const done = await args.perform(row.payload.intent).catch(() => ({ wroteMeta: false, error: '没有建成暂停广告。' }))
  const reason = done.error ?? '已按确认卡去建暂停广告。'
  await save(args.sb, args.clientId, row.id, {
    ...row.payload,
    status: done.error || !done.wroteMeta ? 'failed' : 'built',
    wroteMeta: done.wroteMeta,
    resultLine: reason,
  })
  return {
    handled: true,
    status: done.wroteMeta ? 200 : 502,
    body: { wroteMeta: done.wroteMeta, card, statusLine: reason, ...(done.error ? { error: done.error } : {}) },
  }
}

function decisionArgs(args: Parameters<typeof confirmListingDraftCard>[0]): DecideArgs {
  return {
    clientId: args.clientId,
    runId: args.runId,
    clicker: args.clicker,
    resolution: args.resolution,
    expectedDecisionId: args.expectedDecisionId,
    fingerprint: args.fingerprint,
  }
}

function plainAccount(label: string): string {
  const text = label.replace(/[{}[\]`]/g, '').trim()
  return text.length > 0 && text.length <= 180 ? text : '已登记的广告账户'
}

function stopped(status: number, error: string): { handled: true; status: number; body: Record<string, unknown> } {
  return { handled: true, status, body: { wroteMeta: false, error } }
}

async function holdingFor(sb: SupabaseClient, clientId: string, subjectKey: string): Promise<HoldRow | null> {
  const found = await holds(sb, clientId, 'payload->>subjectKey', subjectKey)
  return found.find((row) => row.payload.status === 'holding') ?? null
}

async function holdForRun(sb: SupabaseClient, clientId: string, runId: string): Promise<HoldRow | null> {
  const found = await holds(sb, clientId, 'payload->>cardRunId', runId)
  return found.length === 1 ? found[0] ?? null : null
}

async function insertHold(sb: SupabaseClient, clientId: string, payload: ListingHold): Promise<void> {
  const { error } = await sb.from('flywheel_actions').insert({
    client_id: clientId,
    flywheel: 'ads',
    action_type: LISTING_DRAFT_HOLD,
    execution_mode: 'in_house',
    payload,
  })
  if (error) throw new ConfirmationCardError('invalid', '确认卡记下了，但底稿没存住，没有去建。')
}

async function claim(sb: SupabaseClient, clientId: string, row: HoldRow): Promise<boolean> {
  const next = { ...row.payload, status: 'building' as const, wroteMeta: false }
  const { data, error } = await sb.from('flywheel_actions')
    .update({ payload: next })
    .eq('id', row.id)
    .eq('client_id', clientId)
    .eq('payload->>status', 'holding')
    .select('id')
  if (error || !data) return false
  return Array.isArray(data) ? data.length === 1 : true
}

async function save(sb: SupabaseClient, clientId: string, id: string, payload: ListingHold): Promise<void> {
  const { error } = await sb.from('flywheel_actions').update({ payload }).eq('id', id).eq('client_id', clientId)
  if (error) throw new ConfirmationCardError('invalid', '结果没能记下。没有再去建一次。')
}

async function holds(sb: SupabaseClient, clientId: string, column: string, value: string): Promise<HoldRow[]> {
  const { data, error } = await sb
    .from('flywheel_actions')
    .select('id, payload')
    .eq('client_id', clientId)
    .eq('action_type', LISTING_DRAFT_HOLD)
    .eq(column, value)
  if (error) throw new ConfirmationCardError('invalid', '建草稿的记录读不出来，没有去建。')
  return ((data ?? []) as Array<{ id?: unknown; payload?: unknown }>).flatMap(asHold)
}

function asHold(row: { id?: unknown; payload?: unknown }): HoldRow[] {
  if (typeof row.id !== 'string' || !row.payload || typeof row.payload !== 'object') return []
  const payload = row.payload as ListingHold
  if (!payload.cardRunId || !payload.fingerprint || !payload.intent) return []
  return [{ id: row.id, payload }]
}
