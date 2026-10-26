import { accountLevelRoom, accountRoom, currencyOfFacts } from './classify'
import { formatMinor } from './format'
import { splitBudget, type HalveFlags } from './split-budget'
import { computeLiveAdjustment, type LiveAdjustment } from './live-adjust'
import type { LiveDelivering } from './live-delivering'
import { windowBefore } from '@/lib/marketing-plan/promo/draft-ads'
import { isStale, safe, type AccountData, type PassingStep, type PlanSeedDeps } from './shared'
import type { Basis, Field } from './types'

const SNAPSHOT_SOURCE = '广告快照'
const CAPTURE_SOURCE = 'ad_snapshot_captures'

export const BUDGET_FIXED_BASIS: Basis[] = [
  { label: '建议范围', value: '这是第一版建议：只按客户和账户的日上限、在投合计算，不含受众与素材。', source: '剧本参数 + 广告快照', as_of: null },
  { label: '没扣掉的部分', value: '没扣掉计划里人工已填的步骤。', source: '剧本参数 + 广告快照', as_of: null },
  { label: '数据口径', value: '读到的在投合计来自最近一次数据抓取，抓取之后新开的广告不在内。', source: '剧本参数 + 广告快照', as_of: null },
]

/** 生成"合格候选账户"依据列表。 */
export function candidateBasis(accounts: AccountData[]): Basis[] {
  return accounts.map((a) => ({
    label: '合格候选账户',
    value: `${a.id}：可用余量 ${formatMinor(accountRoom(a.facts), currencyOfFacts(a.facts))}（读不全按 0 算）`,
    source: SNAPSHOT_SOURCE,
    as_of: a.captureAt,
  }))
}

/** 生成"余量数据抓取时间"依据。 */
export function captureBasis(captureAt: string | null): Basis {
  return {
    label: '余量数据抓取时间',
    value: captureAt ?? '读不到抓取时间',
    source: CAPTURE_SOURCE,
    as_of: captureAt,
  }
}

/** 生成"是否有 ME 成功建过广告"依据（本版读不到）。 */
export function meHistoryBasis(): Basis {
  return {
    label: '该账户是否有 ME 成功建过广告的记录',
    value: '本版读不到',
    source: '本版未接入',
    as_of: null,
  }
}

/** 收集已选账户的币种（大写去重）。 */
export function collectCurrencies(passing: PassingStep[]): string[] {
  const set = new Set<string>()
  for (const p of passing) {
    const facts = p.account.facts
    if (facts !== null && facts.headroom.ok === true) {
      const cur = facts.headroom.currency.trim().toUpperCase()
      if (cur !== '') set.add(cur)
    }
  }
  return Array.from(set)
}

/** 已选账户里最小的客户余量（读不到按 0）。 */
function minClientHeadroom(passing: PassingStep[]): number {
  let min: number | null = null
  for (const p of passing) {
    const facts = p.account.facts
    if (facts !== null && facts.headroom.ok === true) {
      const h = facts.headroom.headroom_minor
      if (min === null || h < min) min = h
    }
  }
  return min ?? 0
}

/** 已选账户的账户级余量映射（扣掉实时读到的增量）。 */
function accountHeadroomMap(
  passing: PassingStep[],
  bumpByAccount: Record<string, number>,
): Record<string, number> {
  const map: Record<string, number> = {}
  for (const p of passing) {
    map[p.accountId] = Math.max(
      0,
      accountLevelRoom(p.account.facts) - (bumpByAccount[p.accountId] ?? 0),
    )
  }
  return map
}

/** 近 7 天最高日花费 >= 客户日上限 95%（口径同 marketing-plan/promo/draft-ads.ts）；读不到逐日花费时不判（那条走 dailyUnknown）。 */
function isNearCap(facts: AccountData['facts']): boolean {
  if (facts === null || facts.daily === null || facts.headroom.ok !== true) return false
  let maxSpend = 0
  for (const row of windowBefore(facts.daily, facts.today, 7)) {
    if (row.spend_cents > maxSpend) maxSpend = row.spend_cents
  }
  return maxSpend >= facts.headroom.cap_minor * 0.95
}

/** 单个账户的保守口径标记。 */
function haveFlags(a: AccountData, nowMs: number): HalveFlags {
  return {
    stale: isStale(a.captureAt, nowMs),
    dailyUnknown: a.facts !== null && a.facts.daily === null,
    nearCap: isNearCap(a.facts),
  }
}

/** 客户层保守口径：所有候选账户里任一命中即命中。 */
function clientFlags(all: AccountData[], nowMs: number): HalveFlags {
  let stale = false
  let dailyUnknown = false
  let nearCap = false
  for (const a of all) {
    const f = haveFlags(a, nowMs)
    if (f.stale) stale = true
    if (f.dailyUnknown) dailyUnknown = true
    if (f.nearCap) nearCap = true
  }
  return { stale, dailyUnknown, nearCap }
}

/** 账户层保守口径：只按已选账户逐个给出。 */
function accountFlagMap(passing: PassingStep[], nowMs: number): Record<string, HalveFlags> {
  const map: Record<string, HalveFlags> = {}
  for (const p of passing) {
    map[p.accountId] = haveFlags(p.account, nowMs)
  }
  return map
}

/** 预算字段为空时的原因（按优先级）。 */
function budgetEmptyReason(
  passing: PassingStep,
  splitWhy: string | undefined,
  multiCurrency: boolean,
): string {
  const facts = passing.account.facts
  if (facts === null) return '读不到这个账户的广告快照'
  if (facts.headroom.ok !== true) return `客户预算余量读不全：${facts.headroom.reason}`
  if (facts.account_cap_minor === null || facts.account_delivering_minor === null) {
    return '账户日上限或在投预算读不到'
  }
  if (multiCurrency) return '多币种，本版不做跨币种'
  return splitWhy ?? '预算余量不够这一步'
}

/** 实时读数可用时去掉"数据口径"那条固定说明。 */
function fixedBasisFor(liveUsed: boolean): Basis[] {
  return liveUsed ? BUDGET_FIXED_BASIS.filter((b) => b.label !== '数据口径') : BUDGET_FIXED_BASIS
}

/** 组装单个通过步骤的 daily_budget_cents 字段。 */
export function buildBudgetField(
  passing: PassingStep,
  budgetMinor: number | null,
  splitWhy: string | undefined,
  splitBasis: Basis[],
  multiCurrency: boolean,
  liveBasis: Basis | null = null,
  liveUsed: boolean = false,
): Field<number> {
  const facts = passing.account.facts
  const canValue =
    budgetMinor !== null &&
    facts !== null &&
    facts.headroom.ok === true &&
    facts.account_cap_minor !== null &&
    facts.account_delivering_minor !== null &&
    !multiCurrency
  if (canValue && budgetMinor !== null) {
    return {
      ok: true,
      value: budgetMinor,
      basis: [
        ...splitBasis,
        ...(liveBasis !== null ? [liveBasis] : []),
        ...fixedBasisFor(liveUsed),
        captureBasis(passing.account.captureAt),
      ],
      notes: [],
    }
  }
  return {
    ok: false,
    why_empty: budgetEmptyReason(passing, splitWhy, multiCurrency),
    notes: [],
  }
}

/** 组装所有通过步骤的预算字段（含 splitBudget 调用）。 */
export async function buildBudgetFields(
  clientId: string,
  passing: PassingStep[],
  deps: PlanSeedDeps,
  extra: {
    nowMs: number
    multiCurrency: boolean
    allAccounts: AccountData[]
    unknownDrops: { step_key: string; reason: string }[]
    currency: string | null
    live?: Map<string, LiveDelivering | null>
  },
): Promise<Map<string, Field<number>>> {
  const out = new Map<string, Field<number>>()
  if (passing.length === 0) return out

  const shareRes = await safe(() => deps.playbookShare(clientId))
  const share = shareRes.ok && Number.isFinite(shareRes.value) ? shareRes.value : null
  if (share === null) {
    for (const p of passing) {
      out.set(p.play.step_key, {
        ok: false,
        why_empty: '读不到剧本里的预算比例',
        notes: [],
      })
    }
    return out
  }

  const adj: LiveAdjustment = computeLiveAdjustment(
    passing,
    extra.allAccounts,
    extra.live ?? new Map(),
  )

  const split = splitBudget({
    steps: passing.map((p) => ({ step_key: p.play.step_key, accountId: p.accountId })),
    clientHeadroomMinor: Math.max(0, minClientHeadroom(passing) - adj.totalBump),
    accountHeadroomMinor: accountHeadroomMap(passing, adj.bumpByAccount),
    share,
    halve: {
      client: clientFlags(extra.allAccounts, extra.nowMs),
      account: accountFlagMap(passing, extra.nowMs),
    },
    currency: extra.currency,
    extraDivisor: extra.unknownDrops.length,
  })

  const k = extra.unknownDrops.length
  const N = passing.length + k
  const dropReasons: string[] = []
  for (const d of extra.unknownDrops) {
    if (!dropReasons.includes(d.reason)) dropReasons.push(d.reason)
  }
  const divisorBasis: Basis | null =
    k > 0
      ? {
          label: '除数说明',
          value: `本来 ${N} 步，其中 ${k} 步因为读不到${dropReasons.join('、')}被丢掉，除数仍按 ${N} 算（读不到≠没有）`,
          source: '剧本参数 + 广告快照',
          as_of: null,
        }
      : null

  const byKey = new Map(split.map((r) => [r.step_key, r]))
  for (const p of passing) {
    const r = byKey.get(p.play.step_key)
    const splitBasis = r?.basis ?? []
    if (divisorBasis !== null) splitBasis.push(divisorBasis)
    out.set(
      p.play.step_key,
      buildBudgetField(
        p,
        r?.budgetMinor ?? null,
        r?.why_empty,
        splitBasis,
        extra.multiCurrency,
        adj.basisByAccount[p.accountId] ?? null,
        adj.liveUsedByAccount[p.accountId] ?? false,
      ),
    )
  }
  return out
}
