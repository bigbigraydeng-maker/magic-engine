import type { ContentPillar } from '@/types/magic-engine'
import { platformRulesFor, type HardRule, type RecipePlatform } from './platform-rules'
import {
  industryTemplateFor,
  type IndustryTemplate,
  type IndustryTemplateKey,
} from './industry-templates'
import { computeStage, type RecipeStage, type StageSignals } from './stage'

export type RecipeLayer = 'platform' | 'industry' | 'stage' | 'client' | 'none'

export interface ClientRecipeConfig {
  /** mirrors clients.publishing_calendar_config.quota ; null/undefined = not configured (never 0) */
  quota?: {
    post_per_day?: number | null
    reel_per_week?: number | null
    story_per_day?: number | null
  } | null
  /** mirrors master_briefs.content_pillars; only id and post_ratio (0..1) are read */
  content_pillars?: ReadonlyArray<Pick<ContentPillar, 'id' | 'post_ratio'>> | null
}

export interface RecipeQuotas {
  reelPerWeek: number | null
  storyPerDay: number | null
  postPerWeek: number | null
}

export type MixMap = Record<string, number> // percent

export interface RecipeSuggestion {
  field: 'reelPerWeek' | 'storyPerDay' | 'postPerWeek' | 'mix'
  layer: 'industry' | 'stage'
  clientValue: number | MixMap
  suggestedValue: number | MixMap
}

export interface WeeklyRecipe {
  platform: RecipePlatform
  stage: RecipeStage
  stageReasons: string[]
  /** true when stage is paused: no new drafts, only to-dos */
  holdNewDrafts: boolean
  industryKey: IndustryTemplateKey | null
  quotas: RecipeQuotas
  mix: { pillars: MixMap | null; emphasisKey: string | null }
  interaction: {
    autoReplyScope: 'greeting_faq_only'
    humanReplyTopics: string[]
    suggestFaqTemplateCards: boolean
  }
  platformPlan: 'facebook_only' | 'facebook_with_connect_cards'
  /** the only health signal; there are NO numeric social goals (no followers, reach or DM counts) anywhere */
  primarySignal: 'on_time_cadence'
  hardRules: readonly HardRule[]
  sources: {
    reelPerWeek: RecipeLayer
    storyPerDay: RecipeLayer
    postPerWeek: RecipeLayer
    mix: RecipeLayer
    mixEmphasis: RecipeLayer
    interaction: RecipeLayer
    humanReplyTopics: RecipeLayer
    platformPlan: RecipeLayer
  }
  /** fields where the industry or stage layer differs from a value the client filled in; client values are never overwritten */
  suggestions: RecipeSuggestion[]
}

export type SynthesizeResult =
  | ({ status: 'ready' } & WeeklyRecipe)
  | { status: 'not_connected'; platform: RecipePlatform }

export interface SynthesizeInput {
  platform: RecipePlatform
  industryKey: string | null | undefined
  stageSignals: StageSignals
  clientConfig?: ClientRecipeConfig | null
}

/** Cold-start defaults used in the starting stage (lower bound of the 1-2 reel range). */
const COLD_START = { reelPerWeek: 1, postPerWeek: 3, storyPerDay: 1 } as const

/** A quota layer value plus the layer it came from. */
interface LayerValue {
  value: number | null
  layer: RecipeLayer
}

/** A client quota value plus whether it was actually filled in. */
interface ClientValue {
  filled: boolean
  value: number | null
}

/** Treat non-finite or negative numbers as not filled. 0 is a filled value. */
function readClientNumber(raw: number | null | undefined): ClientValue {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
    return { filled: false, value: null }
  }
  return { filled: true, value: raw }
}

/** Compute the layer default for each quota based on stage and template. */
function layerQuotas(stage: RecipeStage, template: IndustryTemplate | null): {
  reelPerWeek: LayerValue
  postPerWeek: LayerValue
  storyPerDay: LayerValue
} {
  if (stage === 'paused') {
    return {
      reelPerWeek: { value: 0, layer: 'stage' },
      postPerWeek: { value: 0, layer: 'stage' },
      storyPerDay: { value: 0, layer: 'stage' },
    }
  }
  if (stage === 'starting') {
    return {
      reelPerWeek: { value: COLD_START.reelPerWeek, layer: 'stage' },
      postPerWeek: { value: COLD_START.postPerWeek, layer: 'stage' },
      storyPerDay: { value: COLD_START.storyPerDay, layer: 'stage' },
    }
  }
  if (template !== null) {
    return {
      reelPerWeek: { value: template.quotas.reelPerWeek.max, layer: 'industry' },
      postPerWeek: { value: template.quotas.postPerWeek.max, layer: 'industry' },
      storyPerDay: { value: template.quotas.storyPerDay.max, layer: 'industry' },
    }
  }
  return {
    reelPerWeek: { value: null, layer: 'none' },
    postPerWeek: { value: null, layer: 'none' },
    storyPerDay: { value: null, layer: 'none' },
  }
}

/** Resolve a single quota: client value wins; otherwise the layer value. */
function resolveQuota(
  field: 'reelPerWeek' | 'postPerWeek' | 'storyPerDay',
  client: ClientValue,
  layer: LayerValue,
  suggestions: RecipeSuggestion[],
): { value: number | null; source: RecipeLayer } {
  if (client.filled && client.value !== null) {
    if (
      layer.value !== null &&
      (layer.layer === 'industry' || layer.layer === 'stage') &&
      layer.value !== client.value
    ) {
      suggestions.push({
        field,
        layer: layer.layer,
        clientValue: client.value,
        suggestedValue: layer.value,
      })
    }
    return { value: client.value, source: 'client' }
  }
  return { value: layer.value, source: layer.layer }
}

/** Build a MixMap from client content pillars (percent, 2 decimals). */
function buildClientMix(
  pillars: ReadonlyArray<Pick<ContentPillar, 'id' | 'post_ratio'>> | null | undefined,
): MixMap | null {
  if (!pillars || pillars.length === 0) {
    return null
  }
  const mix: MixMap = {}
  for (const pillar of pillars) {
    if (!Number.isFinite(pillar.post_ratio)) {
      continue
    }
    mix[pillar.id] = Math.round(pillar.post_ratio * 10000) / 100
  }
  return Object.keys(mix).length > 0 ? mix : null
}

/** Build a MixMap from the industry template. */
function buildTemplateMix(template: IndustryTemplate | null): MixMap | null {
  if (template === null) {
    return null
  }
  const mix: MixMap = {}
  for (const [key, value] of Object.entries(template.mix)) {
    mix[key] = value.value
  }
  return mix
}

/** True when key sets differ or any shared key's percent differs by more than 0.5. */
function mixesDiffer(a: MixMap, b: MixMap): boolean {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) {
    return true
  }
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) {
      return true
    }
    if (Math.abs(a[key] - b[key]) > 0.5) {
      return true
    }
  }
  return false
}

/** Resolve the mix and its source, pushing a suggestion when the client mix differs. */
function resolveMix(
  clientMix: MixMap | null,
  templateMix: MixMap | null,
  suggestions: RecipeSuggestion[],
): { pillars: MixMap | null; source: RecipeLayer } {
  if (clientMix !== null) {
    if (templateMix !== null && mixesDiffer(clientMix, templateMix)) {
      suggestions.push({
        field: 'mix',
        layer: 'industry',
        clientValue: clientMix,
        suggestedValue: templateMix,
      })
    }
    return { pillars: clientMix, source: 'client' }
  }
  if (templateMix !== null) {
    return { pillars: templateMix, source: 'industry' }
  }
  return { pillars: null, source: 'none' }
}

/** De-duplicated union of platform never-auto-reply topics and template human reply topics. */
function buildHumanReplyTopics(
  platformTopics: readonly string[],
  template: IndustryTemplate | null,
): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const topic of platformTopics) {
    if (!seen.has(topic)) {
      seen.add(topic)
      result.push(topic)
    }
  }
  if (template !== null) {
    for (const topic of template.humanReplyTopics) {
      if (!seen.has(topic)) {
        seen.add(topic)
        result.push(topic)
      }
    }
  }
  return result
}

function resolveQuotas(
  stage: Parameters<typeof layerQuotas>[0],
  template: Parameters<typeof layerQuotas>[1],
  clientConfig: SynthesizeInput['clientConfig'],
  suggestions: RecipeSuggestion[],
) {
  const layer = layerQuotas(stage, template)
  const quotaConfig = clientConfig?.quota ?? null
  const clientPostPerDay = readClientNumber(quotaConfig?.post_per_day)
  const clientPost: ClientValue =
    clientPostPerDay.filled && clientPostPerDay.value !== null
      ? { filled: true, value: clientPostPerDay.value * 7 }
      : { filled: false, value: null }
  return {
    reel: resolveQuota('reelPerWeek', readClientNumber(quotaConfig?.reel_per_week), layer.reelPerWeek, suggestions),
    post: resolveQuota('postPerWeek', clientPost, layer.postPerWeek, suggestions),
    story: resolveQuota('storyPerDay', readClientNumber(quotaConfig?.story_per_day), layer.storyPerDay, suggestions),
  }
}

export function synthesizeWeeklyRecipe(input: SynthesizeInput): SynthesizeResult {
  const { platform, industryKey, stageSignals, clientConfig } = input
  const rules = platformRulesFor(platform)

  if (rules.status === 'not_connected') {
    return { status: 'not_connected', platform }
  }
  if (stageSignals.platform !== platform) {
    throw new Error('stageSignals.platform must match platform')
  }

  const { stage, reasons } = computeStage(stageSignals)
  const template = industryTemplateFor(industryKey)
  const suggestions: RecipeSuggestion[] = []
  const { reel, post, story } = resolveQuotas(stage, template, clientConfig, suggestions)

  const clientMix = buildClientMix(clientConfig?.content_pillars)
  const templateMix = buildTemplateMix(template)
  const mix = resolveMix(clientMix, templateMix, suggestions)

  const emphasisKey =
    stage === 'starting' && template !== null ? template.explainPillarKey : null
  const mixEmphasis: RecipeLayer = emphasisKey !== null ? 'stage' : 'none'

  const humanReplyTopics = buildHumanReplyTopics(rules.neverAutoReplyTopics, template)
  const humanReplyTopicsSource: RecipeLayer = template !== null ? 'industry' : 'platform'

  const platformPlan: WeeklyRecipe['platformPlan'] =
    stage === 'growing' || stage === 'mature'
      ? 'facebook_with_connect_cards'
      : 'facebook_only'

  const recipe: WeeklyRecipe = {
    platform,
    stage,
    stageReasons: reasons,
    holdNewDrafts: stage === 'paused',
    industryKey: template !== null ? template.key : null,
    quotas: {
      reelPerWeek: reel.value,
      storyPerDay: story.value,
      postPerWeek: post.value,
    },
    mix: { pillars: mix.pillars, emphasisKey },
    interaction: {
      autoReplyScope: 'greeting_faq_only',
      humanReplyTopics,
      suggestFaqTemplateCards: stage === 'growing' || stage === 'mature',
    },
    platformPlan,
    primarySignal: 'on_time_cadence',
    hardRules: rules.rules,
    sources: {
      reelPerWeek: reel.source,
      storyPerDay: story.source,
      postPerWeek: post.source,
      mix: mix.source,
      mixEmphasis,
      interaction: 'stage',
      humanReplyTopics: humanReplyTopicsSource,
      platformPlan: 'stage',
    },
    suggestions,
  }

  return { status: 'ready', ...recipe }
}
