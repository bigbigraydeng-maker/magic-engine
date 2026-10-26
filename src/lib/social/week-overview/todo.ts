/**
 * "待你处理 N 件": what a person has to click on this week, counted from what the page already read.
 * Display only, no I/O. A part that could not be read is never counted as "nothing to do": it is reported as unknown.
 */
import type { LitePackState } from '../story-lite/service'
import type { StoryTally } from '../story-lite/page-text'
import type { ReelWork } from './reel-works'

export interface TodoItem {
  id: 'reel_review' | 'reel_problem' | 'story_authorize' | 'story_newer_draft' | 'story_blocked' | 'story_overdue'
  count: number
  /** One plain sentence, no codes. */
  text: string
  /** The words on the link; existing entry names are kept as they were. */
  cta: string
  href: string
}

export interface TodoSummary {
  total: number
  items: TodoItem[]
  /** Parts that could not be read ("Reel" / "Story"); the page must say the count may be incomplete. */
  unknown: string[]
}

export interface TodoStoryInput {
  title: string
  state: LitePackState
  itemCount: number
  newerDraftTitle: string | null
}

export interface TodoInput {
  clientId: string
  /** null = the Reel read failed. */
  works: ReadonlyArray<ReelWork> | null
  /** null = no pack, or the Story read failed (see storyFailed). */
  story: TodoStoryInput | null
  storyFailed: boolean
  tally: StoryTally
}

function reelItems(clientId: string, works: ReadonlyArray<ReelWork>): TodoItem[] {
  const href = `/dashboard/factory?client=${clientId}`
  const review = works.filter((work) => work.tag.kind === 'review').length
  const problem = works.filter((work) => work.tag.kind === 'problem').length
  const items: TodoItem[] = []
  if (review > 0) items.push({ id: 'reel_review', count: review, text: `视频：${review} 条作品等你审核`, cta: '去视频工厂看 / 点通过', href })
  if (problem > 0) items.push({ id: 'reel_problem', count: problem, text: `视频：${problem} 条被打回或出了问题`, cta: '去视频工厂看', href })
  return items
}

function storyItems(clientId: string, story: TodoStoryInput | null, tally: StoryTally): TodoItem[] {
  const href = `/dashboard/clients/${clientId}/story`
  const items: TodoItem[] = []
  if (story && story.state === 'DRAFT' && story.itemCount > 0) {
    items.push({ id: 'story_authorize', count: 1, text: `Story：「${story.title}」这一周还没授权`, cta: '去 Story 页授权', href })
  }
  if (story?.newerDraftTitle) {
    items.push({ id: 'story_newer_draft', count: 1, text: `Story：新的周包「${story.newerDraftTitle}」还没授权`, cta: '去 Story 页授权', href })
  }
  if (tally.blocked > 0) items.push({ id: 'story_blocked', count: tally.blocked, text: `Story：${tally.blocked} 条被拦或出错，没发出去`, cta: '去 Story 页看看', href })
  if (tally.overdue > 0) items.push({ id: 'story_overdue', count: tally.overdue, text: `Story：${tally.overdue} 条已过发布时间，没发出去`, cta: '去 Story 页看看', href })
  return items
}

export function buildTodoSummary(input: TodoInput): TodoSummary {
  const unknown: string[] = []
  const items: TodoItem[] = []
  if (input.works === null) unknown.push('视频')
  else items.push(...reelItems(input.clientId, input.works))
  if (input.storyFailed) unknown.push('Story')
  else items.push(...storyItems(input.clientId, input.story, input.tally))
  return { total: items.reduce((sum, item) => sum + item.count, 0), items, unknown }
}

/** Only the Reel part of the headline, for the 短视频 tab. `null` works = the Reel read failed. */
export function buildReelTodoSummary(clientId: string, works: ReadonlyArray<ReelWork> | null): TodoSummary {
  if (works === null) return { total: 0, items: [], unknown: ['视频'] }
  const items = reelItems(clientId, works)
  return { total: items.reduce((sum, item) => sum + item.count, 0), items, unknown: [] }
}
