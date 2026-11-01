/**
 * 今日待办里的「读回链拒绝了，但以前没人看得见」。
 *
 * 数据来源：`social-readback-outcome` 写进 `cron_run_logs` 的失败行
 * （status = failed）。不单开表。拉模式：事件丢了，待办照样出得来。
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-items'
import { SOCIAL_READBACK_OUTCOME_JOB } from '@/lib/social/readback-outcome-record'

export type SocialReadbackItemKind = 'social_readback_refused'

const APP_BASE = 'https://app.magicengine.com.au'
const LOOKBACK_DAYS = 7
const MAX_ITEMS = 20

interface ReadbackSummary {
  client_id?: unknown
  subject_kind?: unknown
  subject_ref?: unknown
  outcome?: unknown
  reason?: unknown
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function reasonCode(outcome: string, reason: string): string {
  const prefix = 'reel_rebind_refused:'
  if (outcome.startsWith(prefix)) return outcome.slice(prefix.length)
  return reason || outcome
}

function hrefFor(clientId: string, subjectRef: string): string {
  if (/^\d+_\d+$/.test(subjectRef)) return `https://www.facebook.com/${subjectRef}`
  return `${APP_BASE}/dashboard/clients/${clientId}`
}

function copyFor(code: string, clientName: string, subjectRef: string): { what: string; how: string } {
  const handoff = `把这条待办转给开发，附上编号 ${subjectRef}`
  if (code === 'not_published') {
    return {
      what: `${clientName} 有一条短视频，系统拒绝开始记它的成绩：流量记录还不是已公开。点赞、评论、转发不会被自动记下来，后面「该不该照这个再发」也会缺这一条。`,
      how: `① 打开链接，看这条视频在 Facebook 上是不是已经公开。② 如果还是草稿，这条不用管。③ 如果已经公开，${handoff}，说明流量记录还是草稿。不要在 Facebook 后台改状态，也不要重新发布。`,
    }
  }
  if (code === 'published_at_mismatch') {
    return {
      what: `${clientName} 有一条短视频，系统拒绝开始记它的成绩：记录里的公开时间和这次对不上。成绩不会被自动记下来。`,
      how: `① 打开链接，确认这条视频在 Facebook 上是公开的。② ${handoff}，说明公开时间对不上。不要重新发布，也不要改时间。`,
    }
  }
  if (code === 'multiple_traffic_rows') {
    return {
      what: `${clientName} 有一条短视频，同一个工单有多于一条流量记录，系统没法确定记哪一条，所以没有开始记成绩。`,
      how: `${handoff}，说明有多条流量记录。不要手工删记录，也不要重新发布。`,
    }
  }
  const shown = code || '未记录原因'
  return {
    what: `${clientName} 有一条社媒内容，系统拒绝开始记它的成绩（${shown}）。成绩不会被自动记下来。`,
    how: `① 打开链接看这条内容是否还在。② ${handoff}，原因是 ${shown}。不要重新发布。`,
  }
}

export async function pushSocialReadbackItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  clientNames: Map<string, { name: string }>,
): Promise<void> {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from('cron_run_logs')
    .select('summary, started_at')
    .eq('job_name', SOCIAL_READBACK_OUTCOME_JOB)
    .eq('status', 'failed')
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(100)
  if (error) throw new Error(`cron_run_logs query failed: ${error.message}`)

  const seen = new Set<string>()
  for (const row of (data ?? []) as Array<{ summary?: ReadbackSummary | null }>) {
    const summary = row.summary ?? {}
    const clientId = str(summary.client_id)
    const subjectRef = str(summary.subject_ref)
    const outcome = str(summary.outcome)
    const code = reasonCode(outcome, str(summary.reason))
    const dedup = `${str(summary.subject_kind)}:${subjectRef}:${outcome || code}`
    if (!clientId || !subjectRef || seen.has(dedup)) continue
    seen.add(dedup)
    if (seen.size > MAX_ITEMS) break
    const clientName = clientNames.get(clientId)?.name ?? '未知客户'
    const copy = copyFor(code, clientName, subjectRef)
    items.push({
      kind: 'social_readback_refused',
      client_id: clientId,
      client_name: clientName,
      what: copy.what,
      how: copy.how,
      href: hrefFor(clientId, subjectRef),
    })
  }
}
