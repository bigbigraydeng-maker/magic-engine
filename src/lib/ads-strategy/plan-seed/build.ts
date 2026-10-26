import { classifyPlays } from './classify'
import { captureBasis, candidateBasis, buildBudgetFields, collectCurrencies, meHistoryBasis } from './budget-fields'
import { loadAllAccounts, loadCandidates, loadForms, loadPageContext, loadScopes } from './context'
import { LIVE_READ_TIMEOUT_MS } from './constants'
import { readLiveForSelected } from './live-read'
import type { AdPlay } from './ad-plays'
import { errorReason, type Accumulator, type PassingStep, type PlanSeedDeps, type SharedContext } from './shared'
import type { Basis, Field, PlanSeed, PlanSeedStep } from './types'

export type { PlanSeedDeps } from './shared'

export interface BuildArgs {
  clientId: string
  plays: AdPlay[]
  period: { start_date: string; end_date: string } | null
}

const DEFAULT_TIMEOUT_MS = 8000

/** Cap for the live read: at most LIVE_READ_TIMEOUT_MS, and always leave a margin before the overall deadline so a hung live read falls back to the snapshot instead of triggering the overall timeout. */
function liveCapMs(deadlineMs: number, timeoutMs: number): number {
  const margin = Math.min(500, Math.floor(timeoutMs / 4))
  return Math.max(0, Math.min(LIVE_READ_TIMEOUT_MS, deadlineMs - Date.now() - margin))
}

/** 组装 ad_account_id 字段（有值）。 */
function buildAccountField(passing: PassingStep): Field<string> {
  const basis: Basis[] = [
    ...candidateBasis(passing.eligibleAccounts),
    ...passing.eligibility.basis,
    meHistoryBasis(),
    captureBasis(passing.account.captureAt),
  ]
  const notes = ['这个数没算进该时间之后新开的广告']
  return { ok: true, value: passing.accountId, basis, notes }
}

/** 组装 page_id 字段（有值）。 */
function buildPageField(pageId: string): Field<string> {
  if (pageId.trim() === '') {
    return { ok: false, why_empty: '客户没配主页', notes: [] }
  }
  return {
    ok: true,
    value: pageId,
    basis: [
      {
        label: '客户主页',
        value: pageId,
        source: '客户设置（clients.facebook_page_id）',
        as_of: null,
      },
    ],
    notes: [],
  }
}

/** 组装一个完整的 PlanSeedStep。 */
function buildStep(
  passing: PassingStep,
  pageId: Field<string>,
  budget: Field<number>,
): PlanSeedStep {
  return {
    step_key: passing.play.step_key,
    play: passing.play.play,
    page_id: pageId,
    ad_account_id: buildAccountField(passing),
    daily_budget_cents: budget,
  }
}

/** 把通过步骤组装成 ad_steps；预算或主页读不到的步骤改记到 skipped。 */
function collectSteps(
  passing: PassingStep[],
  pageId: string,
  budgets: Map<string, Field<number>>,
  acc: Accumulator,
): void {
  const pageField = buildPageField(pageId)
  const steps: PlanSeedStep[] = []
  for (const p of passing) {
    const budget = budgets.get(p.play.step_key) ?? {
      ok: false,
      why_empty: '预算余量不够这一步',
      notes: [],
    }
    if (budget.ok !== true) {
      acc.skipped.push({ step_key: p.play.step_key, why_empty: budget.why_empty })
      continue
    }
    if (pageField.ok !== true) {
      acc.skipped.push({ step_key: p.play.step_key, why_empty: pageField.why_empty })
      continue
    }
    steps.push(buildStep(p, pageField, budget))
  }
  acc.steps = steps
}

/** 兜底：任何意外都只让剩余步骤跳过，不抛错。 */
function skipRemaining(args: BuildArgs, acc: Accumulator, err: unknown): void {
  const reason = errorReason(err)
  const doneKeys = new Set(acc.steps.map((s) => s.step_key))
  const skippedKeys = new Set(acc.skipped.map((s) => s.step_key))
  for (const play of args.plays) {
    if (doneKeys.has(play.step_key) || skippedKeys.has(play.step_key)) continue
    acc.skipped.push({ step_key: play.step_key, why_empty: `取数出错：${reason}` })
  }
  acc.done = true
}

/** 组装最终 PlanSeed。 */
function assemble(
  args: BuildArgs,
  acc: Accumulator,
  factsAsOf: string,
): PlanSeed {
  return {
    schema_version: 1,
    produced_by: 'ads-agent',
    facts_as_of: factsAsOf,
    currency: acc.currency,
    period: args.period,
    captured_at: { ...acc.capturedAt },
    ad_steps: [...acc.steps],
    skipped: [...acc.skipped],
    notes: [...acc.notes],
  }
}

/** 把全部打法标记为跳过。 */
function skipAll(plays: AdPlay[], why: string): { step_key: string; why_empty: string }[] {
  return plays.map((p) => ({ step_key: p.step_key, why_empty: why }))
}

/** 主工作函数：把结果写进累加器，永不抛错。 */
async function runWork(
  args: BuildArgs,
  deps: PlanSeedDeps,
  acc: Accumulator,
  limits: { deadlineMs: number; timeoutMs: number },
): Promise<void> {
  try {
    const nowMs = deps.now().getTime()
    const { candidates, why } = await loadCandidates(args.clientId, deps)
    if (why !== null) {
      acc.skipped = skipAll(args.plays, why)
      acc.done = true
      return
    }

    const { pageId, pageToken, pageTokenValue } = await loadPageContext(args.clientId, deps)
    const { tokenSource, scopes } = await loadScopes(args.clientId, deps)
    const forms = await loadForms(args.plays, pageId, pageToken, pageTokenValue, deps)
    const ctx: SharedContext = { pageId, pageToken, pageTokenValue, scopes, tokenSource, forms }

    const accounts = await loadAllAccounts(args.clientId, candidates, deps)
    for (const a of accounts) acc.capturedAt[a.id] = a.captureAt

    const { passing, skipped, unknownDrops } = classifyPlays(args.plays, accounts, ctx)
    acc.skipped = skipped

    const currencies = collectCurrencies(passing)
    const multiCurrency = currencies.length > 1
    acc.currency = currencies.length === 1 ? currencies[0] : null
    if (multiCurrency) acc.notes.push('多币种')

    const live = await readLiveForSelected(
      args.clientId,
      passing,
      deps,
      liveCapMs(limits.deadlineMs, limits.timeoutMs),
    )

    const budgets = await buildBudgetFields(args.clientId, passing, deps, {
      nowMs,
      multiCurrency,
      allAccounts: accounts,
      unknownDrops,
      currency: acc.currency,
      live,
    })

    collectSteps(passing, pageId ?? '', budgets, acc)
    acc.done = true
  } catch (err) {
    skipRemaining(args, acc, err)
  }
}

/** 超时后从累加器组装：未完成的打法标记为取数超时。 */
function assembleOnTimeout(args: BuildArgs, acc: Accumulator, factsAsOf: string): PlanSeed {
  const doneKeys = new Set(acc.steps.map((s) => s.step_key))
  const skippedKeys = new Set(acc.skipped.map((s) => s.step_key))
  for (const play of args.plays) {
    if (doneKeys.has(play.step_key) || skippedKeys.has(play.step_key)) continue
    acc.skipped.push({ step_key: play.step_key, why_empty: '取数超时' })
  }
  acc.notes.push('取数超时，只返回已经算出的部分')
  return assemble(args, acc, factsAsOf)
}

/** 取当前时间的 ISO 字符串；时钟依赖抛错时退回系统时间，保证入口永不抛错。 */
function safeNowIso(deps: PlanSeedDeps): string {
  try {
    return deps.now().toISOString()
  } catch {
    return new Date().toISOString()
  }
}

/** 空周期：直接返回空种子，不调用任何依赖（除 now）。 */
function emptyPeriodSeed(args: BuildArgs, deps: PlanSeedDeps): PlanSeed {
  return {
    schema_version: 1,
    produced_by: 'ads-agent',
    facts_as_of: safeNowIso(deps),
    currency: null,
    period: null,
    captured_at: {},
    ad_steps: [],
    skipped: [],
    notes: ['目标没有周期，没法产出种子（不猜）'],
  }
}

/** 入口：永不抛错、永不 reject。 */
export async function buildPlanSeed(
  args: BuildArgs,
  deps: PlanSeedDeps,
  opts?: { timeoutMs?: number },
): Promise<PlanSeed> {
  if (args.period === null) return emptyPeriodSeed(args, deps)

  const factsAsOf = safeNowIso(deps)
  const acc: Accumulator = {
    steps: [],
    skipped: [],
    notes: [],
    capturedAt: {},
    currency: null,
    done: false,
  }

  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const deadlineMs = Date.now() + timeoutMs
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs)
  })

  try {
    const workPromise = runWork(args, deps, acc, { deadlineMs, timeoutMs }).then(
      () => 'done' as const,
    )
    const winner = await Promise.race([workPromise, timeoutPromise])
    if (winner === 'timeout') {
      return assembleOnTimeout(args, acc, factsAsOf)
    }
    return assemble(args, acc, factsAsOf)
  } catch {
    // runWork 内部已兜底；这里再兜一层，保证永不 reject。
    return assembleOnTimeout(args, acc, factsAsOf)
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}

