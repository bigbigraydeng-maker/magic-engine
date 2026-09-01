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
import { pushAttributionItems, type AttributionItemKind } from './attribution-items'
import { clientListUnreadableItem, loadActiveClients, type ClientRosterItemKind, type ClientRow } from './client-roster'
import { isHtmlPageUrl } from '@/lib/seo/url-kind'
import { findMessengerStopSignals } from '@/lib/crm/messenger-stop-signal'
import { AUTO_LANDED_AGENT } from '@/lib/diagnostic/auto-prescribe'
import { isHandAddedItem } from '@/lib/diagnostic/prescription-landing'
import { LINKEDIN_PROGRESS_CLIENT_ID, LINKEDIN_PROGRESS_SOURCE } from '@/lib/linkedin-progress/constants'

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
  | 'dataforseo_credits_out'
  | 'cron_not_running'
  | 'cron_blind'
  | 'goal_baseline_mismatch'
  | 'diagnostic_findings'
  | 'prescription_updated'
  | 'leads_metric_untrusted'
  | 'factory_worker_idle'
  | 'ad_readback_blocker'
  | 'blog_draft_waiting'
  | 'cross_client_leak'
  | 'price_claim_unbacked'
  | 'auto_run_blocked'
  | 'auto_run_stuck'
  /** 被一句「不打算去」误判成永久拒联 —— 只有人能看一眼原话再决定 */
  | 'dnc_maybe_wrong'
  /** 客人在 Facebook 私信里像是说了「别再联系」，而判据从来读不到私信 —— 只提示，不自动封 */
  | 'dm_maybe_stop'
  /** 平台候选（docs/registry/platform-candidates.md）到了复查日期 —— 见 me-platform-tier-gate skill */
  | 'platform_candidate_review_due'
  /** 官网免费体检漏斗断流：Cloudflare Pages 生产环境缺 Supabase 凭证，见 pushDiscoveryFunnelCloudflareItem */
  | 'discovery_funnel_cloudflare_env_missing'
  | CommentScopeTodoKind
  /** 执行内核停手 / 等审批 / 被规则挡下 —— 必须有人看见，不许死在日志里 */
  | 'kernel_needs_human'
  | AttributionItemKind
  | ClientRosterItemKind
  | 'linkedin_progress_needs_review'
  | 'linkedin_progress_needs_setup'
  | 'linkedin_progress_failed'

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

/**
 * `ad-readback-sweep` 写进运行记录的那份 summary 的形状。
 *
 * 刻意在这里重新声明、只声明用得到的字段，不 import 那边的类型：这是一份**已经
 * 落库的旧数据**，字段随时可能是上个版本写的。当成外部输入处理，比假装它一定
 * 跟今天的代码同构安全。
 */
interface AdSweepSummary {
  results?: {
    clientId: string
    clientName: string
    adAccountId: string
    adSets?: {
      adSetId: string
      adSetName: string
      hasBlocker: boolean
      findings: { severity: string; message: string }[]
      buyerWillSee: { adName: string; lines: string[] }[]
    }[]
  }[]
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
import { fetchCommentScopeTodos, type CommentScopeTodoKind } from '@/lib/pm-todo/comment-scope-items'
import { fetchKernelHandoffTodos } from '@/lib/kernel/handoff'
import { auditCrossClientLeaks } from '@/lib/clients/cross-client-audit'
import { containsPriceClaim } from '@/lib/content/price-claim'
import { judgeOutgoingPost } from '@/lib/content/price-claim-gate'
import { SOURCE_LABELS } from '@/lib/assets/provenance'
import { isDoNotContact, type DncTouch } from '@/lib/crm/dnc'
import {
  PLATFORM_CANDIDATE_REVIEWS,
  PLATFORM_CANDIDATE_REGISTRY_URL,
  type PlatformCandidateReview,
} from './platform-candidate-reviews'

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
      // 🔴 **没有链接 ≠ 链接坏了。**
      //    有些待办本来就没有可点的地方（比如那件事的入口还没上线），
      //    它的价值全在 what / how 上。空 href 交给 verifyActionLink 会走
      //    `new URL('')` / `fetch('')` 抛错 → 判成 broken → 整条被丢掉，
      //    于是「如实告诉人这件事现在做不了」变成了「人什么都看不到」——
      //    发现死在 console.warn 里，正是铁律 3 下半句禁止的那件事。
      it.href.trim() === ''
        ? Promise.resolve({ kind: 'unverifiable' as const })
        : verifyActionLink(it.href, fetchImpl).catch(() => ({ kind: 'unverifiable' as const })),
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

  const { clients, error: clientsError } = await loadActiveClients(supabase)
  // 基础设施类检查要放在这条提前返回**之前**：定时任务健康跟系统里有几个客户
  // 毫无关系。放在后面的话，客户表一空它就被跳过了。
  // 出片余额用完 —— 只有人能充值，必须当天摆到眼前，不能烂在工单的 error 字段里
  await pushVideoCreditsItem(supabase, items, now)
  // 关键词数据供应商余额用完 —— 同样只有人能充值；仅 40210 进入人工车道。
  await pushDataForSeoCreditsItem(supabase, items, now).catch((e) =>
    console.warn('[manual-items] Keyword Intelligence 余额检查失败（不阻塞其他待办）:', e),
  )
  // 按时没跑 / 查不出跑没跑 —— PM 2026-08-03 要求「不能完成需要有报错」
  await pushCronHealthItems(supabase, items, now)
  // 平台候选到了复查日期 —— 不落库、不查表，纯本地日期判断
  pushPlatformCandidateReviewItems(items, now)
  // 官网免费体检漏斗断流 —— Cloudflare 侧缺 Supabase 凭证，第一条真实 lead 落库前持续下发
  await pushDiscoveryFunnelCloudflareItem(supabase, items).catch((e) =>
    console.warn('[manual-items] 免费体检漏斗断流检查失败（不阻塞其他待办）:', e),
  )
  // 目标数字口径对不上 —— 错的方向感比没数字更危险(2026-08-03 差点据此给出反向建议)
  await pushBaselineItems(supabase, items)
  // 出片工单排队但没人干活 —— 装配跑在一台 Mac 上，不开机就没人做，而队列里看不出来
  await pushFactoryWorkerItems(supabase, items, now).catch((e) =>
    console.warn('[manual-items] 出片工人在岗检查失败（不阻塞其他待办）:', e),
  )
  // 正在花钱的广告撞上了已知的坑 —— 每天扫一遍的结果，不下发就等于没扫
  await pushAdReadbackItems(supabase, items, now).catch((e) =>
    console.warn('[manual-items] 广告闸门结果读取失败（不阻塞其他待办）:', e),
  )
  // ME 产品动态自动发 LinkedIn —— 敏感内容待审 / 账号未连 / 发布失败三种卡点
  await pushLinkedinProgressItems(supabase, items, now).catch((e) =>
    console.warn('[manual-items] LinkedIn 进度贴待办检查失败（不阻塞其他待办）:', e),
  )
  if (clientsError) {
    items.push(clientListUnreadableItem(clientsError.message))
    return items
  }

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

  // 评论读不到（缺权限 / 令牌被拒）—— 只有人能补，日志里那行 console.error 没人会看
  await pushCommentScopeItems(supabase, items, now, nameOf).catch((e) =>
    console.warn('[manual-items] 评论权限待办生成失败（不阻塞其他待办）:', e),
  )

  // 执行内核停手的 / 等你点头的 / 被规则挡下的 —— 死信不许只写进库里没人看
  await pushKernelItems(supabase, items, now, nameOf).catch((e) =>
    console.warn('[manual-items] 执行内核待办生成失败（不阻塞其他待办）:', e),
  )

  // 客户之间有没有串台 —— PM 2026-08-05：「坚决不能胡窜」。
  // 实测查到 CTS 的发布通道指向 Oztop 的网站，填错两个多月没人发现。
  await pushCrossClientItems(supabase, items).catch((e) =>
    console.warn('[manual-items] 串台检查失败（不阻塞其他待办）:', e),
  )

  // 可能被一句「不打算去」误判成永久拒联的人 —— 刻意不自动解除，交给人看一眼。
  await pushDncReviewItems(supabase, items, ids, nameOf).catch((e) =>
    console.warn('[manual-items] 拒联复核待办生成失败（不阻塞其他待办）:', e),
  )

  // 反向的那一半：客人在私信里像是说了「别再联系」，而判据从来读不到私信（#1025）。
  // 刻意**不自动封渠道**，只提示 —— 理由见 lib/crm/messenger-stop-signal.ts 文件头。
  await pushMessengerStopItems(supabase, items, ids, now, nameOf).catch((e) =>
    console.warn('[manual-items] 私信拒联提示生成失败（不阻塞其他待办）:', e),
  )

  // 归因侧两条通道（黑洞 / 孤儿数据），理由见 attribution-items.ts
  await pushAttributionItems(supabase, items, ids, nameOf, now)

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
/** 官方稳定后台入口；登录后从 Billing → Add Funds 充值。 */
const DATAFORSEO_DASHBOARD_URL = 'https://app.dataforseo.com/'

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

/** Keyword Intelligence 余额告罄只认供应商的明确 40210，不猜其它错误。 */
export async function pushDataForSeoCreditsItem(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
): Promise<void> {
  const since = new Date(now.getTime() - 3 * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from('client_discovery')
    .select('id')
    .gte('generated_at', since)
    // JSONB containment matches a warning object even when it also has stage/message.
    .contains('payload', { meta: { warnings: [{ error_code: 40210 }] } })
    .limit(1)

  if (error) throw new Error(`client_discovery warning query failed: ${error.message}`)
  if (!data?.length) return

  items.push({
    kind: 'dataforseo_credits_out',
    client_id: 'infra',
    client_name: 'Magic Engine 后台',
    what: 'Keyword Intelligence 余额用完了 —— 新的客户发现、SEO 竞品分析和内容选题会缺少关键词量数据',
    how: '打开后台 → Billing → Add Funds 充值；充完回我一句，我把最近受影响的发现任务重跑',
    href: DATAFORSEO_DASHBOARD_URL,
  })
}

/** Cloudflare 独立账号后台，本仓无权限深链到具体 Pages 项目，只能给稳定登录入口。 */
const CLOUDFLARE_DASHBOARD_URL = 'https://dash.cloudflare.com/'

/**
 * 官网 magicengine.com.au 免费体检漏斗断流（2026-09-02 发现，docs/ROADMAP.md 同日登记）。
 *
 * 根因：Cloudflare Pages 独立账号（本仓无法访问）的生产环境没配
 * `SUPABASE_URL` / `SUPABASE_SERVICE_KEY`，`storeLead()` 从未真正连过库，
 * 一律回退成假 `demo-` id，报告邮件也因此从未真正发出过。
 *
 * 这条只能人工去 Cloudflare 后台补——但自愈判据可以自动查：只要 Cloudflare
 * 侧接上了真 Supabase 凭证，第一次真实体检就会在 `discovery_leads` 落一行
 * 真实 uuid（`demo-` 的假 id 从不落库）。所以判据就是这张表还有没有任何一行，
 * 一旦有了就自动停止下发，不用等人回来手动关掉这条待办。
 */
export async function pushDiscoveryFunnelCloudflareItem(
  supabase: SupabaseClient,
  items: ManualItem[],
): Promise<void> {
  const { data, error } = await supabase.from('discovery_leads').select('id').limit(1)
  if (error) throw new Error(`discovery_leads existence check failed: ${error.message}`)
  if (data?.length) return

  items.push({
    kind: 'discovery_funnel_cloudflare_env_missing',
    client_id: 'infra',
    client_name: 'Magic Engine 后台',
    what:
      '官网 magicengine.com.au 的免费体检从上线起一直断流：Cloudflare Pages 生产环境缺 ' +
      'SUPABASE_URL / SUPABASE_SERVICE_KEY 两个环境变量，每次体检都存假 demo- ID，从没真正发出过一封报告邮件',
    how:
      '登录 Cloudflare（独立账号，非本仓库账号）→ 找到 magicengine.com.au 对应的 Pages 项目 → ' +
      'Settings → Environment variables → Production，新增 SUPABASE_URL=https://glbdnayojixmexgofbsd.supabase.co、' +
      'SUPABASE_SERVICE_KEY（从 Render magic-engine 服务的 SUPABASE_SERVICE_ROLE_KEY 复制同一个值）→ ' +
      '保存后触发一次重新部署；顺手确认 RESEND_API_KEY 也配了，否则报告邮件仍会静默不发。' +
      '补完后这条待办会在第一条真实体检记录落库后自动消失，不用回来手动关',
    href: CLOUDFLARE_DASHBOARD_URL,
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


/** 广告闸门的扫描结果多久算过期 —— 每天跑一次，超过两天就是它自己也停了。 */
const AD_SWEEP_STALE_DAYS = 2

/**
 * 每天扫在投广告的结果里，凡是 blocker 就下发。
 *
 * 为什么必须落到待办（管道不许断头）：
 *   这套闸门唯一的价值就是「有人看见并去改」。停在 cron 的运行记录里 = 只有开发
 *   翻库才看得到 = 跟没扫一样。2026-08-04 那次得罪 5 个买家，事后复盘的结论不是
 *   「没查出来」，是「没人被告知」。
 *
 * 只发 blocker 不发 warn：warn 每天都有一堆，全推等于全不看。
 */
async function pushAdReadbackItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
): Promise<void> {
  const { data } = await supabase
    .from('cron_run_logs')
    .select('finished_at, summary')
    .eq('job_name', 'ad-readback-sweep')
    .eq('status', 'completed')
    .order('finished_at', { ascending: false })
    .limit(1)

  const run = (data ?? [])[0] as
    | { finished_at: string | null; summary: AdSweepSummary | null }
    | undefined
  // 没跑过 / 过期都不在这里报 —— `pushCronHealthItems` 已经在管「该跑没跑」，
  // 两处都报会让同一件事在待办上出现两遍。
  if (!run?.summary) return
  const age = daysAgo(run.finished_at, now)
  if (age !== null && age > AD_SWEEP_STALE_DAYS) return

  for (const r of run.summary.results ?? []) {
    const bad = (r.adSets ?? []).filter((s) => s.hasBlocker)
    if (bad.length === 0) continue

    for (const s of bad) {
      const why = s.findings
        .filter((f) => f.severity === 'blocker')
        .map((f) => f.message)
        .join('　')
      // 买家实际会看到的话直接印在待办上 —— 让人当场判断，不用再登后台翻。
      const sample = s.buyerWillSee
        .flatMap((b) => b.lines)
        .slice(0, 3)
        .map((l) => `「${l}」`)
        .join('　')

      items.push({
        kind: 'ad_readback_blocker',
        client_id: r.clientId,
        client_name: r.clientName,
        what: `广告组「${s.adSetName}」正在花钱，而且撞上了已知会出事的设置：${why}${
          sample ? ` 买家现在看到的是：${sample}` : ''
        }`,
        how: '打开链接 → 找到这个广告组 → 按上面那句话改（多半是按语言拆开，或把「允许投给名单以外的人」关掉）。改完当天不用管，第二天早上这条会自己消失',
        href: `https://adsmanager.facebook.com/adsmanager/manage/adsets?act=${r.adAccountId.replace(
          /^act_/,
          '',
        )}&selected_adset_ids=${s.adSetId}`,
      })
    }
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

/**
 * 平台候选到了复查日期 —— 接入既有 pm-daily-todo 管道（NZ 工作日早晨已在跑,
 * render.yaml 已排班,不需要新开 cron)，而不是只靠"当值 FDE 记得每月第一个
 * 周一"这句日历式 SOP。见 platform-candidate-reviews.ts 头注。
 *
 * 🔴 日期判断走 Pacific/Auckland 时区，不能用 `Date.parse('YYYY-MM-DD')`：
 * 后者把日期解释为 UTC 零点，而 cron 在 19:00 UTC 跑（次日 07:00/08:00 NZDT），
 * 复查日为 2026-09-28 时，周一 08:00 NZDT 的运行时刻仍是 2026-09-27T19:00Z，
 * 判据 `now.getTime() < due` 就跳过，提醒直到周二才出现（周五到期拖到下周一）。
 */
function nzDateStr(now: Date): string {
  // en-CA 输出 'YYYY-MM-DD' 便于字符串比较（同 formatted YYYY-MM-DD reviewDate）
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function pushPlatformCandidateReviewItems(
  items: ManualItem[],
  now: Date,
  reviews: PlatformCandidateReview[] = PLATFORM_CANDIDATE_REVIEWS,
): void {
  const nzToday = nzDateStr(now)
  for (const c of reviews) {
    // reviewDate 必须是 'YYYY-MM-DD' 格式（platform-candidate-reviews.ts 类型约束）
    // YYYY-MM-DD 字符串按字典序比较即等于日期比较；nzToday >= reviewDate 即"NZ 当天或已过期"
    if (nzToday < c.reviewDate) continue
    items.push({
      kind: 'platform_candidate_review_due',
      client_id: 'infra',
      client_name: 'Magic Engine 平台治理',
      what: `平台候选「${c.name}」到了复查日期（${c.reviewDate}），该扫一遍有没有新客户/新行业的硬证据了`,
      how: '打开候选登记表，看这条候选的「硬证据进度」列要不要更新；凑齐晋升判据就走 2 审提案，没有就把「复查日」列往后推一个月（同时更新 platform-candidate-reviews.ts 里的日期，否则这条提醒下次不会再出现）',
      href: PLATFORM_CANDIDATE_REGISTRY_URL,
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

const LINKEDIN_CONTENT_BOARD_URL = `https://app.magicengine.com.au/dashboard/clients/${LINKEDIN_PROGRESS_CLIENT_ID}/content-factory`
const LINKEDIN_CONNECTORS_URL = `https://app.magicengine.com.au/dashboard/clients/${LINKEDIN_PROGRESS_CLIENT_ID}/connectors/publer`

/** A post stuck at 'approved' this long after creation means the publish call itself failed. */
const LINKEDIN_PUBLISH_FAILURE_STALE_HOURS = 2

/**
 * ME 产品动态自动发 LinkedIn（P24 新建）—— 三种"这条本该自动完成却没完成"的状态，
 * 全部要下发,不能只写进 cron_run_logs：
 *   1. 敏感内容命中硬过滤,转人审草稿(status='draft', reason='sensitive_content_flagged')
 *   2. LinkedIn 账号还没连(status='draft', reason='linkedin_account_not_configured')
 *   3. 账号已连但发布调用本身失败(status 卡在 'approved' 超过 2 小时)
 * 三种原因给不同的 how —— 同一句话应付三种原因,FDE/PM 会点错地方白跑一趟。
 *
 * "cron 该跑没跑"不在这里报 —— pushCronHealthItems 已经通过 CRON_REGISTRY
 * 通用覆盖了 linkedin-progress-post-mon/-thu 这两个 job，不用再单独登记。
 */
async function pushLinkedinProgressItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
): Promise<void> {
  const { data } = await supabase
    .from('content_posts')
    .select('id, status, updated_at, generation_context_snapshot')
    .eq('client_id', LINKEDIN_PROGRESS_CLIENT_ID)
    .eq('source', LINKEDIN_PROGRESS_SOURCE)
    .in('status', ['draft', 'approved'])
    .order('updated_at', { ascending: false })
    .limit(20)

  for (const row of (data ?? []) as Array<{
    id: string
    status: string
    updated_at: string
    generation_context_snapshot: { reason?: string; publish_error?: string } | null
  }>) {
    const reason = row.generation_context_snapshot?.reason

    if (row.status === 'draft' && reason === 'sensitive_content_flagged') {
      items.push({
        kind: 'linkedin_progress_needs_review',
        client_id: LINKEDIN_PROGRESS_CLIENT_ID,
        client_name: 'ME 产品动态（LinkedIn）',
        what: '这周的 LinkedIn 进度贴草稿里可能带了客户敏感信息，系统没敢自动发，等你看一眼',
        how: '打开内容工厂看板，找到标题带「(needs review)」的那条草稿，读一遍确认没问题就批准发布；不想发就直接拒绝，下周照常自动生成新的',
        href: LINKEDIN_CONTENT_BOARD_URL,
      })
      continue
    }

    if (row.status === 'draft' && reason === 'linkedin_account_not_configured') {
      items.push({
        kind: 'linkedin_progress_needs_setup',
        client_id: LINKEDIN_PROGRESS_CLIENT_ID,
        client_name: 'ME 产品动态（LinkedIn）',
        what: 'LinkedIn 自动发帖这条已经在跑了，但你的 LinkedIn 账号还没连到发布工具，该发的这条卡着没发出去',
        // 账号连好之后这条草稿不会自己重新尝试发布——没有额外的重试 cron，
        // 得靠 PM 回内容工厂看板对这条草稿再点一次"确认"（那个按钮现在会
        // 真的调发布，不是走视频那套），不写清楚这一步就是永久卡死。
        how: '先去 Publer 后台用你自己的 LinkedIn 账号做一次性授权连接，连完之后打开这个链接，把出现的 LinkedIn 账号填进「Publer」这一项；填完再回内容工厂看板找到这条卡住的草稿，点一次"确认"，这条就会真的发出去，不用等下一次自动跑',
        href: LINKEDIN_CONNECTORS_URL,
      })
      continue
    }

    // 草稿但 reason 不认识(未来 run.ts 加了新原因、或者字段意外为空)——
    // 兜底也要有一条,不能让它三个分支都不落、悄悄消失在待办之外。
    if (row.status === 'draft') {
      items.push({
        kind: 'linkedin_progress_needs_review',
        client_id: LINKEDIN_PROGRESS_CLIENT_ID,
        client_name: 'ME 产品动态（LinkedIn）',
        what: '有一条 LinkedIn 进度贴草稿卡在待处理，系统没能说清具体原因',
        how: '打开内容工厂看板看一眼这条草稿，读一遍决定发不发',
        href: LINKEDIN_CONTENT_BOARD_URL,
      })
      continue
    }

    if (row.status === 'approved') {
      // 用 updated_at 不用 created_at —— 一条被拦下转人审的草稿，PM 点"批准"那一刻
      // 只会刷新 updated_at，created_at 还是它被生成那天。按 created_at 算的话，
      // PM 前脚刚批准，下一次巡检马上就会误报"没能发出去"，而系统根本还没试着发。
      const updatedAt = Date.parse(row.updated_at)
      if (Number.isNaN(updatedAt)) continue
      const hoursAgo = (now.getTime() - updatedAt) / 3_600_000
      if (hoursAgo < LINKEDIN_PUBLISH_FAILURE_STALE_HOURS) continue

      // 这条其实已经真发到 LinkedIn 上了——只是发布成功后回写数据库那一步
      // 失败了，本地状态没跟上。绝不能套用下面"没能发出去"那套话术：那会
      // 引导人去重试/重新批准，而 Publer 那边已经真有一条了，重试 = 发出
      // 重复的公开帖子。这里只能是"帮我手动改一下状态"，不是"帮我重试"。
      if (row.generation_context_snapshot?.reason === 'published_but_db_sync_failed') {
        items.push({
          kind: 'linkedin_progress_needs_review',
          client_id: LINKEDIN_PROGRESS_CLIENT_ID,
          client_name: 'ME 产品动态（LinkedIn）',
          what: '这条 LinkedIn 进度贴其实已经真的发出去了，只是系统记录状态没跟上——千万别在内容工厂看板里重新点"批准发布"，会发出重复的公开帖子',
          how: '回我一句，我去手动把这条记录的状态改成"已发布"，不用你操作',
          href: LINKEDIN_CONTENT_BOARD_URL,
        })
        continue
      }

      const err = row.generation_context_snapshot?.publish_error
      items.push({
        kind: 'linkedin_progress_failed',
        client_id: LINKEDIN_PROGRESS_CLIENT_ID,
        client_name: 'ME 产品动态（LinkedIn）',
        what: `这周的 LinkedIn 进度贴生成好了但没能发出去${err ? `(系统报的原因: ${err})` : ''}`,
        how: '打开 Publer 连接器设置页，看看 LinkedIn 账号是不是掉线了；账号看起来没问题的话，回我一句，我来查具体原因',
        href: LINKEDIN_CONNECTORS_URL,
      })
    }
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
/**
 * 可能被误判成「永久别再联系」的人。
 *
 * 🔴 **这一条是刻意不自动化的**（PM 2026-08-16）。
 *
 * 旧的判词把「not intending to go」（我不打算去）当成了「别再联系我」，而
 * `contacts.do_not_contact` 是全系统最重的一个标记：**任何渠道都不许再发**。
 * 词表已经改好，新写的备注不会再落这个坑，但**存量那几个人不会自己回来**。
 *
 * 为什么不写自动解除：本仓一贯的判断是「漏判是骚扰，误判只是少打一通」。
 * 让一段正则去**解开**这个闸，方向恰好反了 —— 万一某人原话里同时含着真正的
 * 拒绝，我们就会去骚扰一个明确说过别联系的客人。这是客户红线，不该由规则来赌。
 *
 * 所以按铁律 3 的下半条办：**确实不该自动化，就下发成人工任务，且进同一个管道**。
 * 判据只挑「原话里只有『不打算去』、没有任何划界限说法」的那些 —— 真的说过
 * 「别再联系 / 不要打电话 / 只邮件联系」的人不在里面，不会被打扰。
 */
interface ContactRowForDnc {
  id: string
  client_id: string
  display_name: string
  do_not_contact?: boolean
}

export async function pushDncReviewItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  ids: string[],
  nameOf: (id: string) => string,
): Promise<void> {
  if (ids.length === 0) return

  /**
   * 候选人从**两头**取（Codex 复审 2026-08-16）：
   *
   *   · 镜像列 `do_not_contact = true` 的
   *   · 触点里说过拒联的 —— 那才是真相源
   *
   * 只按镜像列筛会漏掉最该被复核的一批：写触点成功、镜像列那一步失败的人。
   * 那种半写入状态确实存在（取消接口正因为它才回 500），而这些人恰恰
   * **被今日名单和分段当成拒联继续排除着** —— 漏了他们，这条任务就白设了。
   */
  const { data: flaggedRows } = await supabase
    .from('contacts')
    .select('id, client_id, display_name, do_not_contact')
    .in('client_id', ids)
    .eq('do_not_contact', true)

  const { data: dncTouchRows } = await supabase
    .from('contact_touchpoints')
    .select('contact_id')
    .in('client_id', ids)
    .eq('metadata->>outcome', 'do_not_contact')

  const extraIds = Array.from(
    new Set(((dncTouchRows ?? []) as { contact_id: string }[]).map((t) => t.contact_id)),
  ).filter((id) => !(flaggedRows ?? []).some((c) => (c.id as string) === id))

  let contacts = (flaggedRows ?? []) as ContactRowForDnc[]
  if (extraIds.length > 0) {
    const { data: extra } = await supabase
      .from('contacts')
      .select('id, client_id, display_name, do_not_contact')
      .in('client_id', ids)
      .in('id', extraIds)
    contacts = contacts.concat((extra ?? []) as ContactRowForDnc[])
  }
  if (contacts.length === 0) return

  const { data: touches } = await supabase
    .from('contact_touchpoints')
    // metadata / occurred_at 是给判据用的：有人纠正过「这条判错了」之后，
    // 这条任务不许再冒出来 —— 否则 FDE 每天被同一个已经处理完的人骚扰一次。
    .select('contact_id, raw, metadata, occurred_at')
    .in('contact_id', contacts.map((c) => c.id as string))
  if (!touches) return

  /** 客户真的在划界限的说法 —— 命中任何一条就不算误判，别去打扰。 */
  const BOUNDARY =
    /do not follow up|no need\s*(to\s*)?follow up|do(es)? not want to talk|do not (like|want) (phone|call)|不要.?电话|不需要联系|别再(联系|打)|只邮件联系/i
  const SOFT = /not intending to go/i

  const byContact = new Map<string, string[]>()
  const touchesByContact = new Map<string, DncTouch[]>()
  for (const t of touches) {
    const cid = t.contact_id as string
    const list = byContact.get(cid) ?? []
    if (typeof t.raw === 'string' && t.raw) list.push(t.raw)
    byContact.set(cid, list)

    const meta = (t.metadata ?? {}) as Record<string, unknown>
    const dncList = touchesByContact.get(cid) ?? []
    dncList.push({
      outcome: (meta.outcome as string) ?? null,
      flagged: meta.do_not_contact === true,
      occurredAt: t.occurred_at as string,
    })
    touchesByContact.set(cid, dncList)
  }

  for (const c of contacts) {
    /**
     * 🔴 **别再拿那一列当判据**（Codex 复审 2026-08-16）。
     *
     * `contacts.do_not_contact` 是尽力维护的镜像，写失败过。人已经点过
     * 「判错了，放回名单」、纠正的触点也写好了，只要那一次镜像更新没成功，
     * 这条任务第二天照旧冒出来 —— FDE 会以为自己上次点的按钮是假的。
     * 判据只有一份，见 `lib/crm/dnc`。
     */
    // 镜像列按它**实际的值**传，别写死：只按触点找来的那批，列可能是 false
    // （正是「触点写成功、镜像那一步失败」的那种半写入状态）。
    if (!isDoNotContact(c.do_not_contact === true, touchesByContact.get(c.id as string) ?? [])) {
      continue
    }

    const raws = byContact.get(c.id as string) ?? []
    if (raws.some((r) => BOUNDARY.test(r))) continue
    if (!raws.some((r) => SOFT.test(r))) continue

    const name = (c.display_name as string) || '未留姓名'
    items.push({
      kind: 'dnc_maybe_wrong',
      client_id: c.client_id as string,
      client_name: nameOf(c.client_id as string),
      what: `${name} 被标成「永久别再联系」，但他原话只说了「不打算去」—— 可能是系统早前判错了，这个人现在收不到我们任何消息`,
      how: '点链接直接就展开到他了 —— 联系方式下面有一条黄条写着「他被标成别再联系」。先看黄条下面的往来记录，确认他原话只是「不打算去」、没说过「别再打给我」，再点黄条上的「判错了？点这里放回名单」',
      /**
       * 🔴 绝对网址 —— 相对路径会被链接闸判成 broken，整条待办被丢掉
       *    （狄仁杰 2026-08-05 实测 kept=0，理由见 pushCrossClientItems）。
       *
       * 🔴 `?contact=` 这个参数「全部客人」那一页**真的读**（Codex 复审
       *    2026-08-16）：点进去自动展开到这个人，并且那一页就有取消入口。
       *    改这个链接前先确认新落点也满足这两条 —— 否则 FDE 点进去只会看到
       *    一张 583 行的表，还得自己搜名字，进去了也找不到上面说的那个按钮。
       */
      href: `https://app.magicengine.com.au/dashboard/clients/${c.client_id as string}/crm/all?contact=${c.id as string}`,
    })
  }
}

/**
 * 客人在 Facebook 私信里像是说了「别再联系」—— 提示销售去看一眼。
 *
 * 🔴 **只提示，不自动封渠道**（PM 2026-08-17 拍板 B 方案）。判据本身现在还判不准
 * （issue #1019），把 2099 条私信喂进去自动写 `do_not_contact`，代价是一批正常客人
 * 被永久静默排除，而解除只能一个个手动点。风险方向倒过来：判错了浪费销售 10 秒，
 * 判漏了跟今天一样。完整理由见 `lib/crm/messenger-stop-signal.ts` 文件头。
 *
 * 那个模块**一行写操作都没有** —— 这是它的核心纪律，别在这里给它补上。
 */
export async function pushMessengerStopItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  ids: string[],
  now: Date,
  nameOf: (id: string) => string,
): Promise<void> {
  if (ids.length === 0) return

  const { signals, dropped } = await findMessengerStopSignals(supabase, ids, now)
  if (dropped > 0) {
    // 🔴 上限压掉了多少必须说出来 —— 静默截断会被读成「就这么几条」。
    console.warn(`[manual-items] 私信拒联提示：每客户上限压下 ${dropped} 条，本轮未下发`)
  }
  if (signals.length === 0) return

  const { data: names } = await supabase
    .from('contacts')
    .select('id, display_name')
    .in('id', signals.map((s) => s.contactId))
  const nameById = new Map(
    ((names ?? []) as { id: string; display_name: string | null }[]).map((c) => [
      c.id,
      c.display_name,
    ]),
  )

  for (const s of signals) {
    const who = nameById.get(s.contactId) || '未留姓名'
    items.push({
      kind: 'dm_maybe_stop',
      client_id: s.clientId,
      client_name: nameOf(s.clientId),
      what: `${who} 在 Facebook 私信里说了「${s.quote}」—— 听着像是不想再被联系，但系统读不懂私信，他现在**照常留在名单里**，明天还会被打扰`,
      /**
       * 🔴 **两条路都必须让人留一笔**（Codex 复审 PR #1037，2026-08-17）。
       *
       * 初版写的是「只是这次不想去 → 什么都不用做，这条明天不再冒出来」——
       * 那是假的：光点开链接不写任何东西，抑制条件（那条私信之后有一笔
       * `me_manual` 触点）就不成立，同一条会**连着冒 30 天**。
       *
       * 一条说明不准的人工任务比没有更糟：FDE 照做、发现没用、下次就整栏跳过。
       * 所以两条路都收在「写一句」上 —— 顺带这一笔也成了留痕，
       * 下一个人能看见当初是谁、按什么理由判的。
       */
      how: '点链接直接展开到他，先把私信原话看完整（同一段对话里可能后面又改口了）。真要停 → 在他的记录里写一句「客户说别再联系」，系统会停掉所有渠道；只是这次不想去 → 写一句「只是这次不去，可以继续联系」。**两种都得写一句**，写完这条才不会再冒出来（没写就等于没人看过，明天还来）',
      /**
       * 🔴 绝对网址 —— 相对路径会被链接闸判成 broken，整条待办被丢掉
       *    （狄仁杰 2026-08-05 实测 kept=0，理由见 pushCrossClientItems）。
       *    `?contact=` 那一页真的读，点进去自动展开到这个人，同 pushDncReviewItems。
       */
      href: `https://app.magicengine.com.au/dashboard/clients/${s.clientId}/crm/all?contact=${s.contactId}`,
    })
  }
}

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

/**
 * 评论自动回复读不到评论 → 下发。
 *
 * 判定与文案都在 `comment-scope-items.ts`：那边直接读 cron 自己写的运行记录，
 * 所以这里说的话跟机器真遇到的失败永远一致。
 */
async function pushCommentScopeItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  nameOf: (id: string) => string,
): Promise<void> {
  const todos = await fetchCommentScopeTodos(supabase, now)
  for (const t of todos) {
    items.push({
      kind: t.kind,
      client_id: t.client_id,
      client_name: nameOf(t.client_id),
      what: t.what,
      how: t.how,
      href: t.href,
    })
  }
}

/**
 * 执行内核里需要人处理的东西 → 下发。
 *
 * 三种：重试到上限停手的（死信）、按客户规则要人点头的、被规则挡下的。
 * 判定复用 Kernel 自己的取数函数，所以这里说的话跟库里的状态永远一致。
 *
 * 🔴 这条是「管道不许断头」的执行内核侧出口。没有它，一次死信就只是
 *    `action_runs` 里一行 `status='dead_letter'` —— 没有任何人会去翻。
 */
async function pushKernelItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  nameOf: (id: string) => string,
): Promise<void> {
  const todos = await fetchKernelHandoffTodos(supabase, now)
  for (const t of todos) {
    items.push({
      kind: 'kernel_needs_human',
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
