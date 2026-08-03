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
  | 'video_credits_out'
  | 'cron_not_running'
  | 'cron_blind'
  | 'goal_baseline_mismatch'
  | 'diagnostic_findings'

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
import { auditGoalBaselines } from '@/lib/strategy/baseline-audit'

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
    if (verdicts[i].kind === 'broken') {
      dropped.push(it)
      console.warn(`[manual-items] 链接打不开,本条不下发: ${it.kind} ${it.href}`)
    } else {
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
  // 基础设施类检查要放在这条提前返回**之前**：新建的 cron 有没有接上密钥，
  // 跟系统里有几个客户毫无关系。放在后面的话，客户表一空它就被跳过了。
  await appendNeverRanCrons(supabase, items)
  // 出片余额用完 —— 只有人能充值，必须当天摆到眼前，不能烂在工单的 error 字段里
  await pushVideoCreditsItem(supabase, items, now)
  // 按时没跑 / 查不出跑没跑 —— PM 2026-08-03 要求「不能完成需要有报错」
  await pushCronHealthItems(supabase, items, now)
  // 目标数字口径对不上 —— 错的方向感比没数字更危险(2026-08-03 差点据此给出反向建议)
  await pushBaselineItems(supabase, items)
  if (clients.size === 0) return items

  const ids = Array.from(clients.keys())
  const nameOf = (id: string) => clients.get(id)?.name ?? '未知客户'

  // 新诊断结果 —— PM 2026-08-03 拍板要逐条看；没有消费方的自动化 = 再造一个没人看的数据源。
  // 必须放在 nameOf 定义之后：待办上显示 uuid 等于没显示。
  await pushDiagnosticItems(supabase, items, now, nameOf)

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
      what: `本周体检查出 ${counts}问题。最要紧的一条：${v.top}`,
      how: '打开链接看完整诊断报告，挑要处理的告诉我，能自动做的我直接做掉',
      href: `https://app.magicengine.com.au/dashboard/clients/${clientId}/diagnostic`,
    })
  }
}
