/**
 * Payment deals pass review themselves and then use the existing send
 * state machine. A queue is not used: replaying one has double-sent before.
 * This module does not import the sender until a real dispatch runs.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { SendOutcomeResult } from './writeback-service'

export const CRM_DEAL_AUTO_ACTOR = 'system:crm-deal-auto'

export type DealSendClass = 'sent' | 'held' | 'expired' | 'blocked' | 'not_sent' | 'failed'

type SendPreview = { held?: unknown }

export function classifyDealSend(result: { status: string; preview?: SendPreview | null }): DealSendClass {
  if (result.preview?.held === true) return 'held'
  if (result.status === 'confirmed') return 'sent'
  if (result.status === 'expired_no_send') return 'expired'
  if (result.status === 'redacted') return 'blocked'
  if (result.status === 'dry_run' || result.status === 'queued') return 'not_sent'
  return 'failed'
}

export function autoPassMessage(kind: 'recorded' | 'restored', send: DealSendClass): string {
  const head = kind === 'restored'
    ? '这笔之前因为撤销收款作废了。款又记下之后，已重新打开，并已自动通过。'
    : '记下了，已自动通过。'
  const tail: Record<DealSendClass, string> = {
    sent: '已发给广告平台。',
    held: '按这个客户允许发送的名单先停住了，没有发出去。',
    expired: '这笔已经超过 7 天，广告平台收不进去，没有发出去。',
    blocked: '没有发给广告平台。',
    not_sent: '这次没有发给广告平台。',
    failed: '发给广告平台时没成功。',
  }
  return head + tail[send]
}

/** The deal row already exists. Say so, then say what this send attempt did. */
export function unsentRetryMessage(send: DealSendClass): string {
  const head = '这笔已经记下了，但上次发送记录没写成。'
  const tail: Record<DealSendClass, string> = {
    sent: '这次已发给广告平台。',
    held: '这次仍按允许发送的名单停住了，没有发出去。',
    expired: '这笔已经超过 7 天，广告平台收不进去，没有发出去。',
    blocked: '这次也没有发给广告平台。',
    not_sent: '这次没有发给广告平台。',
    failed: '这次还是没写成发送记录。请到成交页再试一次。',
  }
  return head + tail[send]
}

export function partyReadNote(message: string, fromStored: boolean): string {
  if (!fromStored) return message
  return `${message}人数是从已经存下的往来或跟进记录里读到的。`
}

type Sender = (db: SupabaseClient, outcomeId: string) => Promise<SendOutcomeResult>

async function defaultSend(db: SupabaseClient, outcomeId: string): Promise<SendOutcomeResult> {
  const { sendApprovedOutcome } = await import('./writeback-service')
  const { metaCapiWriter } = await import('@/lib/meta/capi/writer')
  return sendApprovedOutcome(outcomeId, { supabase: db, writer: metaCapiWriter, fetcher: fetch })
}

/** Never throws. A send error after the row exists must not look like the row was lost. */
export async function dispatchCrmDeal(
  db: SupabaseClient,
  outcomeId: string,
  send: Sender = defaultSend,
): Promise<DealSendClass> {
  try {
    return classifyDealSend(await send(db, outcomeId))
  } catch {
    return 'failed'
  }
}
