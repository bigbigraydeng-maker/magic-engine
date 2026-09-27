/**
 * PM daily to-do email (22.E.S18 前置 · 滚动排班).
 *
 * One short email every NZ weekday morning: today's pillar theme (rolling
 * Mon-Fri schedule the PM signed off 2026-07-31) plus LIVE counts of things
 * actually awaiting him — blog drafts to review, fresh patrol findings,
 * recent pending kanban cards, cron failures. Sections with zero items are
 * omitted; a quiet day sends a one-line all-clear so the rhythm stays daily.
 *
 * Deliberately narrow: counts only cover the FDE focus clients (CTS/Oztop)
 * and only recent items — the kanban holds 400+ historical pending cards
 * that would drown the signal (backlog cleanup is its own task).
 *
 * PM-facing copy is plain Chinese, zero jargon (CLAUDE.md § 跟 PM 说话的格式).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  loadManualItems,
  dropBrokenLinks,
  type ManualItem,
  type ManualItemKind,
} from './manual-items'
import { sharedLinkVerdictCache } from './action-link'

/**
 * 这些是**知会**，不是待办 —— 单独一栏，也不计进「今天有几件事」。
 * 判断标准：PM 不动手也不会出事。会出事的一律留在「需要你动手」那栏。
 *
 * 2026-09-07 `diagnostic_findings` 挪进来：跟 SEO 巡逻发现是同一条纪律 ——
 * 本周体检查到的严重问题**已经**由每周方案自动排成了执行看板的建议卡
 * （见 manual-items.ts:1741-1758 how 原文「不用你挑」），本就不是要 PM
 * 单独动手处理的事，之前算进「今天有几件事」是口径 bug（跟 91 那次
 * 「巡逻发现被数两遍」是同一类错，PM 2026-08-04 拍板）。
 */
const INFORMATIONAL_KINDS: ManualItemKind[] = ['prescription_updated', 'diagnostic_findings']

/**
 * 这些条目的 how 字段自己都写着「回我一句我去改」/「回我一句我去查」——
 * 本质是**我们代码 / 基础设施的欠账**，不是 PM 该动手的活，之前塞进
 * 「🙋 需要你动手」栏是把 dev 的活假装成 PM 的活（每天骚扰 PM 一遍，
 * PM 也没法真的做，只能转给 Ray/dev）。挪进单独一栏「🛠 系统欠账」：
 *
 *   - 不进 `totalItems`（不算 PM 的活）
 *   - 单独渲染成一节，标题写清「不影响你 · Ray 转给 dev 就好」
 *   - 保留可见性 —— 铁律 3 下半「发现不许死在日志里」照样满足，
 *     只是这栏不再算作要 PM 处理的待办
 *
 * 后续正确形态是自动开 GitHub issue / spawn dev-task，但那需要另立项
 * （所有权分配 / 去重 / 关闭跟踪）；本次先做管道分流，别让"应该由 dev
 * 修的 bug"每天早上都到 PM 的动手栏里刷屏。
 */
const DEV_OWNED_KINDS: ManualItemKind[] = [
  // auto-run cron 三次都失败停手 → how 自己写「回我一句「查一下这条」我去看」
  'auto_run_stuck',
  // 归因黑洞三个子情况（cross_flywheel / scope_mismatch / scope_skip）→
  // how 全是「这条不用你动手 —— 是我们这边把指标配到了错的战线... 回我一句我去改」
  'action_unattributable',
  // 归因 audit 查询挂了 → how 写「这条不用你动手 —— 是我们这边查询挂了」
  'attribution_audit_failed',
  // 读客户表失败 → how 写「这条不用你动手 —— 是我们这边读客户表失败了」
  'client_list_unreadable',
  // cron 接口没接 startCronRun → how 写「这条不用你动手 —— 是我们代码里的欠账」
  // 当前 registry 里全部 logsRuns=true，这条实际为空；新增 CI 守卫
  // （cron-registry-logs-runs.test.ts）阻止未来回归。留在 DEV_OWNED_KINDS 作为
  // 双保险：万一 CI 漏了，运行时也不再往 PM 邮件的「需要你动手」里塞。
  'cron_blind',
  // 自动任务跑到一半卡死 → how 写的是「回我一句『查一下卡死的那几个』」。
  // 孤儿行没有任何代码会回头改好，PM 做什么都不会让它消失（它只会在 48 小时后
  // 滑出窗口）—— 放在 PM 的动手栏里等于每天给他一件做不了的事。
  'cron_stuck',
  // 自动任务最近一次报错 → how 写的是「回我一句『查一下报错的那几个』」。
  // 「某任务抛了个异常」PM 没法直接动手，得先有人诊断是代码问题还是账号问题。
  'cron_failing',
  // 广告回拉读不出广告配置 → how 写的是「回我一句『查一下广告配置』」。
  // 数据库对不上代码是我们的欠账，PM 没法动手。
  'ads_config_unreadable',
  // 「AI 断电告警自己读不出来了」→ how 写的是「回我一句『修一下断电告警』」。
  // 🔴 注意：真的断电那条（ai_provider_exhausted）**不在这里** ——
  //    那条只有 PM 能处理（去充钱 / 换钥匙），必须留在动手栏。
  'ai_alerting_broken',
  // 「AI 卡在 Cloudflare 网关那一层」→ how 写的是「回我一句『换网关令牌』」。
  // 跟真断电（ai_provider_exhausted）分成两个 kind 就是为了这一刻：
  // 那条要 PM 去充钱 / 换钥匙，这条只有我们能换令牌。
  'ai_gateway_broken',
  // 经验手册（Claude 持久记忆，不在仓库）里点名的代码引用疑似过期——
  // 「这句话要不要改」是技术判断，不是 PM 该做的业务决策，how 字段同样是
  // 「回我一句我去查」的话术。见 playbook-staleness-items.ts。
  'playbook_reference_stale',
  // 「这个平台所有客户一起没了心跳」→ how 写的是「回我一句我去查」。
  // 全部一起停说明是我们这边的取数任务停了，PM 去重连一百次也不会好。
  // 🔴 注意：单条断线（platform_connection_broken / _silent / _scope_gap）
  //    **不在这里** —— 那几条只有人能去点一次同意页，必须留在动手栏。
  'platform_connection_pipeline_down',
  // 「授权体检自己读不出来了」→ 同上，是我们这边的欠账。
  'platform_connection_check_failed',
  // 「连上了但这个客户不在取数名单里」→ 缺的是配置不是授权，重连也没用。
  'platform_connection_not_enrolled',
  // 「这个平台后台还没有让 PM 自助重连的按钮」→ 给他一件点不到按钮的活比不报还糟。
  'platform_connection_no_reconnect_ui',
  // 「连接挂在查不到的客户名下」→ 要核对该断还是该改挂，是我们的活。
  'platform_connection_orphan',
  // 马良：自检检不了（模型钥匙没配 / 视频下载不了）、出片后没检（事件没发出去）——how 都是
  // 「回我一句我去看/去补」。**过关等审片、不过关问返工还是放弃那两条不在这里**，那是 PM 的活。
  'maliang_check_unverifiable',
  'maliang_check_missing',
  // 李白：溯源检不了（官网网址没配 / 读不到）、生成后没检（事件没发出去）、提示词库月检
  // 疑似过期——三条 how 都是「回我一句我去看/去补/去改」。**真有「未证实」句要改的那条
  // （libai_copy_unverified）不在这里**，那是 PM/FDE 要动手改文案的活。
  'libai_check_unverifiable',
  'libai_check_missing',
  'libai_prompt_library_stale',
  // 司马迁本周没巡成（读评价表失败 / 起草全失败）→ how 写「回我一句「查一下司马迁」我去看」。
  // 真有新评价要回的那条（simaqian_review_drafts）**不在这里**，那是 PM/FDE 要动手回评价的活。
  'simaqian_patrol_failed',
  // Meta 钥匙体检自己没跑成（客户表读不到 / 一把钥匙都问不到 Meta）→ how 写「回我一句我去修」。
  // 真有钥匙死了的那条（meta_token_dead）**不在这里**，只有人能重新授权。
  'meta_token_check_failed',
  // 「合进去的代码有没有上线」的检查自己没跑成 → how 写「回我一句我去修」。
  // 真没上线的那条（deploy_not_live）**不在这里**：修复要合，PM 得知道各窗口的「已上线」不算数。
  'deploy_check_failed',
]

/** FDE focus clients: CTS + Oztop. */
export const FOCUS_CLIENT_IDS = [
  'c0000000-0000-0000-0000-000000000000',
  'd5c98811-1c1d-4ded-bdf0-4cefec6afb84',
] as const

/** Pending kanban cards older than this many days are backlog, not to-do. */
const RECENT_CARD_DAYS = 7

const DASHBOARD_BASE = 'https://app.magicengine.com.au/dashboard/clients'

// ── Rolling weekday themes (PM 拍板 2026-07-31) ────────────────────────────────
// 口碑 (Wed) / 竞品 (Thu) slots take over when those pillars come online.
// Exported: the /dashboard/today page and the email render the SAME schedule.

export const DAY_THEMES: Record<number, { title: string; hint: string }> = {
  1: { title: '周报日', hint: '读周报邮件，把里面的「待点头」清单过一遍' },
  2: { title: 'Blog 审稿日', hint: '昨夜自动生成的草稿在等你审，改完点发布' },
  3: { title: 'SEO 发现日', hint: '看看巡逻员这周抓到的排名问题和机会' },
  4: { title: '广告 & 社媒日', hint: '扫一眼广告健康警报和社媒待批事项' },
  5: { title: '收尾日', hint: '清掉本周剩下的待办，下周一见周报' },
}

export interface TodoCounts {
  /**
   * One-off setup actions only a human can complete (OAuth consent screens).
   * Surfaced here so the PM/FDE never has to hunt for them in Settings —
   * these block whole pillars until done.
   */
  setupTasks: Array<{ name: string; id: string; label: string; href: string }>
  /** [{ name, id, drafts }] — clients with blog drafts awaiting review. */
  draftsByClient: Array<{ name: string; id: string; drafts: number }>
  /** [{ name, id, findings }] — clients with fresh patrol findings. */
  findingsByClient: Array<{ name: string; id: string; findings: number }>
  /** [{ name, id, cards }] — focus clients' pending kanban cards (recent only). */
  recentCardsByClient: Array<{ name: string; id: string; cards: number }>
  /** [{ name, id, reels }] — clients with factory clips awaiting review. */
  reelsByClient: Array<{ name: string; id: string; reels: number }>
  /** Things automation cannot finish — each carries what/how/link so a human
   *  can act without asking (PM 拍板 2026-08-01: 管道不许断头). */
  manualItems: ManualItem[]
  /** Cron runs that failed in the last 24h. */
  cronFailures24h: number
}

/** reels_drafts statuses that mean "a human needs to look at this". */
const REEL_REVIEW_STATUSES = ['video_ready', 'images_ready', 'in_review'] as const

const APP_BASE = 'https://app.magicengine.com.au'

/**
 * 板桥审：给 PM/FDE 看的 GBP 待办文案（含「用谁的账号」这个最易翻车点）。
 *
 * 2026-09-07 铁律 3 「遇卡点必自动化」落地：这条 setup 从前只覆盖商家页一个
 * scope，Ray 还得再单独点一次 Google Search Console / Analytics 授权 ——
 * 每客户要跳两遍 Google consent。合到 `/api/auth/google/connect` 之后，一次
 * 点完覆盖商家页 + Search Console + Analytics + 收录申请，同一个 Google 账号
 * 只跳一次；用户不用在同一个客户上二次授权。判据仍是 `client_connectors.gbp`
 * / `platform_oauth_connections.google_gbp` 上有活跃行 + location_name 有值，
 * 所以商家页仍然是这条待办的触发条件（有些客户没 GSC/GA4 也没关系）。
 */
const GBP_CONNECT_LABEL =
  '一次点完客户全部 Google 权限 · 约 1 分钟。覆盖商家页 + Search Console + Analytics + 收录申请，' +
  '同一个 Google 账号只跳一次同意页。连上后不会自动发东西，每条帖子仍要你点确认才发。' +
  '跳到 Google 后要用「能管理这家客户商家页的那个账号」登录 —— 通常是客户老板的账号，不是你自己的；' +
  '用错账号连不上，退出重来一次就行，不会弄坏任何东西。一般由 Ray 或客户老板本人点，FDE 看到转给 Ray 就行。'

const GBP_LOCATION_LABEL =
  'Google 商家页差最后一步：还没确认是哪一家门店（在确认前不会发任何内容）。' +
  '把客户名字和正确的门店名发给 Ray，我们指定一下，一般当天就能好。'

/**
 * Clients that still need a human on the Google Business Profile setup.
 *
 * "Should have GBP" is inferred from `gbp_place_id` — a client only gets that
 * field once we've confirmed they have a Google storefront (口碑监测身份).
 * So the list extends itself as more clients are configured; no hardcoded roster.
 *
 * TWO ways to be unfinished, and both must stay on the list (板桥 必改 3):
 *   1. no active connection at all → needs the consent click
 *   2. connected but `location_name` still null → we could not tell which
 *      storefront is theirs, so nothing will ever publish
 * Case 2 used to vanish from the to-do the next day (its row IS `active`),
 * leaving a dead pillar behind an "all clear" — the to-do would be lying.
 */
export async function loadGbpSetupTasks(
  supabase: SupabaseClient,
): Promise<TodoCounts['setupTasks']> {
  const [{ data: clients }, { data: connections }] = await Promise.all([
    supabase
      .from('clients')
      .select('id, name')
      .eq('client_status', 'active')
      .not('gbp_place_id', 'is', null),
    supabase
      .from('platform_oauth_connections')
      .select('client_id, status, location_name')
      .eq('provider', 'google_gbp'),
  ])

  const rows = (connections ?? []) as Array<{
    client_id: string
    status: string
    location_name: string | null
  }>

  /** Live connection AND pointed at a specific storefront = actually done. */
  const ready = new Set(
    rows
      .filter((c) => c.status === 'active' && (c.location_name ?? '').length > 0)
      .map((c) => c.client_id),
  )
  const connectedButUnlocated = new Set(
    rows
      .filter((c) => c.status === 'active' && !(c.location_name ?? '').length)
      .map((c) => c.client_id),
  )

  return ((clients ?? []) as Array<{ id: string; name: string }>)
    .filter((c) => !ready.has(c.id))
    .map((c) => ({
      name: c.name,
      id: c.id,
      label: connectedButUnlocated.has(c.id) ? GBP_LOCATION_LABEL : GBP_CONNECT_LABEL,
      href: connectedButUnlocated.has(c.id)
        ? `${APP_BASE}/dashboard/clients/${c.id}/settings`
        // combined flow: 一次授权覆盖 GBP + GSC + GA4 + Indexing（见 GBP_CONNECT_LABEL 头注）
        : `${APP_BASE}/api/auth/google/connect?client_id=${c.id}`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// ── Data loading ────────────────────────────────────────────────────────────────

export interface LoadTodoCountsOptions {
  /**
   * 链接闸整批最多等多久（毫秒），只给有人盯着转圈的 /dashboard/today 用。
   * 每日邮件不传，照旧等每条链接验完。见 dropBrokenLinks 的 budgetMs。
   */
  linkCheckBudgetMs?: number
}

export async function loadTodoCounts(
  supabase: SupabaseClient,
  opts: LoadTodoCountsOptions = {},
): Promise<TodoCounts> {
  // 人工待办跟下面的计数互不依赖，先开跑、跟计数同时进行（2026-09-26「loading 非常慢」）
  const rawManualItemsPromise = loadManualItems(supabase).catch((err: unknown) => {
    console.error('[pm-todo] manual items load failed:', err instanceof Error ? err.message : String(err))
    return [] as ManualItem[]
  })
  const cardCutoff = new Date()
  cardCutoff.setDate(cardCutoff.getDate() - RECENT_CARD_DAYS)
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // 🔴 在服务的客户名单 —— 待办里的每一条都必须限定在这些客户上。
  //    2026-08-04 PM 反馈「91 件，很多点进去办不了」，查下来最大一块就是这个：
  //    SEO 巡逻那一栏**完全没按客户过滤**，把 7-31 给 5 个潜在客户
  //    （Dixon Homes / IB Real Estate / mobile station / Sungenix / smiledental）
  //    生成的 26 条陈年发现也算了进来。巡逻本身早就只跑在服务的客户，
  //    所以这 26 条永远不会被刷新、也永远不会有人去做 —— 纯占数字。
  const { data: activeRows } = await supabase
    .from('clients')
    .select('id')
    .eq('client_status', 'active')
  const activeIds = ((activeRows ?? []) as Array<{ id: string }>).map((c) => c.id)
  // 一个在服务的客户都没有时用一个不存在的 id，避免 .in([]) 变成"不过滤"
  const activeFilter = activeIds.length > 0 ? activeIds : ['00000000-0000-0000-0000-000000000000']

  const [drafts, findings, cards, reels, failures, setupTasks] = await Promise.all([
    supabase
      .from('blog_posts')
      .select('client_id, clients(name)')
      .eq('status', 'draft'),
    supabase
      .from('seo_patrol_findings')
      .select('client_id, clients(name)')
      .eq('status', 'fresh')
      .in('client_id', activeFilter),
    supabase
      .from('execution_items')
      .select('client_id, clients(name)')
      .eq('status', 'pending')
      .in('client_id', [...FOCUS_CLIENT_IDS])
      .gte('created_at', cardCutoff.toISOString()),
    supabase
      .from('reels_drafts')
      .select('client_id, clients(name)')
      .in('status', [...REEL_REVIEW_STATUSES]),
    supabase
      .from('cron_run_logs')
      .select('id, status, failed_count')
      .gte('started_at', since24h),
    loadGbpSetupTasks(supabase),
  ])

  const countByClient = (
    rows: Array<{ client_id: string; clients: { name: string } | { name: string }[] | null }> | null,
  ): Map<string, { name: string; count: number }> => {
    const map = new Map<string, { name: string; count: number }>()
    for (const row of rows ?? []) {
      const rel = row.clients
      const name = (Array.isArray(rel) ? rel[0]?.name : rel?.name) ?? '未知客户'
      const entry = map.get(row.client_id) ?? { name, count: 0 }
      entry.count += 1
      map.set(row.client_id, entry)
    }
    return map
  }

  const toList = (map: Map<string, { name: string; count: number }>, key: 'drafts' | 'findings' | 'cards' | 'reels') =>
    Array.from(map.entries())
      .map(([id, v]) => ({ name: v.name, id, [key]: v.count }))
      .sort((a, b) => a.name.localeCompare(b.name))

  const rawManualItems = await rawManualItemsPromise
  // 链接打不开的不下发（PM 2026-08-03：「点过去就是 404，徒增我和 fde 的工作时间」）。
  // 闸本身出问题时原样放行 —— 少过滤好过整栏消失。
  // 页面读缓存 + 限时；没给时限的调用方（每日邮件）照旧每条现场验，结果写回缓存给页面用。
  const manualItems = await dropBrokenLinks(rawManualItems, undefined, {
    cache: sharedLinkVerdictCache,
    refreshCache: opts.linkCheckBudgetMs === undefined,
    budgetMs: opts.linkCheckBudgetMs,
  })
    .then((r) => r.kept)
    .catch(() => rawManualItems)

  const failedRuns = ((failures.data ?? []) as Array<{ status: string; failed_count: number | null }>)
    .filter((r) => r.status === 'failed' || (r.failed_count ?? 0) > 0)

  return {
    setupTasks,
    draftsByClient: toList(countByClient(drafts.data as never), 'drafts') as TodoCounts['draftsByClient'],
    findingsByClient: toList(countByClient(findings.data as never), 'findings') as TodoCounts['findingsByClient'],
    recentCardsByClient: toList(countByClient(cards.data as never), 'cards') as TodoCounts['recentCardsByClient'],
    reelsByClient: toList(countByClient(reels.data as never), 'reels') as TodoCounts['reelsByClient'],
    manualItems,
    cronFailures24h: failedRuns.length,
  }
}

// ── Email building (pure) ───────────────────────────────────────────────────────

export function nzWeekday(now: Date): number {
  // 0=Sun..6=Sat in Pacific/Auckland
  const s = now.toLocaleDateString('en-US', { timeZone: 'Pacific/Auckland', weekday: 'short' })
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(s)
}

export interface TodoEmail {
  subject: string
  html: string
  /** Total actionable items (drives the subject line). */
  totalItems: number
}

export const ZH_DAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/**
 * 拼进邮件 HTML 之前先转义。
 *
 * 🔴 **人工待办的 what / how / href 里有客人自己写的字**（Codex 复审 PR #1037，
 * 2026-08-17）：`dm_maybe_stop` 会把 Facebook 私信原话摘一段进 `what`，
 * 联系人姓名也是客人自己填的。不转义的话，任何一个陌生人只要在私信里发一段
 * `do not follow up <a href="...">`，就能往**我们自己发出去的官方日报**里
 * 注入链接、图片或别的标记 —— 收件人是 PM 和 FDE，那封邮件看起来完全可信。
 *
 * 转义放在**渲染这一层**，不是放在造条目的地方：造条目的有二十多处，
 * 少写一处就漏一处；渲染只有这两行。同一个判断只允许存在一份。
 *
 * 现有条目的正文都是纯文字（实测无一处含尖括号），所以这一刀不会改变它们的样子。
 */
export function esc(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function buildTodoEmail(weekday: number, counts: TodoCounts, nzDateLabel: string): TodoEmail {
  const theme = DAY_THEMES[weekday] ?? { title: '日常', hint: '' }

  const sections: string[] = []

  const sectionCard = (emoji: string, title: string, rows: string[]) => `
    <div style="margin:0 0 14px;padding:14px 16px;border:1px solid #e2e8f0;border-radius:10px">
      <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#0f172a">${emoji} ${title}</p>
      ${rows.join('')}
    </div>`

  const linkRow = (label: string, href: string, count: number, unit: string) => `
    <p style="margin:0 0 4px;font-size:14px;color:#334155">
      ${label}：<b>${count}</b> ${unit} · <a href="${href}" style="color:#0891b2">去处理</a>
    </p>`

  // Setup first: these are one-off consent clicks that block a whole pillar
  // until done, so they outrank the day's routine review queue.
  const setupTasks = counts.setupTasks ?? []
  if (setupTasks.length > 0) {
    sections.push(sectionCard('🔌', '要你点一次的连接（做一次，以后不再出现）',
      setupTasks.map((t) => `
        <p style="margin:0 0 8px;font-size:14px;color:#334155">
          <b>${t.name}</b> · <a href="${t.href}" style="color:#0891b2">去连接</a><br/>
          <span style="font-size:12px;color:#64748b">${t.label}</span>
        </p>`),
    ))
  }

  // Then the manual lane: work the system genuinely cannot finish. Routine
  // sections below move on their own; these stay frozen until a human acts.
  const manualItems = counts.manualItems ?? []
  // 🔴 「需要你动手」这一栏的全部价值，在于**里面每一条不动就不会好**。
  //    往里塞不用动手的通知，等于每周每个客户往里加一行噪音；栏目一被稀释，
  //    真正等他动手的那条（比如"出片余额用完了"）会被一起划过去。
  //    所以纯知会型的单独一栏，且不计进"要你办的事"。
  const actionItems = manualItems.filter(
    (m) => !INFORMATIONAL_KINDS.includes(m.kind) && !DEV_OWNED_KINDS.includes(m.kind),
  )
  const infoItems = manualItems.filter((m) => INFORMATIONAL_KINDS.includes(m.kind))
  const devOwnedItems = manualItems.filter((m) => DEV_OWNED_KINDS.includes(m.kind))

  if (actionItems.length > 0) {
    const rows = actionItems.map((m) => `
      <div style="margin:0 0 10px;padding-bottom:8px;border-bottom:1px solid #f1f5f9">
        <p style="margin:0 0 2px;font-size:14px;color:#0f172a"><b>${esc(m.client_name)}</b>：${esc(m.what)}</p>
        <p style="margin:0;font-size:13px;color:#475569">→ ${esc(m.how)} · <a href="${esc(m.href)}" style="color:#0891b2">去做这件事</a></p>
      </div>`)
    sections.push(sectionCard('🙋', '需要你动手（系统做不了的）', rows))
  }

  if (infoItems.length > 0) {
    const rows = infoItems.map((m) => `
      <div style="margin:0 0 10px;padding-bottom:8px;border-bottom:1px solid #f1f5f9">
        <p style="margin:0 0 2px;font-size:14px;color:#0f172a"><b>${esc(m.client_name)}</b>：${esc(m.what)}</p>
        <p style="margin:0;font-size:13px;color:#475569">→ ${esc(m.how)} · <a href="${esc(m.href)}" style="color:#0891b2">去看看</a></p>
      </div>`)
    // 「不用动手」字面上等于「可以跳过」，但这条通知存在的全部理由，
    // 就是让 PM 知道客户的方向被自动改成了什么 —— 他不用干活，但必须过目。
    // 「看一眼就行」两件事一起说清楚。
    sections.push(sectionCard('📣', '这周系统替你做了什么（看一眼就行）', rows))
  }

  if (devOwnedItems.length > 0) {
    const rows = devOwnedItems.map((m) => `
      <div style="margin:0 0 10px;padding-bottom:8px;border-bottom:1px solid #f1f5f9">
        <p style="margin:0 0 2px;font-size:14px;color:#0f172a"><b>${esc(m.client_name)}</b>：${esc(m.what)}</p>
        <p style="margin:0;font-size:13px;color:#475569">→ ${esc(m.how)}${m.href ? ` · <a href="${esc(m.href)}" style="color:#0891b2">去看看</a>` : ''}</p>
      </div>`)
    // 🛠 这栏是**我们代码 / infra 欠账**的清单，转给 Ray/dev 就好 —— 不算你要办的事。
    //    见 DEV_OWNED_KINDS 头注：这几个 kind 的 how 字段自己都写「回我一句我去改」，
    //    本就不是 PM 能动手解决的，塞到「🙋 需要你动手」栏是把 dev 的活假装成 PM 的活。
    sections.push(sectionCard('🛠', '系统欠账（不影响你 · Ray 转给 dev 就好）', rows))
  }

  const totalDrafts = counts.draftsByClient.reduce((s, c) => s + c.drafts, 0)
  if (totalDrafts > 0) {
    sections.push(sectionCard('📝', 'Blog 草稿待审', counts.draftsByClient.map((c) =>
      linkRow(c.name, `${DASHBOARD_BASE}/${c.id}/blog`, c.drafts, '篇'),
    )))
  }

  // 🔴 巡逻发现**不是一批独立的活儿** —— 它当天就被自动排成了下面那栏的建议卡。
  //    原来两栏各数一遍，同一件事在「今天有几件」里被算了两次，
  //    这是 91 那个数字虚高的第二个原因（第一个是没按客户过滤）。
  //    所以这一栏只报「查到什么、已经变成什么」，不进总数。
  const totalFindings = counts.findingsByClient.reduce((s, c) => s + c.findings, 0)
  if (totalFindings > 0) {
    sections.push(sectionCard('🔎', 'SEO 巡逻查到的（已自动排成下面的建议卡，不用单独处理）',
      counts.findingsByClient.map((c) =>
        linkRow(c.name, `${DASHBOARD_BASE}/${c.id}/execution`, c.findings, '条'),
      )))
  }

  const totalCards = counts.recentCardsByClient.reduce((s, c) => s + c.cards, 0)
  if (totalCards > 0) {
    sections.push(sectionCard('🗂', '本周新建议卡待处理', counts.recentCardsByClient.map((c) =>
      linkRow(c.name, `${DASHBOARD_BASE}/${c.id}/execution`, c.cards, '张'),
    )))
  }

  const totalReels = counts.reelsByClient.reduce((s, c) => s + c.reels, 0)
  if (totalReels > 0) {
    sections.push(sectionCard('🎬', '社媒成片待审', counts.reelsByClient.map((c) =>
      linkRow(c.name, 'https://app.magicengine.com.au/dashboard/factory', c.reels, '条'),
    )))
  }

  if (counts.cronFailures24h > 0) {
    sections.push(sectionCard('⚠️', '系统有活儿没跑成', [
      linkRow('过去 24 小时', 'https://app.magicengine.com.au/dashboard/admin/cron-health', counts.cronFailures24h, '次失败'),
    ]))
  }

  // 只知会、不用他动手的那些不计进「今天有几件事」—— 否则数字会虚高，
  // 他以为有 5 件要办，点进去 3 件写着「不用你操作」，这个数字就不可信了
  // 🔴 「今天有几件」只数**真的要人处理**的：
  //    巡逻发现不进（它已经是下面的建议卡，数两遍就是虚高）；
  //    纯知会型的也不进（见上面 INFORMATIONAL_KINDS）。
  //    PM 2026-08-04：「91 件，很多按钮点了并不能顺利办理」——
  //    一个数不准的数字比没有数字更糟，他会连带不信这封信里的其他数。
  const totalItems =
    setupTasks.length + actionItems.length +
    totalDrafts + totalCards + totalReels + counts.cronFailures24h

  const body = sections.length > 0
    ? sections.join('')
    : `<p style="margin:0 0 14px;font-size:14px;color:#059669">今天没有待办 ✅ 系统都在正常跑。</p>`

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
      <h2 style="margin:0 0 4px;font-size:18px;color:#0f172a">📋 今日待办 · ${ZH_DAYS[weekday]} ${nzDateLabel}</h2>
      <p style="margin:0 0 18px;font-size:14px;color:#64748b">
        <b>${theme.title}</b>${theme.hint ? ` — ${theme.hint}` : ''}
      </p>
      ${body}
      <p style="margin-top:18px;font-size:12px;color:#94a3b8">
        这封信每个工作日早上自动发，数字实时统计，办完的第二天自动消失。
        随时可在后台 <a href="https://app.magicengine.com.au/dashboard/today" style="color:#0891b2">今日待办</a> 页查看同一份清单。
      </p>
    </div>`

  const subject = totalItems > 0
    ? `📋 今日待办 · ${ZH_DAYS[weekday]} · ${totalItems} 件`
    : `📋 今日待办 · ${ZH_DAYS[weekday]} · 无事 ✅`

  return { subject, html, totalItems }
}
