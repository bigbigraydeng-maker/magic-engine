/**
 * 「待确认的电话」读侧：电话系统收了一通电话，但没能自动记进客人档案（crm_status =
 * needs_review / failed）时，要有一个人看得见的出口（PM 2026-10-12：接真实客人线路前必须补）。
 *
 * 只读。电话系统（telephony_calls）的写入归电话流水线，这里一行写操作都没有。
 * 号码只给「尾号」，不把完整号码摆到页面和待办上。
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export const REVIEW_STATUSES = ['needs_review', 'failed'] as const

export interface ReviewCall {
  id: string
  startedAt: string
  direction: 'inbound' | 'outbound' | null
  /** 号码尾号（最多 3 位），认不出时为空串。 */
  numberTail: string
  answered: boolean
  talkSeconds: number
  status: 'needs_review' | 'failed'
  /** 为什么没能自动记进客人档案（电话流水线写的人话；没写就给一句兜底）。 */
  reason: string
}

export interface ReviewCallRow {
  id: string
  started_at: string
  direction: string | null
  counterparty_e164: string | null
  answered: boolean | null
  talk_seconds: number | null
  crm_status: string
  crm_detail: string | null
}

export const FALLBACK_REASON = '电话系统没写原因，需要人看一眼这通电话'

export function numberTail(e164: string | null): string {
  if (!e164) return ''
  const digits = e164.replace(/\D/g, '')
  return digits.slice(-3)
}

export function toReviewCall(row: ReviewCallRow): ReviewCall {
  const detail = (row.crm_detail ?? '').trim()
  return {
    id: row.id,
    startedAt: row.started_at,
    direction: row.direction === 'inbound' || row.direction === 'outbound' ? row.direction : null,
    numberTail: numberTail(row.counterparty_e164),
    answered: row.answered === true,
    talkSeconds: typeof row.talk_seconds === 'number' ? row.talk_seconds : 0,
    status: row.crm_status === 'failed' ? 'failed' : 'needs_review',
    reason: detail.length > 0 ? detail : FALLBACK_REASON,
  }
}

export interface ReviewCallsResult {
  calls: ReviewCall[]
  /** 实际待确认的总数（可能多于 calls.length，页面要明说）。 */
  total: number
}

const SELECT_COLUMNS = 'id, started_at, direction, counterparty_e164, answered, talk_seconds, crm_status, crm_detail'

/** 读失败一律抛，不许把「读不到」画成「没有待确认」。 */
export async function loadReviewCalls(
  supabase: SupabaseClient,
  clientId: string,
  limit = 100,
): Promise<ReviewCallsResult> {
  const { data, error, count } = await supabase
    .from('telephony_calls')
    .select(SELECT_COLUMNS, { count: 'exact' })
    .eq('client_id', clientId)
    .in('crm_status', [...REVIEW_STATUSES])
    .order('started_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`telephony_calls query failed: ${error.message}`)
  const calls = ((data ?? []) as ReviewCallRow[]).map(toReviewCall)
  return { calls, total: typeof count === 'number' ? count : calls.length }
}

/** 每个客户有几通待确认的电话（待办汇总用）。读失败抛。 */
export async function countReviewCallsByClient(
  supabase: SupabaseClient,
  clientIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (clientIds.length === 0) return out
  const { data, error } = await supabase
    .from('telephony_calls')
    .select('client_id')
    .in('client_id', clientIds)
    .in('crm_status', [...REVIEW_STATUSES])
    .limit(5000)
  if (error) throw new Error(`telephony_calls count failed: ${error.message}`)
  for (const r of (data ?? []) as { client_id: string }[]) {
    out.set(r.client_id, (out.get(r.client_id) ?? 0) + 1)
  }
  return out
}
