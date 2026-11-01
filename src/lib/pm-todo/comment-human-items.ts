/**
 * 「主页评论要人回」→ 今日待办（只读分流，不改自动回复）。
 *
 * 读 `social_comment_engagements` 里 `needs_human = true` 且还没人处理的行，
 * 用 `routeComment` 筛出 `route = human` 的，按客户汇总成一条待办。
 * 待办文字不含评论原文和留言人全名（会被截图转发）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase-paginate'
import type { ManualItem } from './manual-items'
import type { ClientRow } from './client-roster'
import { APP_BASE } from './binding-request-items'
import { routeComment, type CommentIntent } from '@/lib/social/comment-routing'

export const WINDOW_DAYS = 14

export type CommentHumanTodoKind = 'comment_needs_human_reply' | 'comment_human_check_failed'

export interface CommentEngagementRow {
  client_id: string
  category: string | null
  comment_text: string | null
  author_name: string | null
  reviewed_by: string | null
  created_at: string
}

const INTENT_LABEL: Record<CommentIntent, string> = {
  price: '问价',
  complaint: '投诉',
  refund: '退款',
  booking_change: '改单/改期',
  unknown: '待你判断',
  greeting: '问候',
  faq_itinerary: '问行程',
  faq_visa: '问签证',
  faq_signup: '问怎么订',
}

function auditHref(clientId: string): string {
  return `${APP_BASE}/dashboard/clients/${encodeURIComponent(clientId)}/settings?tab=content`
}

function containsAuthorName(text: string, authorName: string | null): boolean {
  if (!authorName || authorName.trim().length < 2) return false
  return text.includes(authorName.trim())
}

function containsCommentSnippet(text: string, commentText: string | null): boolean {
  if (!commentText) return false
  const snippet = commentText.trim().slice(0, 24)
  if (snippet.length < 8) return false
  return text.includes(snippet)
}

function summarizeIntents(counts: Partial<Record<CommentIntent, number>>): string {
  const parts: string[] = []
  const order: CommentIntent[] = [
    'price',
    'complaint',
    'refund',
    'booking_change',
    'unknown',
  ]
  for (const key of order) {
    const n = counts[key]
    if (n && n > 0) parts.push(`${n} 条${INTENT_LABEL[key]}`)
  }
  return parts.join('、')
}

const HOW_BASE =
  '点链接打开客户设置 →「内容」页签 → 滚到「最近自动回复（审计）」→ 找「需要人看」且还没记处理人的行 → ' +
  '在 Facebook 上公开回复（或按审计页说明处理）。'

const HOW_PRICE =
  '问价类：公开评论里不要报具体价格，引导客人发私信；系统若已自动私信过，公开回一句「已私信你」即可。'

/** 纯函数： engagement 行 → 每个客户最多一条待办。 */
export function buildCommentHumanTodos(
  rows: readonly CommentEngagementRow[],
  activeClientIds: ReadonlySet<string>,
): ManualItem[] {
  const byClient = new Map<string, { total: number; intents: Partial<Record<CommentIntent, number>> }>()

  for (const row of rows) {
    if (!row || typeof row.client_id !== 'string') continue
    if (!activeClientIds.has(row.client_id)) continue
    if (row.reviewed_by !== null && row.reviewed_by !== undefined && String(row.reviewed_by).trim() !== '') {
      continue
    }
    const routing = routeComment({ category: row.category, comment_text: row.comment_text })
    if (routing.route !== 'human') continue

    const cur = byClient.get(row.client_id) ?? { total: 0, intents: {} }
    cur.total += 1
    cur.intents[routing.intent] = (cur.intents[routing.intent] ?? 0) + 1
    byClient.set(row.client_id, cur)
  }

  const items: ManualItem[] = []
  for (const [clientId, agg] of Array.from(byClient.entries())) {
    const breakdown = summarizeIntents(agg.intents)
    const hasPrice = (agg.intents.price ?? 0) > 0
    const what =
      `最近 ${WINDOW_DAYS} 天里，这个客户 Facebook 主页有 ${agg.total} 条评论要人回` +
      (breakdown ? `（${breakdown}）` : '') +
      ' —— 客人会觉得没人理，问价/投诉还可能升级。'
    const how = hasPrice ? `${HOW_BASE}${HOW_PRICE}` : HOW_BASE

    items.push({
      kind: 'comment_needs_human_reply',
      client_id: clientId,
      client_name: '',
      what,
      how,
      href: auditHref(clientId),
    })
  }

  items.sort((a, b) => (a.client_id < b.client_id ? -1 : a.client_id > b.client_id ? 1 : 0))
  return items
}

export function assertCommentHumanTodoSafe(item: ManualItem, rowsForClient: CommentEngagementRow[]): void {
  if (containsAuthorName(item.what, rowsForClient[0]?.author_name ?? null)) {
    throw new Error('what must not contain commenter name')
  }
  if (containsAuthorName(item.how, rowsForClient[0]?.author_name ?? null)) {
    throw new Error('how must not contain commenter name')
  }
  for (const row of rowsForClient) {
    if (containsCommentSnippet(item.what, row.comment_text)) {
      throw new Error('what must not contain comment text')
    }
    if (containsCommentSnippet(item.how, row.comment_text)) {
      throw new Error('how must not contain comment text')
    }
  }
}

export async function pushCommentHumanItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  clients: Map<string, ClientRow>,
  now: Date,
): Promise<void> {
  const activeIds = new Set(clients.keys())
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString()

  let rows: CommentEngagementRow[]
  try {
    rows = await fetchAll<CommentEngagementRow>((from, to) =>
      supabase
        .from('social_comment_engagements')
        .select('client_id, category, comment_text, author_name, reviewed_by, created_at')
        .eq('needs_human', true)
        .is('reviewed_by', null)
        .gte('created_at', since)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    )
  } catch {
    items.push({
      kind: 'comment_human_check_failed',
      client_id: '',
      client_name: '',
      what:
        '主页评论「要人回」清单今天读不出来 —— 读失败不等于没有待处理的评论，别当成「今天没事」。',
      how: '这条不用你动手 —— 回我一句「修一下评论待办读取」我去查数据库权限或查询。',
      href: '',
    })
    return
  }

  const built = buildCommentHumanTodos(rows, activeIds)
  for (const item of built) {
    item.client_name = clients.get(item.client_id)?.name ?? '未知客户'
    const clientRows = rows.filter((r) => r.client_id === item.client_id)
    assertCommentHumanTodoSafe(item, clientRows)
    items.push(item)
  }
}
