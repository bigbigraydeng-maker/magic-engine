import type { Basis } from './types'

export interface SplitInput {
  steps: { step_key: string; accountId: string }[]
  clientHeadroomMinor: number
  accountHeadroomMinor: Record<string, number>
  share: number
  halve: { stale: boolean; dailyUnknown: boolean }
  humanCommitted?: { byAccount: Record<string, number>; all: number }
}

export type SplitResult = {
  step_key: string
  budgetMinor: number | null
  why_empty?: string
  divisors: { N: number; n_a: number }
  basis: Basis[]
}[]

/** 统计每个账户下有多少步（n_a）。 */
function countByAccount(steps: { accountId: string }[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const step of steps) {
    counts[step.accountId] = (counts[step.accountId] ?? 0) + 1
  }
  return counts
}

/** 生成"预算怎么算的"依据。 */
function budgetBasis(
  clientH: number,
  N: number,
  acctH: number,
  n_a: number,
  share: number,
  raw: number,
): Basis {
  const clientPer = Math.floor(clientH / N)
  const acctPer = Math.floor(acctH / n_a)
  return {
    label: '预算怎么算的',
    value: `客户余量 ${clientH} ÷ N=${N} → ${clientPer} ；账户余量 ${acctH} ÷ n_a=${n_a} → ${acctPer} ；取小者 × 剧本比例 ${share} = ${raw}`,
    source: '剧本参数 + 广告快照',
    as_of: null,
  }
}

/** 生成"保守口径"依据；不适用时返回 null。 */
function halveBasis(halve: { stale: boolean; dailyUnknown: boolean }): Basis | null {
  const reasons: string[] = []
  if (halve.stale) reasons.push('广告数据过期或读不到抓取时间')
  if (halve.dailyUnknown) reasons.push('近期逐日花费读不到')
  if (reasons.length === 0) return null
  return {
    label: '保守口径',
    value: `${reasons.join('、')}，按保守口径减半（只减半一次）`,
    source: '剧本参数 + 广告快照',
    as_of: null,
  }
}

export function splitBudget(i: SplitInput): SplitResult {
  const N = i.steps.length
  if (N === 0) return []

  const counts = countByAccount(i.steps)
  const clientH = Math.max(0, i.clientHeadroomMinor - (i.humanCommitted?.all ?? 0))
  const shouldHalve = i.halve.stale || i.halve.dailyUnknown
  const halveEntry = halveBasis(i.halve)

  return i.steps.map((step) => {
    const n_a = counts[step.accountId] ?? 1
    const acctH = Math.max(
      0,
      (i.accountHeadroomMinor[step.accountId] ?? 0) -
        (i.humanCommitted?.byAccount[step.accountId] ?? 0),
    )
    const raw = Math.floor(i.share * Math.min(clientH / N, acctH / n_a))
    const budget = shouldHalve ? Math.floor(raw / 2) : raw

    const basis: Basis[] = [budgetBasis(clientH, N, acctH, n_a, i.share, raw)]
    if (halveEntry) basis.push(halveEntry)

    if (budget <= 0) {
      return {
        step_key: step.step_key,
        budgetMinor: null,
        why_empty: `预算余量不够这一步（客户余量 ${clientH} ÷ ${N}，账户余量 ${acctH} ÷ ${n_a}，剧本比例 ${i.share}）`,
        divisors: { N, n_a },
        basis,
      }
    }

    return {
      step_key: step.step_key,
      budgetMinor: budget,
      divisors: { N, n_a },
      basis,
    }
  })
}
