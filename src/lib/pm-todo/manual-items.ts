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
import { pushAttributionItems } from './attribution-items'
import { clientListUnreadableItem, loadActiveClients, type ClientRow } from './client-roster'
import { pushConversionReviewItems } from './conversion-review-items'
import { pushAiAutoReviewCircuitBreakerItems } from './ai-auto-review-circuit-breaker-items'
import { pushMessengerDraftItems } from './messenger-draft-items'
import { pushKnowledgeFactExpiringItems } from './knowledge-fact-expiring-items'
import { pushDailyPlanMeasurementItems } from './daily-plan-measurement-items'
import { pushEmailReplyItems } from './email-reply-items'
import { pushBindingRequestItems } from './binding-request-items'
import { pushPageBindingItems } from './page-binding-items'
import { AUTO_LANDED_AGENT } from '@/lib/diagnostic/auto-prescribe'
import { isHandAddedItem } from '@/lib/diagnostic/prescription-landing'
import { daysSinceLatest, makeSupabaseOutageReader, readRecentOutages, streakDays, utcDate, type OutageQuery } from '@/lib/ai/outage-ledger'
import { shouldRemindToday, streakPhrase } from './remind-cadence'
import {
  buildNotIndexedItems,
  daysAgo,
  META_PENDING_STALE_DAYS,
  CRAWL_STALE_DAYS,
  type ManualItem,
  type ManualItemKind,
  type NotIndexedRow,
} from './manual-item-types'
import { pushLinkedinProgressItems } from './manual-linkedin-items'
import { pushPaidSignalReviewItems, pushDncReviewItems, pushMessengerStopItems } from './manual-crm-items'

export * from './manual-item-types'
export { pushLinkedinProgressItems } from './manual-linkedin-items'
export { pushPaidSignalReviewItems, pushDncReviewItems, pushMessengerStopItems } from './manual-crm-items'


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

import { fetchAll } from '@/lib/supabase-paginate'
import { checkCronHealth } from '@/lib/cron/health'
import { CRON_REGISTRY } from '@/lib/cron/registry'
import { fetchGa4KeyEventBreakdown } from '@/lib/ga4/client'
import { judgeLeadsSanity } from '@/lib/strategy/leads-sanity'
import { judgeWorkerPresence, judgeQueueByClient } from '@/lib/factory/worker-presence'
import { auditGoalBaselines } from '@/lib/strategy/baseline-audit'
import { fetchBlogDraftTodos } from '@/lib/pm-todo/blog-drafts'
import { fetchAutoRunTodos } from '@/lib/pm-todo/auto-run-items'
import { fetchCommentScopeTodos } from '@/lib/pm-todo/comment-scope-items'
import { fetchKernelHandoffTodos } from '@/lib/kernel/handoff'
import { auditCrossClientLeaks } from '@/lib/clients/cross-client-audit'
import { containsPriceClaim } from '@/lib/content/price-claim'
import { judgeOutgoingPost } from '@/lib/content/price-claim-gate'
import { SOURCE_LABELS } from '@/lib/assets/provenance'
import {
  PLATFORM_CANDIDATE_REVIEWS,
  PLATFORM_CANDIDATE_REGISTRY_URL,
  type PlatformCandidateReview,
} from './platform-candidate-reviews'
import { CLIENT_DOC_MANUAL_TASKS, type ClientDocManualTask } from './client-doc-manual-tasks'

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
  // AI 文字账户断电（没钱 / 钥匙失效 / 卡在网关）—— 2026-09-20 那次全站三天没人知道。
  // 跟上面两条余额待办同一条纪律：只有人能充钱，必须当天摆到眼前。
  await pushProviderOutageItems(supabase, items, now).catch((e: unknown) => {
    // 只打日志就等于这只眼睛瞎了也没人知道 —— 照样下发一条
    items.push({
      kind: 'ai_alerting_broken',
      client_id: 'infra',
      client_name: 'Magic Engine 后台',
      what: `「AI 账户断电」的告警自己挂了（${(e instanceof Error ? e.message : String(e)).slice(0, 160)}）—— 今天没有这项检查的结果，不报警不等于没事`,
      how: '这条不用你动手 —— 是我们这边的欠账。回我一句「修一下断电告警」我就去修',
      href: '',
    })
  })
  // 按时没跑 / 查不出跑没跑 —— PM 2026-08-03 要求「不能完成需要有报错」
  await pushCronHealthItems(supabase, items, now)
  // 平台候选到了复查日期 —— 不落库、不查表，纯本地日期判断
  pushPlatformCandidateReviewItems(items, now)
  // 客户方案文档里写的一次性人工动作 —— 同样不落库、纯本地日期判断，过期自动消失
  pushClientDocManualTaskItems(items, now)
  // 成交/咨询等着人核对要不要告诉广告平台 —— 撤不回的动作，只能人点（#1397）
  await pushConversionReviewItems(supabase, items, clients, now).catch((e) =>
    console.warn('[manual-items] 成交待核对读取失败（不阻塞其他待办）:', e),
  )
  // AI 全自动审核被异常刹车暂停了 —— 拉模式，事件送达失败也照样出得来
  await pushAiAutoReviewCircuitBreakerItems(supabase, items).catch((e) =>
    console.warn('[manual-items] AI 自动审核熔断状态读取失败（不阻塞其他待办）:', e),
  )
  // AI 客服回复：待批准 / 已批但发送失败 / 超时升级三档（#1589）——拉模式，
  // 不依赖 Inngest 事件送达
  await pushMessengerDraftItems(supabase, items, clients, now).catch((e) =>
    console.warn('[manual-items] AI 客服草稿待办读取失败（不阻塞其他待办）:', e),
  )
  // 客户资料库信息快到期了，过期后 AI 客服不能再用这条信息回复客户（#1589）
  await pushKnowledgeFactExpiringItems(supabase, items, clients, now).catch((e) =>
    console.warn('[manual-items] 客户资料库到期检查失败（不阻塞其他待办）:', e),
  )
  // 目标数字口径对不上 —— 错的方向感比没数字更危险(2026-08-03 差点据此给出反向建议)
  await pushBaselineItems(supabase, items)
  // 出片工单排队但没人干活 —— 装配跑在一台 Mac 上，不开机就没人做，而队列里看不出来
  await pushFactoryWorkerItems(supabase, items, now, clients).catch((e) =>
    console.warn('[manual-items] 出片工人在岗检查失败（不阻塞其他待办）:', e),
  )
  // Creatomate 渲染失败/超时 —— 旧路径的卡死回收已死透，这是它的替代（spec §4.4 B4）
  await pushCreatomateRenderItems(supabase, items, now, clients).catch((e) =>
    console.warn('[manual-items] Creatomate 渲染检查失败（不阻塞其他待办）:', e),
  )
  // 排期帖发出去了但拿不到帖子编号 —— 成绩收不回来，只写运行记录等于没人知道
  await pushDailyPlanMeasurementItems(supabase, items, now, clients).catch((e) =>
    console.warn('[manual-items] 帖子成绩回收失败检查读取失败（不阻塞其他待办）:', e),
  )
  // 正在花钱的广告撞上了已知的坑 —— 每天扫一遍的结果，不下发就等于没扫
  await pushAdReadbackItems(supabase, items, now).catch((e) =>
    console.warn('[manual-items] 广告闸门结果读取失败（不阻塞其他待办）:', e),
  )
  // Mailchimp 出口在 tally 里非预期失败（配置读不出来 / API key 失效 / 被限流 / 5xx）——
  // 这类失败从不设置 cron 结果的 error，cron 整体照样显示 completed，不单独捞出来就永远没人看见
  await pushMailchimpExportItems(supabase, items, now).catch((e) =>
    console.warn('[manual-items] Mailchimp 出口检查失败（不阻塞其他待办）:', e),
  )
  // ME 产品动态自动发 LinkedIn —— 敏感内容待审 / 账号未连 / 发布失败三种卡点
  await pushLinkedinProgressItems(supabase, items, now).catch((e) =>
    console.warn('[manual-items] LinkedIn 进度贴待办检查失败（不阻塞其他待办）:', e),
  )
  // 客人说他付款了但没法自动确认 —— 只有人能对银行流水，不许机器自己打 paid 标签
  await pushPaidSignalReviewItems(supabase, items, now).catch((e) =>
    console.warn('[manual-items] 待确认付款读取失败（不阻塞其他待办）:', e),
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

  // 客人来信超过一天没人回 + 公司邮箱同步哑了（后者会让前者假装成零条），见 email-reply-items.ts
  await pushEmailReplyItems(supabase, items, ids, now, nameOf).catch((e) =>
    console.warn('[manual-items] 客人来信没回待办生成失败（不阻塞其他待办）:', e),
  )

  // 客户交了广告账户号等核实 —— 客户以为交上去了，不下发就没人知道（AD-SEC-3）
  await pushBindingRequestItems(supabase, items, ids, now, nameOf).catch((e) =>
    console.warn('[manual-items] 广告账户号待核实读取失败（不阻塞其他待办）:', e),
  )

  // 主页绑定没核实 → 私信/线索同步被暂停（AD-SEC-4）。读失败时自己生成一条待办，不靠 catch。
  await pushPageBindingItems(supabase, items, process.env)

  // 归因侧两条通道（黑洞 / 孤儿数据），理由见 attribution-items.ts
  await pushAttributionItems(supabase, items, ids, nameOf, now)

  // 私信客服健康心跳查出的异常（issue #1587）——拉模式，直接查
  // conversation_health_alerts，事件送达失败也照样出得来
  await pushConversationHealthAlertItems(supabase, items, now, nameOf).catch((e) =>
    console.warn('[manual-items] 私信客服健康告警读取失败（不阻塞其他待办）:', e),
  )

  // GSC property per client —— 汇总后的「未收录页面」待办链到这里。谷歌自己的
  // 「索引 → 网页」报告才是权威的「哪些页面没被收录、为什么」清单；ME 后台没有
  // 任何展示收录状态的页面（实测 /site-audit/pages 只有网址/字数，无收录状态）。
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
    // 🔴 未收录页面必须读全（Codex P2）：一页一条时截断只是少报几行，但汇总
    //    报数时截断会让「N 个页面」谎报、甚至把整客户漏掉。用 fetchAll 分页读全，
    //    按 (client_id, url) 全序排序保证跨页不重不漏。
    // 🔴 fetchAll 会**抛错**（分页失败 / 触 10 万行硬顶），而普通 supabase 查询
    //    只返回 {error} 不抛。它在这个 Promise.all 里，抛出会让整个 loadManualItems
    //    失败 → daily-todo.ts 把**所有**人工待办替换成 []（广告红线、串台、LinkedIn
    //    全从邮件和看板消失，只剩一行日志）。所以这一路必须自己兜住，只丢 not_indexed，
    //    不拖垮别的通道 —— 跟本文件每条通道的 .catch 隔离纪律一致（Codex P1 #1375）。
    fetchAll<NotIndexedRow>((from, to) =>
      supabase
        .from('client_site_pages')
        .select('client_id, url, index_verdict, first_not_indexed_at, word_count')
        .not('first_not_indexed_at', 'is', null)
        .in('client_id', ids)
        .order('client_id', { ascending: true })
        .order('url', { ascending: true })
        .range(from, to),
    ).catch((e: unknown) => {
      console.warn(
        '[manual-items] 未收录页面读取失败（不阻塞其他待办）:',
        e instanceof Error ? e.message : String(e),
      )
      return [] as NotIndexedRow[]
    }),
    supabase
      .from('seo_meta_log')
      .select('client_id, page_slug, created_at, applied_channel')
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

  // 2. Pages Google won't index —— 一个客户汇总成一条，见 buildNotIndexedItems。
  items.push(...buildNotIndexedItems(notIndexed, siteUrlOf, nameOf, now))

  // 3. Meta changes queued but not applied — the Oztop WP plugin polls this
  //    queue; a long backlog means the plugin stopped.
  //
  //    CTS (and any other repo-PR client — applied_channel='pr') is EXCLUDED
  //    here: its cts-meta-pr.ts / seo-meta-cycle flow always writes
  //    wp_updated=false even after the PR has been opened/merged (there is
  //    no client-side plugin polling this queue for it), so before this
  //    filter every CTS row eventually surfaced a false "Magic Engine 插件
  //    is stopped" alert — a client that has no such plugin. Detecting a
  //    genuinely stuck repo-PR (opened but never merged) needs a separate
  //    GitHub PR-state check, not this queue-age heuristic; that's tracked
  //    as follow-up work, not solved here.
  const metaByClient = new Map<string, { count: number; oldest: string }>()
  for (const row of (metaPending.data ?? []) as Array<{
    client_id: string
    created_at: string
    applied_channel?: string | null
  }>) {
    if (row.applied_channel === 'pr') continue
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
      // 🔴 落地路径必须落到 /site-audit/pages —— /site-audit 本身没有 page.tsx，
      //    Next.js 直接 404（2026-09-07 每日待办 href 落地页审计 PR #1467 实测）。
      //    /site-audit/pages 是「页面清单」页，右上就有「Start New Audit」按钮，
      //    功能刚好对上「重新扫描网站」这句 how。
      how: '打开链接（是「页面清单」页），右上点「Start New Audit」重扫；如果还是不行说明对方主机挡了我们，回一句我来换通道',
      href: `https://app.magicengine.com.au/dashboard/clients/${clientId}/site-audit/pages`,
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

/**
 * Creatomate 渲染失败 / 超时 —— 旧 ffmpeg 路径的 reapStale() 随 2026-09-02 退役一起死了
 * （见 docs/specs/2026-09-09-creatomate-connector-spec-v1.md §4.4 B4），这条是它的替代：
 * 卡死的任务不会自己被谁看见，必须扫一遍 failed 行主动下发。
 *
 * 判据：`render_engine='creatomate' AND status='failed'`，近 3 天（避免翻出陈年旧账）。
 * `error` 文案区分"额度用完"（402，见 spec §6.2）和其他失败（超时/参数错误等），
 * 前者的 how 指向充值，后者指向去 Creatomate 后台查那条具体的 render。
 */
export async function pushCreatomateRenderItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  clientNames: Map<string, { name: string }>,
): Promise<void> {
  const since = new Date(now.getTime() - 3 * 86_400_000).toISOString()
  const { data } = await supabase
    .from('content_factory_render_jobs')
    .select('id, client_id, error, creatomate_render_id')
    .eq('render_engine', 'creatomate')
    .eq('status', 'failed')
    .gte('updated_at', since)
    .limit(50)

  const rows = (data ?? []) as Array<{ id: string; client_id: string; error: string | null; creatomate_render_id: string | null }>
  for (const row of rows) {
    const clientName = clientNames.get(row.client_id)?.name ?? '未知客户'
    const creditsOut = /402|insufficient|credit/i.test(row.error ?? '')
    items.push({
      kind: 'creatomate_render_failed',
      client_id: row.client_id,
      client_name: clientName,
      what: creditsOut
        ? `${clientName} 有一条视频没做完 —— Creatomate 出片额度可能用完了，只有人能充值`
        : `${clientName} 有一条视频做片失败：${row.error ?? '原因未知'}`,
      how: creditsOut
        ? '登录 Creatomate 后台确认额度并充值，充完回我一句，我把这条重新提交'
        : `登录 Creatomate 后台查这条 render（id: ${row.creatomate_render_id ?? '未知，看工单详情'}）到底卡在哪，或者直接找我重跑`,
      href: `https://app.magicengine.com.au/dashboard/clients/${row.client_id}/content-factory`,
    })
  }
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


/**
 * AI 账户断电 —— 只有人能充值 / 换钥匙，必须当天摆到眼前。
 *
 * 真实事故（2026-09-20）：ME 全站只有一把 OpenAI 钥匙，它背后的账户当天
 * 18:01~19:11 (UTC) 余额耗尽，约 35 个调用点一起死，**三天没人知道**。
 * 当时全仓只有市场情报那一条链路会喊出来，其余十几处都是 catch {} 静默吞掉。
 *
 * 判据用「最近几天有没有落地的断电记录」，**不是**「现在还坏着」——
 * 后者会让 9/20 那种只持续 70 分钟的断电在充值后彻底消失（今日待办一天才跑一次，
 * 而且只有周日到周四）。见 outage-ledger.ts 顶部那段。
 */
const AI_ACCOUNT_GUIDE: Record<
  string,
  { kind: ManualItemKind; what: string; how: string; href: string }
> = {
  account_exhausted: {
    kind: 'ai_provider_exhausted',
    what: 'AI 文字账户的钱用完了 —— 这把钥匙全站在用：写内容、判客户到哪一步了、读通话记录、做 AI 可见度体检，全都会安静地跳过，看上去像「今天没什么发现」',
    how: '打开链接 →「Add to credit balance」→ 充值（这是我们生成文字用的账户，跟出片那个不是同一个）。不确定充多少就回我一句「算一下烧了多少」，我按最近 30 天的真实用量给你一个数再充。充完也回我一句，我把这几天被跳过的活儿重跑一遍',
    href: 'https://platform.openai.com/settings/organization/billing/overview',
  },
  credential_invalid: {
    kind: 'ai_provider_exhausted',
    what: 'AI 文字账户的那把钥匙不认了（被撤销或过期）—— 全站用到 AI 的地方都在安静地跳过，跟没钱时的表现一模一样',
    how: '打开链接 →「Create new secret key」→ 名字随便填 → 复制。**别把它贴在聊天里**，直接去 Render 后台（dashboard.render.com → 服务 → Environment）把 OPENAI_API_KEY 这一项的值换成新的 → Save。换完回我一句，我把这几天被跳过的活儿重跑一遍',
    href: 'https://platform.openai.com/api-keys',
  },
  gateway_auth_failed: {
    kind: 'ai_gateway_broken',
    what: 'AI 调用卡在中间那道 Cloudflare 关口上了 —— **不是 OpenAI 的问题，你去 OpenAI 后台查不出任何东西**。全站用到 AI 的地方都在安静地跳过',
    how: '这条不用你动手 —— 是我们这边的网关令牌过期了。回我一句「换网关令牌」我就去换；不说的话它会一直这么空着',
    href: 'https://dash.cloudflare.com',
  },
}

async function pushProviderOutageItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
): Promise<void> {
  const query = await readRecentOutages(makeSupabaseOutageReader(supabase), now)
  items.push(...buildProviderOutageItems(query, now))
}

/**
 * 从断电记录造待办 —— 纯函数，可完全单测（这是验收条件 1 的落点）。
 */
export function buildProviderOutageItems(query: OutageQuery, now: Date): ManualItem[] {
  const items: ManualItem[] = []
  const { rows, error } = query

  // 🔴 「查不了」绝不能长得跟「一切正常」一样 —— 那正是这张卡存在的原因。
  //    表没建 / 权限不对 / 查询挂了，都必须有人看见，否则这套告警瞎了也没人知道
  //    （memory: monitoring-writer-silent-failure-inverts-health-check）。
  if (error) {
    items.push({
      kind: 'ai_alerting_broken',
      client_id: 'infra',
      client_name: 'Magic Engine 后台',
      what: `「AI 账户断电」的告警自己读不出来了（${error.slice(0, 160)}）—— 现在不报警**不等于**没事，等于这只眼睛瞎了`,
      how: '这条不用你动手 —— 是我们这边的欠账（记录表没建好或权限不对）。回我一句「修一下断电告警」我就去修',
      href: '',
    })
    return items
  }

  const today = utcDate(now)
  const byReason = new Map<string, { dates: string[]; detail: string | null }>()
  for (const r of rows) {
    const key = `${r.provider}::${r.reason}`
    const g = byReason.get(key) ?? { dates: [], detail: null }
    g.dates.push(r.outage_date)
    if (r.outage_date === today || g.detail === null) g.detail = r.detail
    byReason.set(key, g)
  }

  for (const [key, g] of byReason) {
    const streak = streakDays(g.dates, today)
    const sinceLatest = daysSinceLatest(g.dates, today)
    if (!shouldRemindToday(streak, sinceLatest, now)) continue
    const reason = key.split('::')[1] ?? ''
    const guide = AI_ACCOUNT_GUIDE[reason]
    // 认不出来的新失败形态照样下发 —— 说不清楚也好过不说。
    // 供应商原话一起带上（截断），否则 PM 只看到一个代号，连问我第二遍都没法问。
    const raw = (g.detail ?? '').trim()
    const what =
      guide?.what ??
      `AI 供应商报了一个我们还没见过的账户级问题（${reason}）—— 全站用到 AI 的地方可能在安静地跳过${raw ? `。供应商原话：${raw.slice(0, 160)}` : ''}`
    // 已经好了的那种（最近一次不是今天）要说清是哪天，别让人以为现在还坏着
    const when =
      sinceLatest !== null && sinceLatest > 0
        ? `${sinceLatest} 天前断过一次（现在看起来已经恢复）`
        : streakPhrase(streak)
    items.push({
      kind: guide?.kind ?? 'ai_provider_exhausted',
      client_id: 'infra',
      client_name: 'Magic Engine 后台',
      what: `${when}：${what}`,
      how: guide?.how ?? '回我一句「查一下 AI 账户」，我去看供应商后台具体报的是什么',
      href: guide?.href ?? '',
    })
  }
  return items
}

/** Render 后台首页 —— 稳定入口，登录后一定打得开（不是会 404 的深链）。 */
const RENDER_DASHBOARD_URL = 'https://dashboard.render.com'

/**
 * 「任务该跑没跑」按调度方给不同的动手指引。
 *
 * 三件套里的 how / href 必须**对得上真实系统**：让人去 Render 找一个由 GitHub 或
 * Inngest 调度的任务，他会翻半天再回来问 —— 等于这条待办没下发好。
 */
const CRON_STOPPED_GUIDE = {
  render: {
    how: '打开链接 → 找到这几个服务 → 看 Events 里最后一次运行是什么结果。多半是 Environment 里没关联 me-shared-cron-secret，勾上再选「Link and apply on next run」即可',
    href: RENDER_DASHBOARD_URL,
  },
  'github-actions': {
    how: '打开链接 → Actions 页找到同名的工作流 → 看最近几次是不是被跳过或报错。GitHub 的免费定时任务经常延迟几小时，但连着几天没有记录就是真停了；可以先点 Run workflow 手动跑一次确认',
    href: 'https://github.com/bigbigraydeng-maker/magic-engine/actions',
  },
  inngest: {
    how: '打开链接 → 进 Production 环境 → Apps → 找到 magic-engine-web，点 Sync 一次（地址是 https://app.magicengine.com.au/api/inngest）。新增函数或改了触发时间之后必须手动同步一次，否则它安静地不跑；同步完在 Functions 里能看到就对了',
    href: 'https://app.inngest.com',
  },
  external: {
    how: '这几个的定时器**不在我们代码仓库里**，是有人在 Render 后台手工建的 —— 打开链接 → 在服务列表里按名字找 → 看它还在不在、Events 里最后一次跑成什么样。如果整条被删了，回我一句我把它接回代码里管',
    href: RENDER_DASHBOARD_URL,
  },
} as const

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
  // 🔴 体检整体挂掉时**不能什么都不报**。原来是 `.catch(() => null); if (!r) return` ——
  //    于是「40 个自动任务的体检自己坏了」跟「40 个全部正常」长得一模一样，
  //    正是这个文件存在要消灭的那种静默。
  const r = await checkCronHealth(supabase, now).catch((e: unknown) => {
    items.push({
      kind: 'ai_alerting_broken',
      client_id: 'infra',
      client_name: 'Magic Engine 后台',
      what: `自动任务的体检自己跑挂了（${(e instanceof Error ? e.message : String(e)).slice(0, 160)}）—— 今天**没有任何**「任务停了/卡死/报错」的检查结果，不报警不等于一切正常`,
      how: '这条不用你动手 —— 是我们这边的查询挂了。回我一句「修一下任务体检」我就去修',
      href: '',
    })
    return null
  })
  if (!r) return

  const stopped = [...r.neverRan, ...r.overdue]
  if (stopped.length > 0) {
    // 🔴 按**谁在调度它**分组下发。原来一律写「打开 Render → 找到这几个服务」，
    //    但清单里已经有不是 Render 调度的任务（GitHub Actions / Render 后台手工建 /
    //    Inngest 自带定时器）—— 照着那条指引去 Render 找一个根本不存在的服务，
    //    等于把人支到错的系统里，正是 CLAUDE.md 说的「下发了但没法照做」。
    const bySvc = new Map(CRON_REGISTRY.map((e) => [e.service, e.scheduler ?? 'render']))
    const groups = new Map<string, string[]>()
    for (const h of stopped) {
      const who = bySvc.get(h.service) ?? 'render'
      groups.set(who, [...(groups.get(who) ?? []), h.service])
    }
    for (const [who, names] of groups) {
      const guide = CRON_STOPPED_GUIDE[who as keyof typeof CRON_STOPPED_GUIDE] ?? CRON_STOPPED_GUIDE.render
      items.push({
        kind: 'cron_not_running',
        client_id: 'infra',
        client_name: 'Magic Engine 后台',
        what: `${names.length} 个自动任务该跑没跑：${names.join('、')} —— 它们负责的活儿现在没人干，而且不会自己好`,
        how: guide.how,
        href: guide.href,
      })
    }
  }

  // 卡死跟「该跑没跑」是两件事，不能合成一条：那边是**没开始**（多半是 Render 侧配置），
  // 这边是**开始了没结束**（进程被杀 / 卡在某个外部调用上），下一步动作完全不同。
  // 两边都接不住它：failing 只认 status='failed'，可容器被杀时路由的 catch 根本没机会跑；
  // overdue 看 started_at，而卡死的任务开跑记录是有的。所以跑死的任务在体检里等于健康。
  if (r.stuck.length > 0) {
    // 🔴 `r.stuck` 已经在 health.ts 里**按服务聚合过**，所以 `.length` 说的是
    //    「几个任务」而不是「几条记录」。不聚合的话 attribution-cron 一家 4 条孤儿行
    //    会被渲染成「4 个自动任务卡死」，是个会骗人的数（魏征 2026-09-23 复审）。
    const names = r.stuck
      .map((s) => {
        const dur = s.minutesRunning >= 120 ? `${Math.round(s.minutesRunning / 60)} 小时` : `${s.minutesRunning} 分钟`
        const rounds = s.rounds > 1 ? `，48 小时里卡了 ${s.rounds} 轮` : ''
        return `${s.service}（已卡 ${dur}${rounds}）`
      })
      .join('、')
    items.push({
      kind: 'cron_stuck',
      client_id: 'infra',
      client_name: 'Magic Engine 后台',
      what: `${r.stuck.length} 个自动任务开跑了但一直没结束：${names} —— 这类不会报错，它就那么挂着，那一轮该干的活儿等于没干`,
      how: '这条不用你动手 —— 是我们代码里的欠账（某段外部调用没有超时保护）。回我一句「查一下卡死的那几个」我就去看 Logs 停在哪一步、补上超时',
      href: RENDER_DASHBOARD_URL,
    })
  }

  // 最近一次是**报错**结束的。`health.ts` 从 2026-09-06 就算出了这一类，
  // 但 `pushCronHealthItems` 里一次都没用过 —— 算完只去了一个没人天天开的看板页
  // 和一封每天没人细看的邮件。这条把它接上（铁律 3 下半：发现不许死在日志里）。
  //
  // 合成一条，不是一个任务一条：9-22 那天今日待办一共 170 条，
  // 真告警就是这么被淹死的。
  if (r.failing.length > 0) {
    const names = r.failing.map((f) => f.service).join('、')
    // 🔴 不把原始报错贴进来：它可能带客户 id 和一长串英文技术串，
    //    跟隔壁那封日报的头注（"no client_ids, no raw error strings"）守同一条线。
    //    具体错误在链接里那个页面上，要看的人点进去看。
    items.push({
      kind: 'cron_failing',
      client_id: 'infra',
      client_name: 'Magic Engine 后台',
      what: `${r.failing.length} 个自动任务最近一次是报错结束的：${names} —— 它们负责的活儿这一轮没干成`,
      how: '这条不用你动手 —— 多数是我们代码或某个外部账号的问题。回我一句「查一下报错的那几个」我就逐个看是代码要改、还是哪个账号要你去续费/重新授权',
      href: 'https://app.magicengine.com.au/dashboard/admin/cron-health',
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

/** meta-leads-sync 跑得多稀 —— 超过这个窗口就是这条最新记录已经过期，别再报旧问题。 */
const MAILCHIMP_EXPORT_STALE_HOURS = 6

/** 只挑「非预期」失败：配置读不出来 / API key 失效 / audience 找不到 / 限流 / provider 5xx。 */
function isMailchimpExportFailureKey(key: string): boolean {
  return (
    key.startsWith('failed:') ||
    key === 'skipped:client_config_read_failed' ||
    key === 'skipped:source_tag_read_failed' ||
    // 人进了名单但来源标签没补上 —— 会员关系是真的，广告归因证据却没落地。
    // 不报的话，这一整类失败又只剩「看起来一切正常」。
    key.startsWith('already_member:tag_failed:')
  )
}

/**
 * Mailchimp 出口在 `meta-leads-sync` 每小时的 tally 里非预期失败 → 下发。
 *
 * 为什么必须下发：`lib/meta/leads-sync.ts` 把每条 lead 的 Mailchimp 结果压进
 * `results[].mailchimp` tally，但 tally 从不写进 `results[].error`——
 * `summariseFailures`（`lib/meta/leads-sync-alert.ts`）读不到它，cron 整体
 * 照样标 completed。真实事故：`clients.mailchimp_audience_id` 那一列没 apply
 * 到生产，出口每小时都因为 `client_config_read_failed` 静默 skip 掉，连着
 * 一个月没人发现（见 `lib/mailchimp/audience-config.ts` 文件头）。
 *
 * 只报 `failed:*` 和 `client_config_read_failed`：`no_audience_config` /
 * `no_email` / `no_api_key` 是客户压根没配 Mailchimp 的正常状态，报了等于
 * 天天骚扰不用管的人。
 *
 * 🔴 **不能只挑 `status = 'completed'`**：`meta-leads-sync/route.ts` 只要有
 * 任一客户 Meta 取数报错，就会把 `summariseFailures` 的结果传给 `finish()`
 * 的 `error`，`run-logger.ts` 因此把这一整轮标成 `failed` —— 但同一轮里其他
 * 客户的 `results[].mailchimp` 完全可能是真实的出口故障。只查 `completed`
 * 会让这些故障在 Meta 取数一出错的那些轮次里彻底消失。排除运行中记录该看
 * `finished_at` 是否非空，而不是硬编码某一个终态。
 */
export async function pushMailchimpExportItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
): Promise<void> {
  const { data, error } = await supabase
    .from('cron_run_logs')
    .select('finished_at, summary')
    .eq('job_name', 'meta-leads-sync')
    .not('finished_at', 'is', null)
    .in('status', ['completed', 'failed'])
    .order('finished_at', { ascending: false })
    .limit(1)

  if (error) throw new Error(`cron_run_logs query failed: ${error.message}`)

  const run = (data ?? [])[0] as
    | {
        finished_at: string | null
        summary: {
          results?: Array<{ clientId: string; clientName: string | null; mailchimp?: Record<string, number> }>
        } | null
      }
    | undefined
  if (!run?.summary) return

  const hoursOld = run.finished_at ? (now.getTime() - Date.parse(run.finished_at)) / 3_600_000 : null
  if (hoursOld !== null && hoursOld > MAILCHIMP_EXPORT_STALE_HOURS) return

  for (const r of run.summary.results ?? []) {
    const badKeys = Object.entries(r.mailchimp ?? {}).filter(([k]) => isMailchimpExportFailureKey(k))
    if (badKeys.length === 0) continue

    const total = badKeys.reduce((n, [, count]) => n + count, 0)
    const detail = badKeys.map(([k, count]) => `${k.replace(/^(failed|skipped):/, '')} ×${count}`).join('、')

    items.push({
      kind: 'mailchimp_export_broken',
      client_id: r.clientId,
      client_name: r.clientName ?? '未知客户',
      what: `这个客户有 ${total} 条 lead 本该进 Mailchimp 邮件名单，但出口坏了没进去：${detail}。不会自己好，客户的邮件名单会一直缺这些人`,
      how: '点链接进设置页，看「Meta 广告线索送进哪个 Mailchimp 名单」那一栏 —— 空了就把 Mailchimp 里的 Audience ID 填回去（Mailchimp → Audience → Settings → Audience name and defaults 最下面那串）；那一栏是对的话就不是配置问题，回我一句我去查授权和限流',
      href: `https://app.magicengine.com.au/dashboard/clients/${r.clientId}/settings`,
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
export async function pushPriceGateItems(
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

    // href 要指到「这张图真的能改」的地方——素材库页面只操作 client_assets，
    // 不是这条闸真正查的表。图必须在素材库里才有「改来源」这个动作可点；
    // 不在库里（比如纯 AI 生成、从没进过素材库）就没有素材库能改，那条选项对
    // PM 来说是死链接，只剩「把价格去掉」这一条路是真能做的。
    const { data: libraryRow } = await supabase
      .from('client_assets')
      .select('id')
      .eq('client_id', post.client_id)
      .eq('storage_url', storageUrl)
      .limit(1)
      .maybeSingle()
    const libraryAssetId = (libraryRow as { id: string } | null)?.id

    items.push({
      kind: 'price_claim_unbacked',
      client_id: post.client_id,
      client_name: nameOf(post.client_id),
      what:
        `帖子「${post.title ?? post.id}」已审批但发不出去 —— 文案里写了价格，` +
        `配图来源是「${SOURCE_LABELS[verdict.source]}」。真实价格只能配真实画面，` +
        '客人按图下单拿到的东西对不上，投诉算客户的。',
      how: libraryAssetId
        ? '两条路选一条：① 最快 —— 把价格从文案里去掉；' +
          '② 如果那张图确实是客户实拍，点这个链接会直接跳到那张图，把来源改成「客户实拍（已确认）」，再回来重发。'
        : '这张图不在素材库里（不是客户实拍上传的，多半是系统自动生成的），没法回去"确认成客户实拍"——' +
          '唯一能做的是把价格从文案里去掉，再重发。',
      href: libraryAssetId
        ? `https://app.magicengine.com.au/dashboard/clients/${post.client_id}/assets?highlight=${libraryAssetId}`
        : `https://app.magicengine.com.au/dashboard/clients/${post.client_id}/execution`,
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

/**
 * 一次性 client ops 请求（写在客户方案文档里、只对某个日期有效）——
 * 只登记在文档里等于没下发（CLAUDE.md 铁律 3 下半：管道不许断头）。
 *
 * 与 PLATFORM_CANDIDATE_REVIEWS 同样是"纯本地日期判断，不落库"，但语义不同：
 * 那边是"到期该做"，这里是"过期就不用再提醒"——用 `expiresAt` 而不是 `dueDate`。
 * 过了 `expiresAt` 不用回来删这一行，判据本身会让它自然消失。
 *
 * 任务清单本身在 `client-doc-manual-tasks.ts`（同 platform-candidate-reviews.ts
 * 的分离方式）：这里只留通用加载逻辑，客户特例数据不进这份共享运行时文件。
 */
export function pushClientDocManualTaskItems(
  items: ManualItem[],
  now: Date,
  tasks: ClientDocManualTask[] = CLIENT_DOC_MANUAL_TASKS,
): void {
  for (const t of tasks) {
    if (now.getTime() > Date.parse(t.expiresAt)) continue
    items.push({
      kind: 'client_doc_manual_task',
      client_id: t.clientId,
      client_name: t.clientName,
      what: t.what,
      how: t.how,
      href: t.href,
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
/** 渠道代号 → 人话名字，不在 what 字段里出现 `messenger`/`whatsapp` 这种没解释过的裸词。 */
function conversationChannelLabel(channel: string): string {
  if (channel === 'messenger') return 'Facebook Messenger'
  if (channel === 'whatsapp') return 'WhatsApp'
  return channel
}

/** check_type 代号 → 人话问题描述（不把代号本身抛给 PM/FDE）。 */
function conversationHealthProblemLabel(checkType: string): string {
  switch (checkType) {
    case 'webhook_silent':
      return '收到的客户消息量突然明显变少，像是接收链路安静地断了'
    case 'verifier_block_rate_high':
      return 'AI 写的回复大多被系统自己拦下，没能发出去'
    case 'verifier_error_rate_high':
      return 'AI 起草回复这一步一直在报错'
    case 'optout_write_failed':
      return '客户说了「别再联系我」，但系统记这件事时失败了'
    default:
      return '心跳检查发现异常'
  }
}

/** check_type 代号 → 该先查什么（跟 issue #1587 原文四类问题一一对应）。 */
function conversationHealthHowLabel(checkType: string, channelLabel: string): string {
  switch (checkType) {
    case 'webhook_silent':
      return `先看 ${channelLabel} 那边的官方后台连接状态是不是掉了；如果连接正常，也可能这段时间客户确实没人来问，看一眼对话记录再判断`
    case 'verifier_block_rate_high':
      return '打开对话看几条被拦下的草稿——多半是客户资料库里的信息（团期/价格）过期了，或者 AI 理解错了客户的问题'
    case 'verifier_error_rate_high':
      return 'AI 起草回复这一步在报错，这不是你能直接修的，回一句「AI 报错」我去查'
    case 'optout_write_failed':
      return '先打开对话确认这几位客户有没有在被继续联系；需要的话在他们的记录里手动写一句「客户说别再联系」，系统会立刻停掉所有渠道'
    default:
      return '打开对话看一下最近发生了什么'
  }
}

interface ConversationHealthAlertRow {
  client_id: string
  channel: string
  check_type: string
  detail: string
  first_detected_at: string
}

/**
 * 私信客服健康心跳（issue #1587）查出的异常——拉模式，直接查
 * `conversation_health_alerts`：这张表本身就是「现在正在报警的问题」，健康了
 * 心跳函数自己会把行删掉，这里不需要再按时间过滤。
 */
async function pushConversationHealthAlertItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  nameOf: (id: string) => string,
): Promise<void> {
  const { data, error } = await supabase
    .from('conversation_health_alerts')
    .select('client_id, channel, check_type, detail, first_detected_at')
  if (error) throw new Error(error.message)

  for (const row of (data ?? []) as ConversationHealthAlertRow[]) {
    const channelLabel = conversationChannelLabel(row.channel)
    const firstDetectedMs = Date.parse(row.first_detected_at)
    const hoursOngoing = Number.isNaN(firstDetectedMs)
      ? null
      : Math.max(0, Math.floor((now.getTime() - firstDetectedMs) / 3_600_000))
    const durationText =
      hoursOngoing === null
        ? ''
        : hoursOngoing < 24
          ? `，已经持续 ${hoursOngoing} 小时没恢复`
          : `，已经持续 ${Math.floor(hoursOngoing / 24)} 天没恢复`

    items.push({
      kind: 'conversation_health_alert',
      client_id: row.client_id,
      client_name: nameOf(row.client_id),
      what: `${channelLabel} 私信客服：${conversationHealthProblemLabel(row.check_type)}${durationText}（${row.detail}）`,
      how: conversationHealthHowLabel(row.check_type, channelLabel),
      href: `https://app.magicengine.com.au/dashboard/clients/${row.client_id}/messenger`,
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
export async function pushFactoryWorkerItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  /** 客户名查表 —— 待办要说清是哪个客户的活卡了，显示 uuid 等于没显示。 */
  clientNames: Map<string, { name: string }>,
): Promise<void> {
  // 真实列名（已核实）：status / created_at / heartbeat_at / reject_reason
  // 🔴 `reject_reason` 必须一起读：余额不足时 worker 把工单退回 queued 而不是
  //    标 failed，只数「队列里有几个」会把「失败后卡住的僵尸工单」误当成「等人干的新活」。
  const { data: queuedRows } = await supabase
    .from('content_work_orders')
    .select('id, client_id, created_at, reject_reason')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
  const queued = (queuedRows ?? []) as Array<{
    id: string
    client_id: string
    created_at: string
    reject_reason: string | null
  }>
  if (queued.length === 0) return

  // 心跳按客户查 —— 判定层解释了为什么不能用全局最新的（judgeQueueByClient 头注）。
  const clientIds = Array.from(new Set(queued.map((q) => q.client_id)))
  const latestHbByClient = new Map<string, string>()
  for (const clientId of clientIds) {
    // A busy client's history must not crowd another client's latest heartbeat out of a global limit.
    const { data: hbRows, error: hbError } = await supabase
      .from('content_work_orders')
      .select('heartbeat_at')
      .eq('client_id', clientId)
      .not('heartbeat_at', 'is', null)
      .order('heartbeat_at', { ascending: false })
      .limit(1)
    if (hbError) throw new Error(`factory heartbeat query failed: ${hbError.message}`)
    const latest = (hbRows ?? [])[0] as { heartbeat_at: string } | undefined
    if (latest) latestHbByClient.set(clientId, latest.heartbeat_at)
  }

  // 一个客户一条：不同客户的 worker 在线状态是独立的，合成一条会把两种
  // 完全不同的处置（这家去开机 / 那家去查报错）搅在一起。
  for (const { clientId, verdict } of judgeQueueByClient(queued, latestHbByClient, now)) {
    pushOneFactoryWorkerItem(items, verdict, clientNames.get(clientId)?.name ?? '未知客户')
  }
}

/** 把一条工人待办写出来。两种病因两套话术，别混。 */
function pushOneFactoryWorkerItem(
  items: ManualItem[],
  verdict: Exclude<ReturnType<typeof judgeWorkerPresence>, { idle: true }>,
  clientName: string,
): void {
  const who = `【${clientName}】`

  // 两种病因，两套话术。判定层已经保证：`stuck_on_failure` 只在工人**在线**时
  // 产生（离线一律先报 worker_offline，因为开机是那种情况下无条件正确的第一步）。
  if (verdict.kind === 'stuck_on_failure') {
    items.push({
      kind: 'factory_worker_idle',
      client_id: 'infra',
      client_name: 'Magic Engine 后台',
      what:
        `${who}${verdict.humanReason}` +
        (verdict.sampleReason ? `。系统报的原因：「${verdict.sampleReason}」` : ''),
      // 🔴 这里**不能**写成「先观察下一次重试」（Codex P2 复审）。
      //    `factory/worker/[id]/fail` 把可重试失败直接退回 `queued`，**没有任何
      //    退避字段**（`next_retry_at` 只存在于 publish-worker，那是另一条线），
      //    所以失败工单立刻就能被重新领走。工人在线还卡了 6 小时以上，重试早
      //    该发生了 —— 「在等重试」不是这里的合理解释，确实需要人看一眼。
      //    话术必须给真动作，否则这条进了「需要你动手」栏却让人干等，等于
      //    制造一条假待办。
      how:
        '工人在线、活却过不去，重试早该发生了（失败退回队列是立刻可重领的，没有等待期）—— ' +
        '先看上面那句报错：写着余额不足（credit / balance）就去充值，充完它会自己被重新领走；' +
        '写的是别的原因，回我一句「出片工单卡住了」，我去查',
      href: 'https://app.magicengine.com.au/dashboard/factory',
    })
    return
  }

  // worker_offline：开机是第一步。这些活如果失败过，把原因一并带上 ——
  // 开机后还是过不去时，那就是下一步该看的东西（但绝不因此劝阻开机：
  // 带 reject_reason 的 queued 工单通常还有重试机会，重试恰恰要靠工人上线）。
  items.push({
    kind: 'factory_worker_idle',
    client_id: 'infra',
    client_name: 'Magic Engine 后台',
    what:
      `${who}${verdict.humanReason} —— 出片这一步跑在你那台 Mac 上，它不开机就没人做` +
      (verdict.sampleReason
        ? `。另外这些工单上次失败过，系统报的原因是：「${verdict.sampleReason}」`
        : ''),
    how:
      '在那台 Mac 上跑 `node scripts/factory-worker/worker.mjs --loop`，它会自己把排队的活领走。' +
      (verdict.sampleReason
        ? '开机之后如果这些工单还是过不去，就是上面那条原因（写着余额不足就去充值），回我一句我来查。'
        : '') +
      '如果你希望这事不再依赖某一台机器，回我一句，我们单独排',
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
