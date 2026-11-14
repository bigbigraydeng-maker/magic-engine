/**
 * Story week-pack counts. The pack itself is written from factory stills.
 * A missing weekly count does not invent a pack.
 */

import { resolveConfiguredWeekCounts, type WeekCountSource } from '@/lib/social/social-week-quota'
import { MAX_WEEK_SLOTS } from '@/lib/social/weekly-plan/types'
import type { ProducedLine } from '@/lib/social/weekly-plan/produced'

export interface StoryWeekDraftReceipt {
  requested: number | null
  drafted: number
  packId: string | null
  skipped: string | null
  error: string | null
  source: WeekCountSource
  note: string
  lines: ProducedLine[]
}

export function planStoryWeekDraft(config: unknown): StoryWeekDraftReceipt {
  const story = resolveConfiguredWeekCounts(config).story
  const base = { drafted: 0, packId: null, error: null, source: story.source, lines: [] as ProducedLine[] }
  if (story.source === 'none' || story.value === null) {
    return { ...base, requested: null, skipped: 'no_story_quota', note: '没有每周 Story 条数，没有生成。' }
  }
  if (story.value === 0) {
    return { ...base, requested: 0, skipped: 'story_count_zero', note: '每周 Story 条数是 0，没有生成。' }
  }
  if (story.value > MAX_WEEK_SLOTS) {
    return { ...base, requested: story.value, skipped: 'story_count_over_cap', note: '每周 Story 条数超过一周上限，没有生成。' }
  }
  return { ...base, requested: story.value, skipped: null, note: '按每周条数，用工厂 9:16 静图。' }
}
