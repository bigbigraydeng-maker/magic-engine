/**
 * Turns candidates into list items: what / how / href, evidence with a confidence
 * label, and a failure criterion (docs/specs/2026-10-04-seo-specialist-capability-map-v0.1.md §3).
 *
 * Confidence: 确认 = a number straight from a stored snapshot; 很可能 = a text match
 * on our own pages; 假设 = anything not looked up. A "which page ranks for this word"
 * claim is never 确认 here — the platform does not store the ranking URL.
 */

import { canonicalUrl } from '@/lib/url/canonical-url'
import type { CtrGapCandidate, KeywordMember, NearMissCandidate, SitePageRow } from './candidates'

export const SEO_PLAN_LOOP_MARKER = 'seo_goal_v1'
export const PLAN_ACTION = {
  STRENGTHEN_PAGE: 'seo.plan.strengthen_page',
  DRAFT_POST: 'seo.plan.draft_post',
} as const
export type PlanActionType = (typeof PLAN_ACTION)[keyof typeof PLAN_ACTION]

export type Confidence = '确认' | '很可能' | '假设'

export interface EvidenceLine {
  claim: string
  source: string
  fetched_at: string
  confidence: Confidence
}

export interface PlanItemDraft {
  actionType: PlanActionType
  title: string
  description: string
  keyword: string | null
  url: string | null
  dueDate: string
  stepsJson: Record<string, unknown>
}

export interface ItemContext {
  clientId: string
  goalId: string
  planWeek: string
  snapshotDate: string
  gscDay: string
  /** Direct link to the in-app SEO Intelligence page for this client. */
  intelligenceHref: string
  /** Impressions per canonical own-page URL (28d) — picks the main page among matches. */
  pageImpressions: ReadonlyMap<string, number>
}

const TITLE_TRUNCATION_CHARS = 60

function dueDateFor(planWeek: string, index: number): string {
  const d = new Date(`${planWeek}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1 + (index % 4)) // Tue..Fri
  return d.toISOString().slice(0, 10)
}

function variantsLine(members: KeywordMember[]): string {
  if (members.length < 2) return ''
  const rest = members.slice(1).map(m => `${m.keyword}（第${m.position}名，月搜${m.volume}）`).join('、')
  return `同一意思的其他说法已并入本项：${rest}。`
}

export function buildNearMissItem(
  c: NearMissCandidate,
  matches: SitePageRow[],
  ctx: ItemContext,
  index: number,
): PlanItemDraft {
  const p = c.primary
  const failure = `28 天后「${p.keyword}」排名没有上移至少 3 名，判没起效（不做点击归因）`
  const evidence: EvidenceLine[] = [
    { claim: `「${p.keyword}」排第 ${p.position}，月搜 ${p.volume}，难度 ${p.kd}`, source: 'keyword_snapshots（DataForSEO 周快照）', fetched_at: ctx.snapshotDate, confidence: '确认' },
    {
      claim: matches.length === 0
        ? '站内标题/H1/路径含全部词的页面有 0 个（文本匹配，不认同义词/别名，不能当作"站内没有"）'
        : `站内标题/H1/路径含全部词的页面有 ${matches.length} 个（文本匹配，未核实谁在排）`,
      source: 'client_site_pages 文本匹配',
      fetched_at: ctx.snapshotDate,
      confidence: matches.length === 0 ? '假设' : '很可能',
    },
  ]
  // pageImpressions is keyed by canonical URL (see canonicalUrl), so look up the same way.
  const imp = (url: string) => ctx.pageImpressions.get(canonicalUrl(url) ?? url) ?? 0
  const main = [...matches].sort((a, b) => imp(b.url) - imp(a.url))[0]

  if (!main) {
    const how = [
      '① 先确认站内真的没有覆盖这个词的页面：系统只做了字面匹配（0 个），不认同义词/别名（例如 imperial palace 与 forbidden city 是同一主题）——请用同义说法再搜一次站内；若已有同主题页，改为加强该页，不要再写新文。',
      '② 走周博客管线写一篇，主关键词填上面这个词，并带上搜索量/难度（blog 草稿必须记录 primary_keyword / keyword_volume / keyword_kd）。',
      '③ 写之前先对官网真实产品页核对事实，不编价格、日期、行程细节；文章里不放竞品品牌词。',
    ].join('\n')
    return {
      actionType: PLAN_ACTION.DRAFT_POST,
      title: `写新文章：${p.keyword}（第${p.position}名，月搜${p.volume}）`,
      description: [
        `【为什么】${evidence[0].claim}，站内没有明显对应页面；这是差一步上第一页的词（估算上限约 +${c.potentialClicks} 次点击/月，未经验证的估算）。`,
        variantsLine(c.members),
        `【怎么做】\n${how}`,
        `【怎么算没起效】${failure}`,
        `【证据】${evidence.map(e => `${e.claim}〔${e.confidence}｜${e.source}｜${e.fetched_at}〕`).join('；')}`,
        `【链接】${ctx.intelligenceHref}`,
      ].filter(Boolean).join('\n'),
      keyword: p.keyword,
      url: null,
      dueDate: dueDateFor(ctx.planWeek, index),
      stepsJson: baseSteps(ctx, 'near_miss', p.keyword, null, evidence, failure, {
        opportunity: { members: c.members, potential_clicks_estimate: c.potentialClicks },
        baseline: { rank: p.position, volume: p.volume, kd: p.kd, snapshot_date: ctx.snapshotDate },
        verify: { type: 'blog_published' },
      }),
    }
  }

  const split = matches.length >= 2
  const how = [
    '① 先看这页收录了吗（后台"收录状态"），没收录先解决收录，不改内容。',
    split
      ? `② 站内有 ${matches.length} 个页面都沾这个词：${matches.slice(0, 4).map(m => m.title ?? m.url).join(' ｜ ')}。先决定哪页当主页，其余往主页汇内链、不再抢同一个词。`
      : '② 确认没有别的自家页面在抢同一个词。',
    titleCheck(main.title),
    `④ 补充覆盖该词意图的小节，并在相关页面加指向它的内链（至少 ${2} 处）。`,
  ].join('\n')
  return {
    actionType: PLAN_ACTION.STRENGTHEN_PAGE,
    title: `加强页面：${p.keyword}（第${p.position}名，月搜${p.volume}）`,
    description: [
      `【为什么】${evidence[0].claim}；站内最可能的对应页面：${main.url}（估算上限约 +${c.potentialClicks} 次点击/月，未经验证）。`,
      variantsLine(c.members),
      `【怎么做】\n${how}`,
      `【怎么算没起效】${failure}`,
      `【证据】${evidence.map(e => `${e.claim}〔${e.confidence}｜${e.source}｜${e.fetched_at}〕`).join('；')}`,
      `【链接】${main.url} ｜ ${ctx.intelligenceHref}`,
    ].filter(Boolean).join('\n'),
    keyword: p.keyword,
    url: main.url,
    dueDate: dueDateFor(ctx.planWeek, index),
    stepsJson: baseSteps(ctx, 'near_miss', p.keyword, main.url, evidence, failure, {
      opportunity: { members: c.members, matched_pages: matches.map(m => m.url), potential_clicks_estimate: c.potentialClicks },
      baseline: { rank: p.position, volume: p.volume, kd: p.kd, snapshot_date: ctx.snapshotDate, word_count: main.word_count },
      verify: { type: 'page_strengthened' },
    }),
  }
}

export function buildCtrGapItem(
  c: CtrGapCandidate,
  page: SitePageRow | undefined,
  ctx: ItemContext,
  index: number,
): PlanItemDraft {
  const failure = '28 天后该页曝光不变而点击率仍低于排名对应水平，且页面无实质改动，判没起效（不做点击归因，只看页面是否真改了）'
  const evidence: EvidenceLine[] = [
    {
      claim: `该页近 28 天曝光 ${c.impressions}、平均排第 ${c.position.toFixed(1)}、点击率 ${(c.ctr * 100).toFixed(2)}%（该排名常见水平约 ${(c.benchmark * 100).toFixed(1)}%）`,
      source: 'gsc_page_daily（谷歌逐页逐天）',
      fetched_at: ctx.gscDay,
      confidence: '确认',
    },
  ]
  const how = [
    '① 先看这页收录了吗。',
    '② 看是否有别的自家页面在分食同一主题（后台"逐页对比"同主题页面的曝光）。',
    titleCheck(page?.title ?? null),
    '④ 标题或首段没写清读者要的答案、或被别的搜索结果板块压住，才考虑改内容；改动后请记下改了什么，便于核对。',
  ].join('\n')
  return {
    actionType: PLAN_ACTION.STRENGTHEN_PAGE,
    title: `加强页面：点击率偏低 ${c.url}`,
    description: [
      `【为什么】${evidence[0].claim}。已排在第一页但点的人少（点击率偏低，估算上限约 +${c.potentialClicks} 次点击/28 天，未经验证）。`,
      `【怎么做】\n${how}`,
      `【怎么算没起效】${failure}`,
      `【证据】${evidence.map(e => `${e.claim}〔${e.confidence}｜${e.source}｜${e.fetched_at}〕`).join('；')}`,
      `【链接】${c.url} ｜ ${ctx.intelligenceHref}`,
    ].join('\n'),
    keyword: null,
    url: c.url,
    dueDate: dueDateFor(ctx.planWeek, index),
    stepsJson: baseSteps(ctx, 'ctr_gap', null, c.url, evidence, failure, {
      opportunity: { impressions: c.impressions, clicks: c.clicks, position: c.position, ctr: c.ctr, benchmark: c.benchmark, potential_clicks_estimate: c.potentialClicks },
      baseline: { snapshot_date: ctx.gscDay, word_count: page?.word_count ?? null, title: page?.title ?? null },
      verify: { type: 'page_strengthened' },
    }),
  }
}

function titleCheck(title: string | null): string {
  if (!title) return '③ 标题体检：没取到该页标题，请直接看页面。'
  const len = title.length
  return len > TITLE_TRUNCATION_CHARS
    ? `③ 标题体检：「${title}」共 ${len} 个字符，超过约 ${TITLE_TRUNCATION_CHARS}，在谷歌里会被截断，把关键词放前面并缩短（若该页在标题保护名单内则只能人工改）。`
    : `③ 标题体检：「${title}」${len} 个字符，不会被截断，长度不是问题。`
}

function baseSteps(
  ctx: ItemContext,
  kind: 'near_miss' | 'ctr_gap',
  keyword: string | null,
  url: string | null,
  evidence: EvidenceLine[],
  failure: string,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    loop: SEO_PLAN_LOOP_MARKER,
    plan_week: ctx.planWeek,
    goal_id: ctx.goalId,
    kind,
    // TOP-LEVEL on purpose: executionItemDedupKey only reads these two.
    keyword,
    url,
    evidence,
    fail_criterion: failure,
    href: url ?? ctx.intelligenceHref,
    ...extra,
  }
}
