/**
 * Weekly watchdog report (22.E.S18 · PM 拍板 2026-07-31 决定③).
 *
 * Monday-morning plain-Chinese email to the PM: per focus client —
 *   SEO      排名变化(首页词/前三词/涨跌明星) + GSC 点击曝光 + 巡逻产出
 *   自动改动  本周系统自己动手改了什么(Oztop 标题队列 / 卫生清理)
 *   Blog     本周生成/发布/待点头
 *   社媒      发帖数/互动/断更天数/最佳帖(social.fb.* 滚动指标)
 *   社媒广告  花费/进线/私信(ad_daily_insights 7 天)
 *   广告一本账 每个有广告的客户算到第几级(花费→线索→合格→成交→金额→回报)，只读
 *
 * EVERY section carries a data-freshness stamp; data older than
 * STALE_AFTER_DAYS renders as 「⚠️ 数据断流」 instead of masquerading as
 * fresh (魏征 M4 — a report that dresses stale data as current is worse
 * than no report).
 *
 * Copy rules: 一次一件事能一句话回、零黑话(CLAUDE.md § 跟 PM 说话的格式)。
 * PM-facing only — if this ever goes to client bosses it must pass 板桥
 * review + supplier-name masking first.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { esc, FOCUS_CLIENT_IDS } from '@/lib/pm-todo/daily-todo'
import { gatherSeoListWeekly, seoListLines, type SeoListWeeklyResult } from '@/lib/seo-weekly-list/report'
import { gatherReturnLadders, type ReturnLadderSection } from './return-ladder-gather'
import { renderLadderBlock, renderLadderUnavailable, renderOtherLadders } from './return-ladder-section'

const STALE_AFTER_DAYS = 3
/** Keyword snapshots are WEEKLY by design — 8 days tolerance, not 3, or
 *  every Monday report would falsely cry 断流 on perfectly-on-schedule data
 *  (happened on the very first send, 2026-08-02). */
const SEO_STALE_AFTER_DAYS = 8

export interface FreshnessStamp {
  latest: string | null
  stale: boolean
}

export function freshness(
  latestIso: string | null,
  now: Date,
  staleAfterDays: number = STALE_AFTER_DAYS,
): FreshnessStamp {
  if (!latestIso) return { latest: null, stale: true }
  const ageDays = (now.getTime() - Date.parse(latestIso)) / 86_400_000
  return { latest: latestIso.slice(0, 10), stale: ageDays > staleAfterDays }
}

export interface KeywordMover {
  keyword: string
  from: number
  to: number
}

export interface ClientWeekly {
  client_id: string
  name: string
  seo: {
    page1_now: number
    page1_prior: number
    top3_now: number
    movers_up: KeywordMover[]
    movers_down: KeywordMover[]
    gsc_clicks_28d: number | null
    gsc_impressions_28d: number | null
    findings_week: number
    freshness: FreshnessStamp
  }
  /** SEO weekly list block (null when the client has no active list goal). Optional: old data / tests have none. */
  seo_list?: SeoListWeeklyResult
  auto_changes: {
    titles_applied_week: number
    /** Of this week's changes, how many recorded a rank baseline (ranked or not_in_top_n) and can therefore be verified later. Optional: old data / tests have none. */
    titles_with_rank_baseline_week?: number
    freshness: FreshnessStamp
    /**
     * Checked changes this week. Two kinds of row share this list: legacy page-CTR checks
     * (`outcome` set — switched off 2026-10-04, kept so old rows still render) and target-keyword
     * rank verdicts (`rank_verdict` set).
     */
    outcomes_checked_week: Array<{
      page_slug: string
      baseline_ctr: number | null
      observed_ctr: number | null
      observed_impressions: number | null
      outcome: string | null
      rank_verdict?: string | null
      baseline_rank_group?: number | null
      verdict_detail?: { reason?: string | null; median_delta?: number | null } | null
    }>
    /**
     * 看板上这周新排了几张还没做的建议卡。2026-09-26 从每日待办挪过来 —— 系统和 FDE 在推，
     * 不是 PM 五类里的事，每天报一遍只会把真要他动手的淹掉。可选：老数据 / 测试里没有就不报。
     */
    cards_new_week?: number
  }
  blog: {
    generated_week: number
    published_week: number
    awaiting_review: number
  }
  social: {
    posts_7d: number | null
    reactions_7d: number | null
    days_since_last_post: number | null
    reels_awaiting: number
    freshness: FreshnessStamp
  }
  ads: {
    spend_7d: number | null
    leads_7d: number | null
    messages_7d: number | null
    freshness: FreshnessStamp
  }
}

// ── Data gathering ──────────────────────────────────────────────────────────────

async function latestTwoSnapshotDates(
  supabase: SupabaseClient,
  clientId: string,
): Promise<{ current: string | null; prior: string | null }> {
  const { data: cur } = await supabase
    .from('keyword_snapshots')
    .select('snapshot_date')
    .eq('client_id', clientId)
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  const current = (cur as { snapshot_date: string } | null)?.snapshot_date ?? null
  if (!current) return { current: null, prior: null }

  const { data: pri } = await supabase
    .from('keyword_snapshots')
    .select('snapshot_date')
    .eq('client_id', clientId)
    .lt('snapshot_date', current)
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  return { current, prior: (pri as { snapshot_date: string } | null)?.snapshot_date ?? null }
}

interface KwRow {
  keyword: string
  position: number | null
  snapshot_date: string
}

export function computeSeoWeek(current: KwRow[], prior: KwRow[]): {
  page1_now: number
  page1_prior: number
  top3_now: number
  movers_up: KeywordMover[]
  movers_down: KeywordMover[]
} {
  const priorByKw = new Map(prior.map((r) => [r.keyword, r.position]))
  const page1_now = current.filter((r) => r.position !== null && r.position <= 10).length
  const page1_prior = prior.filter((r) => r.position !== null && r.position <= 10).length
  const top3_now = current.filter((r) => r.position !== null && r.position <= 3).length

  const movers: Array<KeywordMover & { delta: number }> = []
  for (const row of current) {
    const before = priorByKw.get(row.keyword)
    if (row.position == null || before == null) continue
    const delta = before - row.position // positive = climbed
    if (delta !== 0) movers.push({ keyword: row.keyword, from: before, to: row.position, delta })
  }
  movers.sort((a, b) => b.delta - a.delta)

  return {
    page1_now,
    page1_prior,
    top3_now,
    movers_up: movers.filter((m) => m.delta > 0).slice(0, 3).map(({ keyword, from, to }) => ({ keyword, from, to })),
    movers_down: movers.filter((m) => m.delta < 0).slice(-3).reverse().map(({ keyword, from, to }) => ({ keyword, from, to })),
  }
}

async function gatherClient(
  supabase: SupabaseClient,
  clientId: string,
  now: Date,
): Promise<ClientWeekly | null> {
  const weekAgoIso = new Date(now.getTime() - 7 * 86_400_000).toISOString()

  const { data: client } = await supabase
    .from('clients')
    .select('id, name')
    .eq('id', clientId)
    .maybeSingle()
  if (!client) return null

  const { current, prior } = await latestTwoSnapshotDates(supabase, clientId)

  const fetchKw = async (date: string | null): Promise<KwRow[]> => {
    if (!date) return []
    const { data } = await supabase
      .from('keyword_snapshots')
      .select('keyword, position, snapshot_date')
      .eq('client_id', clientId)
      .eq('snapshot_date', date)
      .limit(400)
    return (data ?? []) as KwRow[]
  }

  const [curKw, priKw, gsc, findings, titles, outcomesChecked, blogGen, blogPub, blogWait, socialMetrics, adRows, reels, cards] =
    await Promise.all([
      fetchKw(current),
      fetchKw(prior),
      supabase
        .from('gsc_performance_snapshots')
        .select('total_clicks, total_impressions, period_end')
        .eq('client_id', clientId)
        .order('period_end', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('seo_patrol_findings')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .gte('created_at', weekAgoIso),
      // wp_updated=true only counts the WordPress-plugin channel (Oztop).
      // A repo-PR client (applied_channel='pr', e.g. CTS) never flips
      // wp_updated — cts-meta-pr.ts / seo-meta-cycle write the row once the
      // PR is opened/merged in the same run, so presence of the row in the
      // window is the applied-channel equivalent of wp_updated=true.
      supabase
        .from('seo_meta_log')
        .select('created_at, baseline_rank_status')
        .eq('client_id', clientId)
        .or('wp_updated.eq.true,applied_channel.eq.pr')
        .gte('created_at', weekAgoIso),
      // PM 2026-09-20 item 8: SEO Meta-Cycle's T+14 Check outcomes classified
      // this week — surfaced in the report, not just written to the DB.
      supabase
        .from('seo_meta_log')
        .select('page_slug, baseline_ctr, observed_ctr, observed_impressions, outcome, rank_verdict, baseline_rank_group, verdict_detail')
        .eq('client_id', clientId)
        .not('checked_at', 'is', null)
        .gte('checked_at', weekAgoIso)
        .order('checked_at', { ascending: false }),
      supabase
        .from('blog_posts')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .gte('created_at', weekAgoIso),
      supabase
        .from('blog_posts')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .eq('status', 'published')
        .gte('updated_at', weekAgoIso),
      supabase
        .from('blog_posts')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .eq('status', 'draft'),
      supabase
        .from('flywheel_metrics')
        .select('metric_key, metric_value, measured_at')
        .eq('client_id', clientId)
        .like('metric_key', 'social.fb.%')
        .order('measured_at', { ascending: false })
        .limit(12),
      supabase
        .from('ad_daily_insights')
        .select('spend, leads, messaging_conversations, insight_date')
        .eq('client_id', clientId)
        .eq('level', 'campaign')
        .gte('insight_date', weekAgoIso.slice(0, 10)),
      supabase
        .from('reels_drafts')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .in('status', ['video_ready', 'images_ready', 'in_review']),
      supabase
        .from('execution_items')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .eq('status', 'pending')
        .gte('created_at', weekAgoIso),
    ])

  const seoWeek = computeSeoWeek(curKw, priKw)
  const gscRow = gsc.data as { total_clicks: number; total_impressions: number; period_end: string } | null

  // Latest value per social metric key (rows are newest-first).
  const socialByKey = new Map<string, { value: number; at: string }>()
  for (const row of (socialMetrics.data ?? []) as Array<{ metric_key: string; metric_value: number; measured_at: string }>) {
    if (!socialByKey.has(row.metric_key)) {
      socialByKey.set(row.metric_key, { value: Number(row.metric_value), at: row.measured_at })
    }
  }
  const socialLatestAt = socialByKey.get('social.fb.posts_7d')?.at ?? null

  const ads = (adRows.data ?? []) as Array<{
    spend: number | null
    leads: number | null
    messaging_conversations: number | null
    insight_date: string
  }>
  const adLatest = ads.reduce<string | null>((m, r) => (m && m > r.insight_date ? m : r.insight_date), null)

  const seoList = await gatherSeoListWeekly(supabase, clientId, now)

  return {
    client_id: clientId,
    name: (client as { name: string }).name,
    seo_list: seoList,
    seo: {
      ...seoWeek,
      gsc_clicks_28d: gscRow?.total_clicks ?? null,
      gsc_impressions_28d: gscRow?.total_impressions ?? null,
      findings_week: findings.count ?? 0,
      freshness: freshness(current ? `${current}T00:00:00Z` : null, now, SEO_STALE_AFTER_DAYS),
    },
    auto_changes: {
      titles_applied_week: (titles.data ?? []).length,
      titles_with_rank_baseline_week: ((titles.data ?? []) as Array<{ baseline_rank_status?: string | null }>)
        .filter((r) => r.baseline_rank_status === 'ranked' || r.baseline_rank_status === 'not_in_top_n').length,
      freshness: freshness((titles.data as Array<{ created_at: string }> | null)?.[0]?.created_at ?? null, now),
      outcomes_checked_week: (outcomesChecked.data ?? []) as ClientWeekly['auto_changes']['outcomes_checked_week'],
      cards_new_week: cards.count ?? 0,
    },
    blog: {
      generated_week: blogGen.count ?? 0,
      published_week: blogPub.count ?? 0,
      awaiting_review: blogWait.count ?? 0,
    },
    social: {
      posts_7d: socialByKey.get('social.fb.posts_7d')?.value ?? null,
      reactions_7d: socialByKey.get('social.fb.reactions_7d')?.value ?? null,
      days_since_last_post: socialByKey.get('social.fb.days_since_last_post')?.value ?? null,
      reels_awaiting: reels.count ?? 0,
      freshness: freshness(socialLatestAt, now),
    },
    ads: {
      spend_7d: ads.length ? Math.round(ads.reduce((s, r) => s + (r.spend ?? 0), 0) * 100) / 100 : null,
      leads_7d: ads.length ? ads.reduce((s, r) => s + (r.leads ?? 0), 0) : null,
      messages_7d: ads.length ? ads.reduce((s, r) => s + (r.messaging_conversations ?? 0), 0) : null,
      freshness: freshness(adLatest ? `${adLatest}T00:00:00Z` : null, now),
    },
  }
}

/**
 * 周报客户列表，外加「广告一本账」这一段。
 *
 * 一本账要覆盖**所有**有广告花费的客户，不只重点客户，所以它不属于某一个 `ClientWeekly`。
 * 挂在返回的数组上、而不是把返回值改成对象：调用方（定时任务入口）只把这个数组原样交给
 * `renderWeeklyReport`、再对它做 `.map` / `.length`，这样入口文件一个字不用改。
 * 下次有正当理由动入口文件时，换成对象返回。
 */
export type WeeklyClients = ClientWeekly[] & { return_ladders?: ReturnLadderSection }

/** 一本账最多等这么久。整封周报的网关上限约 125 秒（PITFALLS F10），超时就如实写「没读出来」。 */
const RETURN_LADDER_TIMEOUT_MS = 45_000

async function gatherReturnLaddersWithin(supabase: SupabaseClient, now: Date, ms: number): Promise<ReturnLadderSection> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<ReturnLadderSection>((resolve) => {
    timer = setTimeout(() => resolve({ error: `读了 ${Math.round(ms / 1000)} 秒还没读完` }), ms)
  })
  try {
    return await Promise.race([gatherReturnLadders(supabase, now), timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export async function gatherWeeklyReport(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<WeeklyClients> {
  // 跟逐客户取数并行跑，不排在后面（两段串着会逼近网关上限）。
  const laddersPending = gatherReturnLaddersWithin(supabase, now, RETURN_LADDER_TIMEOUT_MS)
  const out: WeeklyClients = []
  for (const clientId of FOCUS_CLIENT_IDS) {
    const weekly = await gatherClient(supabase, clientId, now)
    if (weekly) out.push(weekly)
  }
  out.return_ladders = await laddersPending
  return out
}

// ── Rendering (pure, plain Chinese) ─────────────────────────────────────────────

function stamp(f: FreshnessStamp): string {
  if (f.stale) {
    return `<span style="color:#dc2626;font-weight:700">⚠️ 数据断流${f.latest ? `（最后更新 ${f.latest}）` : '（从未有数据）'}</span>`
  }
  return `<span style="color:#94a3b8">数据截至 ${f.latest}</span>`
}

function line(text: string): string {
  return `<p style="margin:0 0 4px;font-size:14px;color:#334155">${text}</p>`
}

function moverText(m: KeywordMover): string {
  return `「${m.keyword}」第${m.from}名→第${m.to}名`
}

/**
 * 从今日待办挪过来的「系统替你做了什么」（PM 2026-09-26：今日待办只留五类，知会挪周报）。
 * 来源是 `loadManualItems` 里车道为 weekly 的那几种（five-kinds.ts），**不按重点客户过滤** ——
 * 其它在服务的客户的知会也得有人看见。读失败时是 `{ error }`，周报里如实写「没读出来」。
 */
export type WeeklyNotices =
  | { rows: Array<{ client_name: string; what: string; how: string; href: string }> }
  | { error: string }

function renderNotices(notices: WeeklyNotices | undefined): string {
  if (!notices) return ''
  const box = (inner: string) => `
    <div style="margin:0 0 14px;padding:12px 14px;border:1px solid #e2e8f0;border-radius:10px">
      <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#0f172a">📣 这周系统替你做了什么（看一眼就行）</p>
      ${inner}
    </div>`
  if ('error' in notices) {
    return box(line(`<span style="color:#dc2626">⚠️ 这一栏这周没读出来（${esc(notices.error.slice(0, 160))}）—— 不等于这周没事</span>`))
  }
  if (notices.rows.length === 0) return ''
  return box(notices.rows.map((n) => `
      <p style="margin:0 0 6px;font-size:13px;color:#334155"><b>${esc(n.client_name)}</b>：${esc(n.what)}<br/>
        <span style="color:#64748b">→ ${esc(n.how)}${n.href ? ` · <a href="${esc(n.href)}" style="color:#0891b2">去看看</a>` : ''}</span>
      </p>`).join(''))
}

const RANK_REASON_LABEL: Record<string, string> = {
  reverted: '改完又被撤回了',
  superseded: '两周内又改过这一页，没法单独判',
  no_baseline: '改的时候没能记下排名',
  baseline_other_own_page: '改的时候排在前面的是站内另一页',
  live_title_mismatch: '线上现在的标题不是我们写的那个',
  fetch_failed: '多次查谷歌排名都失败了',
  url_changed: '后来排在前面的是站内另一页',
  never_ranked: '前几页里一直没有这一页',
}

/** One plain-language line for a target-keyword rank verdict. Never says "有效"/"变差": a rank move is not a verdict on the title. */
function rankLineText(o: ClientWeekly['auto_changes']['outcomes_checked_week'][number]): string {
  const base = o.baseline_rank_group ?? null
  const delta = o.verdict_detail?.median_delta ?? null
  const before = base !== null ? `第 ${base} 名` : '榜外'
  const after = base !== null && delta !== null ? `第 ${base + delta} 名` : '—'
  switch (o.rank_verdict) {
    case 'no_detectable_change': return `目标词排名 ${before} → ${after} · ➖ 没看出变化`
    case 'rank_moved_up': return `目标词排名 ${before} → ${after} · 🔺 上升了 ${Math.abs(delta ?? 0)} 名`
    case 'rank_moved_down': return `目标词排名 ${before} → ${after} · 🔻 下降了 ${Math.abs(delta ?? 0)} 名`
    case 'entered_top_n': return `目标词排名 ${before} → 进入前几页 · 🔺 新上榜`
    case 'dropped_out': return `目标词排名 ${before} → 榜外 · 🔻 掉出榜`
    case 'unstable': return '目标词排名忽进忽出 · ❔ 不下结论'
    case 'confounded': return '目标词排名有变动，但同期没改的词也在同向变动 · ❔ 不下结论'
    default: return `❔ 没测成（${RANK_REASON_LABEL[o.verdict_detail?.reason ?? ''] ?? '原因不明'}）`
  }
}

/** 某个客户的「广告一本账」块：有数出数，读失败如实写，没广告花费就不出这一块。 */
function ladderBlockFor(clientId: string, section: ReturnLadderSection | undefined): string {
  if (!section) return ''
  if ('error' in section) return renderLadderUnavailable(section.error)
  const row = section.rows.find((r) => r.client_id === clientId)
  if (row) return renderLadderBlock(row)
  const failure = section.failed.find((f) => f.client_id === clientId)
  return failure ? renderLadderUnavailable(failure.error) : ''
}

export function renderWeeklyReport(clients: WeeklyClients, nzDateLabel: string, notices?: WeeklyNotices): {
  subject: string
  html: string
} {
  const ladders = clients.return_ladders
  const sections = clients.map((c) => {
    const seoDelta = c.seo.page1_now - c.seo.page1_prior
    const seoLines = [
      line(
        `首页词 <b>${c.seo.page1_now}</b> 个（${seoDelta === 0 ? '持平' : seoDelta > 0 ? `多了 ${seoDelta} 个 🔺` : `少了 ${-seoDelta} 个 🔻`}），前三名 <b>${c.seo.top3_now}</b> 个`,
      ),
      c.seo.gsc_clicks_28d !== null
        ? line(`近 28 天谷歌点击 <b>${c.seo.gsc_clicks_28d}</b> 次，曝光 ${c.seo.gsc_impressions_28d ?? '—'} 次`)
        : line('谷歌点击数据缺失'),
      c.seo.movers_up.length > 0 ? line(`涨得最好：${c.seo.movers_up.map(moverText).join('；')}`) : '',
      c.seo.movers_down.length > 0 ? line(`跌得要看：${c.seo.movers_down.map(moverText).join('；')}`) : '',
      line(`巡逻员本周抓到 ${c.seo.findings_week} 个新发现`),
      ...seoListLines(c.seo_list ?? null, `https://app.magicengine.com.au/dashboard/clients/${c.client_id}/execution`).map(line),
    ].filter(Boolean).join('')

    const OUTCOME_LABEL: Record<string, string> = {
      improved: '✅ 改好了',
      flat: '➖ 没变化',
      regressed: '⚠️ 变差了（已下发人工任务，去点 PR 的 Revert 按钮改回去）',
      insufficient_data: '❔ 数据还不够，先不判',
    }
    const rankLines = c.auto_changes.outcomes_checked_week.filter((o) => o.rank_verdict)
    const outcomeLines = c.auto_changes.outcomes_checked_week
      .map((o) => {
        if (o.rank_verdict) return line(`&nbsp;&nbsp;/${o.page_slug}：${rankLineText(o)}`)
        const before = o.baseline_ctr !== null ? `${(o.baseline_ctr * 100).toFixed(2)}%` : '—'
        const after = o.observed_ctr !== null ? `${(o.observed_ctr * 100).toFixed(2)}%` : '—'
        const label = o.outcome ? OUTCOME_LABEL[o.outcome] ?? o.outcome : '—'
        return line(`&nbsp;&nbsp;/${o.page_slug}：点击率 ${before} → ${after}（曝光 ${o.observed_impressions ?? '—'} 次）· ${label}`)
      })
      .join('')
      + (rankLines.length > 0 ? line('&nbsp;&nbsp;ℹ️ 排名没动 ≠ 改动没用：标题主要影响点击率，而这个站的流量还不足以测出点击率的变化。排名变动也只说明发生了什么，不证明是标题造成的。') : '')

    const cardsLine = (c.auto_changes.cards_new_week ?? 0) > 0
      ? line(`看板上本周新排了 ${c.auto_changes.cards_new_week} 张建议卡还没做（系统和 FDE 在推，不用你挑）· <a href="https://app.magicengine.com.au/dashboard/clients/${c.client_id}/execution" style="color:#0891b2">看看板</a>`)
      : ''
    const autoLines = (c.auto_changes.titles_applied_week > 0
      ? line(`系统本周自动改了 <b>${c.auto_changes.titles_applied_week}</b> 个页面标题/描述（网站上已生效）${
          c.auto_changes.titles_with_rank_baseline_week !== undefined
            ? `，其中 ${c.auto_changes.titles_with_rank_baseline_week} 个记下了改动前的排名、日后能验收`
            : ''
        }`)
      : line('本周没有自动改动'))
      + outcomeLines
      + cardsLine

    const blogLines = [
      line(`本周生成 ${c.blog.generated_week} 篇、发布 ${c.blog.published_week} 篇`),
      c.blog.awaiting_review > 0
        ? line(`<b>${c.blog.awaiting_review} 篇草稿等你点头</b> · <a href="https://app.magicengine.com.au/dashboard/clients/${c.client_id}/blog" style="color:#0891b2">去审</a>`)
        : '',
    ].filter(Boolean).join('')

    const socialLines = c.social.freshness.stale
      ? line(stamp(c.social.freshness))
      : [
          line(`近 7 天发帖 <b>${c.social.posts_7d ?? 0}</b> 条，互动 ${c.social.reactions_7d ?? 0} 次`),
          c.social.days_since_last_post !== null && c.social.days_since_last_post >= 7
            ? line(`<b style="color:#dc2626">已断更 ${c.social.days_since_last_post} 天</b>`)
            : '',
        ].filter(Boolean).join('')
    const reelsLine = c.social.reels_awaiting > 0
      ? line(`${c.social.reels_awaiting} 条成片等你审 · <a href="https://app.magicengine.com.au/dashboard/factory" style="color:#0891b2">去看片</a>`)
      : ''

    const adsLines = c.ads.freshness.stale
      ? line(stamp(c.ads.freshness))
      : line(
          `近 7 天花费 <b>$${c.ads.spend_7d ?? 0}</b>，进线 ${c.ads.leads_7d ?? 0} 个，私信 ${c.ads.messages_7d ?? 0} 条`,
        )

    const block = (emoji: string, title: string, body: string, f?: FreshnessStamp) => `
      <div style="margin:0 0 10px;padding:12px 14px;border:1px solid #e2e8f0;border-radius:10px">
        <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#0f172a">${emoji} ${title}
          ${f && !f.stale ? `<span style="float:right;font-size:11px;font-weight:400">${stamp(f)}</span>` : ''}
        </p>
        ${body}
      </div>`

    return `
      <h3 style="margin:18px 0 8px;font-size:16px;color:#0f172a">${c.name}</h3>
      ${block('🔍', 'SEO 排名', seoLines, c.seo.freshness)}
      ${block('🤖', '系统自动改动', autoLines)}
      ${block('📝', 'Blog', blogLines)}
      ${block('📱', '社媒', socialLines + reelsLine, c.social.freshness)}
      ${block('📣', '社媒广告', adsLines, c.ads.freshness)}
      ${ladderBlockFor(c.client_id, ladders)}`
  }).join('') + renderOtherLadders(ladders, clients.map((c) => c.client_id))

  const html = `
    <div style="font-family:sans-serif;max-width:640px;margin:0 auto;padding:24px">
      <h2 style="margin:0 0 4px;font-size:18px;color:#0f172a">📊 每周盯梢报告 · ${nzDateLabel}</h2>
      <p style="margin:0 0 16px;font-size:13px;color:#64748b">
        两家客户过去一周的排名、自动改动、内容与广告。标了 ⚠️ 的是数据断了，不是没事。
      </p>
      ${renderNotices(notices)}
      ${sections}
      <p style="margin-top:16px;font-size:12px;color:#94a3b8">
        每周一早自动发。日常待办看 <a href="https://app.magicengine.com.au/dashboard/today" style="color:#0891b2">今日待办</a>。
      </p>
    </div>`

  return { subject: `📊 每周盯梢报告 · ${nzDateLabel}`, html }
}
