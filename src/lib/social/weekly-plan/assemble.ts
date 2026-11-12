/**
 * Turn raw reads into planner input.
 * A failed read stays unreadable. It is not a zero and it does not borrow the industry mix.
 */

import {
  authFromStatuses,
  pillarNameMap,
  readClientRecipe,
  readGoalCard,
  readPillars,
  readThemes,
  readWeeklyQuota,
  unreadMeasurement,
} from './read'
import type { BuildInput, CountSignal, WeeklyQuotaInput } from './types'

const EMPTY_QUOTA: WeeklyQuotaInput = { storyPerWeek: null, postPerWeek: null, reelPerWeek: null }

export interface AssembleArgs {
  weekStart: string
  weekEnd: string
  clientError: boolean
  industry: unknown
  config: unknown
  pillarsError: boolean
  pillarsRaw: unknown
  goalError: boolean
  goalRow: unknown
  themeError: boolean
  themeRows: unknown
  factError: boolean
  factCount: number | null
  assetError: boolean
  assetCount: number | null
  authStatuses: string[] | 'unreadable'
}

export function assembleInput(args: AssembleArgs): { input: BuildInput; gaps: string[] } {
  const gaps: string[] = []
  if (args.clientError) gaps.push('客户配置读不到，没有用行业模板顶上。')
  const pillars = args.clientError
    ? { pillars: null, unreadable: true }
    : readPillars(args.pillarsRaw, args.pillarsError)
  if (!args.clientError && pillars.unreadable) gaps.push('内容比例读不到，没有用行业比例顶上。')
  const quota = args.clientError ? { quota: EMPTY_QUOTA, gaps: [] as string[] } : readWeeklyQuota(args.config)
  gaps.push(...quota.gaps)
  return {
    gaps,
    input: {
      weekStart: args.weekStart,
      weekEnd: args.weekEnd,
      industryKey: args.clientError ? null : plainIndustry(args.industry),
      clientConfig: args.clientError ? null : readClientRecipe(args.config, pillars.pillars),
      weeklyQuota: quota.quota,
      pillarNames: pillarNameMap(pillars.pillars),
      lockMix: args.clientError || pillars.unreadable,
      stage: {
        ...authFromStatuses(args.authStatuses),
        facts: countSignal(args.factError, args.factCount),
        assets: countSignal(args.assetError, args.assetCount),
        ...unreadMeasurement(),
      },
      goal: readGoalCard(args.goalRow, args.goalError),
      themes: readThemes(args.themeRows, args.themeError),
    },
  }
}

function countSignal(error: boolean, count: number | null): CountSignal {
  if (error || count === null || !Number.isInteger(count) || count < 0) return { state: 'unreadable', value: 0 }
  return { state: 'ok', value: count }
}

function plainIndustry(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  return text ? text.slice(0, 40) : null
}
