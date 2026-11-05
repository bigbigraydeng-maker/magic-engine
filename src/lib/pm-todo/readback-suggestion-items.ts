/**
 * 今日待办「社媒每周回看建议」：每周一回看（social-readback-weekly）写的回执里，哪个客户有「多做 / 少做」建议，或读不到数。
 * 每个客户最多一条；只读最近 8 天内最新一行回执；只读，一行写库都没有。建议只是建议，不会自己改任何设置。
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { APP_BASE } from './binding-request-items'

export const READBACK_TODO_KIND = 'social_readback_suggestion' as const
export const READBACK_JOB = 'social-readback-weekly'
const FRESH_DAYS = 8
const NO_DM_NOTE = '注意：这里比的是点赞、评论、分享，不是询价；自然内容带来的私信和表单暂时归不到某一条片，所以查不到，不是 0。'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const s = (v: unknown): string => (typeof v === 'string' ? v : '')
const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** One client receipt → one to-do, or none when there is nothing to act on. Pure. */
export function buildReadbackItem(receipt: unknown, nameOf: (id: string) => string): ManualItem | null {
  if (!isRecord(receipt) || typeof receipt.client_id !== 'string') return null
  const href = `${APP_BASE}/dashboard/clients/${encodeURIComponent(receipt.client_id)}/daily-plan?tab=reels`
  const base = { kind: READBACK_TODO_KIND, client_id: receipt.client_id, client_name: nameOf(receipt.client_id), href }
  if (receipt.error) {
    return { ...base, what: `本周 Reel 回看没跑成（${s(receipt.as_of)}）：${s(receipt.error)}。这周没人看过发出去的片效果如何，不要当成没问题。`, how: '这条不用你改内容：是我们这边的欠账，已记在运行记录里。' }
  }
  const counts = isRecord(receipt.counts) ? receipt.counts : {}
  const unread = n(counts.not_readable)
  const suggestion = isRecord(receipt.suggestion) ? receipt.suggestion : null
  const lines = Array.isArray(suggestion?.lines) ? suggestion.lines.filter((l): l is string => typeof l === 'string') : []
  const advice = suggestion?.status === 'ok' && lines.length > 0 ? lines : []
  if (advice.length === 0 && unread === 0) return null
  const unreadNote = unread > 0 ? `另有 ${unread} 条满 72 小时但没读到数（不是 0，要查读数权限）。` : ''
  return {
    ...base,
    what: `Reel 回看（${s(receipt.as_of)}）：${advice.length > 0 ? advice.join('') : ''}${unreadNote}${NO_DM_NOTE}`,
    how: advice.length > 0 ? '打开客户社媒页看每条片的 72 小时成绩，决定下周配比是否照建议调；系统不会自己改。' : '打开客户社媒页看哪几条没读到数，转给开发查读数权限。',
  }
}

/** Newest receipt per client over the last 8 days; a failed run becomes its own to-do, never silence. */
export async function pushReadbackItems(supabase: SupabaseClient, items: ManualItem[], nameOf: (id: string) => string, now: Date): Promise<void> {
  const since = new Date(now.getTime() - FRESH_DAYS * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from('cron_run_logs')
    .select('summary, started_at')
    .eq('job_name', READBACK_JOB)
    .in('status', ['completed', 'partial', 'failed'])
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(20)
  if (error) throw new Error(error.message)
  const rows = (Array.isArray(data) ? data : []).map((r) => (isRecord(r) ? r.summary : null)).filter(isRecord)
  if (rows.find((r) => r.trigger !== 'event')?.status === 'list_failed') {
    items.push({ kind: READBACK_TODO_KIND, client_id: 'infra', client_name: 'Magic Engine 后台', what: '社媒 Reel 回看这周没拿到客户名单，所有客户都没回看过，不要当成没问题。', how: '这条不用你动手，是我们这边的欠账。', href: 'https://app.inngest.com' })
  }
  const seen = new Set<string>()
  for (const summary of rows) {
    for (const c of Array.isArray(summary.clients) ? summary.clients : []) {
      const id = isRecord(c) && typeof c.client_id === 'string' ? c.client_id : null
      if (id === null || seen.has(id)) continue
      seen.add(id)
      const item = buildReadbackItem(c, nameOf)
      if (item) items.push(item)
    }
  }
}
