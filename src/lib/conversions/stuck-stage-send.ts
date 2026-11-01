/**
 * A stage send that already left, when a new send is no longer allowed.
 * Turns a timed-out `sending` row into `in_doubt` and never calls the writer.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type ParkedStageSend = {
  status: 'sending' | 'in_doubt'
  message: string
  writebackId: string
}

type StageRow = { id: string; status: string; last_attempt_at: string | null }

export async function parkStuckStageSend(
  supabase: SupabaseClient,
  destination: string,
  eventId: string,
  now: Date,
  stuckAfterMs: number,
): Promise<ParkedStageSend | null> {
  const { data, error } = await supabase
    .from('me_conversion_writebacks')
    .select('id, status, last_attempt_at')
    .eq('destination', destination)
    .eq('event_id', eventId)
    .maybeSingle()
  if (error) throw new Error(`读取阶段发送记录失败：${error.message}`)
  const wb = data as StageRow | null
  if (!wb || wb.status !== 'sending') return null
  return parkIfTimedOut(supabase, wb, now, stuckAfterMs)
}

async function parkIfTimedOut(
  supabase: SupabaseClient,
  wb: StageRow,
  now: Date,
  stuckAfterMs: number,
): Promise<ParkedStageSend | null> {
  const startedAt = wb.last_attempt_at ? new Date(wb.last_attempt_at).getTime() : null
  const stuckMs = startedAt == null ? Infinity : now.getTime() - startedAt
  if (stuckMs < stuckAfterMs) {
    return {
      status: 'sending',
      message: '这条正在发送中，请过几秒再看 —— 不会重复发送',
      writebackId: wb.id,
    }
  }
  const parked = await markInDoubt(supabase, wb.id, stuckMs)
  if (!parked) return null
  return {
    status: 'in_doubt',
    message: '上一次发送中途断了，不确定平台收没收 —— 需要人去核对，不会自动重发',
    writebackId: wb.id,
  }
}

async function markInDoubt(supabase: SupabaseClient, writebackId: string, stuckMs: number): Promise<boolean> {
  const { data, error } = await supabase
    .from('me_conversion_writebacks')
    .update({
      status: 'in_doubt',
      last_error: `发送开始后 ${Math.round(stuckMs / 60_000)} 分钟没有结果，状态未知`,
      updated_at: new Date().toISOString(),
    })
    .eq('id', writebackId)
    .in('status', ['sending'])
    .select('id')
  if (error) throw new Error(`更新发送状态失败：${error.message}`)
  return (data?.length ?? 0) > 0
}
