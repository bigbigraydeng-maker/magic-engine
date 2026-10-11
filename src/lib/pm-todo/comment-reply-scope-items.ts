/**
 * 评论自动回复回不出去 → 下发给人。
 *
 * 🔴 2026-10-07 实测：拿第一个受影响客户存着的主页令牌向 Meta 查权限，权限清单里
 *    **没有 `pages_manage_engagement`（管理和回复评论）**。评论 cron 读得到评论，
 *    但往帖子下面写回复一律被 Meta 拒绝。权限只有人能补（要拿管理员账号重新授权），
 *    所以必须下发。
 *
 *    判据是 `platform_oauth_connections` 里存着的 scopes —— 那是连接时 Meta 真正
 *    授予的权限清单，是地面真相。引擎对任何「回复返回空」都写同一句失败原因
 *    （限流、评论被删……），所以那句话**不作为判据**。
 *
 * 只报「授权里缺 pages_manage_engagement」这一类：限流、网络抖动那类机器会自己重试，
 * 下发等于制造噪音。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { APP_BASE } from './binding-request-items'

/** 只看最近这些天的失败 —— 更早的要么已经修好，要么早该有人管了。 */
const WINDOW_DAYS = 14

/** 一次最多读这么多失败行，够覆盖一个窗口里的失败量。 */
const ROW_LIMIT = 1000

/** Meta 说缺的那项权限。 */
const PERMISSION = 'pages_manage_engagement'

/** 只声明这条读得到的字段：这是**已经落库的旧数据**，当外部输入处理。 */
export interface CommentConfigRow {
  client_id: string
  fb_page_id: string | null
}

export interface MetaConnectionRow {
  client_id: string
  account_id: string
  status: string | null
  scopes: string[] | null
}

export interface FailedReplyRow {
  client_id: string
  needs_human: boolean | null
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
  '点链接（会跳到 Facebook 授权页，要先登录 ME 后台）→ ' +
  '用能管理这个主页的账号登录 → ' +
  '在同意页里保持所有权限都勾着，尤其是「管理和回复评论」' +
  '（已有的其它权限也不要取消，取消任何一项会让线索同步等功能降级）→ ' +
  '完成后会跳回设置页，这条待办会在下一次今日待办刷新时自己消失' +
  '（它看的是授权里有没有这项权限，不用等新评论）。' +
  '如果同意页里根本没有「管理和回复评论」这一项，说明 Meta 应用还没拿到这项权限，' +
  '别反复重试，把这条转给开发处理。'

function connectHref(clientId: string): string {
  return `${APP_BASE}/api/auth/facebook/connect?client_id=${encodeURIComponent(clientId)}&rerequest=1`
}

function samePage(a: string | null, b: string | null): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  return a.trim() === b.trim()
}

/**
 * 配置 + 授权 + 失败行 → 每个客户最多一条待办。
 *
 * 判据：该客户的主页授权里没有 `pages_manage_engagement`。找不到对应授权就跳过
 * （说不清，不猜）。
 */
export function buildCommentReplyScopeTodos(
  configs: readonly CommentConfigRow[],
  connections: readonly MetaConnectionRow[],
  failed: readonly FailedReplyRow[],
): CommentReplyScopeTodo[] {
  const failedByClient = new Map<string, FailedReplyRow[]>()
  for (const f of failed) {
    if (!f || typeof f.client_id !== 'string') continue
    const list = failedByClient.get(f.client_id)
    if (list) list.push(f)
    else failedByClient.set(f.client_id, [f])
  }

  const seen = new Set<string>()
  const todos: CommentReplyScopeTodo[] = []

  for (const c of configs) {
    if (!c || typeof c.client_id !== 'string') continue
    if (typeof c.fb_page_id !== 'string' || c.fb_page_id.trim() === '') continue
    if (seen.has(c.client_id)) continue

    const conn = connections.find(
      (m) => m && m.client_id === c.client_id && samePage(m.account_id, c.fb_page_id),
    )
    if (!conn) continue
    if (!Array.isArray(conn.scopes)) continue
    if (conn.scopes.includes(PERMISSION)) continue

    seen.add(c.client_id)

    const rows = failedByClient.get(c.client_id) ?? []
    const n = rows.length
    const h = rows.filter((r) => r.needs_human === true).length
    const humanText = h > 0 ? `（其中 ${h} 条是需要人看的提问或投诉）` : ''

    const what =
      n > 0
        ? `评论自动回复已开启，但最近 ${WINDOW_DAYS} 天里客人在这个客户 Facebook 主页帖子下的留言，` +
          `自动回复失败了 ${n} 条${humanText}。` +
          `原因：我们存着的授权里没有「管理和回复评论」这项权限（${PERMISSION}），` +
          `所以系统读得到评论、但回不了。`
        : `评论自动回复已开启，但我们存着的授权里没有「管理和回复评论」这项权限（${PERMISSION}）：` +
          `之后客人在帖子下的留言，系统读得到、但回不了。`

    todos.push({
      kind: 'comment_reply_scope_missing',
      client_id: c.client_id,
      what,
      how: HOW,
      href: connectHref(c.client_id),
    })
  }

  todos.sort((a, b) => (a.client_id < b.client_id ? -1 : a.client_id > b.client_id ? 1 : 0))
  return todos
}

export async function fetchCommentReplyScopeTodos(
  supabase: SupabaseClient,
  now: Date,
): Promise<CommentReplyScopeTodo[]> {
  const { data: configData, error: configError } = await supabase
    .from('social_comment_config')
    .select('client_id, fb_page_id')
    .eq('enabled', true)

  if (configError || !configData || configData.length === 0) return []
  const configs = configData as CommentConfigRow[]
  const clientIds = configs.map((c) => c.client_id)

  const { data: connData, error: connError } = await supabase
    .from('platform_oauth_connections')
    .select('client_id, account_id, status, scopes')
    .eq('provider', 'meta')
    .in('client_id', clientIds)

  if (connError) return []
  const connections = (connData ?? []) as MetaConnectionRow[]

  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString()
  const { data: failedData, error: failedError } = await supabase
    .from('social_comment_engagements')
    .select('client_id, needs_human')
    .eq('reply_status', 'failed')
    .gte('created_at', since)
    .limit(ROW_LIMIT)

  const failed = failedError ? [] : ((failedData ?? []) as FailedReplyRow[])

  return buildCommentReplyScopeTodos(configs, connections, failed)
}
