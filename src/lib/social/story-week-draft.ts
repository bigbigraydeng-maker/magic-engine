/**
 * Story week-pack decision for one write-mode weekly draft.
 *
 * No pack is inserted. client_assets are analysed photos for reels and image posts:
 * they have no sha256, no checked text line, no Facebook page id, and no official-site
 * source_ref, and story_items rejects a row without all four. The content factory does
 * not emit story stills. The old manual packs were uploaded by hand into visual-assets.
 * Inventing those fields would invent the story. Callers record the skip and move on.
 */

import { resolveConfiguredWeekCounts, type WeekCountSource } from '@/lib/social/social-week-quota'
import { MAX_WEEK_SLOTS } from '@/lib/social/weekly-plan/types'

export const NO_AUTOMATIC_STORY_ASSET_SOURCE = 'no_automatic_story_asset_source'

export interface StoryWeekDraftReceipt {
  requested: number | null
  drafted: number
  packId: null
  skipped: string | null
  error: string | null
  source: WeekCountSource
  note: string
}

export function planStoryWeekDraft(config: unknown): StoryWeekDraftReceipt {
  const story = resolveConfiguredWeekCounts(config).story
  const base = { drafted: 0, packId: null as null, error: null, source: story.source }
  if (story.source === 'none' || story.value === null) {
    return { ...base, requested: null, skipped: 'no_story_quota', note: '没有每周 Story 条数，没有生成。' }
  }
  if (story.value === 0) {
    return { ...base, requested: 0, skipped: 'story_count_zero', note: '每周 Story 条数是 0，没有生成。' }
  }
  if (story.value > MAX_WEEK_SLOTS) {
    return {
      ...base,
      requested: story.value,
      skipped: 'story_count_over_cap',
      note: '每周 Story 条数超过一周上限，没有生成。',
    }
  }
  return {
    ...base,
    requested: story.value,
    skipped: NO_AUTOMATIC_STORY_ASSET_SOURCE,
    note: '没有可自动取的 Story 成片（图、校验、已核对的一句字、主页编号、官网出处），没有新建周包。',
  }
}
