/**
 * Weekly social plan (IMPACT prescribe). Slots only: format, content group, theme, reason.
 * Nothing here publishes, and nothing here is a numeric follower or reach goal.
 */

import type { ContentPillar } from '@/types/magic-engine'

import type { ClientRecipeConfig } from '@/lib/social/recipe/synthesize'
import type { RecipeStage } from '@/lib/social/recipe/stage'

export const WEEKLY_SLOT_PLAN_KIND = 'weekly_slot_plan_v1' as const

/** One week stays inside this so a bad config cannot emit a huge pack. */
export const MAX_WEEK_SLOTS = 40

export type PlanFormat = 'story' | 'post' | 'reel'
export type PlanStatus = 'ready' | 'held' | 'incomplete'
export type ReadState = 'ok' | 'none' | 'unreadable'
export type CountSource = 'client_week' | 'client_quota' | 'industry' | 'stage' | 'none'

export interface CountSignal {
  state: 'ok' | 'unreadable'
  value: number
}

export interface FlagSignal {
  state: 'ok' | 'unreadable'
  value: boolean
}

export interface WeeklyQuotaInput {
  storyPerWeek: number | null
  postPerWeek: number | null
  reelPerWeek: number | null
}

export interface GoalInput {
  read: ReadState
  title: string | null
  /** goals.fde_reasoning — 战略说明，不当条数也不当报价依据 */
  reasoning: string | null
  intent: string | null
  subType: string | null
  awarenessSubtype: string | null
  /** 给下游出稿用的纯文本行，只来自上面已有字段，缺了就不写那一行 */
  draftBasis: string[]
}

export interface ReadbackSuggestionInput {
  read: ReadState
  asOf: string | null
  /** From social-readback-weekly receipts; reference only for drafting. */
  draftBasis: string[]
}

export interface ThemeInput {
  read: ReadState
  items: ReadonlyArray<{ id: string; label: string }>
}

export interface WeeklyPlanSlot {
  index: number
  format: PlanFormat
  contentGroup: string | null
  contentGroupLabel: string
  theme: string | null
  themeId: string | null
  reason: string
}

export interface WeeklySocialPlan {
  planKind: typeof WEEKLY_SLOT_PLAN_KIND
  platform: 'facebook'
  weekStart: string
  weekEnd: string
  status: PlanStatus
  stage: RecipeStage | null
  stageNote: string
  primarySignal: 'on_time_cadence'
  counts: { story: number | null; post: number | null; reel: number | null }
  countSources: { story: CountSource; post: CountSource; reel: CountSource; mix: CountSource }
  goal: GoalInput
  readbackSuggestion: ReadbackSuggestionInput
  themes: { read: ReadState; labels: string[] }
  items: WeeklyPlanSlot[]
  gaps: string[]
}

export interface BuildInput {
  weekStart: string
  weekEnd: string
  industryKey: string | null
  clientConfig: ClientRecipeConfig | null
  weeklyQuota: WeeklyQuotaInput
  pillarNames: Readonly<Record<string, string>>
  /** True when the client's mix could not be read. Industry mix must not fill the gap. */
  lockMix: boolean
  stage: StageSignalsInput
  goal: GoalInput
  readbackSuggestion: ReadbackSuggestionInput
  themes: ThemeInput
}

/** Stage inputs. Unreadable is not zero. */
export interface StageSignalsInput {
  auth: FlagSignal
  authLost: FlagSignal
  facts: CountSignal
  assets: CountSignal
  onTimeWeeks: CountSignal
  receipts: CountSignal
  periods: CountSignal
  circuitBreaker: FlagSignal
  complaintSpike: FlagSignal
}

export type PillarPick = Pick<ContentPillar, 'id' | 'post_ratio' | 'name'>
