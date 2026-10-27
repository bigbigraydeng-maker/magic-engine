/**
 * Zhuge drawer turn for spend / publish / ad-account writes.
 * Issues a knife-7 confirmation card and returns. Does not run the chat model
 * and does not write the ad account.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { KernelDeps } from '@/lib/kernel/deps'
import {
  type CardClicker,
  type ConfirmationCardView,
  issueConfirmationCard,
} from '@/lib/confirmation-card'
import { publicError } from '@/lib/confirmation-card/http'
import { classifyDrawerTurn, type SpendKind } from './drawer-spend-ask'
import { factsForSpend, type SpendEvidence } from './drawer-spend-checks'
import { loadSpendEvidence, type SpendEvidenceDb } from './drawer-spend-evidence'

const AFFIRMATION_REPLY = '聊天里说好、可以、确认都不算点了确认，也没有执行。'
const STAFF_REPLY = '客户员工可以对话，但不能发起花钱、发布或改广告。这一下没有执行。'
const CARD_REPLY = '已出确认卡，还没有执行。请在卡片上点确认或不做。聊天里说好、可以、确认都不算。'

export type DrawerSpendBody = {
  readonly success: boolean
  readonly held: true
  readonly executed: false
  readonly reply?: string
  readonly error?: string
  readonly card?: ConfirmationCardView
}

export type DrawerSpendOutcome =
  | { readonly kind: 'pass' }
  | { readonly kind: 'reply'; readonly status: number; readonly body: DrawerSpendBody }

function reply(status: number, body: DrawerSpendBody): DrawerSpendOutcome {
  return { kind: 'reply', status, body }
}

function mayAsk(clicker: CardClicker, clientId: string): boolean {
  if (clicker.kind === 'agent' || clicker.kind === 'opc') return true
  return clicker.kind === 'fde' && clicker.clientId === clientId
}

export async function issueDrawerSpendCard(args: {
  kernel: KernelDeps
  clientId: string
  clicker: CardClicker
  spend: SpendKind
  summary: string
  evidence: SpendEvidence
  now?: Date
}): Promise<ConfirmationCardView> {
  const facts = factsForSpend(args.spend, args.summary, args.evidence)
  return issueConfirmationCard(args.kernel, {
    clientId: args.clientId,
    clicker: args.clicker,
    facts,
    now: args.now,
  })
}

export async function handleDrawerSpendTurn(args: {
  supabase: SupabaseClient | SpendEvidenceDb
  kernel: KernelDeps
  clientId: string
  clicker: CardClicker
  message: string
  now?: Date
}): Promise<DrawerSpendOutcome> {
  const turn = classifyDrawerTurn(args.message)
  if (turn.kind === 'chat') return { kind: 'pass' }
  if (turn.kind === 'affirmation') {
    return reply(200, { success: true, held: true, executed: false, reply: AFFIRMATION_REPLY })
  }
  if (!mayAsk(args.clicker, args.clientId)) {
    return reply(200, { success: true, held: true, executed: false, reply: STAFF_REPLY })
  }
  const now = args.now ?? new Date()
  try {
    const evidence = await loadSpendEvidence(args.supabase as SpendEvidenceDb, args.clientId, args.clicker, now)
    const card = await issueDrawerSpendCard({
      kernel: args.kernel,
      clientId: args.clientId,
      clicker: args.clicker,
      spend: turn.spend,
      summary: turn.summary,
      evidence,
      now,
    })
    return reply(200, { success: true, held: true, executed: false, reply: CARD_REPLY, card })
  } catch (error) {
    const mapped = publicError(error)
    return reply(mapped.status, { success: false, held: true, executed: false, error: mapped.message })
  }
}
