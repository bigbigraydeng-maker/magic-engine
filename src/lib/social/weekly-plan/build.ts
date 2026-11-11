/**
 * One Facebook week: client config wins, then the known stage, then the industry template.
 * Does not publish and does not call a model.
 */

import { industryTemplateFor } from '@/lib/social/recipe/industry-templates'
import { synthesizeWeeklyRecipe, type RecipeLayer, type WeeklyRecipe } from '@/lib/social/recipe/synthesize'
import type { StageSignals } from '@/lib/social/recipe/stage'

import { resolveStage } from './stage-resolve'
import { buildSlots, emphasiseExplain, spreadGroups } from './slots'
import { MAX_WEEK_SLOTS, type BuildInput, type CountSource, type WeeklyQuotaInput, type WeeklySocialPlan } from './types'

const GROWING_STAND_IN: StageSignals = {
  platform: 'facebook',
  hasPublishAuth: true,
  factCount: 20,
  verifiedAssetCount: 15,
  consecutiveOnTimeWeeks: 4,
  receiptsPerFormatMax: 0,
  consecutivePeriodsAtThreshold: 0,
  circuitBreakerTripped: false,
  complaintSpike: false,
}

export function buildWeeklySocialPlan(input: BuildInput): WeeklySocialPlan {
  const resolved = resolveStage(input.stage)
  const recipe = recipeFor(input, resolved.signals, resolved.stage)
  const counts = applyWeekly(recipe, input.weeklyQuota)
  const mix = mixFor(recipe, resolved.stage, input.lockMix)
  const gaps = [...resolved.reasons.filter((line) => line.includes('读不到') || line.includes('没有下结论'))]
  const sources = { reel: counts.reel.source, post: counts.post.source, story: counts.story.source }
  const base = shell(input, resolved.stage, resolved.reasons[0] ?? '', sources, mix.source)
  if (resolved.stage === 'paused' || recipe?.holdNewDrafts) {
    return { ...base, status: 'held', stageNote: resolved.reasons[0] ?? '暂停：这周不出新稿。', gaps: [...gaps, '暂停阶段不出新稿。'] }
  }
  return fillItems(base, counts, mix, input, gaps)
}

function recipeFor(input: BuildInput, signals: StageSignals | null, stage: WeeklySocialPlan['stage']): WeeklyRecipe | null {
  const stageSignals = signals ?? (stage === null ? GROWING_STAND_IN : null)
  if (stageSignals === null) return null
  const result = synthesizeWeeklyRecipe({
    platform: 'facebook',
    industryKey: input.industryKey,
    stageSignals,
    clientConfig: input.clientConfig,
  })
  return result.status === 'ready' ? result : null
}

function applyWeekly(recipe: WeeklyRecipe | null, weekly: WeeklyQuotaInput) {
  const reel = oneCount(weekly.reelPerWeek, recipe?.quotas.reelPerWeek ?? null, recipe?.sources.reelPerWeek ?? 'none')
  const post = oneCount(weekly.postPerWeek, recipe?.quotas.postPerWeek ?? null, recipe?.sources.postPerWeek ?? 'none')
  const storyDay = recipe?.quotas.storyPerDay ?? null
  const storyWeek = storyDay === null ? null : storyDay * 7
  const story = oneCount(weekly.storyPerWeek, storyWeek, recipe?.sources.storyPerDay ?? 'none')
  return { reel, post, story }
}

function oneCount(weekly: number | null, fallback: number | null, layer: RecipeLayer): { value: number | null; source: CountSource } {
  if (weekly !== null) return { value: weekly, source: 'client_week' }
  if (fallback === null) return { value: null, source: 'none' }
  if (layer === 'client') return { value: fallback, source: 'client_quota' }
  if (layer === 'stage') return { value: fallback, source: 'stage' }
  if (layer === 'industry') return { value: fallback, source: 'industry' }
  return { value: fallback, source: 'none' }
}

function mixFor(
  recipe: WeeklyRecipe | null,
  stage: WeeklySocialPlan['stage'],
  lockMix: boolean,
): { pillars: Record<string, number> | null; source: CountSource } {
  if (lockMix) return { pillars: null, source: 'none' }
  const pillars = recipe?.mix.pillars ?? null
  if (pillars === null) return { pillars: null, source: 'none' }
  const source = recipe?.sources.mix === 'client' ? 'client_week' : 'industry'
  if (stage === 'starting' && source !== 'client_week') {
    const key = recipe?.mix.emphasisKey ?? industryTemplateFor(recipe?.industryKey)?.explainPillarKey ?? null
    return { pillars: emphasiseExplain(pillars, key), source: 'stage' }
  }
  return { pillars, source }
}

function shell(
  input: BuildInput,
  stage: WeeklySocialPlan['stage'],
  stageNote: string,
  sources: { reel: CountSource; post: CountSource; story: CountSource },
  mix: CountSource,
): WeeklySocialPlan {
  return {
    planKind: 'weekly_slot_plan_v1',
    platform: 'facebook',
    weekStart: input.weekStart,
    weekEnd: input.weekEnd,
    status: 'incomplete',
    stage,
    stageNote,
    primarySignal: 'on_time_cadence',
    counts: { story: null, post: null, reel: null },
    countSources: { ...sources, mix },
    goal: input.goal,
    themes: { read: input.themes.read, labels: input.themes.items.map((item) => item.label) },
    items: [],
    gaps: [],
  }
}

function fillItems(
  base: WeeklySocialPlan,
  counts: ReturnType<typeof applyWeekly>,
  mix: { pillars: Record<string, number> | null; source: CountSource },
  input: BuildInput,
  gaps: string[],
): WeeklySocialPlan {
  const story = whole(counts.story.value)
  const post = whole(counts.post.value)
  const reel = whole(counts.reel.value)
  const next = { ...base, counts: { story, post, reel }, countSources: { ...base.countSources, mix: mix.source }, gaps: [...gaps] }
  if (story === null || post === null || reel === null) {
    next.gaps.push('每周条数算不出来，没有编一个数。')
    return next
  }
  const total = story + post + reel
  if (total > MAX_WEEK_SLOTS) {
    next.gaps.push(`一周超过 ${MAX_WEEK_SLOTS} 条，没有排。`)
    return next
  }
  if (mix.pillars === null && total > 0) next.gaps.push('没有内容比例，条目没有分组，也没有猜一组。')
  next.status = 'ready'
  next.items = buildSlots({
    counts: { reel, post, story },
    sources: { reel: counts.reel.source, post: counts.post.source, story: counts.story.source },
    groups: spreadGroups(total, mix.pillars),
    names: input.pillarNames,
    themes: input.themes.read === 'ok' ? input.themes.items : [],
    themeRead: input.themes.read,
  })
  return next
}

function whole(value: number | null): number | null {
  if (value === null || !Number.isInteger(value) || value < 0) return null
  return value
}
