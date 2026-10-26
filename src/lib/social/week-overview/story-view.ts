/**
 * Plain-Chinese wording for the Story part of 本周总览. Display only, no I/O.
 * The older helpers in story-lite/page-text.ts stay as they are (the Story page still uses them); this file only words
 * what the overview shows, and never calls a Story "sent" without saying it has not been checked against Facebook.
 */
import type { LitePackState } from '../story-lite/service'
import { OVERDUE_GRACE_MS, describeItemStatusInPack, describeNzDay, describePackState, nzDateKey, type StoryTally } from '../story-lite/page-text'
import type { LiteItemStatus } from '../story-lite/types'
import type { StatusKind } from './reel-works'

export interface StoryChip {
  kind: StatusKind
  label: string
  count: number
  hint: string
}

/** One chip per non-empty count of the week's Stories, in the order a person should read them. */
export function describeStoryChips(tally: StoryTally): StoryChip[] {
  const chips: StoryChip[] = [
    { kind: 'review', label: '还没授权', count: tally.unauthorised, hint: '这一周还没授权，到点也不会发。' },
    { kind: 'problem', label: '需要人看', count: tally.blocked, hint: '被检查拦下、发布失败，或不确定有没有发出去，需要人看一眼。' },
    { kind: 'problem', label: '过点还没发出', count: tally.overdue, hint: '已经过了计划时间，还没确认发出去。' },
    { kind: 'approved', label: '待发', count: tally.waiting, hint: '已授权，等到计划时间发出。' },
    { kind: 'sent', label: '已发出（未核对）', count: tally.recordedSent, hint: '系统记录已发出，还没有逐条和 Facebook 主页核对。' },
    { kind: 'closed', label: '已停或授权过期', count: tally.stopped, hint: '这一周被停掉或授权过期，不会再发。' },
  ]
  return chips.filter((chip) => chip.count > 0)
}

/** One Story's state in a sentence. A Story in a week nobody authorised says it will not go out. */
export function describeStoryItemState(status: LiteItemStatus, packState: LitePackState, slotAt: string, now: Date): string {
  if (status === 'SENT') return '已发出（未核对 Facebook）'
  if (status === 'PENDING' && packState === 'DRAFT') return '还没授权，不会发'
  if (status === 'PENDING' && packState === 'AUTHORIZED') {
    const slot = new Date(slotAt).getTime()
    if (!Number.isNaN(slot) && slot + OVERDUE_GRACE_MS < now.getTime()) return '已过点，没发出（系统里仍是待发）'
  }
  return describeItemStatusInPack(status, packState)
}

/** Which pack is in play and whether it is authorised; a failed read says so instead of "no pack". */
export function describeStoryPackLine(story: { title: string; state: LitePackState; expires_at: string | null } | null, readFailed: boolean): string {
  if (readFailed) return '现在读不到 Story 周包，不知道是否已授权。'
  if (!story) return '没有进行中的 Story 周包。'
  const until = story.state === 'AUTHORIZED' && story.expires_at ? `（${describeNzDay(nzDateKey(story.expires_at))}前有效）` : ''
  return `「${story.title}」${describePackState(story.state)}${until}。`
}
