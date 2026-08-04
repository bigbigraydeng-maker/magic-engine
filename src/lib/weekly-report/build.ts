/**
 * Weekly watchdog report (22.E.S18 · PM 拍板 2026-07-31 决定③).
 *
 * Monday-morning plain-Chinese email to the PM: per focus client —
 *   SEO      排名变化(首页词/前三词/涨跌明星) + GSC 点击曝光 + 巡逻产出
 *   自动改动  本周系统自己动手改了什么(Oztop 标题队列 / 卫生清理)
 *   Blog     本周生成/发布/待点头
 *   社媒      发帖数/互动/断更天数/最佳帖(social.fb.* 滚动指标)
 *   社媒广告  花费/进线/私信(ad_daily_insights 7 天)
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
import { FOCUS_CLIENT_IDS } from '@/lib/pm-todo/daily-todo'

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
  auto_changes: {
    titles_applied_week: number
    freshness: FreshnessStamp
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

  const [curKw, priKw, gsc, findings, titles, blogGen, blogPub, blogWait, socialMetrics, adRows, reels] =
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
      supabase
        .from('seo_meta_log')
        .select('created_at')
        .eq('client_id', clientId)
        .eq('wp_updated', true)
        .gte('created_at', weekAgoIso),
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

  return {
    client_id: clientId,
    name: (client as { name: string }).name,
    seo: {
      ...seoWeek,
      gsc_clicks_28d: gscRow?.total_clicks ?? null,
      gsc_impressions_28d: gscRow?.total_impressions ?? null,
      findings_week: findings.count ?? 0,
      freshness: freshness(current ? `${current}T00:00:00Z` : null, now, SEO_STALE_AFTER_DAYS),
    },
    auto_changes: {
      titles_applied_week: (titles.data ?? []).length,
      freshness: freshness((titles.data as Array<{ created_at: string }> | null)?.[0]?.created_at ?? null, now),
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

export async function gatherWeeklyReport(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<ClientWeekly[]> {
  const out: ClientWeekly[] = []
  for (const clientId of FOCUS_CLIENT_IDS) {
    const weekly = await gatherClient(supabase, clientId, now)
    if (weekly) out.push(weekly)
  }
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

export function renderWeeklyReport(clients: ClientWeekly[], nzDateLabel: string): {
  subject: string
  html: string
} {
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
    ].filter(Boolean).join('')

    const autoLines = c.auto_changes.titles_applied_week > 0
      ? line(`系统本周自动改了 <b>${c.auto_changes.titles_applied_week}</b> 个页面标题/描述（网站上已生效）`)
      : line('本周没有自动改动')

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
      ${block('📣', '社媒广告', adsLines, c.ads.freshness)}`
  }).join('')

  const html = `
    <div style="font-family:sans-serif;max-width:640px;margin:0 auto;padding:24px">
      <h2 style="margin:0 0 4px;font-size:18px;color:#0f172a">📊 每周盯梢报告 · ${nzDateLabel}</h2>
      <p style="margin:0 0 16px;font-size:13px;color:#64748b">
        两家客户过去一周的排名、自动改动、内容与广告。标了 ⚠️ 的是数据断了，不是没事。
      </p>
      ${sections}
      <p style="margin-top:16px;font-size:12px;color:#94a3b8">
        每周一早自动发。日常待办看 <a href="https://app.magicengine.com.au/dashboard/today" style="color:#0891b2">今日待办</a>。
      </p>
    </div>`

  return { subject: `📊 每周盯梢报告 · ${nzDateLabel}`, html }
}
