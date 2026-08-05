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
import { AUTO_LANDED_AGENT } from '@/lib/diagnostic/auto-prescribe'
import { isHandAddedItem } from '@/lib/diagnostic/prescription-landing'

/**
 * 这些条目**链接坏了也照样下发**。
 *
 * 链接闸的本意是「别给人一个白跑的链接」，但对红线类问题，
 * 「链接不好用」远不如「这条根本没人看见」严重 —— 宁可让人自己找入口，
 * 也不能让一条客户资料串台的告警因为链接问题静默消失。
 *
 * 狄仁杰 2026-08-05 实测：串台告警因为 href 写成相对路径被整条丢掉，
 * kept=0，整套排查产出为零。
 */
const NEVER_DROP_KINDS = new Set<ManualItemKind>(['cross_client_leak'])

/** Meta queued this long without being applied = the applier is stuck. */
const META_PENDING_STALE_DAYS = 3
/** Crawl data older than this = the weekly recrawl isn't landing. */
const CRAWL_STALE_DAYS = 14

export type ManualItemKind =
  | 'blog_pr_open'
  | 'not_indexed'
  | 'meta_stuck'
  | 'crawl_stale'
  | 'video_credits_out'
  | 'cron_not_running'
  | 'cron_blind'
  | 'goal_baseline_mismatch'
  | 'diagnostic_findings'
  | 'prescription_updated'
  | 'leads_metric_untrusted'
  | 'factory_worker_idle'
  | 'blog_draft_waiting'
  | 'cross_client_leak'
  | 'price_claim_unbacked'
  | 'auto_run_blocked'
  | 'auto_run_stuck'

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
/**
 * @deprecated 深链在实际使用中会 404（PM 2026-08-03 实测）。
 * 用 `gscPropertyUrl` + `gscInspectSteps` 代替 —— 稳定入口 + 文字步骤。
 * 保留只为让老测试还能引用到它，新代码不要用。
 */
export function gscInspectUrl(siteUrl: string, pageUrl: string): string {
  return (
    'https://search.google.com/search-console/inspect' +
    `?resource_id=${encodeURIComponent(siteUrl)}&id=${encodeURIComponent(pageUrl)}`
  )
}

import { gscPropertyUrl, gscInspectSteps, verifyActionLink } from './action-link'
import { checkCronHealth } from '@/lib/cron/health'
import { fetchGa4KeyEventBreakdown } from '@/lib/ga4/client'
import { judgeLeadsSanity } from '@/lib/strategy/leads-sanity'
import { judgeWorkerPresence } from '@/lib/factory/worker-presence'
import { auditGoalBaselines } from '@/lib/strategy/baseline-audit'
import { fetchBlogDraftTodos } from '@/lib/pm-todo/blog-drafts'
import { fetchAutoRunTodos } from '@/lib/pm-todo/auto-run-items'
import { auditCrossClientLeaks } from '@/lib/clients/cross-client-audit'
import { containsPriceClaim } from '@/lib/content/price-claim'
import { judgeOutgoingPost } from '@/lib/content/price-claim-gate'
import { SOURCE_LABELS } from '@/lib/assets/provenance'

export function daysAgo(iso: string | null, now: Date): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return Math.floor((now.getTime() - t) / 86_400_000)
}

/**
 * 下发前过一遍链接闸。
 *
 * PM 2026-08-03:「点过去就是 404，徒增我和 fde 的工作时间」。
 * 所以公开网址实测不通的**直接不下发** —— 宁可这条今天不提醒,也不给一个白跑的链接。
 * 登录类站点验不了(见 action-link 头注),它们的 how 里必带文字步骤,不靠链接落点。
 *
 * 单条验证失败不拖累其他条目;整体超时也只是少过滤,不阻断待办。
 */
export async function dropBrokenLinks(
  items: ManualItem[],
  fetchImpl: typeof fetch = fetch,
): Promise<{ kept: ManualItem[]; dropped: ManualItem[] }> {
  const verdicts = await Promise.all(
    items.map((it) =>
      verifyActionLink(it.href, fetchImpl).catch(() => ({ kind: 'unverifiable' as const })),
    ),
  )
  const kept: ManualItem[] = []
  const dropped: ManualItem[] = []
  items.forEach((it, i) => {
    if (verdicts[i].kind === 'broken' && !NEVER_DROP_KINDS.has(it.kind)) {
      dropped.push(it)
      console.warn(`[manual-items] 链接打不开,本条不下发: ${it.kind} ${it.href}`)
    } else {
      if (verdicts[i].kind === 'broken') {
        console.warn(`[manual-items] 链接打不开但这是红线条目,照常下发: ${it.kind} ${it.href}`)
      }
      kept.push(it)
    }
  })
  return { kept, dropped }
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
  // 基础设施类检查要放在这条提前返回**之前**：定时任务健康跟系统里有几个客户
  // 毫无关系。放在后面的话，客户表一空它就被跳过了。
  // 出片余额用完 —— 只有人能充值，必须当天摆到眼前，不能烂在工单的 error 字段里
  await pushVideoCreditsItem(supabase, items, now)
  // 按时没跑 / 查不出跑没跑 —— PM 2026-08-03 要求「不能完成需要有报错」
  await pushCronHealthItems(supabase, items, now)
  // 目标数字口径对不上 —— 错的方向感比没数字更危险(2026-08-03 差点据此给出反向建议)
  await pushBaselineItems(supabase, items)
  // 出片工单排队但没人干活 —— 装配跑在一台 Mac 上，不开机就没人做，而队列里看不出来
  await pushFactoryWorkerItems(supabase, items, now).catch((e) =>
    console.warn('[manual-items] 出片工人在岗检查失败（不阻塞其他待办）:', e),
  )
  if (clients.size === 0) return items

  const ids = Array.from(clients.keys())
  const nameOf = (id: string) => clients.get(id)?.name ?? '未知客户'

  // 新诊断结果 —— PM 2026-08-03 拍板要逐条看；没有消费方的自动化 = 再造一个没人看的数据源。
  // 必须放在 nameOf 定义之后：待办上显示 uuid 等于没显示。
  await pushDiagnosticItems(supabase, items, now, nameOf)

  // 审批过但被价格闸拦住的帖子 —— 自动发布那条路人不在场,不捞出来就没人知道
  await pushPriceGateItems(supabase, items, nameOf).catch((e) =>
    console.warn('[manual-items] 价格闸待办检查失败（不阻塞其他待办）:', e),
  )

  // 本周方案已自动落地 —— 只通知，不要求 PM 操作（PM 2026-08-04 拍板）
  await pushPrescriptionItems(supabase, items, now, nameOf)

  // 客资数值不值得信 —— 值不值得信只有查了统计后台才知道，别让人自己去翻
  await pushLeadsSanityItems(supabase, items, nameOf).catch((e) =>
    console.warn('[manual-items] 客资口径检查失败（不阻塞其他待办）:', e),
  )

  // 写好但没人看过的草稿 —— 这条待办以前只捞 pr_open，于是周更 cron 写出来的
  // 草稿一直沉在库里（实测 3 篇，最老的躺了 5 天，而上一篇真正上线的文章在 47 天前）。
  await pushBlogDraftItems(supabase, items, ids, now, nameOf).catch((e) =>
    console.warn('[manual-items] 草稿待办生成失败（不阻塞其他待办）:', e),
  )

  // 机器本来能自己做、今天却没做的动作 —— 拦下来的原因必须有人看见。
  // 只写进 cron 的运行记录 = 发现死在日志里（管道断头那条铁律的反面教材）。
  await pushAutoRunItems(supabase, items, now, nameOf).catch((e) =>
    console.warn('[manual-items] 自动执行待办生成失败（不阻塞其他待办）:', e),
  )

  // 客户之间有没有串台 —— PM 2026-08-05：「坚决不能胡窜」。
  // 实测查到 CTS 的发布通道指向 Oztop 的网站，填错两个多月没人发现。
  await pushCrossClientItems(supabase, items).catch((e) =>
    console.warn('[manual-items] 串台检查失败（不阻塞其他待办）:', e),
  )

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
    // Day 0 reads as "（已 0 天）" — noise. Say nothing until it has aged.
    const age = days !== null && days > 0 ? `（已 ${days} 天）` : ''

    const what = unknown
      ? `${row.url} 谷歌根本不知道这个网址${age}，它拿不到任何谷歌流量`
      : `${row.url} 谷歌爬过但决定不收录${age}${thin ? `，正文只有 ${row.word_count ?? 0} 词` : ''}，它拿不到任何谷歌流量`

    // 🔴 链接要指向**动作真正发生的地方**,不是「跟这事有关的地方」。
    //    内容太薄 → 活儿在网页上,给页面链接;谷歌不认识这网址 → 活儿在 GSC。
    //    此前一律给 GSC 深链,结果既 404、方向也错(补内容不在 GSC 里做)。
    const how = unknown
      ? `打开 Google Search Console，${gscInspectSteps(row.url)}，然后点「请求编入索引」；如果这页本来就不该被搜到，回我一句，我把它从检查名单去掉`
      : thin
        ? `这条别去点「请求编入索引」——谷歌已经看过并拒绝了，再点一次也一样。真问题是内容太薄（${row.word_count ?? 0} 词）：打开链接看这一页，要么补厚到 300 词以上并配图加内链，要么合并进相关页面做跳转。拿不准回我一句`
        : `先打开 Google Search Console，${gscInspectSteps(row.url)}，点一次「请求编入索引」；如果一周后还是不收录，说明谷歌认为内容价值不够，要补内链和内容`

    items.push({
      kind: 'not_indexed',
      client_id: row.client_id,
      client_name: nameOf(row.client_id),
      what,
      how,
      // 补内容的活儿落在网页上,给页面本身(公开网址,能实测);
      // 要 GSC 操作的给属性首页(稳定入口,不是会 404 的深链)。
      href: thin && !unknown ? row.url : gscPropertyUrl(siteUrl),
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



/** 出片余额充值页 —— 用户自己的账户页,不是深链,登录后一定打得开。 */
const MUAPI_TOPUP_URL = 'https://muapi.ai/topup'

/**
 * AI 出片余额用完 —— 必须下发给人，因为只有人能充值。
 *
 * 2026-08-03 实测:Oztop 重跑到第二个镜头时 402 Insufficient credits,整单失败。
 * 这种失败以前只写进工单的 error 字段 —— 没人会去翻,于是「工厂又没出片」
 * 变成一个查不出原因的现象。余额这种事必须当天摆到眼前。
 *
 * 判据用「近 3 天有没有因余额失败的工单」,不是查余额接口 ——
 * 那个接口不对外(实测 404),而失败记录是我们自己的、一定拿得到。
 */
async function pushVideoCreditsItem(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
): Promise<void> {
  const since = new Date(now.getTime() - 3 * 86_400_000).toISOString()
  // ⚠️ 不按 status 过滤:余额不足时 worker 把工单**退回 queued** 让下轮重领,
  //    status 并不会变成 failed。按状态筛会一条都查不到 —— 实测踩到。
  const { data } = await supabase
    .from('content_work_orders')
    .select('id, client_id, updated_at, reject_reason')
    .not('reject_reason', 'is', null)
    .gte('updated_at', since)
    .limit(50)

  // ⚠️ 字段叫 reject_reason，不是 failure_reason。首版按后者写，查询会直接报错、
  //    被 catch 吞掉 → 这条待办永远不出现。跟 quality_score 那次是同一个毛病：
  //    **写 select 前必须先查真实列名**。
  const hit = ((data ?? []) as Array<{ reject_reason?: string | null }>).find((r) =>
    /insufficient credit|INSUFFICIENT_CREDITS/i.test(r.reject_reason ?? ''),
  )
  if (!hit) return

  items.push({
    kind: 'video_credits_out',
    client_id: 'infra',
    client_name: 'Magic Engine 后台',
    what: 'AI 出片的余额用完了 —— 工厂现在做到一半就会断，做出来的半成品也白花了钱',
    how: '打开链接充值（这是我们生成视频画面用的账户）。充完回我一句，我把断掉的那几单重跑',
    href: MUAPI_TOPUP_URL,
  })
}


/** Render 后台首页 —— 稳定入口，登录后一定打得开（不是会 404 的深链）。 */
const RENDER_DASHBOARD_URL = 'https://dashboard.render.com'

/**
 * 自动任务该跑没跑 → 下发。
 *
 * 现有 daily-cron-digest 只报「跑了但失败」。**「压根没跑」没有任何记录**，
 * 在 digest 眼里跟一切正常完全一样 —— 工厂排产停摆 8 天、digest 自己哑 51 天，
 * 都是死在这个盲区。这里补上。
 *
 * 逾期和从没跑过合成一条，别把待办刷屏：一条说清楚有几个、分别是谁。
 */
async function pushCronHealthItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
): Promise<void> {
  const r = await checkCronHealth(supabase, now).catch(() => null)
  if (!r) return

  const stopped = [...r.neverRan, ...r.overdue]
  if (stopped.length > 0) {
    const names = stopped.map((h) => h.service).join('、')
    items.push({
      kind: 'cron_not_running',
      client_id: 'infra',
      client_name: 'Magic Engine 后台',
      what: `${stopped.length} 个自动任务该跑没跑：${names} —— 它们负责的活儿现在没人干，而且不会自己好`,
      how: '打开链接 → 找到这几个服务 → 看 Events 里最后一次运行是什么结果。多半是 Environment 里没关联 me-shared-cron-secret，勾上再选「Link and apply on next run」即可',
      href: RENDER_DASHBOARD_URL,
    })
  }

  // 「查不出跑没跑」是我们自己的代码欠账，不该天天催 PM ——
  // 但也不能不说，否则它会永远躺在暗处。合成一条，说清楚这是开发要补的。
  if (r.blind.length > 0) {
    items.push({
      kind: 'cron_blind',
      client_id: 'infra',
      client_name: 'Magic Engine 后台',
      what: `${r.blind.length} 个自动任务不写运行记录，跑没跑查不出来：${r.blind.map((h) => h.service).join('、')}`,
      how: '这条不用你动手 —— 是我们代码里的欠账（接口没接运行记录）。回我一句「补记录」我就去补，补完它们才进得了这套监控',
      href: RENDER_DASHBOARD_URL,
    })
  }
}


/**
 * 目标的「起点」和「现值」口径对不上 → 下发。
 *
 * 2026-08-03 真实事故：仪表盘显示 CTS 自然流量跌 39%、Oztop 跌 28%，
 * 我据此差点建议 PM 砍掉正在见效的动作。查下去两个都是假的 ——
 * 起点填的是**总会话数**，现值只算**自然流量**。真实是涨 42% / 涨 203%。
 *
 * 🔴 这类问题必须当天摆出来：**错的方向感比没有数字危险得多**。
 *    仪表盘一旦说反话，越认真看的人被误导得越狠。
 *
 * 不自动改客户的目标数字 —— 那是业务事实，PM 拍板。这里只负责说清楚。
 */
/**
 * 审批过了但发不出去的帖子 —— 文案报了价，配图来源却背不了真价。
 *
 * 为什么必须下发：`/api/publer/create-post` 是 Airtable 审批过就自动跑的，人不在场。
 * 那道闸拦下来只会往 webhook 回一个 409，**没有任何人会看到** —— 帖子就永远停在
 * approved，看起来像「排着排着就没了」。发现死在日志里 = 管道断头。
 *
 * 不落新状态、不加新表：判定条件跟闸本身同源，改好文案或确认好素材，这条自己就消失。
 */
async function pushPriceGateItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  nameOf: (id: string) => string,
): Promise<void> {
  const { data: posts } = await supabase
    .from('content_posts')
    .select('id, client_id, title, caption')
    .eq('status', 'approved')
  const rows = (posts ?? []) as Array<{
    id: string
    client_id: string
    title: string | null
    caption: string | null
  }>

  // 绝大多数帖子不报价 —— 先在内存里筛掉，别为了没价格的帖子去查素材。
  const withPrice = rows.filter((p) => containsPriceClaim(p.caption))
  if (withPrice.length === 0) return

  for (const post of withPrice) {
    // 跟 create-post 取图口径一致：外部改过的终版优先，其次选中的，再次最新的。
    const { data: assets } = await supabase
      .from('visual_assets')
      .select('storage_url')
      .eq('post_id', post.id)
      .eq('generation_status', 'ready')
      .order('is_final', { ascending: false })
      .order('is_selected', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
    const storageUrl = (assets ?? [])[0]?.storage_url as string | undefined
    if (!storageUrl) continue // 没配图 = 发不出去是别的原因，不归这条管

    const verdict = await judgeOutgoingPost(supabase, {
      clientId: post.client_id,
      caption:  post.caption ?? '',
      imageUrl: storageUrl,
    })
    if (!verdict.blocked) continue

    items.push({
      kind: 'price_claim_unbacked',
      client_id: post.client_id,
      client_name: nameOf(post.client_id),
      what:
        `帖子「${post.title ?? post.id}」已审批但发不出去 —— 文案里写了价格，` +
        `配图来源是「${SOURCE_LABELS[verdict.source]}」。真实价格只能配真实画面，` +
        '客人按图下单拿到的东西对不上，投诉算客户的。',
      how:
        '两条路选一条：① 最快 —— 把价格从文案里去掉；' +
        '② 如果那张图确实是客户实拍，去素材库点开它，把来源改成「客户实拍（已确认）」，再回来重发。',
      href: `https://app.magicengine.com.au/dashboard/clients/${post.client_id}/assets`,
    })
  }
}

async function pushBaselineItems(supabase: SupabaseClient, items: ManualItem[]): Promise<void> {
  const suspects = await auditGoalBaselines(supabase).catch(() => [])
  for (const s of suspects) {
    items.push({
      kind: 'goal_baseline_mismatch',
      client_id: s.clientId,
      client_name: s.clientName,
      what: `目标「${s.title}」的仪表盘数字可能是反的 —— ${s.reason}`,
      how: `打开目标页核对：如果确认起点填错了，把它改成 ${s.recomputedBaseline}，仪表盘才会说真话。改之前先想一下这个目标当初是按哪个口径定的`,
      // 真实路径是 /clients/<客户id>/goal/<目标id> —— 首版拼成 /clients/<目标id>，那是 404
      href: `https://app.magicengine.com.au/dashboard/clients/${s.clientId}/goal/${s.goalId}`,
    })
  }
}


/**
 * 「客资数」这个目标指标值不值得信 —— 不值得就说清为什么。
 *
 * 2026-08-04 实测起因：CTS 目标《Best of China 团报名》目标值 30、当前 344，
 * 仪表盘上 1147% 达成。查下来是网站那个「产生线索」事件触发条件太宽 ——
 * 28 天响 341 次，而真正开始填表只有 86 次，连关于我们、签证指南这种
 * 没有表单的页面都在响。
 *
 * 这个数只有客户自己能修（在他们的统计后台改触发条件），所以必须下发；
 * 但下发的话要说清「这个数为什么不能信」，而不是让人自己去后台翻。
 */
/**
 * 客户之间串台 —— 一个客户名下存着另一个客户的东西。
 *
 * 这条**不按客户过滤**：串台天生涉及两个客户，任何一方被过滤掉都会让问题
 * 从待办里消失。也不做「只报 active 客户」—— 潜客的资料串进正式客户同样是事故。
 */
async function pushCrossClientItems(supabase: SupabaseClient, items: ManualItem[]): Promise<void> {
  const findings = await auditCrossClientLeaks(supabase)
  for (const f of findings) {
    items.push({
      kind: 'cross_client_leak',
      // 串台涉及多个客户，名字里全列出来，别只挂一个
      client_id: 'infra',
      client_name: f.clients.join(' / '),
      what:
        f.severity === 'critical'
          ? `🔴 客户资料串台：${f.what}`
          : `⚠️ ${f.what}`,
      how:
        f.severity === 'critical'
          ? '进客户设置页核对这条配置填的是不是本人的。在纠正之前，系统已经拒绝用它发布任何东西'
          : '确认一下归因口径：这笔花费该算给谁，或者要不要拆开记',
      // 🔴 必须是绝对网址。写成相对路径 `/dashboard/clients` 时，
      //    链接闸的 `new URL()` 会抛错 → 判成 broken → **整条待办被丢掉**，
      //    只剩一行 console.warn。狄仁杰 2026-08-05 实跑证实 kept=0 ——
      //    也就是说这套串台排查产出为零，而我正是在修「发现死在日志里」的时候
      //    又造了一个。绝对网址会命中「登录类站点」名单 → unverifiable → 保留。
      href: 'https://app.magicengine.com.au/dashboard/clients',
    })
  }
}

/**
 * 写好但没人看过的博客草稿。
 *
 * 上面那条 `blog_pr_open` 只捞 `status='pr_open'`，而 `draft → pr_open` 需要
 * 有人手动去点发布 —— 没有任何自动化在做这一步。于是周更 cron 每周写出来的
 * 草稿全部沉在库里：实测 3 篇没人看过，而上一篇真正上线的文章在 47 天前。
 */
async function pushBlogDraftItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  ids: string[],
  now: Date,
  nameOf: (id: string) => string,
): Promise<void> {
  const todos = await fetchBlogDraftTodos(supabase, ids, now)
  for (const t of todos) {
    items.push({
      kind: 'blog_draft_waiting',
      client_id: t.client_id,
      client_name: nameOf(t.client_id),
      what: t.what,
      how: t.how,
      href: t.href,
    })
  }
}

/**
 * 自动执行这条线今天的产出说明。
 *
 * 两类：机器已经停手的（一条一条报）、被闸门拦下的（按客户汇总一条）。
 * 判定复用 cron 自己的选择函数，所以这里说的话跟机器真做的事永远一致。
 */
async function pushAutoRunItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  nameOf: (id: string) => string,
): Promise<void> {
  const todos = await fetchAutoRunTodos(supabase, now)
  for (const t of todos) {
    items.push({
      kind: t.stuck ? 'auto_run_stuck' : 'auto_run_blocked',
      client_id: t.client_id,
      client_name: nameOf(t.client_id),
      what: t.what,
      how: t.how,
      href: t.href,
    })
  }
}

async function pushLeadsSanityItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  nameOf: (id: string) => string,
): Promise<void> {
  const { data: goals } = await supabase
    .from('goals')
    .select('id, client_id, title, current_value')
    .eq('status', 'active')
    .eq('primary_metric_key', 'leads_count')
  const rows = (goals ?? []) as Array<{
    id: string
    client_id: string
    title: string
    current_value: number | null
  }>
  if (rows.length === 0) return

  // 一个客户查一次就够 —— 同客户多个客资目标共用同一份统计数据
  const checked = new Map<string, Awaited<ReturnType<typeof checkClientLeads>>>()
  for (const g of rows) {
    if (!checked.has(g.client_id)) {
      checked.set(g.client_id, await checkClientLeads(supabase, g.client_id))
    }
    const verdict = checked.get(g.client_id)
    if (!verdict || verdict.trustworthy) continue

    items.push({
      kind: 'leads_metric_untrusted',
      client_id: g.client_id,
      client_name: nameOf(g.client_id),
      what:
        `目标「${g.title}」现在显示 ${g.current_value ?? '—'}，但这个数不能信 —— ${verdict.humanReason}`,
      how:
        '这个要在客户的网站统计后台改（把「产生线索」的触发条件收窄到真的提交了表单），' +
        '我改不了。你确认一下该找谁改；在那之前别拿这个数判断这个目标做得好不好',
      href: `https://app.magicengine.com.au/dashboard/clients/${g.client_id}/goal/${g.id}`,
    })
  }
}

/**
 * 出片工单在排队但没人干活 → 下发。
 *
 * 装配环节跑在一台 Mac 上，没人开机时工单就静静躺在队列里 ——
 * 队列里有活、看板上没动静，而「这周怎么没出片」要等人想起来问才发现。
 * 只在**真的有活在等**时才报（没活时工人没开机完全正常，报了就是噪音）。
 */
async function pushFactoryWorkerItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
): Promise<void> {
  // 真实列名（已核实）：status / created_at / heartbeat_at
  const { data: queuedRows } = await supabase
    .from('content_work_orders')
    .select('id, created_at')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
  const queued = (queuedRows ?? []) as Array<{ id: string; created_at: string }>
  if (queued.length === 0) return

  const { data: hbRows } = await supabase
    .from('content_work_orders')
    .select('heartbeat_at')
    .not('heartbeat_at', 'is', null)
    .order('heartbeat_at', { ascending: false })
    .limit(1)
  const lastHb = (hbRows ?? [])[0] as { heartbeat_at: string } | undefined

  const hours = (iso: string) => (now.getTime() - Date.parse(iso)) / 3_600_000
  const verdict = judgeWorkerPresence({
    queued: queued.length,
    oldestQueuedHours: hours(queued[0].created_at),
    lastHeartbeatHours: lastHb ? hours(lastHb.heartbeat_at) : null,
  })
  if (verdict.idle) return

  items.push({
    kind: 'factory_worker_idle',
    client_id: 'infra',
    client_name: 'Magic Engine 后台',
    what: `${verdict.humanReason} —— 出片这一步跑在你那台 Mac 上，它不开机就没人做`,
    how: '在那台 Mac 上跑 `node scripts/factory-worker/worker.mjs --loop`，它会自己把排队的活领走。如果你希望这事不再依赖某一台机器，回我一句，我们单独排',
    href: 'https://app.magicengine.com.au/dashboard/factory',
  })
}

/** 拉一个客户的关键事件构成并判定。任何一步拿不到就返回 null（不误报）。 */
async function checkClientLeads(supabase: SupabaseClient, clientId: string) {
  const { data: conn } = await supabase
    .from('client_connectors')
    .select('config')
    .eq('client_id', clientId)
    .eq('anchor', 'ga4')
    .eq('status', 'connected')
    .maybeSingle<{ config: { property_id?: string } | null }>()
  const propertyId = conn?.config?.property_id
  if (!propertyId) return null

  const breakdown = await fetchGa4KeyEventBreakdown(propertyId, clientId).catch(() => null)
  if (!breakdown) return null
  return judgeLeadsSanity(breakdown)
}


/** 新诊断出的问题多久内算「新」—— 周更任务，给一周多一点余量。 */
const DIAGNOSTIC_FRESH_DAYS = 8

/**
 * 本周新诊断出的严重问题 → 下发。
 *
 * PM 2026-08-03 拍板：诊断结果进今日待办逐条看。
 *
 * 🔴 **每个客户只出一条汇总，不是每个发现出一条。**
 *    库里光 critical + high 就有 98 条。全塞进待办 = 刷屏 = PM 直接不看 ——
 *    那跟没做一样，而且比没做更糟（占了注意力还不产生行动）。
 *    一条说清楚「几个严重问题 + 最要紧的是哪个 + 去哪看全部」。
 */
async function pushDiagnosticItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  /** 客户名查表 —— 待办上要显示客户名，显示 uuid 等于没显示。 */
  nameOf: (id: string) => string,
): Promise<void> {
  const since = new Date(now.getTime() - DIAGNOSTIC_FRESH_DAYS * 86_400_000).toISOString()
  const { data } = await supabase
    .from('diagnostic_findings')
    .select('client_id, severity, title, priority_score, created_at')
    .in('severity', ['critical', 'high'])
    .gte('created_at', since)
    .order('priority_score', { ascending: false })
    .limit(300)

  const rows = (data ?? []) as Array<{
    client_id: string
    severity: string
    title: string
  }>
  if (rows.length === 0) return

  // 按客户归堆；因为已按 priority_score 倒序取回，每堆第一条就是最要紧的
  const byClient = new Map<string, { critical: number; high: number; top: string }>()
  for (const r of rows) {
    const cur = byClient.get(r.client_id) ?? { critical: 0, high: 0, top: r.title }
    if (r.severity === 'critical') cur.critical += 1
    else cur.high += 1
    byClient.set(r.client_id, cur)
  }

  for (const [clientId, v] of Array.from(byClient.entries())) {
    const counts = [
      v.critical > 0 ? `${v.critical} 个严重` : null,
      v.high > 0 ? `${v.high} 个高优先` : null,
    ].filter(Boolean).join('、')
    items.push({
      kind: 'diagnostic_findings',
      client_id: clientId,
      client_name: nameOf(clientId),
      // 🔴 别再让人去体检页「挑要处理的」——那页是只读报告，一个可执行按钮都没有
      //    （2026-08-04 PM 实测：「点击到健康体检页面，出现的页面我不知道应该做什么」）。
      //    体检查出的问题现在由每周方案自动排成看板上的动作，所以这条只报「查到了什么」，
      //    并把人送到**真的能动手的地方**（执行看板），不是送到报告里。
      what: `本周体检查出 ${counts}问题。最要紧的一条：${v.top}`,
      how: '不用你挑 —— 每周方案会把这些自动排成看板上的动作。点开是执行看板，看方向对不对；觉得漏了哪条回我一句，我单独加',
      href: `https://app.magicengine.com.au/dashboard/clients/${clientId}/execution`,
    })
  }
}


/** 方案多新算「本周的」—— 跟体检同一个窗口。 */
const PRESCRIPTION_FRESH_DAYS = 8

/**
 * 本周自动落地的方案 → 通知一声。
 *
 * PM 2026-08-04 拍板：方案自动落地，不等他一份份点头。所以这条**不是要他干活**，
 * 是让他知道「这周客户的方向被改了、改成什么」——
 * 自动落地如果连告知都没有，就成了系统背着人改客户的方向。
 *
 * 🔴 只报数得出来的：新增几个动作、挂在哪个目标。
 *    不写「去掉了几个」之类需要跟上一版比对才知道的数 —— 没算过就不能写，
 *    错的数字比没有数字更危险（2026-08-03 目标口径事故就是这么来的）。
 */
async function pushPrescriptionItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  nameOf: (id: string) => string,
): Promise<void> {
  const since = new Date(now.getTime() - PRESCRIPTION_FRESH_DAYS * 86_400_000).toISOString()
  const { data } = await supabase
    .from('prescriptions')
    .select('id, client_id, goal_id, approved_at, agent_name, supersedes_id')
    .eq('status', 'approved')
    .eq('agent_name', AUTO_LANDED_AGENT)
    .gte('approved_at', since)
    .order('approved_at', { ascending: false })
    .limit(50)

  const rows = (data ?? []) as Array<{
    id: string
    client_id: string
    goal_id: string | null
    approved_at: string
    supersedes_id: string | null
  }>
  if (rows.length === 0) return

  // 一个客户只出最新一条 —— 同一周落地两份方案时，刷屏没有意义
  const seen = new Set<string>()
  for (const p of rows) {
    if (seen.has(p.client_id)) continue
    seen.add(p.client_id)

    // 🔴 两个数分开数：动作总数，和其中**真的挂到了目标下**的。
    //    首版只数了总数，却在文案里说「照着目标 X 排的」——
    //    而当时的开方提示词根本不产出挂载信息，等于每周对 PM 说一句假话。
    // 🔴 三个数都必须带 `source='diagnostic'`，跟清理那一侧的口径**逐字一致**。
    //    诸葛亮的看板推荐卡也挂同一个方案号（那是归属标记），每跑一次挂一批。
    //    不过滤的话：①「新增 N 个动作」会一天比一天大 —— 同一个日期、同一份方案，
    //    数字却在涨，比不带日期更让人糊涂；②诸葛亮的卡不走战线派生，会全落进
    //    「还没归类」那一堆，PM 按提示切到「全部」看到的是一批日常建议，
    //    不是这份方案的动作；③「收起了 N 个」会把清理逻辑压根没碰的行算进去。
    //    写侧和读侧是一对，条件必须永远一致 —— 上一轮就是只补了写侧、
    //    读侧照数不误，堵上的那句谎从报数这边原样漏了回来。
    // 一次取回来自己数，不发两条 count —— 两条 count 就是两处要维护的过滤条件，
    // 而这条链三轮里有三次缺陷都是「两边口径分家」。手工加的那道排除
    // 直接复用清理侧导出的 `isHandAddedItem`，同一份代码，想分家都难。
    const { data: itemRows } = await supabase
      .from('execution_items')
      .select('id, initiative_id, steps_json')
      .eq('prescription_id', p.id)
      .eq('source', 'diagnostic')
    const ownItems = ((itemRows ?? []) as Array<{
      id: string
      initiative_id: string | null
      steps_json: Record<string, unknown> | null
    }>).filter((r) => !isHandAddedItem(r))
    const total = ownItems.length
    const hung = ownItems.filter((r) => r.initiative_id != null).length

    let goalTitle: string | null = null
    if (p.goal_id) {
      const { data: g } = await supabase
        .from('goals')
        .select('title')
        .eq('id', p.goal_id)
        .maybeSingle<{ title: string }>()
      goalTitle = g?.title ?? null
    }

    // 上一版有多少条被这次接管时收起来了 —— 只报「新增了多少」不报「收起了多少」，
    // 跟只报好消息是一回事。
    //
    // 🔴 必须按**因果**数（这批动作属于被替代的那一版），不能按时间窗数。
    //    首版写的是「这个客户 8 天内变成 superseded 的」，两头都错：
    //    ① 收起旧动作发生在写批准时间**之前**，所以 `updated_at >= approved_at`
    //       对这批动作正好是 false —— 数不数得到全看两边时钟差几毫秒；
    //    ② 每日巡逻任务会把诸葛亮过期的推荐卡整批标成同一个状态、同一个客户，
    //       于是这个数一天比一天大，同一份方案周二说 0 个、周日说 60 个。
    let dropped = 0
    if (p.supersedes_id) {
      const { data: droppedRows } = await supabase
        .from('execution_items')
        .select('id, steps_json')
        .eq('prescription_id', p.supersedes_id)
        .eq('client_id', p.client_id)
        .eq('source', 'diagnostic')
        .eq('status', 'superseded')
      dropped = ((droppedRows ?? []) as Array<{ steps_json: Record<string, unknown> | null }>)
        .filter((r) => !isHandAddedItem(r)).length
    }

    const n = total
    const onGoal = hung
    // 中文日期不带前导零 —— 「08 月 04 日」一眼就是机器拼的
    const [mm, dd] = p.approved_at.slice(5, 10).split('-')
    const day = `${Number(mm)} 月 ${Number(dd)} 日`

    // 一个动作都没排出来 → 这是「这周空转了」，不是「更新成功」，得分开说
    if (n === 0) {
      items.push({
        kind: 'prescription_updated',
        client_id: p.client_id,
        client_name: nameOf(p.client_id),
        // ⚠️ 开头：这条挂在「系统替你做了什么」这个报喜标题下，
        // 是唯一一条坏消息，不自己抢眼一点会被连标题一起扫过去
        what: `⚠️ ${day}出的新方案一个可执行动作都没排出来 —— 等于这周没往前推`,
        how: '这是我们这边的毛病，不用你动手。回我一句我去查是哪一步卡住的',
        href: `https://app.magicengine.com.au/dashboard/clients/${p.client_id}/execution`,
      })
      continue
    }

    // 「收起来」不是「删掉」—— 事实上也确实没删，只是换了个状态。
    // 括号那句必须留着：PM 看到「清掉」的第一反应是「FDE 做了一半的活会不会没了」，
    // 而这恰恰是代码里防得最严的地方（进行中/已完成/主动跳过/等着重跑/留过记录的
    // 一条都不动）。为一个已经解决的问题让他叫停整条自动落地，太亏。
    // 独立成一句（不是逗号接在后面）：前半句讲这次新增，后半句讲上一版怎么处理。
    // 挤在一句里时，「其余 4 个还没归类」和「还没开始做的 5 个」两个「还没」贴着，
    // 说的却是完全不相干的两件事，PM 很容易把两个数当成一回事。
    const cleaned =
      dropped > 0
        ? `。上一版还没开始做的 ${dropped} 个已经收起来了（做了一半的、已完成的、还有等着重跑的都留着）`
        : ''
    let tail: string
    let how: string
    if (goalTitle && onGoal === n) {
      tail = `，全部排在目标《${goalTitle}》下`
      how = '不用你操作，动作已经在看板里排队了。点开扫一眼方向对不对，觉得排错了回我一句，我这周重排'
    } else if (goalTitle && onGoal > 0) {
      tail = `，其中 ${onGoal} 个排在目标《${goalTitle}》下，其余 ${n - onGoal} 个还没归类`
      how = '打开看板后把顶上的目标筛选切到「全部」，才看得到没归类的那几个。方向不对回我一句，我重排'
    } else if (goalTitle) {
      tail = `，本该排在目标《${goalTitle}》下，但一个都没归类上`
      how = '打开看板后把顶上的目标筛选切到「全部」才看得到这批动作。没归类上是我们这边的毛病，回我一句我去修，不用你动手'
    } else {
      tail = '，没挂到任何目标上'
      // 别说「这个客户还没定目标」—— 那是猜的，而且会让他去建个重复的。
      // 开方流程强制要有目标才会跑（没目标直接跳过），所以走到这一支只有一种可能：
      // 方案挂的那个目标后来被删了。
      how = '打开看板后把顶上的目标筛选切到「全部」才看得到。这份方案原本挂的目标已经不在了 —— 要不要重新定一个你说了算'
    }

    items.push({
      kind: 'prescription_updated',
      client_id: p.client_id,
      client_name: nameOf(p.client_id),
      // 带上日期：这条会连着几天出现在待办里，不带日期 PM 会以为方案被改了好几次
      what: `${day}出的新方案已经排进执行看板 —— 新增 ${n} 个动作${tail}${cleaned}`,
      how,
      href: `https://app.magicengine.com.au/dashboard/clients/${p.client_id}/execution`,
    })
  }
}
