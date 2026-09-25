/**
 * 司马迁 · 口碑周巡的待办出口。
 *
 * 拉模式读 `cron_run_logs` 里 `simaqian-reputation-weekly` 最近一次回执
 * （≤ SIMAQIAN_RECEIPT_FRESH_DAYS 天），每个客户最多一条：
 * 有新评价 → 回复草稿三件套（署名「司马迁」，一律没发）；
 * 巡不成 → 「司马迁没巡成」进系统欠账栏。
 *
 * 「该跑没跑」由 pushCronHealthItems 管，这里不重复报。
 *
 * 判据取自 cron 自己写进运行记录的那份回执（跟 `comment-scope-items.ts` 同一个
 * 套路）：说的话跟机器真做的事永远一致，也不用再查一遍 Google。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ClientPatrolReceipt, ReviewReplyDraft } from '@/lib/reputation/simaqian-drafts'
import { SIMAQIAN_JOB, SIMAQIAN_RECEIPT_FRESH_DAYS } from '@/lib/inngest/functions/simaqian-reputation-weekly'
import type { ManualItem } from './manual-item-types'

export type SimaqianItemKind = 'simaqian_review_drafts' | 'simaqian_patrol_failed'

export interface SimaqianTodo {
  kind: SimaqianItemKind
  client_id: string
  what: string
  how: string
  href: string
}

/** Google 商家后台的评价页——登录类站点，稳定入口不是深链（action-link.ts 的 LOGIN_REQUIRED_HOSTS 里有它） */
export const GBP_REVIEWS_URL = 'https://business.google.com/reviews'

/** how 里最多列几条回复草稿，多了就让人去看回执。 */
export const MAX_REPLIES_IN_HOW = 5

/** 差评门槛，跟 simaqian-drafts.ts 的 NEGATIVE_RATING_CEILING 一致。 */
const NEGATIVE_RATING_CEILING = 2

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨']

/** 一条回复草稿 → 一行给人看的文字。 */
export function formatReplyLine(r: ReviewReplyDraft, index: number): string {
  const marker = CIRCLED[index] ?? `${index + 1}.`
  const head = `${marker}${r.author ?? '匿名'} ★${r.rating ?? '?'}「${r.text_excerpt}」`
  if (r.reply_draft === null) {
    return `${head}→ 没起草（${r.reason ?? '原因未知'}）`
  }
  return `${head}→ 建议回复：${r.reply_draft}`
}

/** 差评排前面（稳定排序），其余保持原顺序。 */
function negativesFirst(replies: readonly ReviewReplyDraft[]): ReviewReplyDraft[] {
  const negative = replies.filter(r => r.rating !== null && r.rating <= NEGATIVE_RATING_CEILING)
  const rest = replies.filter(r => !(r.rating !== null && r.rating <= NEGATIVE_RATING_CEILING))
  return [...negative, ...rest]
}

/** 一个客户的回执 → 最多一条待办。 */
export function buildSimaqianTodo(r: ClientPatrolReceipt): SimaqianTodo | null {
  if (r.status === 'no_new_reviews') return null

  if (r.status === 'read_failed' || r.status === 'draft_failed') {
    return {
      kind: 'simaqian_patrol_failed',
      client_id: r.client_id,
      what:
        `司马迁本周没巡成 ${r.client_name} 的 Google 评价（${r.error ?? '原因未知'}）` +
        '—— 没报 ≠ 没有新评价',
      how: '这条不用你动手 —— 是我们这边读评价或起草失败了。回我一句「查一下司马迁」我去看',
      href: '',
    }
  }

  const ordered = negativesFirst(r.replies)
  const shown = ordered.slice(0, MAX_REPLIES_IN_HOW)
  const lines = shown.map((reply, i) => formatReplyLine(reply, i)).join('；')
  const extra = ordered.length > MAX_REPLIES_IN_HOW ? `；另有 ${ordered.length - MAX_REPLIES_IN_HOW} 条见回执` : ''
  const post = r.post_draft ? `。好评帖子草稿（发不发你定）：「${r.post_draft}」` : ''

  return {
    kind: 'simaqian_review_drafts',
    client_id: r.client_id,
    what:
      `司马迁：${r.client_name} 本周有 ${r.new_reviews} 条新 Google 评价` +
      `（${r.negative_reviews} 条差评），回复草稿已写好，一条都还没发`,
    how: `${lines}${extra}${post}。打开链接（Google 商家后台 → 评价）逐条粘贴，差评先回。`,
    href: GBP_REVIEWS_URL,
  }
}

/** 上一轮跑完多久了。跑到一半没写完 finished_at 的当作太旧，不用。 */
function daysSince(iso: string | null, now: Date): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return (now.getTime() - t) / 86_400_000
}

interface SimaqianRunSummary {
  clients?: ClientPatrolReceipt[]
}

/** 回执里形状不对的行跳过，其余照常。 */
function isClientReceipt(v: unknown): v is ClientPatrolReceipt {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return typeof o.client_id === 'string' && typeof o.status === 'string'
}

export async function fetchSimaqianTodos(
  supabase: SupabaseClient,
  now: Date,
): Promise<SimaqianTodo[]> {
  const { data } = await supabase
    .from('cron_run_logs')
    .select('finished_at, summary, status')
    .eq('job_name', SIMAQIAN_JOB)
    .order('started_at', { ascending: false })
    .limit(1)

  const run = (data ?? [])[0] as
    | { finished_at: string | null; summary: SimaqianRunSummary | null; status: string | null }
    | undefined
  if (!run?.summary) return []
  if (run.status !== 'completed') return []

  // 「该跑没跑」有 pushCronHealthItems 在管，这里不重复报，只在回执够新时说话
  const age = daysSince(run.finished_at, now)
  if (age === null || age > SIMAQIAN_RECEIPT_FRESH_DAYS) return []

  const clients = run.summary.clients
  if (!Array.isArray(clients)) return []

  const todos: SimaqianTodo[] = []
  for (const c of clients) {
    if (!isClientReceipt(c)) continue
    const todo = buildSimaqianTodo(c)
    if (todo) todos.push(todo)
  }
  return todos
}

/** 把待办推进今日待办三件套。 */
export async function pushSimaqianReviewItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  nameOf: (id: string) => string,
): Promise<void> {
  const todos = await fetchSimaqianTodos(supabase, now)
  for (const todo of todos) {
    items.push({
      kind: todo.kind,
      client_id: todo.client_id,
      client_name: nameOf(todo.client_id),
      what: todo.what,
      how: todo.how,
      href: todo.href,
    })
  }
}
