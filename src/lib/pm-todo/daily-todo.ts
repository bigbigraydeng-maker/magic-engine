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
import { loadManualItems, dropBrokenLinks, type ManualItem } from './manual-items'

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

/** 板桥审：给 PM/FDE 看的 GBP 待办文案（含「用谁的账号」这个最易翻车点）。 */
const GBP_CONNECT_LABEL =
  '连接 Google 商家页 · 约 1 分钟。连上后不会自动发东西，每条帖子仍要你点确认才发。' +
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
        : `${APP_BASE}/api/auth/google/gbp/start?clientId=${c.id}`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// ── Data loading ────────────────────────────────────────────────────────────────

export async function loadTodoCounts(supabase: SupabaseClient): Promise<TodoCounts> {
  const cardCutoff = new Date()
  cardCutoff.setDate(cardCutoff.getDate() - RECENT_CARD_DAYS)
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const [drafts, findings, cards, reels, failures, setupTasks] = await Promise.all([
    supabase
      .from('blog_posts')
      .select('client_id, clients(name)')
      .eq('status', 'draft'),
    supabase
      .from('seo_patrol_findings')
      .select('client_id, clients(name)')
      .eq('status', 'fresh'),
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

  const rawManualItems = await loadManualItems(supabase).catch((err: unknown) => {
    console.error('[pm-todo] manual items load failed:', err instanceof Error ? err.message : String(err))
    return [] as ManualItem[]
  })
  // 链接打不开的不下发（PM 2026-08-03：「点过去就是 404，徒增我和 fde 的工作时间」）。
  // 闸本身出问题时原样放行 —— 少过滤好过整栏消失。
  const manualItems = await dropBrokenLinks(rawManualItems)
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
  if (manualItems.length > 0) {
    const rows = manualItems.map((m) => `
      <div style="margin:0 0 10px;padding-bottom:8px;border-bottom:1px solid #f1f5f9">
        <p style="margin:0 0 2px;font-size:14px;color:#0f172a"><b>${m.client_name}</b>：${m.what}</p>
        <p style="margin:0;font-size:13px;color:#475569">→ ${m.how} · <a href="${m.href}" style="color:#0891b2">去做这件事</a></p>
      </div>`)
    sections.push(sectionCard('🙋', '需要你动手（系统做不了的）', rows))
  }

  const totalDrafts = counts.draftsByClient.reduce((s, c) => s + c.drafts, 0)
  if (totalDrafts > 0) {
    sections.push(sectionCard('📝', 'Blog 草稿待审', counts.draftsByClient.map((c) =>
      linkRow(c.name, `${DASHBOARD_BASE}/${c.id}/blog`, c.drafts, '篇'),
    )))
  }

  const totalFindings = counts.findingsByClient.reduce((s, c) => s + c.findings, 0)
  if (totalFindings > 0) {
    sections.push(sectionCard('🔎', 'SEO 巡逻新发现', counts.findingsByClient.map((c) =>
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

  const totalItems =
    setupTasks.length + manualItems.length +
    totalDrafts + totalFindings + totalCards + totalReels + counts.cronFailures24h

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
