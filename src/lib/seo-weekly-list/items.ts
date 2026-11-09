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
import { DECAY_CAUSE_LABEL, type DecayCandidate } from './decay'
import { CAUSE_LABEL, type CtrDiagnosis } from './ctr-diagnosis'
import type { KeywordPageCheck } from './keyword-page-check'

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
  check?: KeywordPageCheck,
): PlanItemDraft {
  const p = c.primary
  const failure = `28 天后「${p.keyword}」排名没有上移至少 3 名，判没起效（不做点击归因）`
  const evidence: EvidenceLine[] = [
    { claim: `「${p.keyword}」排第 ${p.position}，月搜 ${p.volume}，难度 ${p.kd}`, source: '关键词排名周快照（Keyword Intelligence）', fetched_at: ctx.snapshotDate, confidence: '确认' },
    {
      claim: matches.length === 0
        ? '站内标题/H1/路径含全部词的页面有 0 个（文本匹配，不认同义词/别名，不能当作"站内没有"）'
        : `站内标题/H1/路径含全部词的页面有 ${matches.length} 个（文本匹配，未核实谁在排）`,
      source: '站内页面文本匹配',
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
        `【为什么】${evidence[0].claim}，站内没有明显对应页面；这是差一步上第一页的词（粗估增量约 +${c.potentialClicks} 次点击/月，按通用点击率曲线算，只用于排序，不是预测）。`,
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

  if (check) evidence.push(...keywordPageEvidence(check, ctx))

  const split = matches.length >= 2
  const how = [
    '① 先看这页收录了吗（后台"收录状态"），没收录先解决收录，不改内容。',
    split
      ? `② 站内有 ${matches.length} 个页面都沾这个词：${matches.slice(0, 4).map(m => m.title ?? m.url).join(' ｜ ')}。先决定哪页当主页，其余往主页汇内链、不再抢同一个词。`
      : '② 确认没有别的自家页面在抢同一个词。',
    titleCheck(null),
    '④ 补充覆盖该词意图的小节，并在相关页面加指向它的内链（至少 2 处）。系统核对的是"页面正文是否实质变长"，请确实补内容，而不只是改导航或排版。',
  ].join('\n')
  return {
    actionType: PLAN_ACTION.STRENGTHEN_PAGE,
    title: `加强页面：${p.keyword}（第${p.position}名，月搜${p.volume}）`,
    description: [
      `【为什么】${evidence[0].claim}；站内最可能的对应页面：${main.url}（粗估增量约 +${c.potentialClicks} 次点击/月，按通用点击率曲线算，只用于排序）。`,
      variantsLine(c.members),
      check ? `【系统预诊断】${check.verdict === 'proceed' ? '可直接按这页处理' : '需要人先看一眼'}：${check.reasons.join('；')}` : '',
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
      baseline: { rank: p.position, volume: p.volume, kd: p.kd, snapshot_date: ctx.snapshotDate, word_count: main.word_count, crawled_at: main.crawled_at ?? null },
      verify: { type: 'page_strengthened' },
      ...(check ? { prediagnosis: check } : {}),
    }),
  }
}

export function buildCtrGapItem(
  c: CtrGapCandidate,
  page: SitePageRow | undefined,
  ctx: ItemContext,
  index: number,
  diag?: CtrDiagnosis,
): PlanItemDraft {
  const failure = '28 天后该页曝光不变而点击率仍低于排名对应水平，且页面无实质改动，判没起效（不做点击归因，只看页面是否真改了）'
  const evidence: EvidenceLine[] = [
    {
      claim: `该页近 28 天曝光 ${c.impressions}、平均排第 ${c.position.toFixed(1)}、点击率 ${(c.ctr * 100).toFixed(2)}%（该排名常见水平约 ${(c.benchmark * 100).toFixed(1)}%）`,
      source: '谷歌搜索数据（逐页逐天）',
      fetched_at: ctx.gscDay,
      confidence: '确认',
    },
  ]
  if (diag) evidence.push(...diagnosisEvidence(diag, ctx))
  const how = (diag ? diagnosisHow(diag) : [
    '① 先看这页收录了吗。',
    '② 看是否有别的自家页面在分食同一主题（后台"逐页对比"同主题页面的曝光）。',
    titleCheck(null),
    '④ 标题或首段没写清读者要的答案、或被别的搜索结果板块压住，才考虑改内容；改动后请记下改了什么，便于核对。',
  ]).join('\n')
  return {
    actionType: PLAN_ACTION.STRENGTHEN_PAGE,
    title: `加强页面：点击率偏低 ${c.url}`,
    description: [
      `【为什么】${evidence[0].claim}。已排在第一页但点的人少（点击率偏低，粗估增量约 +${c.potentialClicks} 次点击/28 天，按通用点击率曲线算，只用于排序）。`,
      diag ? `【系统诊断】${CAUSE_LABEL[diag.cause]}（机械可核对的事实，见证据；不代表一定是这个原因）` : '',
      diag && diag.quickFixes.length > 0 ? `【顺手可修】${diag.quickFixes.join('；')}` : '',
      `【怎么做】\n${how}`,
      `【怎么算没起效】${failure}`,
      '【自动记录】本页如被系统的每周自动改标题流程改上线，这条会自动记为"已执行"（只证明改了，不证明有效）。',
      `【证据】${evidence.map(e => `${e.claim}〔${e.confidence}｜${e.source}｜${e.fetched_at}〕`).join('；')}`,
      `【链接】${c.url} ｜ ${ctx.intelligenceHref}`,
    ].filter(Boolean).join('\n'),
    keyword: null,
    url: c.url,
    dueDate: dueDateFor(ctx.planWeek, index),
    stepsJson: baseSteps(ctx, 'ctr_gap', null, c.url, evidence, failure, {
      opportunity: { impressions: c.impressions, clicks: c.clicks, position: c.position, ctr: c.ctr, benchmark: c.benchmark, potential_clicks_estimate: c.potentialClicks },
      baseline: { snapshot_date: ctx.gscDay, word_count: page?.word_count ?? null, crawled_at: page?.crawled_at ?? null, title: page?.title ?? null },
      verify: { type: 'page_changed' },
      ...(diag ? { ctr_diagnosis: diag } : {}),
    }),
  }
}

const DECAY_CAUSE_STEP: Record<DecayCandidate['cause'], string> = {
  rank_loss: '③ 对比这页前一期的内容：有没有过时的信息（日期、价格、行程、政策）、少了关键小节；先补最新信息，再补缺的小节，并检查有没有内链指向它。',
  visibility_down: '③ 先判断是不是季节或需求本身变少（和去年同期比；没有去年数据就写明"假设"）。不是季节的话，看它之前能露出的搜索词是不是丢了，针对丢的词补内容。',
  ctr_drop: '③ 曝光没少，重点看线上真实标题和描述是否还吸引人、是否被别的搜索板块压住（用"点击率偏低"那类任务的诊断方法）；内容不用大改。',
  mixed: '③ 原因不单一：先做①②，再对比这页前一期的内容和搜索词，列出你看到的差异后再决定改什么。',
}

export function buildDecayItem(
  c: DecayCandidate,
  page: SitePageRow | undefined,
  ctx: ItemContext,
  index: number,
): PlanItemDraft {
  const failure = '下次清单（14 天）页面没有实质改动，判没执行；改动 28 天后该页点击仍低于前一期的 70%，判没起效（点击回升与"页面真改了"分开记，不做点击归因）'
  const pct = (r: number) => `${Math.round((1 - r) * 100)}%`
  const evidence: EvidenceLine[] = [
    {
      claim: `该页最近 28 天点击 ${c.recentClicks}、曝光 ${c.recentImpressions}${c.recentPosition === null ? '（没有曝光）' : `、平均排第 ${c.recentPosition.toFixed(1)}`}；前 28 天点击 ${c.priorClicks}、曝光 ${c.priorImpressions}、平均排第 ${c.priorPosition.toFixed(1)}。点击少了 ${pct(c.pageRatio)}`,
      source: '谷歌搜索数据（逐页逐天，两个 28 天窗口）',
      fetched_at: ctx.gscDay,
      confidence: '确认',
    },
    {
      claim: `同期全站点击${c.siteRatio >= 1 ? `多了 ${Math.round((c.siteRatio - 1) * 100)}%` : `少了 ${pct(c.siteRatio)}`}，所以这页是明显比全站更差，不是整站波动`,
      source: '谷歌搜索数据（全站合计）',
      fetched_at: ctx.gscDay,
      confidence: '确认',
    },
    {
      claim: `系统读数：${DECAY_CAUSE_LABEL[c.cause]}（只是曝光、排名数字的机械判断，不代表一定是这个原因）`,
      source: '谷歌搜索数据（曝光、平均排名对比）',
      fetched_at: ctx.gscDay,
      confidence: '很可能',
    },
  ]
  const how = [
    '① 先看这页收录了吗、线上能不能正常打开，有没有被误设成不让收录。',
    '② 看这页主要搜索词的排名有没有被竞品或自家别的页面拿走（后台"逐页对比"同主题页面的曝光）。',
    DECAY_CAUSE_STEP[c.cause],
    '④ 改完请记下改了什么，便于核对。',
  ].join('\n')
  return {
    actionType: PLAN_ACTION.STRENGTHEN_PAGE,
    title: `加强页面：流量下滑 ${c.url}`,
    description: [
      `【为什么】${evidence[0].claim}。同期${evidence[1].claim.replace('，所以这页是明显比全站更差，不是整站波动', '')}，这页掉得明显比全站多（粗估少了约 ${c.potentialClicks} 次点击/28 天，只用于排序）。`,
      `【系统读数】${DECAY_CAUSE_LABEL[c.cause]}（机械可核对的数字，见证据；不代表一定是这个原因）`,
      `【怎么做】\n${how}`,
      `【怎么算没起效】${failure}`,
      '【自动记录】本页如被系统的每周自动改标题流程改上线，这条会自动记为"已执行"（只证明改了，不证明有效）。',
      `【证据】${evidence.map(e => `${e.claim}〔${e.confidence}｜${e.source}｜${e.fetched_at}〕`).join('；')}`,
      `【链接】${c.url} ｜ ${ctx.intelligenceHref}`,
    ].join('\n'),
    keyword: null,
    url: c.url,
    dueDate: dueDateFor(ctx.planWeek, index),
    stepsJson: baseSteps(ctx, 'traffic_decay', null, c.url, evidence, failure, {
      opportunity: {
        prior_clicks: c.priorClicks, recent_clicks: c.recentClicks,
        prior_impressions: c.priorImpressions, recent_impressions: c.recentImpressions,
        prior_position: c.priorPosition, recent_position: c.recentPosition,
        page_ratio: c.pageRatio, site_ratio: c.siteRatio, cause: c.cause, potential_clicks_estimate: c.potentialClicks,
      },
      baseline: { snapshot_date: ctx.gscDay, word_count: page?.word_count ?? null, crawled_at: page?.crawled_at ?? null, title: page?.title ?? null },
      verify: { type: 'page_changed' },
    }),
  }
}

function diagnosisEvidence(d: CtrDiagnosis, ctx: ItemContext): EvidenceLine[] {
  const out: EvidenceLine[] = []
  out.push(d.liveTitle
    ? { claim: `线上真实标题：「${d.liveTitle}」（${d.liveTitle.length} 个字符）`, source: '线上页面 HTML 的 <title>', fetched_at: ctx.gscDay, confidence: '确认' }
    : { claim: '没取到线上真实标题（不使用站点抓取表里的标题——那是页面大标题，不是搜索结果标题）', source: '线上页面 HTML', fetched_at: ctx.gscDay, confidence: '假设' })
  if (d.queriesAvailable) {
    const lines = d.topQueries.slice(0, 5).map(q => `「${q.query}」曝光${q.impressions}、点击${q.clicks}、排第${q.position.toFixed(1)}${q.underperforming ? '（点击率明显低于该名次常见水平）' : ''}${q.inTitle ? '' : '（标题里没有）'}`)
    out.push({ claim: `这页自己的前几个搜索词：${lines.join('；')}`, source: '谷歌搜索数据（该页查询）', fetched_at: ctx.gscDay, confidence: '确认' })
    if (d.lowRankShare !== null) {
      out.push({ claim: `这些词里 ${Math.round(d.lowRankShare * 100)}% 的曝光来自排第 8 名及以后的词；品牌词占 ${Math.round((d.brandedShare ?? 0) * 100)}%`, source: '谷歌搜索数据（该页查询）', fetched_at: ctx.gscDay, confidence: '确认' })
    }
  }
  if (d.siblings.length > 0) {
    out.push({
      claim: `同主题自家页面：${d.siblings.map(s => `${s.url}（曝光${s.impressions}、点击${s.clicks}，共同词：${s.sharedTerms.join('/')}）`).join('；')}`,
      source: '站内页面文本匹配 + 谷歌逐页数据', fetched_at: ctx.gscDay, confidence: '很可能',
    })
  }
  return out
}

function keywordPageEvidence(check: KeywordPageCheck, ctx: ItemContext): EvidenceLine[] {
  const out: EvidenceLine[] = []
  if (check.ranking.length > 0) {
    const list = check.ranking.map(r => `${r.url}（曝光${r.impressions}、点击${r.clicks}、平均排第${r.position.toFixed(1)}）`).join('；')
    out.push({ claim: `谷歌记录显示这些自家页在「${check.keyword}」上有曝光：${list}`, source: '谷歌搜索数据（该页查询）', fetched_at: ctx.gscDay, confidence: '确认' })
  }
  if (check.unreadableUrls.length > 0) {
    out.push({ claim: `${check.unreadableUrls.length} 个页面的搜索词没读到：${check.unreadableUrls.join('、')}（这部分结论不完整）`, source: '谷歌搜索数据（该页查询）', fetched_at: ctx.gscDay, confidence: '假设' })
  }
  return out
}

function diagnosisHow(d: CtrDiagnosis): string[] {
  const steps = ['① 先看这页收录了吗。']
  if (d.siblings.length > 0) {
    steps.push(`② 先处理分食：${d.siblings.map(s => s.url).join('、')} 与本页争同一主题。决定哪页当主页，另一页的标题改成与主页明显不同的角度（或把它的内链汇向主页），不要两页用近乎相同的标题。`)
  } else {
    steps.push('② 站内没有发现明显的同主题页面分食。')
  }
  if (d.cause === 'low_rank_queries') {
    steps.push('③ 曝光主要来自排第 8 名及以后的词：先提升名次（补覆盖这些词的内容、加内链），不要急着改标题。')
  } else if (d.titleMisses.length > 0) {
    steps.push(`③ 这页最大的搜索词「${d.titleMisses.join('」「')}」没有出现在标题里：把最大的那个词放到标题前面，并写明读者能得到什么（数字、适用对象）。`)
  } else {
    steps.push(titleCheck(d.liveTitle))
  }
  if (d.titleTruncated) steps.push(`④ 标题 ${d.titleLength} 个字符，超过约 ${TITLE_TRUNCATION_CHARS}，会被截断：缩短，关键词前置（若该页在标题保护名单内则只能人工改）。`)
  steps.push('⑤ 改完请记下改了什么，便于核对；系统核对的是页面正文是否实质变长，标题的效果要 28 天后看排名，点击率前后对比在这个流量下判不了。')
  return steps
}

/**
 * Title check. `liveTitle` must be the real <title> read from the live page — never the crawler's
 * `title` column (that is the page heading, not what Google shows).
 */
function titleCheck(liveTitle: string | null): string {
  const title = liveTitle
  if (!title) return '③ 标题体检：这次没取到线上真实标题（系统只信线上 <title>），请直接打开页面看标题长度和是否重复品牌后缀。'
  const len = title.length
  return len > TITLE_TRUNCATION_CHARS
    ? `③ 标题体检：「${title}」共 ${len} 个字符，超过约 ${TITLE_TRUNCATION_CHARS}，在谷歌里会被截断，把关键词放前面并缩短（若该页在标题保护名单内则只能人工改）。`
    : `③ 标题体检：「${title}」${len} 个字符，不会被截断，长度不是问题。`
}

function baseSteps(
  ctx: ItemContext,
  kind: 'near_miss' | 'ctr_gap' | 'traffic_decay',
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
