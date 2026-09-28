/**
 * PM daily to-do email (22.E.S18 前置 · 滚动排班).
 *
 * One short email every NZ weekday morning: today's pillar theme (rolling
 * Mon-Fri schedule the PM signed off 2026-07-31) plus the things actually
 * awaiting him, grouped into the five kinds the PM signed off 2026-09-26
 * (see five-kinds.ts; built by `buildTodoView`, which the /dashboard/today
 * page renders too). Sections with zero items are omitted; a quiet day sends
 * a one-line all-clear so the rhythm stays daily.
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
} from './manual-items'
import { reconcile } from '@/lib/todo-reconciliation/reconcile'
import type { RawWorkItem } from '@/lib/todo-reconciliation/types'
import { blindSpotNotes, isPmKind, laneOf, PM_KIND_ORDER, PM_KIND_TITLE, type PmKind } from './five-kinds'
import { sharedLinkVerdictCache } from './action-link'

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
  const rawManualItemsPromise = loadManualItems(supabase).catch((err: unknown): ManualItem[] => {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[pm-todo] manual items load failed:', message)
    // 读挂了不能变成一张空清单 —— 空清单会写成「今天没事」（子牙 2026-09-26 实施后复审）
    return [{
      kind: 'todo_items_unreadable',
      client_id: 'infra',
      client_name: 'Magic Engine 后台',
      what: `今日待办的人工待办这一大块整个没读出来（${message.slice(0, 160)}）`,
      how: '这条不用你动手 —— 是我们这边的欠账，转给开发窗口查',
      href: '',
    }]
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

// ── The five-kinds view (pure) ───────────────────────────────────────────────────
//
// 🔴 邮件和 /dashboard/today 页面**都只渲染这一个函数的结果**。以前两边各数各的：
//    页面把巡逻发现、开发欠账、知会全算进总数，邮件不算 —— 同一天两个数字对不上。
//    现在「今天有几件事」只有一个出处。

/** 一行 = PM 要做的一件事。同一件事的 N 条原始记录已经合成这一行，`count` 记着合了几条。 */
export interface TodoRow {
  pm_kind: PmKind
  /** 来源：人工待办的 kind，或 'gbp_setup' / 'blog_drafts' / 'reels'。 */
  kind: string
  client_id: string
  client_name: string
  what: string
  /** 空字符串 = 这一行没有额外的做法说明（比如连接授权，说明就在 what 里）。 */
  how: string
  href: string
  action_label: string
  count: number
  /** 合并时除了第一条之外另外几条的 what（截短），让人不点开也知道合了些什么。 */
  samples: string[]
}

export interface TodoSection {
  pm_kind: PmKind
  emoji: string
  title: string
  rows: TodoRow[]
}

export interface TodoView {
  /** 只含非空的栏，按五类的固定顺序。 */
  sections: TodoSection[]
  /** 行数 = 今天要 PM 做几件事。主题行就用它。 */
  totalItems: number
  /**
   * 今天没查成的栏（不计数）—— 对应的检查挪给了开发，但它一坏，PM 那一栏的「没有」
   * 就是假的，必须说出来。见 five-kinds.ts `BLIND_SPOT_NOTE`。
   */
  blindSpots: string[]
  /** 转给开发的件数（按合并后算，跟开发欠账清单上的行数一致；不算 PM 的事）。 */
  routedToDev: number
  /** 挪到周一周报的件数（合并后）。 */
  routedToWeekly: number
  /** 过去 24 小时自动任务失败次数 —— 同样只进系统故障日报。 */
  cronFailures24h: number
}

/**
 * 合并后的几行共用一个链接：只留每一行都一样的参数。
 *
 * 例：20 条待核对成交各带 `focus=<那一条>`，合成一行后落到「这个客户的全部待核对」
 * （`?client=<id>`）—— 落到其中某一条上会让人以为只有那一条。
 * 路径不一样的（本来就不是同一个页面）就用第一条的链接，不去拼一个不存在的页面。
 */
export function commonHref(hrefs: string[]): string {
  const first = hrefs[0] ?? ''
  if (hrefs.every((h) => h === first)) return first
  let urls: URL[]
  try {
    urls = hrefs.map((h) => new URL(h))
  } catch {
    return first
  }
  const base = urls[0]
  if (urls.some((u) => u.origin !== base.origin || u.pathname !== base.pathname)) return first
  const kept = new URLSearchParams()
  base.searchParams.forEach((value, key) => {
    if (urls.every((u) => u.searchParams.getAll(key).length === 1 && u.searchParams.get(key) === value)) {
      kept.append(key, value)
    }
  })
  const query = kept.toString()
  return `${base.origin}${base.pathname}${query ? `?${query}` : ''}`
}

/**
 * 同一件事的多条记录合成一条（比如 20 条「要不要告诉广告平台」）。
 *
 * 合并用的是仓库里现成的 `reconcile()`（todo-reconciliation，#1169）—— 它本来就是
 * 「同一个根因的 N 次出现合成一行、带次数」，不另写一套口径。根因 = 同一种事 +
 * 同一个客户（id 和名字都一样）+ 同一种做法 + 同一个落地页面：人就是去同一个
 * 地方做同一个动作。落地页面不同的不合，否则合并后的链接只能指到其中一个。
 *
 * 🔴 「认真假」那一栏（串台、共用账户…）**一条都不合**：两件串台就是两件不同的事，
 *    合成一条只剩第一对客户的名字（魏征 2026-09-26 设计复审）。同一件串台的重复记录
 *    在源头就按涉及的网址 / 账号合掉了（manual-items.ts `pushCrossClientItems`）。
 *
 * 🔴 `reconcile()` 会把它认得的几类记录「压下去」（比如谷歌故意不收录的网址）。
 *    这里给的 category 带前缀，不会命中那些规则；万一以后命中了，压下去的也照样
 *    各出一行 —— 在 PM 的清单里，宁可多一行，也不许一条待办悄悄没了。
 */
export function collapseManualItems(
  items: ManualItem[],
): Array<{ item: ManualItem; count: number; hrefs: string[]; samples: string[] }> {
  if (items.length === 0) return []
  const raw: RawWorkItem[] = items.map((m, i) => ({
    id: String(i),
    source: 'manual_item',
    category: `pm-todo:${m.kind}`,
    clientId: m.client_id,
    clientName: m.client_name,
    rootCauseKey: laneOf(m) === 'truth'
      ? `single:${i}`
      : JSON.stringify([laneOf(m), m.kind, m.client_id, m.client_name, m.how, hrefPage(m.href)]),
    label: m.what,
  }))
  const result = reconcile(raw, new Date(0).toISOString())
  const groups: number[][] = [
    ...result.unresolvedClusters.map((c) => c.itemIds.map(Number)),
    ...result.suppressed.flatMap((g) => g.itemIds.map((id) => [Number(id)])),
  ]
  return groups
    .map((ids) => ids.slice().sort((a, b) => a - b))
    .sort((a, b) => a[0] - b[0])
    .map((ids) => ({
      item: items[ids[0]],
      count: ids.length,
      hrefs: ids.map((i) => items[i].href),
      samples: sampleWhats(ids.map((i) => items[i])),
    }))
}

/** 链接落在哪个页面（不含参数）。解析不了的原样当页面，不去猜。 */
function hrefPage(href: string): string {
  try {
    const u = new URL(href)
    return `${u.origin}${u.pathname}`
  } catch {
    return href
  }
}

/** 合并行里另外几条最多点名几条。 */
const MERGED_SAMPLES = 3
const SAMPLE_CHARS = 60

function mergedWhat(what: string, count: number): string {
  return count > 1 ? `共 ${count} 条同类，其中一条：${what}` : what
}

function sampleWhats(items: ManualItem[]): string[] {
  return items
    .slice(1, 1 + MERGED_SAMPLES)
    .map((m) => (m.what.length > SAMPLE_CHARS ? `${m.what.slice(0, SAMPLE_CHARS)}…` : m.what))
}

export function buildTodoView(counts: TodoCounts): TodoView {
  const byKind = new Map<PmKind, TodoRow[]>()
  const push = (row: TodoRow) => {
    const list = byKind.get(row.pm_kind) ?? []
    list.push(row)
    byKind.set(row.pm_kind, list)
  }

  // 授权连接：系统进不去，要人点一次同意页
  for (const t of counts.setupTasks ?? []) {
    push({
      pm_kind: 'one_click', kind: 'gbp_setup', client_id: t.id, client_name: t.name,
      what: t.label, how: '', href: t.href, action_label: '去连接', count: 1, samples: [],
    })
  }

  const manualItems = counts.manualItems ?? []
  const pmItems = manualItems.filter((m) => isPmKind(laneOf(m)))
  for (const { item, count, hrefs, samples } of collapseManualItems(pmItems)) {
    const href = count > 1 ? commonHref(hrefs) : item.href
    push({
      pm_kind: laneOf(item) as PmKind,
      kind: item.kind,
      client_id: item.client_id,
      client_name: item.client_name,
      what: mergedWhat(item.what, count),
      // 合并后链接落到这一类的总列表，不再是某一条 —— 做法里「直接展开到这位客人」
      // 这种话就不对了，得说清楚（魏征 2026-09-26 设计复审）
      how: href !== item.href
        ? `${item.how}（这是 ${count} 条合成的一行：链接打开的是总列表，按上面点到的条目逐个找）`
        : item.how,
      href,
      action_label: '去做这件事',
      count,
      samples,
    })
  }

  // 草稿：人工待办里已经有这个客户的「写好没人看 / 写好没地方发」那条（它带着更多
  // 信息），就不再另起一行 —— 同一批草稿以前在两栏各数一遍。
  const draftClientsInManual = new Set(
    pmItems
      .filter((m) => m.kind === 'blog_draft_waiting' || m.kind === 'blog_publish_channel_broken')
      .map((m) => m.client_id),
  )
  for (const c of counts.draftsByClient) {
    if (c.drafts <= 0 || draftClientsInManual.has(c.id)) continue
    push({
      pm_kind: 'review', kind: 'blog_drafts', client_id: c.id, client_name: c.name,
      what: `${c.drafts} 篇 Blog 草稿写好了，等你审`,
      how: '打开看一眼，觉得可以就点发布',
      href: `${DASHBOARD_BASE}/${c.id}/blog`, action_label: '去审', count: 1, samples: [],
    })
  }

  for (const c of counts.reelsByClient) {
    if (c.reels <= 0) continue
    push({
      pm_kind: 'review', kind: 'reels', client_id: c.id, client_name: c.name,
      what: `${c.reels} 条社媒成片等你审`,
      how: '看一遍，没问题就批准发布',
      href: `${APP_BASE}/dashboard/factory`, action_label: '去看片', count: 1, samples: [],
    })
  }

  // 🔴 这两样**刻意不进**每日待办：
  //    · SEO 巡逻发现 —— 周报里已经有「巡逻员本周抓到 N 个新发现」
  //    · 看板上的新建议卡 —— 系统和 FDE 在推，周报里报「本周新排了几张」
  //    不是 PM 五类里的任何一类，放在这里只会把真正要他动手的那几条淹掉。

  const sections: TodoSection[] = PM_KIND_ORDER
    .filter((k) => (byKind.get(k) ?? []).length > 0)
    .map((k) => ({ pm_kind: k, ...PM_KIND_TITLE[k], rows: byKind.get(k) ?? [] }))

  return {
    sections,
    totalItems: sections.reduce((s, sec) => s + sec.rows.length, 0),
    blindSpots: blindSpotNotes(manualItems),
    routedToDev: collapseManualItems(manualItems.filter((m) => laneOf(m) === 'dev')).length,
    routedToWeekly: collapseManualItems(manualItems.filter((m) => laneOf(m) === 'weekly')).length,
    cronFailures24h: counts.cronFailures24h,
  }
}

/** 「挪走了什么」那一行小字。邮件和页面共用，所以两边说的是同一句话。 */
export function routedElsewhereNote(view: TodoView): string {
  const parts: string[] = []
  if (view.routedToDev > 0) parts.push(`${view.routedToDev} 件开发欠账`)
  if (view.cronFailures24h > 0) parts.push(`过去 24 小时 ${view.cronFailures24h} 次自动任务失败`)
  const dev = parts.length > 0 ? `${parts.join('、')}在后台「开发欠账」清单里，转给开发窗口就行` : ''
  const weekly = view.routedToWeekly > 0 ? `${view.routedToWeekly} 件系统知会挪到周一周报` : ''
  const moved = [dev, weekly].filter(Boolean).join('；')
  return moved ? `另外：${moved} —— 都不算你的事。` : ''
}

/**
 * 开发欠账清单在哪（后台「自动任务健康」页下面那一栏）。
 *
 * 🔴 以前这些在 PM 邮件里占一整栏；挪走以后必须有一个开发打开就能看到全部的地方，
 *    邮件里只留一行小字 + 这个链接（铁律 3 下半：发现不许死在日志里）。
 *    原计划挪进每天的「系统故障日报」—— 但那封信仓库里自己写着「每天没人细看」，
 *    挪过去等于换个地方埋掉（魏征 2026-09-26 设计复审）。
 */
export const DEV_DEBT_URL = `${APP_BASE}/dashboard/admin/cron-health#dev-debt`

export function buildTodoEmail(weekday: number, counts: TodoCounts, nzDateLabel: string): TodoEmail {
  const theme = DAY_THEMES[weekday] ?? { title: '日常', hint: '' }
  const view = buildTodoView(counts)

  const sectionCard = (emoji: string, title: string, rows: string[]) => `
    <div style="margin:0 0 14px;padding:14px 16px;border:1px solid #e2e8f0;border-radius:10px">
      <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#0f172a">${emoji} ${title}</p>
      ${rows.join('')}
    </div>`

  const rowHtml = (r: TodoRow) => {
    const link = r.href
      ? `<a href="${esc(r.href)}" style="color:#0891b2">${esc(r.action_label)}</a>`
      : ''
    const tail = [r.how ? `→ ${esc(r.how)}` : '', link].filter(Boolean).join(' · ')
    const samples = r.samples.length > 0
      ? `<p style="margin:0 0 2px;font-size:12px;color:#64748b">另外几条：${r.samples.map(esc).join('；')}${r.count - 1 > r.samples.length ? ' …' : ''}</p>`
      : ''
    return `
      <div style="margin:0 0 10px;padding-bottom:8px;border-bottom:1px solid #f1f5f9">
        <p style="margin:0 0 2px;font-size:14px;color:#0f172a"><b>${esc(r.client_name)}</b>：${esc(r.what)}</p>
        ${samples}
        ${tail ? `<p style="margin:0;font-size:13px;color:#475569">${tail}</p>` : ''}
      </div>`
  }

  const blind = view.blindSpots.length > 0
    ? `<div style="margin:0 0 14px;padding:10px 14px;border:1px solid #fcd34d;background:#fffbeb;border-radius:10px">
        ${view.blindSpots.map((b) => `<p style="margin:0 0 2px;font-size:13px;color:#92400e">⚠️ 今天没查成：${esc(b)}</p>`).join('')}
      </div>`
    : ''

  const body = view.sections.length > 0
    ? view.sections.map((sec) => sectionCard(sec.emoji, sec.title, sec.rows.map(rowHtml))).join('')
    : view.blindSpots.length > 0
      // 有检查没跑成时不许说「没事」—— 列不出来 ≠ 没有
      ? `<p style="margin:0 0 14px;font-size:14px;color:#92400e">下面没有列出要你做的事，但上面那几项今天没查成，不等于没事。</p>`
      : `<p style="margin:0 0 14px;font-size:14px;color:#059669">今天没有待办 ✅ 没有要你做的事。</p>`

  const note = routedElsewhereNote(view)
  const noteLink = view.routedToDev > 0 || view.cronFailures24h > 0
    ? ` <a href="${esc(DEV_DEBT_URL)}" style="color:#0891b2">开发欠账清单</a>`
    : ''

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
      <h2 style="margin:0 0 4px;font-size:18px;color:#0f172a">📋 今日待办 · ${ZH_DAYS[weekday]} ${nzDateLabel}</h2>
      <p style="margin:0 0 18px;font-size:14px;color:#64748b">
        <b>${theme.title}</b>${theme.hint ? ` — ${theme.hint}` : ''}
      </p>
      ${blind}
      ${body}
      ${note ? `<p style="margin:12px 0 0;font-size:12px;color:#64748b">${esc(note)}${noteLink}</p>` : ''}
      <p style="margin-top:18px;font-size:12px;color:#94a3b8">
        这封信每个工作日早上自动发，只列五类要你做的事：拍板、点一次、转给客户、发前看一眼、认真假。办完的第二天自动消失。
        随时可在后台 <a href="https://app.magicengine.com.au/dashboard/today" style="color:#0891b2">今日待办</a> 页查看同一份清单。
      </p>
    </div>`

  const totalItems = view.totalItems
  const subject = totalItems > 0
    ? `📋 今日待办 · ${ZH_DAYS[weekday]} · ${totalItems} 件`
    : view.blindSpots.length > 0
      ? `📋 今日待办 · ${ZH_DAYS[weekday]} · 有检查没跑成 ⚠️`
      : `📋 今日待办 · ${ZH_DAYS[weekday]} · 无事 ✅`

  return { subject, html, totalItems }
}
