/**
 * After a prescription is approved, ask the existing pause and budget issuers
 * for one confirm card per action_list row. Never confirms or executes.
 * A failed card is recorded and does not undo the approval.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { issueBudgetCard } from '@/lib/ads-budget-card/flow'
import { prescriptionLockSource } from '@/lib/ads-budget-card/prescription-lock'
import { metaBudgetRuntime } from '@/lib/ads-budget-card/meta'
import { issueOnePauseCard } from '@/lib/ads-pause-card/issue'
import { kernelThatCannotResume } from '@/lib/ads-pause-card/kernel'
import { readPauseLive } from '@/lib/ads-pause-card/live'
import type { CardClicker } from '@/lib/confirmation-card/actor'
import { createKernel } from '@/lib/kernel'
import { supabaseAdmin } from '@/lib/supabase'
import {
  APPROVE_CARD_LIFETIME,
  emptyActionCardReport,
  issuePlannedCards,
  planActionCards,
  readStoredActionCards,
  withActionCards,
  type ActionCardItem,
  type ActionCardPorts,
  type ActionCardReport,
} from './prescription-action-cards'

export interface ApproveCardArgs {
  clientId: string
  prescriptionId: string
  version: number
  content: unknown
  clicker: CardClicker
  now?: Date
}

export async function issueCardsAfterPrescriptionApproval(args: ApproveCardArgs): Promise<ActionCardReport> {
  try {
    return await issueAndStore(supabaseAdmin, args)
  } catch (error) {
    console.warn('[prescription action cards] failed', error instanceof Error ? error.name : 'error')
    return failedReport(args.prescriptionId, messageOf(error))
  }
}

async function issueAndStore(sb: SupabaseClient, args: ApproveCardArgs): Promise<ActionCardReport> {
  const planned = planActionCards(args.prescriptionId, args.version, args.content)
  if (!planned.ok) {
    const report = failedReport(args.prescriptionId, planned.reason)
    await storeCards(sb, args.clientId, args.prescriptionId, report.items)
    return report
  }
  if (planned.work.length === 0) return emptyActionCardReport()
  const prior = await loadPrior(sb, args.clientId, args.prescriptionId)
  const report = await issuePlannedCards({
    prescriptionId: args.prescriptionId,
    work: planned.work,
    prior,
    ports: portsFor(args),
  })
  await storeCards(sb, args.clientId, args.prescriptionId, report.items)
  return report
}

function portsFor(args: ApproveCardArgs): ActionCardPorts {
  return {
    issuePause: (order) => issueOnePauseCard({
      kernel: kernelThatCannotResume(supabaseAdmin),
      clientId: args.clientId,
      clicker: args.clicker,
      order,
      live: (next) => readPauseLive(args.clientId, next),
      now: args.now,
      lifetime: APPROVE_CARD_LIFETIME,
    }),
    issueBudget: async (order) => {
      const runtime = await metaBudgetRuntime(args.clientId, supabaseAdmin)
      if (!runtime) return { status: 'blocked', reason: '拿不到广告授权，没有出卡。', card: null }
      return issueBudgetCard({
        kernel: createKernel(supabaseAdmin),
        clientId: args.clientId,
        clicker: args.clicker,
        order,
        runtime,
        locks: prescriptionLockSource(supabaseAdmin),
        now: args.now,
        lifetime: APPROVE_CARD_LIFETIME,
      })
    },
  }
}

async function loadPrior(sb: SupabaseClient, clientId: string, prescriptionId: string): Promise<ActionCardItem[]> {
  const read = await sb.from('prescriptions').select('generation_meta').eq('id', prescriptionId).eq('client_id', clientId).maybeSingle()
  if (read.error) return []
  return readStoredActionCards((read.data as { generation_meta?: unknown } | null)?.generation_meta)
}

async function storeCards(
  sb: SupabaseClient,
  clientId: string,
  prescriptionId: string,
  items: readonly ActionCardItem[],
): Promise<void> {
  if (items.length === 0 || items.every((item) => item.status === 'duplicate')) return
  try {
    const read = await sb.from('prescriptions').select('generation_meta').eq('id', prescriptionId).eq('client_id', clientId).maybeSingle()
    if (read.error) return
    const current = (read.data as { generation_meta?: unknown } | null)?.generation_meta
    await sb.from('prescriptions').update({ generation_meta: withActionCards(current, items) }).eq('id', prescriptionId).eq('client_id', clientId)
  } catch (error) {
    console.warn('[prescription action cards] outcome not stored', error instanceof Error ? error.name : 'error')
  }
}

function failedReport(prescriptionId: string, reason: string): ActionCardReport {
  return {
    wroteMeta: false,
    lifetime: APPROVE_CARD_LIFETIME,
    items: [{
      key: actionKey(prescriptionId),
      index: -1,
      type: 'action_list',
      status: 'failed',
      reason,
      runId: null,
      wroteMeta: false,
    }],
  }
}

function actionKey(prescriptionId: string): string {
  return `${prescriptionId}:-1:action_list`
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim().slice(0, 300)
  return '出确认卡失败，没有改广告。'
}
