/**
 * 广告健康页「目标与设置」卡的实时覆盖。
 *
 * ads_growth_states 每天只在 google-data-pullback-daily 里写一次，所以目标改了/换了，
 * 页面要等到第二天才跟上。这里在读接口时现算当前生效的目标，覆盖掉那一行里存的旧目标；
 * 现算失败就原样保留旧值，并标明「不是实时」——绝不把读失败当成「没有目标」。
 */
import { buildDigestGoalContext } from '../portfolio/goal-context'
import { nzToday } from '../promo-window'

type LiveGoalReader = typeof buildDigestGoalContext

export interface GrowthRowLike {
  payload: unknown
  goal_pace: unknown
}

export interface GoalLiveMeta {
  /** true = goal / goal_pace 是刚读出来的；false = 读不出来，沿用每日缓存里的旧值 */
  live: boolean
  readAtIso: string
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 员工版整行：用当前生效目标覆盖 payload.goal 与 goal_pace，并加 goal_live 标记。 */
export async function overlayLiveGoal<T extends GrowthRowLike>(
  clientId: string,
  row: T,
  now: Date = new Date(),
  readGoal: LiveGoalReader = buildDigestGoalContext,
): Promise<T & { goal_live: GoalLiveMeta }> {
  const readAtIso = now.toISOString()
  const ctx = await readGoal(clientId, nzToday(now.getTime()))
  if (!ctx) return { ...row, goal_live: { live: false, readAtIso } }
  const payload = isRecord(row.payload) ? row.payload : {}
  return {
    ...row,
    payload: {
      ...payload,
      goal: { title: ctx.title, label: ctx.label, target: ctx.target, dayIndex: ctx.dayIndex, totalDays: ctx.totalDays },
    },
    goal_pace: ctx.pace,
    goal_live: { live: true, readAtIso },
  }
}
