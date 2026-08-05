/**
 * 写好了、但没人看过的博客草稿。
 *
 * 🔴 2026-08-05 实测：`blog_posts` 里躺着 3 篇 `status='draft'`，最老的写于
 *    07-31（周更 cron 自动产出的），**没有任何人看过**，而最后一篇真正上线的
 *    文章停在 2026-06-19 —— 47 天前。
 *
 *    原因是今日待办里那条博客待办只捞 `status='pr_open'`，且要求 `pr_url`
 *    非空（`manual-items.ts` 的 `blog_pr_open`）。而 `draft → pr_open` 这一步
 *    需要有人手动调 `/api/clients/[id]/cms/publish-blog`，没有任何自动化在调它。
 *    于是机器一直在写，写完就沉进库里。
 *
 *    这正是「管道不许断头」那条铁律的反面：不是发现死在日志里，
 *    是**产物死在数据库里**。
 *
 * 还有一层更硬的现实：**大部分客户根本没有能发布的通道**。实测 `cms_connections`
 * 只有 CTS 的 github 是 connected，oztop 的 wordpress 是 error，另外两个客户
 * 一条连接都没有。所以「去点发布」对他们根本不成立 —— 那种情况下必须说的是
 * 「这篇没地方发，得先把网站接通」，而不是让人白跑一趟。
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface BlogDraftRow {
  client_id: string
  title: string | null
  topic: string | null
  created_at: string
}

export interface CmsConnectionRow {
  client_id: string
  provider: string
  status: string
}

export interface DraftTodo {
  client_id: string
  /** 说人话的一句：写好了、多久没人看、能不能发 */
  what: string
  how: string
  href: string
}

/** 客户有没有一条真的能用的发布通道。error / 未连接都算没有。 */
export function hasWorkingChannel(
  clientId: string,
  connections: readonly CmsConnectionRow[],
): boolean {
  return connections.some((c) => c.client_id === clientId && c.status === 'connected')
}

function daysBetween(fromIso: string, now: Date): number {
  const ms = now.getTime() - new Date(fromIso).getTime()
  return Math.max(0, Math.floor(ms / 86_400_000))
}

/**
 * 把草稿变成待办。一个客户一条 —— 三篇草稿刷三条是噪音，
 * 而「误报成常态告警就废了」。
 */
export function buildDraftTodos(
  drafts: readonly BlogDraftRow[],
  connections: readonly CmsConnectionRow[],
  now: Date,
): DraftTodo[] {
  const byClient = new Map<string, BlogDraftRow[]>()
  for (const d of drafts) {
    const list = byClient.get(d.client_id) ?? []
    list.push(d)
    byClient.set(d.client_id, list)
  }

  const out: DraftTodo[] = []
  for (const [clientId, list] of byClient) {
    const sorted = [...list].sort((a, b) => a.created_at.localeCompare(b.created_at))
    const oldest = sorted[0]
    const age = daysBetween(oldest.created_at, now)
    const n = list.length
    const titles = sorted
      .map((d) => `《${d.title ?? d.topic ?? '未命名'}》`)
      .slice(0, 3)
      .join('、')

    const ageText = age >= 1 ? `，最早的一篇已经躺了 ${age} 天没人看` : '（刚写好）'
    const connected = hasWorkingChannel(clientId, connections)

    out.push({
      client_id: clientId,
      what: connected
        ? `有 ${n} 篇写好的文章还没人看过${ageText}：${titles}`
        : `有 ${n} 篇写好的文章没地方发${ageText}：${titles} —— 这个客户的网站发布通道是断的，文章写再多也上不了线`,
      how: connected
        ? '打开看一眼，觉得可以就点发布 —— 系统会提交到客户网站等最后确认'
        : '先去客户设置里把网站发布通道接通（现在是未连接或连接报错），接通后这几篇才发得出去',
      href: connected
        ? `/dashboard/clients/${clientId}/blog`
        : `/dashboard/clients/${clientId}/settings`,
    })
  }

  return out
}

/** 读取当前所有待看草稿 + 各客户的发布通道状态。 */
export async function fetchBlogDraftTodos(
  supabase: SupabaseClient,
  clientIds: readonly string[],
  now: Date,
): Promise<DraftTodo[]> {
  if (clientIds.length === 0) return []

  const [draftsRes, connRes] = await Promise.all([
    supabase
      .from('blog_posts')
      .select('client_id, title, topic, created_at')
      .eq('status', 'draft')
      .in('client_id', clientIds as string[]),
    supabase
      .from('cms_connections')
      .select('client_id, provider, status')
      .in('client_id', clientIds as string[]),
  ])

  // 查不出来就别报 —— 「没有草稿」和「没查到」是两件事，
  // 后者伪装成前者正是今天修了一整天的那个病。
  if (draftsRes.error) {
    console.warn('[blog-drafts] 草稿查询失败，本轮不下发:', draftsRes.error.message)
    return []
  }
  if (connRes.error) {
    console.warn('[blog-drafts] 发布通道查询失败，本轮不下发:', connRes.error.message)
    return []
  }

  return buildDraftTodos(
    (draftsRes.data ?? []) as BlogDraftRow[],
    (connRes.data ?? []) as CmsConnectionRow[],
    now,
  )
}
