/**
 * 已经超过广告平台 7 天窗口的待核对，直接标「不发送 / 超过时限」。
 *
 * 不发给广告平台。2026-09-26 定过：这一步不看「AI 自动审核」开没开，
 * 关着的客户以前没人清，过期行会一直躺在今日待办里。
 * 精确时间，不提前 1 小时——那 1 小时余量只用于 AI 还开着时「来不及批就不问模型」。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { AI_REVIEWER_IDENTITY } from './ai-auto-review-circuit-breaker'
import { DAY_MS, eventAgeMs } from './event-window'
import { PAST_WINDOW_REJECT_REASON, PAST_WINDOW_RULE } from './reject-reasons'
import { pastEventWindowCutoffIso } from './review-copy'

const SWEEP_LIMIT = 60
const SWEEP_PASSES = 5

type WindowRow = { id: string; occurred_at: string }

export async function markNotSentPastWindow(
  supabase: SupabaseClient,
  outcomeId: string,
  note: string,
  now: Date,
  ageDays: number,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('me_sale_outcomes')
    .update({
      review_status: 'rejected',
      reject_reason: PAST_WINDOW_REJECT_REASON,
      reject_note: note,
      reviewed_by: AI_REVIEWER_IDENTITY,
      reviewed_at: now.toISOString(),
      reviewed_ip: null,
      reviewed_ua: null,
      review_request_id: crypto.randomUUID(),
      updated_at: now.toISOString(),
    })
    .eq('id', outcomeId)
    .eq('review_status', 'pending_review')
    .select('id')

  if (error) throw new Error(`拒绝失败：${error.message}`)
  if ((data?.length ?? 0) === 0) return false

  await supabase.from('me_conversion_audit').insert({
    outcome_id: outcomeId,
    action: 'ai_auto_rejected',
    actor: AI_REVIEWER_IDENTITY,
    detail: {
      reason: 'expired',
      rule: PAST_WINDOW_RULE,
      reject_reason: PAST_WINDOW_REJECT_REASON,
      ageDays: Math.round(ageDays * 100) / 100,
      model: null,
      promptVersion: null,
    },
  })
  return true
}

async function listPastWindow(supabase: SupabaseClient, now: Date): Promise<WindowRow[]> {
  const { data, error } = await supabase
    .from('me_sale_outcomes')
    .select('id, occurred_at')
    .eq('review_status', 'pending_review')
    .is('redacted_at', null)
    .lt('occurred_at', pastEventWindowCutoffIso(now))
    .order('occurred_at', { ascending: true })
    .limit(SWEEP_LIMIT)

  if (error) throw new Error(`读取已过期待审核记录失败：${error.message}`)
  return (data ?? []) as WindowRow[]
}

async function rejectListed(supabase: SupabaseClient, rows: WindowRow[], now: Date): Promise<number> {
  let marked = 0
  for (const row of rows) {
    const ageDays = eventAgeMs(row.occurred_at, now) / DAY_MS
    const note = `已过去 ${ageDays.toFixed(1)} 天，超过广告平台 7 天窗口，系统自动标记不发送`
    if (await markNotSentPastWindow(supabase, row.id, note, now, ageDays)) marked++
  }
  return marked
}

/** 所有客户一起清。一轮最多 5 批，清不完的下一轮今日待办或早晨任务接着清。 */
export async function sweepPastWindowAll(supabase: SupabaseClient, now: Date): Promise<number> {
  let expired = 0
  for (let pass = 0; pass < SWEEP_PASSES; pass++) {
    const rows = await listPastWindow(supabase, now)
    if (rows.length === 0) break
    const marked = await rejectListed(supabase, rows, now)
    expired += marked
    if (marked === 0 || rows.length < SWEEP_LIMIT) break
  }
  return expired
}
