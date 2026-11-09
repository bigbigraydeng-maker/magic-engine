/**
 * Turn a winner-sync scan into confirmation cards.
 * This file does not call Meta.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { KernelDeps } from '@/lib/kernel/deps'
import { createKernel } from '@/lib/kernel'
import { issueConfirmationCard, type CardClicker } from '@/lib/confirmation-card'
import type { CardFacts, HardCheck } from '@/lib/confirmation-card/facts'
import {
  WINNER_ACTIVATE_WHAT,
  WINNER_ADD_WHAT,
  WINNER_OBSERVATION_DAYS,
  WINNER_PAUSE_WHAT,
} from './copy'
import type { AddIntent, PauseIntent } from './intents'
import {
  activateSubject,
  addSubject,
  holdFromActivate,
  holdFromAdd,
  holdFromPause,
  insertHold,
  openHold,
  pauseSubject,
} from './ledger'

const ACCOUNT = '这位客户的广告账户'

export interface ProposedItem {
  name: string
  postId: string
  score: number
  proposalRunId: string
  creativeRef: null
  adId: string
}

export interface ProposedPause {
  adId: string
  name: string
  reason: string
  ctr: number
  proposalRunId: string
}

export async function proposeWinnerBatch(args: {
  supabase: SupabaseClient
  clientId: string
  clicker: CardClicker
  adds: readonly AddIntent[]
  pauses: readonly PauseIntent[]
  configAskedActive: boolean
  now?: Date
}): Promise<{ added: ProposedItem[]; paused: ProposedPause[]; guards: string[] }> {
  if (args.adds.length === 0 && args.pauses.length === 0) return { added: [], paused: [], guards: [] }
  const kernel = args.now ? createKernel(args.supabase, { now: () => args.now as Date }) : createKernel(args.supabase)
  const added: ProposedItem[] = []
  const paused: ProposedPause[] = []
  const guards: string[] = []
  for (const intent of args.adds) {
    const one = await proposeAdd(kernel, args, intent).catch(() => null)
    if (one === 'already') guards.push(`already_proposed:${intent.postId}`)
    else if (one) added.push(one)
    else guards.push(`propose_failed:${intent.postId}`)
  }
  for (const intent of args.pauses) {
    const one = await proposePause(kernel, args, intent).catch(() => null)
    if (one === 'already') guards.push(`already_proposed:${intent.adId}`)
    else if (one) paused.push(one)
    else guards.push(`propose_pause_failed:${intent.adId}`)
  }
  return { added, paused, guards }
}

export async function proposeActivateCard(args: {
  kernel: KernelDeps
  clientId: string
  clicker: CardClicker
  pageId: string
  adAccountId: string
  adsetId: string
  adId: string
  name: string
  configAskedActive: boolean
  now?: Date
}): Promise<string | null> {
  const subjectKey = activateSubject(args.adsetId, args.adId)
  if (await openHold(args.kernel.supabase, args.clientId, subjectKey)) return null
  const facts = activateFacts(subjectKey)
  const card = await issueConfirmationCard(args.kernel, {
    clientId: args.clientId, clicker: args.clicker, facts, now: args.now,
  })
  await insertHold(args.kernel.supabase, args.clientId, holdFromActivate({
    cardRunId: card.runId,
    fingerprint: card.fingerprint,
    pageId: args.pageId,
    adAccountId: args.adAccountId,
    adsetId: args.adsetId,
    adId: args.adId,
    name: args.name,
    configAskedActive: args.configAskedActive,
  }))
  return card.runId
}

async function proposeAdd(
  kernel: KernelDeps,
  args: { supabase: SupabaseClient; clientId: string; clicker: CardClicker; configAskedActive: boolean; now?: Date },
  intent: AddIntent,
): Promise<ProposedItem | 'already'> {
  const subjectKey = addSubject(intent)
  if (await openHold(args.supabase, args.clientId, subjectKey)) return 'already'
  const card = await issueConfirmationCard(kernel, {
    clientId: args.clientId,
    clicker: args.clicker,
    facts: addFacts(subjectKey, args.configAskedActive),
    now: args.now,
  })
  await insertHold(args.supabase, args.clientId, holdFromAdd(intent, card.runId, card.fingerprint, args.configAskedActive))
  return { name: intent.name, postId: intent.postId, score: intent.score, proposalRunId: card.runId, creativeRef: null, adId: '' }
}

async function proposePause(
  kernel: KernelDeps,
  args: { supabase: SupabaseClient; clientId: string; clicker: CardClicker; configAskedActive: boolean; now?: Date },
  intent: PauseIntent,
): Promise<ProposedPause | 'already'> {
  const subjectKey = pauseSubject(intent)
  if (await openHold(args.supabase, args.clientId, subjectKey)) return 'already'
  const card = await issueConfirmationCard(kernel, {
    clientId: args.clientId,
    clicker: args.clicker,
    facts: pauseFacts(subjectKey),
    now: args.now,
  })
  await insertHold(args.supabase, args.clientId, holdFromPause(intent, card.runId, card.fingerprint, args.configAskedActive))
  return { adId: intent.adId, name: intent.name, reason: intent.reason, ctr: intent.ctr, proposalRunId: card.runId }
}

function addFacts(subjectKey: string, configAskedActive: boolean): CardFacts {
  const scope = configAskedActive
    ? '客户开过自动上线。这次只出建议，建成后仍暂停。'
    : '加进已有广告组。建成后仍暂停，不新开系列。'
  return facts(subjectKey, WINNER_ADD_WHAT, '不花钱', `确认之后才建，观察 ${WINNER_OBSERVATION_DAYS} 天`, scope, [
    check('只建暂停', '不会把新广告直接打开'),
  ])
}

function pauseFacts(subjectKey: string): CardFacts {
  return facts(subjectKey, WINNER_PAUSE_WHAT, '不改预算', `确认之后才暂停，观察 ${WINNER_OBSERVATION_DAYS} 天`, '暂停走已有的暂停卡，这里不直接改广告', [
    check('只建议暂停', '不会在出卡这一步暂停'),
  ])
}

function activateFacts(subjectKey: string): CardFacts {
  return facts(subjectKey, WINNER_ACTIVATE_WHAT, '打开后才花钱', `确认之后才打开，观察 ${WINNER_OBSERVATION_DAYS} 天`, '只打开这一条已暂停的新广告', [
    check('单独开投', '建成暂停的那张卡不能顺便打开'),
  ])
}

function facts(subjectKey: string, what: string, amount: string, date: string, scope: string, hardChecks: HardCheck[]): CardFacts {
  return { subjectKey, what, account: ACCOUNT, amount, date, scope, hardChecks }
}

function check(label: string, reason: string): HardCheck {
  return { label, state: 'green', reason }
}
