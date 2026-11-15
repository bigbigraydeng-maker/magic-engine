/**
 * Write-mode weekly draft: story decision, image drafts, and the lines the week card lists.
 * One kind failing is a receipt field. It does not throw, and it does not publish.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { produceFactoryStills, type StillProduceReceipt } from '@/lib/factory/still-produce'
import { isoDate, nzCalendar, targetWeek } from '@/lib/social/week-pack/cadence'
import { runImagePostStep, type ImagePostStepReceipt } from '@/lib/social/image-post-step'
import { draftStoryWeekPack } from '@/lib/social/story-week-pack'
import { planStoryWeekDraft, type StoryWeekDraftReceipt } from '@/lib/social/story-week-draft'
import type { ProducedDrafts, ProducedKind, ProducedLine } from '@/lib/social/weekly-plan/produced'

import { loadScheduledReelsForWeek, mergeScheduledReels } from './reel-lines'

export interface WeekDraftSummary {
  stills: { drafted: number; skipped: string | null; error: string | null; note: string }
  story: { drafted: number; skipped: string | null; error: string | null; note: string }
  post: { drafted: number; skipped: string | null; error: string | null }
  reel: { drafted: number; skipped: string | null; error: string | null }
}

export interface PreparedWeekDrafts {
  story: StoryWeekDraftReceipt
  image: ImagePostStepReceipt
  produced: ProducedDrafts
  summary: WeekDraftSummary
}

export async function prepareWeekDrafts(input: {
  clientId: string
  now: Date
  config: unknown
  reelScheduled: ReadonlyArray<{ id: string; publishOn: string }>
  reelScheduledCount: number
  supabase: SupabaseClient
  loadExistingReels?: typeof loadScheduledReelsForWeek
}): Promise<PreparedWeekDrafts> {
  const stills = await safeStills(input)
  const story = await safeStory(input)
  const image = await safeImage(input)
  const reel = await reelLinesForCard(input)
  const produced = {
    story: storyKind(story),
    post: imageKind(image),
    reel,
  }
  return { story, image, produced, summary: summaryOf(produced, story, stills, image.drafted) }
}

export function prepareWeekDraftsFailed(message: string): PreparedWeekDrafts {
  const story = failedStory(message)
  const stills: StillProduceReceipt = { drafted: 0, skipped: null, error: message, spentUsd: 0, note: '静图这一步没有跑。' }
  const image: ImagePostStepReceipt = {
    attempted: 0, drafted: 0, planIds: [], dates: [], skipped: null, error: `image_step_failed: ${message}`,
  }
  const produced: ProducedDrafts = {
    story: storyKind(story),
    post: imageKind(image),
    reel: { requested: null, drafted: 0, lines: [], skipped: null, error: message },
  }
  return { story, image, produced, summary: summaryOf(produced, story, stills, 0) }
}

function failedStory(message: string): StoryWeekDraftReceipt {
  return {
    ...planStoryWeekDraft(null),
    error: message,
    note: '这一步失败了，没有新建周包。',
  }
}

async function safeStills(input: { clientId: string; now: Date; config: unknown; supabase: SupabaseClient }): Promise<StillProduceReceipt> {
  try {
    return await produceFactoryStills(input.clientId, input.config, input.now, { supabase: input.supabase })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { drafted: 0, skipped: null, error: `still_step_failed: ${message}`.slice(0, 300), spentUsd: 0, note: '静图这一步失败了，没有再花钱。' }
  }
}

async function safeStory(input: { clientId: string; now: Date; config: unknown; supabase: SupabaseClient }): Promise<StoryWeekDraftReceipt> {
  try {
    return await draftStoryWeekPack(input.clientId, input.config, input.now, input.supabase)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return {
      requested: null, drafted: 0, packId: null, skipped: null, error: message.slice(0, 300),
      source: 'none', note: 'Story 这一步失败了，没有新建周包。', lines: [],
    }
  }
}

async function safeImage(input: {
  clientId: string
  now: Date
  config: unknown
  supabase: SupabaseClient
}): Promise<ImagePostStepReceipt> {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return { attempted: 0, drafted: 0, planIds: [], dates: [], skipped: 'no_openai_key', error: null }
    }
    const { getOpenAIClient } = await import('@/lib/ai/openai-client')
    const openai = getOpenAIClient()
    const callLLM = async (prompt: string): Promise<string> => {
      const resp = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 600,
      })
      return resp.choices[0]?.message?.content ?? ''
    }
    const image = await runImagePostStep(input.clientId, isoDate(nzCalendar(input.now)), input.config, null, {
      supabase: input.supabase,
      callLLM,
      week: targetWeek(input.now),
    })
    if (!image || typeof image.drafted !== 'number') {
      return { attempted: 0, drafted: 0, planIds: [], dates: [], skipped: null, error: 'image_step_failed: empty' }
    }
    return image
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return {
      attempted: 0, drafted: 0, planIds: [], dates: [], skipped: null,
      error: `image_step_failed: ${message}`.slice(0, 300),
    }
  }
}

function storyKind(story: StoryWeekDraftReceipt): ProducedKind {
  const lines = story.lines ?? []
  return {
    requested: story.requested,
    drafted: lines.length > 0 ? lines.length : story.drafted,
    lines,
    skipped: story.drafted === 0 ? story.skipped : null,
    error: story.error,
  }
}

function imageKind(image: ImagePostStepReceipt): ProducedKind {
  const lines = image.weekLines ?? zipLines(image.dates, image.planIds)
  const onWeek = image.weekLines ? image.weekLines.length : image.drafted
  return {
    requested: image.requested ?? null,
    drafted: onWeek,
    lines,
    skipped: image.drafted === 0 ? image.skipped : null,
    error: image.error,
  }
}

async function reelLinesForCard(input: {
  clientId: string
  now: Date
  reelScheduled: ReadonlyArray<{ id: string; publishOn: string }>
  reelScheduledCount: number
  supabase: SupabaseClient
  loadExistingReels?: typeof loadScheduledReelsForWeek
}): Promise<ProducedKind> {
  const fresh = reelKind(input.reelScheduled, input.reelScheduledCount)
  if (fresh.error) return fresh
  const week = targetWeek(input.now)
  const load = input.loadExistingReels ?? loadScheduledReelsForWeek
  try {
    const existing = await load(input.supabase, input.clientId, week)
    if (existing === 'unreadable') return { ...fresh, error: 'existing_reels_unreadable' }
    const merged = mergeScheduledReels(input.reelScheduled, existing, week)
    return reelKind(merged, merged.length)
  } catch {
    return { ...fresh, error: 'existing_reels_unreadable' }
  }
}

function reelKind(
  scheduled: ReadonlyArray<{ id: string; publishOn: string }>,
  scheduledCount: number,
): ProducedKind {
  const lines = scheduled.flatMap((row) => {
    if (!row || typeof row.id !== 'string' || typeof row.publishOn !== 'string') return []
    return [{ date: row.publishOn, ref: row.id }]
  })
  const mismatch = scheduledCount !== lines.length
  return {
    requested: null,
    drafted: lines.length,
    lines,
    skipped: null,
    error: mismatch ? 'reel_schedule_unlisted' : null,
  }
}

function zipLines(dates: string[] | undefined, ids: string[]): ProducedLine[] {
  const count = Math.max(dates?.length ?? 0, ids.length)
  const lines: ProducedLine[] = []
  for (let i = 0; i < count; i++) lines.push({ date: dates?.[i] ?? '', ref: ids[i] ?? '' })
  return lines.filter((line) => line.date !== '' || line.ref !== '')
}

function summaryOf(
  produced: ProducedDrafts,
  story: StoryWeekDraftReceipt,
  stills: StillProduceReceipt,
  imageNew: number,
): WeekDraftSummary {
  return {
    stills: { drafted: stills.drafted, skipped: stills.skipped, error: stills.error, note: stills.note },
    story: { drafted: story.drafted, skipped: story.skipped, error: story.error, note: story.note },
    post: { drafted: imageNew, skipped: produced.post.skipped, error: produced.post.error },
    reel: { drafted: produced.reel.drafted, skipped: produced.reel.skipped, error: produced.reel.error },
  }
}
