/**
 * 评论自动回复回不出去 → 下发给人。
 *
 * 🔴 2026-10-07 实测（拿 CTS 存着的主页令牌向 Meta 查权限）：评论 cron 读得到评论、
 *    也生成了回复，但令牌的权限清单里**没有 `pages_manage_engagement`（管理和回复评论）**，
 *    往帖子下面写回复一律被 Meta 拒绝。于是客人在帖子下面提的问题，
 *    系统看得见、却一条都回不了，而那一轮 cron 照样记成 `ok: true`。
 *    注意：引擎对任何「回复返回空」都写同一句失败原因（含限流），所以下面的文案
 *    说「多半」；确凿的判据是令牌权限清单，不是这句话。
 *
 *    这正是「发现死在日志里」：唯一的痕迹是 `social_comment_engagements` 里一行
 *    `reply_status='failed'`，没有任何人会去翻。权限只有人能补（要拿管理员账号
 *    点授权），所以必须下发。
 *
 * 判据取自 cron 自己写进 `social_comment_engagements` 的那几行（跟
 * `comment-scope-items.ts` 读运行记录同一个套路）：说的话跟机器真做的事永远一致，
 * 也不用再查一遍 Meta。
 *
 * 只报「缺 pages_manage_engagement」这一类 —— 限流、网络抖动那类机器会自己重试，
 * 下发等于制造噪音。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { APP_BASE } from './binding-request-items'

/** 只看最近这些天的失败 —— 更早的要么已经修好，要么早该有人管了。 */
const WINDOW_DAYS = 14

/** 一次最多读这么多行，够覆盖一个窗口里的失败量。 */
const ROW_LIMIT = 1000

/** Meta 说缺的那项权限，出现在 error_message 里就是这一类。 */
const PERMISSION = 'pages_manage_engagement'

/** 回复成功的两种状态：写进帖子下面的回复，和私信发出去的回复。 */
const SUCCESS_STATUSES = new Set(['replied', 'dm_sent'])

/** FacebookPagePanel 只挂在客户页的设置抽屉「platform」页签里，/settings 路由里没有它。 */
function panelHref(clientId: string): string {
  return `${APP_BASE}/dashboard/clients/${encodeURIComponent(clientId)}?settings=platform`
}

/** 只声明这条读得到的字段：这是**已经落库的旧数据**，当外部输入处理。 */
export interface EngagementRow {
  client_id: string
  reply_status: string
  needs_human: boolean | null
  error_message: string | null
  created_at: string
}

export type CommentReplyScopeTodoKind = 'comment_reply_scope_missing'

export interface CommentReplyScopeTodo {
  kind: CommentReplyScopeTodoKind
  client_id: string
  what: string
  how: string
  href: string
}

const HOW =
  '打开链接（这个客户的设置抽屉）→ 在「Facebook 主页」卡片里点「连接 Meta」→ ' +
  '用能管理这个主页的账号登录，在 Facebook 的同意页面里把「管理和回复评论」那一项勾上' +
  '（别点「重新核实」，那个按钮不会补这项权限）→ ' +
  '授权完成后不用管，下一次评论自动回复成功后这条待办会自己消失。'

/**
 * 一个客户的一批回复记录 → 最多一条待办。
 *
 * 只看「最后一次成功之后」的失败：成功过说明权限当时是够的，之后又失败多半是
 * 令牌被换掉了；而成功之前的失败，已经被那次成功证明修好了，不该再摆出来。
 */
export function buildCommentReplyScopeTodos(rows: readonly EngagementRow[]): CommentReplyScopeTodo[] {
  const byClient = new Map<string, EngagementRow[]>()
  for (const r of rows) {
    if (!r || typeof r.client_id !== 'string' || typeof r.reply_status !== 'string') continue
    if (typeof r.created_at !== 'string') continue
    const list = byClient.get(r.client_id)
    if (list) list.push(r)
    else byClient.set(r.client_id, [r])
  }

  const todos: CommentReplyScopeTodo[] = []
  for (const [clientId, list] of byClient) {
    let lastSuccess: string | null = null
    for (const r of list) {
      if (!SUCCESS_STATUSES.has(r.reply_status)) continue
      if (lastSuccess === null || r.created_at > lastSuccess) lastSuccess = r.created_at
    }

    const failed = list.filter(
      (r) =>
        r.reply_status === 'failed' &&
        typeof r.error_message === 'string' &&
        r.error_message.includes(PERMISSION) &&
        (lastSuccess === null || r.created_at > lastSuccess),
    )
    if (failed.length === 0) continue

    const n = failed.length
    const h = failed.filter((r) => r.needs_human === true).length
    const humanText = h > 0 ? `（其中 ${h} 条是需要人看的提问或投诉）` : ''

    todos.push({
      kind: 'comment_reply_scope_missing',
      client_id: clientId,
      what:
        `最近 ${WINDOW_DAYS} 天里，客人在这个客户 Facebook 主页帖子下的留言，` +
        `自动回复失败了 ${n} 条${humanText}。` +
        `多半是我们存着的授权缺「管理和回复评论」这项权限（${PERMISSION}），` +
        `所以系统读得到评论、但回不了。`,
      how: HOW,
      href: panelHref(clientId),
    })
  }

  todos.sort((a, b) => (a.client_id < b.client_id ? -1 : a.client_id > b.client_id ? 1 : 0))
  return todos
}

export async function fetchCommentReplyScopeTodos(
  supabase: SupabaseClient,
  now: Date,
): Promise<CommentReplyScopeTodo[]> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from('social_comment_engagements')
    .select('client_id, reply_status, needs_human, error_message, created_at')
    .gte('created_at', since)
    .in('reply_status', ['failed', 'replied', 'dm_sent'])
    .order('created_at', { ascending: false })
    .limit(ROW_LIMIT)

  if (error || !data) return []
  return buildCommentReplyScopeTodos(data as EngagementRow[])
}
