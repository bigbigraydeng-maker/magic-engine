/**
 * Replace a quota-sized slot plan with the drafts this run actually wrote.
 * A held week stays held. One kind's error does not drop the other kinds' lines.
 */

import type { PlanFormat, WeeklyPlanSlot, WeeklySocialPlan } from './types'

export interface ProducedLine {
  date: string
  ref: string
}

export interface ProducedKind {
  requested: number | null
  drafted: number
  lines: ProducedLine[]
  skipped: string | null
  error: string | null
}

export interface ProducedDrafts {
  story: ProducedKind
  post: ProducedKind
  reel: ProducedKind
}

const SKIP_ZH: Readonly<Record<string, string>> = {
  no_automatic_story_asset_source: '没有可自动取的 Story 成片，没有新建周包',
  no_story_quota: '没有每周 Story 条数',
  story_count_zero: '每周 Story 条数是 0',
  story_count_over_cap: '每周 Story 条数超过一周上限',
  'post_per_week=0': '每周图文条数是 0',
  'post_quota=0': '发布名额里的图文是 0',
  post_count_over_cap: '每周图文条数超过一周上限',
  already_drafted: '这一周的图文草稿已经有了',
  no_published_tours: '没有已发布的线路',
  no_client_assets: '没有可用图片',
  no_active_campaign: '没有进行中的活动',
  no_openai_key: '没有文案模型，没有出图文',
  'imagePostPerDay=0': '没有每周条数，每天条数也是 0',
  existing_posts_unreadable: '已有图文读不到，为避免重复没有再生成',
}

const FORMAT_LABEL: Readonly<Record<PlanFormat, string>> = {
  reel: 'Reel',
  post: '图文',
  story: 'Story',
}

export function applyProducedDrafts(plan: WeeklySocialPlan, produced: ProducedDrafts): WeeklySocialPlan {
  if (plan.status === 'held') {
    return { ...plan, gaps: [...plan.gaps, '这周暂停，已生成的草稿不写进这张卡。'] }
  }
  const items = [
    ...linesOf('reel', produced.reel),
    ...linesOf('post', produced.post),
    ...linesOf('story', produced.story),
  ].map((slot, index) => ({ ...slot, index: index + 1 }))
  const gaps = [
    ...plan.gaps,
    '条数和条目按这次已经生成的草稿，不是按名额摊出来的。',
    ...kindGaps(produced),
  ]
  const errored = produced.story.error !== null || produced.post.error !== null || produced.reel.error !== null
  return {
    ...plan,
    status: errored ? 'incomplete' : 'ready',
    counts: { story: produced.story.drafted, post: produced.post.drafted, reel: produced.reel.drafted },
    items,
    gaps: gaps.filter((line) => line.length > 0),
  }
}

function linesOf(format: PlanFormat, kind: ProducedKind): WeeklyPlanSlot[] {
  return kind.lines.map((line) => ({
    index: 0,
    format,
    contentGroup: null,
    contentGroupLabel: '未分组',
    theme: null,
    themeId: null,
    date: line.date || null,
    draftRef: line.ref || null,
    reason: lineReason(format, line),
  }))
}

function lineReason(format: PlanFormat, line: ProducedLine): string {
  const when = line.date ? `${line.date} 的` : ''
  const ref = line.ref ? `编号 ${line.ref}。` : ''
  return `${FORMAT_LABEL[format]}，${when}已生成草稿。${ref}这条按已经生成的草稿列入。`
}

function kindGaps(produced: ProducedDrafts): string[] {
  return [gapFor('Reel', produced.reel), gapFor('图文', produced.post), gapFor('Story', produced.story)]
    .filter((line): line is string => line !== null)
}

function gapFor(label: string, kind: ProducedKind): string | null {
  if (kind.error) return `${label}生成失败（${kind.error}），卡片只列已生成的 ${kind.drafted} 条。`
  if (kind.lines.length !== kind.drafted) {
    return `${label}生成了 ${kind.drafted} 条，读到的条目是 ${kind.lines.length} 条。`
  }
  if (kind.skipped && kind.drafted === 0) return `${label}没有生成：${skipText(kind.skipped)}。`
  if (kind.requested !== null && kind.drafted !== kind.requested) {
    return `${label}想要 ${kind.requested} 条，这次生成了 ${kind.drafted} 条。`
  }
  return null
}

function skipText(code: string): string {
  return SKIP_ZH[code] ?? code
}
