/**
 * Manual handoff lane (PM 拍板 2026-08-01).
 *
 * "自动化无法完成的，可以交给人工用最简单的方法完成。任务下发都要保持管道
 *  畅通" — this is the second half of the 遇卡点必自动化 rule, not a retreat
 * from it: the system still automates everything it can, but whatever it
 * CANNOT finish must never dead-end in a log line only a developer reads.
 *
 * Every item here answers three questions for the FDE/PM in one glance:
 *   what  — 一句话说清问题（含影响）
 *   how   — 最简单的人工做法（具体到点哪里）
 *   href  — 直达链接，不用自己找入口
 *
 * Sources are deliberately the states that were INVISIBLE before:
 *   · blog PRs waiting on a human merge (post sat in pr_open unnoticed)
 *   · pages Google won't index (detected, but no auto-resubmit path)
 *   · meta changes queued but never applied (WP plugin stalled)
 *   · site page data gone stale (Oztop's host blocks our crawler → 65 days old)
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isHtmlPageUrl } from '@/lib/seo/url-kind'

/** Meta queued this long without being applied = the applier is stuck. */
const META_PENDING_STALE_DAYS = 3
/** Crawl data older than this = the weekly recrawl isn't landing. */
const CRAWL_STALE_DAYS = 14

export type ManualItemKind =
  | 'blog_pr_open'
  | 'not_indexed'
  | 'meta_stuck'
  | 'crawl_stale'
  | 'cron_never_ran'

/**
 * 新建的 cron 在 Render 上必须**手动**关联 me-shared-cron-secret 环境变量组。
 * `sync: false` 不会自动填值 —— 于是 `$CRON_SECRET` 展开成空串、每次 401、
 * curl 直接退出，应用侧连一行 `cron_run_logs` 都不会有。
 *
 * 这就是为什么它必须出现在这里：daily-cron-digest 只报「跑了但失败」，
 * 「压根没跑」它看不见。daily-cron-digest 自己就是这么哑了 51 天没人发现的。
 *
 * 新增 cron 时往这个数组里加一行；它在 cron_run_logs 里出现第一条记录后自动消失。
 */
const CRONS_NEEDING_MANUAL_LINK: Array<{ job: string; label: string }> = [
  { job: 'team-memory-sweeper', label: '团队工作记忆兜底清扫' },
]

/** Render 蓝图页 —— 从这儿进去挑服务、关联环境变量组 */
const RENDER_BLUEPRINT_URL =
  'https://dashboard.render.com/blueprint/exs-d8ejt0og4nts73a1ce50'

export interface ManualItem {
  kind: ManualItemKind
  client_name: string
  client_id: string
  /** One sentence: what is wrong and why it costs something. */
  what: string
  /** The simplest human action, concrete enough to do without asking. */
  how: string
  /** Direct link to the place the action happens. */
  href: string
}

interface ClientRow {
  id: string
  name: string
  domain: string | null
}

/** GSC URL-inspection deep link — the exact screen with the resubmit button. */
export function gscInspectUrl(siteUrl: string, pageUrl: string): string {
  return (
    'https://search.google.com/search-console/inspect' +
    `?resource_id=${encodeURIComponent(siteUrl)}&id=${encodeURIComponent(pageUrl)}`
  )
}

export function daysAgo(iso: string | null, now: Date): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return Math.floor((now.getTime() - t) / 86_400_000)
}

export async function loadManualItems(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<ManualItem[]> {
  const items: ManualItem[] = []

  const { data: clientRows } = await supabase
    .from('clients')
    .select('id, name, domain')
    .eq('client_status', 'active')
  const clients = new Map(
    ((clientRows ?? []) as ClientRow[]).map((c) => [c.id, c]),
  )
  // 基础设施类检查要放在这条提前返回**之前**：新建的 cron 有没有接上密钥，
  // 跟系统里有几个客户毫无关系。放在后面的话，客户表一空它就被跳过了。
  await appendNeverRanCrons(supabase, items)

  if (clients.size === 0) return items

  const ids = Array.from(clients.keys())
  const nameOf = (id: string) => clients.get(id)?.name ?? '未知客户'

  // GSC property identifiers (needed for the inspect deep link).
  const { data: connectors } = await supabase
    .from('client_connectors')
    .select('client_id, config')
    .eq('anchor', 'gsc')
    .eq('status', 'connected')
    .in('client_id', ids)
  const siteUrlOf = new Map(
    ((connectors ?? []) as Array<{ client_id: string; config: { site_url?: string } | null }>)
      .filter((c) => c.config?.site_url)
      .map((c) => [c.client_id, c.config!.site_url!]),
  )

  const [prOpen, notIndexed, metaPending, crawlRows] = await Promise.all([
    supabase
      .from('blog_posts')
      .select('client_id, title, topic, pr_url, pr_number')
      .eq('status', 'pr_open')
      .in('client_id', ids),
    supabase
      .from('client_site_pages')
      .select('client_id, url, index_verdict, first_not_indexed_at, word_count')
      .not('first_not_indexed_at', 'is', null)
      .in('client_id', ids),
    supabase
      .from('seo_meta_log')
      .select('client_id, page_slug, created_at')
      .eq('wp_updated', false)
      .in('client_id', ids),
    supabase
      .from('client_site_pages')
      .select('client_id, crawled_at')
      .not('crawled_at', 'is', null)
      .in('client_id', ids)
      .order('crawled_at', { ascending: false })
      .limit(500),
  ])

  // 1. Blog PRs waiting on a human merge — the article is written and tested,
  //    it just needs someone to press the button.
  for (const row of (prOpen.data ?? []) as Array<{
    client_id: string
    title: string | null
    topic: string | null
    pr_url: string | null
  }>) {
    if (!row.pr_url) continue
    items.push({
      kind: 'blog_pr_open',
      client_id: row.client_id,
      client_name: nameOf(row.client_id),
      what: `文章《${row.title ?? row.topic ?? '未命名'}》已写好并提交到网站，还没上线`,
      how: '打开这个链接，检查通过后点 Merge —— 合并后系统会自动催谷歌收录',
      href: row.pr_url,
    })
  }

  // 2. Pages Google won't index. Detection is automatic; the resubmit button
  //    lives in Google's own console, so this one is genuinely manual.
  for (const row of (notIndexed.data ?? []) as Array<{
    client_id: string
    url: string
    index_verdict: string | null
    first_not_indexed_at: string | null
    word_count: number | null
  }>) {
    // Assets (images/PDFs) are not pages — "not indexed as a page" is normal
    // for them and flagging it burns the whole list's credibility.
    if (!isHtmlPageUrl(row.url)) continue

    const days = daysAgo(row.first_not_indexed_at, now)
    const siteUrl = siteUrlOf.get(row.client_id)
    if (!siteUrl) continue

    // The advice MUST match the verdict. "Crawled - currently not indexed"
    // means Google already looked and declined — sending someone to press
    // 「请求编入索引」 there is busywork that changes nothing. Thin content is
    // the usual cause, so say that instead.
    const unknown = row.index_verdict === 'URL is unknown to Google'
    const thin = (row.word_count ?? 0) < 300
    const age = days !== null ? `（已 ${days} 天）` : ''

    const what = unknown
      ? `${row.url} 谷歌根本不知道这个网址${age}，它拿不到任何谷歌流量`
      : `${row.url} 谷歌爬过但决定不收录${age}${thin ? `，正文只有 ${row.word_count ?? 0} 词` : ''}，它拿不到任何谷歌流量`

    const how = unknown
      ? '打开链接（已定位到这个网址），点「请求编入索引」；如果它本来就不该被搜到，回我一句，我把它从检查名单去掉'
      : thin
        ? '这条别点「请求编入索引」——谷歌已经看过并拒绝了。真问题是内容太薄：要么把它补厚（300 词以上、配图、加内链），要么合并进相关页面并做跳转。拿不准回我一句'
        : '先点一次「请求编入索引」；如果一周后还是不收录，说明谷歌认为内容价值不够，需要补内链和内容'

    items.push({
      kind: 'not_indexed',
      client_id: row.client_id,
      client_name: nameOf(row.client_id),
      what,
      how,
      href: gscInspectUrl(siteUrl, row.url),
    })
  }

  // 3. Meta changes queued but not applied — the Oztop WP plugin polls this
  //    queue; a long backlog means the plugin stopped.
  const metaByClient = new Map<string, { count: number; oldest: string }>()
  for (const row of (metaPending.data ?? []) as Array<{ client_id: string; created_at: string }>) {
    const cur = metaByClient.get(row.client_id)
    if (!cur || row.created_at < cur.oldest) {
      metaByClient.set(row.client_id, { count: (cur?.count ?? 0) + 1, oldest: row.created_at })
    } else {
      cur.count += 1
    }
  }
  for (const [clientId, agg] of Array.from(metaByClient.entries())) {
    const days = daysAgo(agg.oldest, now)
    if (days === null || days < META_PENDING_STALE_DAYS) continue
    items.push({
      kind: 'meta_stuck',
      client_id: clientId,
      client_name: nameOf(clientId),
      what: `${agg.count} 条标题/描述改动排了 ${days} 天还没上到网站，说明网站那边的自动应用停了`,
      how: '登录客户网站后台看看 Magic Engine 插件是不是被停用了，启用它就会自动补上',
      href: `https://app.magicengine.com.au/dashboard/clients/${clientId}/settings`,
    })
  }

  // 4. Site page data gone stale — the weekly recrawl isn't landing (Oztop's
  //    host blocks our server IP). Without fresh pages, the orphan-page and
  //    internal-link checks quietly run on months-old data.
  const newestCrawl = new Map<string, string>()
  for (const row of (crawlRows.data ?? []) as Array<{ client_id: string; crawled_at: string }>) {
    if (!newestCrawl.has(row.client_id)) newestCrawl.set(row.client_id, row.crawled_at)
  }
  for (const [clientId, iso] of Array.from(newestCrawl.entries())) {
    const days = daysAgo(iso, now)
    if (days === null || days < CRAWL_STALE_DAYS) continue
    items.push({
      kind: 'crawl_stale',
      client_id: clientId,
      client_name: nameOf(clientId),
      what: `网站页面数据 ${days} 天没更新了，内链和孤儿页检查还在用旧数据`,
      how: '打开客户页点一次「重新扫描网站」；如果还是不行说明对方主机挡了我们，回一句我来换通道',
      href: `https://app.magicengine.com.au/dashboard/clients/${clientId}/site-audit`,
    })
  }

  return items
}

async function appendNeverRanCrons(
  supabase: SupabaseClient,
  items: ManualItem[],
): Promise<void> {
  if (CRONS_NEEDING_MANUAL_LINK.length === 0) return

  const { data } = await supabase
    .from('cron_run_logs')
    .select('job_name')
    .in(
      'job_name',
      CRONS_NEEDING_MANUAL_LINK.map((c) => c.job),
    )
    .limit(200)

  const seen = new Set(
    ((data ?? []) as Array<{ job_name: string }>).map((r) => r.job_name),
  )

  for (const cron of CRONS_NEEDING_MANUAL_LINK) {
    if (seen.has(cron.job)) continue
    items.push({
      kind: 'cron_never_ran',
      client_id: 'infra',
      client_name: 'Magic Engine 后台',
      what: `定时任务「${cron.label}」建好之后一次都没跑成功过，多半是密钥没接上，接不上它每天都会白跑`,
      how: `打开链接 → 找到服务 ${cron.job} → Environment → Linked Environment Groups → 勾 me-shared-cron-secret → 选「Link and apply on next run」。不用碰密钥本身`,
      href: RENDER_BLUEPRINT_URL,
    })
  }
}
