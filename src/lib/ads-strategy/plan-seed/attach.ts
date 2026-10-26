import type { PrescriptionContent } from '@/types/diagnostic'
import { lenientAdPlays, wasAdPlaysDropped, type AdPlay } from './ad-plays'
import { buildPlanSeed, type PlanSeedDeps } from './build'
import { loadGoalPeriod, productionDeps } from './deps'
import { planSeedSchema } from './types'

/** 整个 attach 流程的默认时间预算（毫秒）。 */
export const ATTACH_TIMEOUT_MS = 8000

/** 附加依赖：PlanSeedDeps 的部分覆盖 + 可选的周期读取 + 总时间预算。 */
export type AttachDeps = Partial<PlanSeedDeps> & {
  loadPeriod?: (goalId: string | null) => Promise<{ start_date: string; end_date: string } | null>
  timeoutMs?: number
}

/** 判断是否为普通对象（非 null、非数组）。 */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 安全取出 phases 数组；不是数组时返回空数组。 */
function safePhases(content: PrescriptionContent): unknown[] {
  const phases: unknown = content.phases
  return Array.isArray(phases) ? phases : []
}

/** 从 phase 里取出 initiative_seed（可能是 null / 非对象）。 */
function seedOf(phase: unknown): Record<string, unknown> | null {
  if (!isPlainObject(phase)) return null
  const seed = phase.initiative_seed
  return isPlainObject(seed) ? seed : null
}

/**
 * 就地清洗每个 phase 的 ad_plays：丢弃不合法项，清空后删除该字段。
 * 永不抛错。
 */
export function sanitizeAdPlays(content: PrescriptionContent): void {
  try {
    for (const phase of safePhases(content)) {
      const seed = seedOf(phase)
      if (seed === null) continue
      if (seed.ad_plays === undefined) continue
      const cleaned = lenientAdPlays(seed.ad_plays)
      if (cleaned.length === 0) {
        delete seed.ad_plays
      } else {
        seed.ad_plays = cleaned
      }
    }
  } catch (err) {
    console.warn('[plan-seed] sanitize failed', errorMessage(err))
  }
}

/**
 * 收集所有 phase 的合法打法（按顺序，step_key 去重保留第一条）。
 * 纯函数，不修改 content。永不抛错。
 */
export function collectAdPlays(content: PrescriptionContent): AdPlay[] {
  try {
    const out: AdPlay[] = []
    const seen = new Set<string>()
    for (const phase of safePhases(content)) {
      const seed = seedOf(phase)
      if (seed === null) continue
      if (seed.ad_plays === undefined) continue
      for (const play of lenientAdPlays(seed.ad_plays)) {
        if (seen.has(play.step_key)) continue
        seen.add(play.step_key)
        out.push(play)
      }
    }
    return out
  } catch (err) {
    console.warn('[plan-seed] collect failed', errorMessage(err))
    return []
  }
}

/**
 * 精修场景：LLM 对某个阶段写了打法但没通过校验（整组被丢）时，按阶段号把上一版该阶段的打法带回来；
 * LLM 没写某阶段的打法 = 有意去掉，不补。就地修改 content，返回被带回打法的阶段号列表。
 */
export function carryPriorAdPlays(content: PrescriptionContent, prior: PrescriptionContent): number[] {
  try {
    const priorByPhase = new Map<number, unknown>()
    for (const phase of safePhases(prior)) {
      if (!isPlainObject(phase)) continue
      const number = phase.phase_number
      if (typeof number !== 'number') continue
      const seed = seedOf(phase)
      if (seed !== null && seed.ad_plays !== undefined) priorByPhase.set(number, seed.ad_plays)
    }
    const carried: number[] = []
    for (const phase of safePhases(content)) {
      if (!isPlainObject(phase)) continue
      const number = phase.phase_number
      if (typeof number !== 'number') continue
      const seed = seedOf(phase)
      if (seed === null) continue
      if (!wasAdPlaysDropped(seed)) continue
      const plays = priorByPhase.get(number)
      if (plays === undefined) continue
      const cleaned = lenientAdPlays(plays)
      if (cleaned.length === 0) continue
      seed.ad_plays = cleaned
      carried.push(number)
    }
    return carried
  } catch (err) {
    console.warn('[plan-seed] carry prior plays failed', errorMessage(err))
    return []
  }
}

/** 把任意异常转成可读字符串。 */
function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string' && err.length > 0) return err
  return '未知错误'
}

/** 读取周期的结果：成功（period 可能为 null）或超时。 */
type PeriodResult =
  | { kind: 'ok'; period: { start_date: string; end_date: string } | null }
  | { kind: 'timeout' }

/**
 * 读取周期，与计时器赛跑；超时返回 { kind: 'timeout' }。
 * loader 抛错时 warn 并返回 { kind: 'ok', period: null }。
 */
async function readPeriod(
  goalId: string | null,
  loader: (goalId: string | null) => Promise<{ start_date: string; end_date: string } | null>,
  timeoutMs: number,
): Promise<PeriodResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<PeriodResult>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'timeout' }), Math.max(0, timeoutMs))
  })
  const load = (async (): Promise<PeriodResult> => {
    try {
      const period = await loader(goalId)
      return { kind: 'ok', period }
    } catch (err) {
      console.warn('[plan-seed] loadPeriod failed', errorMessage(err))
      return { kind: 'ok', period: null }
    }
  })()
  try {
    return await Promise.race([load, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * 组装完整依赖：以 productionDeps() 为底，用 deps 里显式提供的覆盖。
 * 逐个方法名显式合并，保证类型安全。
 */
function resolveDeps(deps: AttachDeps | undefined): PlanSeedDeps {
  const base = productionDeps()
  return {
    now: deps?.now ?? base.now,
    loadOwnedAccounts: deps?.loadOwnedAccounts ?? base.loadOwnedAccounts,
    loadFacts: deps?.loadFacts ?? base.loadFacts,
    loadCaptureAt: deps?.loadCaptureAt ?? base.loadCaptureAt,
    loadClientPageId: deps?.loadClientPageId ?? base.loadClientPageId,
    getPageToken: deps?.getPageToken ?? base.getPageToken,
    readForms: deps?.readForms ?? base.readForms,
    readScopes: deps?.readScopes ?? base.readScopes,
    readPromotePages: deps?.readPromotePages ?? base.readPromotePages,
    playbookShare: deps?.playbookShare ?? base.playbookShare,
  }
}

/**
 * 给处方内容附加计划种子。
 * 永不抛错：任何异常都只清空 plan_seed 并返回原 content。
 */
export async function attachPlanSeed(
  content: PrescriptionContent,
  ctx: { clientId: string; goalId: string | null; priorContent?: PrescriptionContent },
  deps?: AttachDeps,
): Promise<PrescriptionContent> {
  try {
    // 客户端或 LLM 提供的 plan_seed 一律丢弃，只信本次计算。
    delete content.plan_seed
    const startedAt = Date.now()
    const timeoutMs = deps?.timeoutMs ?? ATTACH_TIMEOUT_MS

    const carriedPhases: number[] =
      ctx.priorContent !== undefined ? carryPriorAdPlays(content, ctx.priorContent) : []
    sanitizeAdPlays(content)
    const plays = collectAdPlays(content)
    if (plays.length === 0) return content

    const periodResult = await readPeriod(
      ctx.goalId,
      deps?.loadPeriod ?? loadGoalPeriod,
      timeoutMs,
    )
    if (periodResult.kind === 'timeout') {
      console.warn('[plan-seed] loadPeriod timed out')
      return content
    }
    const period = periodResult.period

    const full = resolveDeps(deps)
    const remaining = Math.max(0, timeoutMs - (Date.now() - startedAt))
    const seed = await buildPlanSeed({ clientId: ctx.clientId, plays, period }, full, {
      timeoutMs: remaining,
    })

    if (carriedPhases.length > 0) {
      const notes: string[] = Array.isArray(seed.notes) ? seed.notes : []
      for (const n of carriedPhases) {
        const note = `打法是从上一版带回来的（阶段 ${n}）`
        if (!notes.includes(note)) notes.push(note)
      }
      seed.notes = notes
    }

    const checked = planSeedSchema.safeParse(seed)
    if (checked.success) {
      content.plan_seed = checked.data
    } else {
      console.warn('[plan-seed] seed failed schema check')
    }
    return content
  } catch (err) {
    console.warn('[plan-seed] attach failed', errorMessage(err))
    delete content.plan_seed
    return content
  }
}
