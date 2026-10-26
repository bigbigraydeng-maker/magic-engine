import type { PrescriptionContent } from '@/types/diagnostic'
import { lenientAdPlays, type AdPlay } from './ad-plays'
import { buildPlanSeed, type PlanSeedDeps } from './build'
import { loadGoalPeriod, productionDeps } from './deps'
import { planSeedSchema } from './types'

/** 附加依赖：PlanSeedDeps 的部分覆盖 + 可选的周期读取。 */
export type AttachDeps = Partial<PlanSeedDeps> & {
  loadPeriod?: (goalId: string | null) => Promise<{ start_date: string; end_date: string } | null>
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
 * 精修场景：新内容里一条打法都没有、但旧内容有时，把旧内容的打法按阶段编号带回来
 * （华佗重写内容不会输出 ad_plays，不带回来就丢了真相源）。就地修改 content。
 */
export function carryPriorAdPlays(content: PrescriptionContent, prior: PrescriptionContent): void {
  try {
    if (collectAdPlays(content).length > 0) return
    const priorByPhase = new Map<unknown, unknown>()
    for (const phase of safePhases(prior)) {
      const seed = seedOf(phase)
      const number = isPlainObject(phase) ? phase.phase_number : undefined
      if (seed !== null && seed.ad_plays !== undefined) priorByPhase.set(number, seed.ad_plays)
    }
    for (const phase of safePhases(content)) {
      if (!isPlainObject(phase)) continue
      const plays = priorByPhase.get(phase.phase_number)
      const seed = seedOf(phase)
      if (plays === undefined || seed === null) continue
      seed.ad_plays = lenientAdPlays(plays)
    }
  } catch (err) {
    console.warn('[plan-seed] carry prior plays failed', errorMessage(err))
  }
}

/** 把任意异常转成可读字符串。 */
function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string' && err.length > 0) return err
  return '未知错误'
}

/** 读取周期；失败或抛错时返回 null。 */
async function readPeriod(
  goalId: string | null,
  loader: (goalId: string | null) => Promise<{ start_date: string; end_date: string } | null>,
): Promise<{ start_date: string; end_date: string } | null> {
  try {
    return await loader(goalId)
  } catch (err) {
    console.warn('[plan-seed] loadPeriod failed', errorMessage(err))
    return null
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

    if (ctx.priorContent !== undefined) carryPriorAdPlays(content, ctx.priorContent)
    sanitizeAdPlays(content)
    const plays = collectAdPlays(content)
    if (plays.length === 0) return content

    const period = await readPeriod(ctx.goalId, deps?.loadPeriod ?? loadGoalPeriod)
    const full = resolveDeps(deps)
    const seed = await buildPlanSeed({ clientId: ctx.clientId, plays, period }, full)

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
