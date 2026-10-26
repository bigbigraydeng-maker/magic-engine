import type { Basis } from './types'
import { formatMinor } from './format'

export interface HalveFlags {
  stale: boolean
  dailyUnknown: boolean
  /** 近 7 天最高日花费已 >= 客户日上限的 95%（与 draft-ads 同口径）。 */
  nearCap?: boolean
}

export interface SplitInput {
  steps: { step_key: string; accountId: string }[]
  clientHeadroomMinor: number
  accountHeadroomMinor: Record<string, number>
  share: number
  halve: { client: HalveFlags; account: Record<string, HalveFlags> }
  currency: string | null
  extraDivisor?: number
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
  currency: string | null,
): Basis {
  const clientPer = Math.floor(clientH / N)
  const acctPer = Math.floor(acctH / n_a)
  const F = (minor: number): string => formatMinor(minor, currency)
  return {
    label: '预算怎么算的',
    value: `客户余量 ${F(clientH)} ÷ N=${N} → ${F(clientPer)}；账户余量 ${F(acctH)} ÷ n_a=${n_a} → ${F(acctPer)}；取小者 × 剧本比例 ${share} = ${F(raw)}`,
    source: '剧本参数 + 广告快照',
    as_of: null,
  }
}

/** 生成"保守口径"依据；不适用时返回 null。 */
function halveBasis(
  clientFlags: HalveFlags,
  accountFlags: HalveFlags | undefined,
): Basis | null {
  const reasons: string[] = []
  if (clientFlags.stale) reasons.push('客户名下账户的广告数据过期或读不到抓取时间')
  if (clientFlags.dailyUnknown) reasons.push('客户名下账户近期逐日花费读不到')
  if (clientFlags.nearCap) reasons.push('客户名下账户最近真实日花费已经贴近上限')
  if (accountFlags?.stale) reasons.push('该账户的广告数据过期或读不到抓取时间')
  if (accountFlags?.dailyUnknown) reasons.push('该账户近期逐日花费读不到')
  if (accountFlags?.nearCap) reasons.push('该账户最近真实日花费已经贴近上限')
  if (reasons.length === 0) return null
  return {
    label: '保守口径',
    value: `${reasons.join('、')}，按保守口径减半（只减半一次）`,
    source: '剧本参数 + 广告快照',
    as_of: null,
  }
}

export function splitBudget(i: SplitInput): SplitResult {
  if (i.steps.length === 0) return []
  const N = i.steps.length + (i.extraDivisor ?? 0)

  const counts = countByAccount(i.steps)
  const clientH = Math.max(0, i.clientHeadroomMinor)
  const F = (minor: number): string => formatMinor(minor, i.currency)

  return i.steps.map((step) => {
    const n_a = counts[step.accountId] ?? 1
    const acctH = Math.max(0, i.accountHeadroomMinor[step.accountId] ?? 0)
    const accountFlags = i.halve.account[step.accountId]
    const shouldHalve =
      i.halve.client.stale ||
      i.halve.client.dailyUnknown ||
      (i.halve.client.nearCap ?? false) ||
      (accountFlags?.stale ?? false) ||
      (accountFlags?.dailyUnknown ?? false) ||
      (accountFlags?.nearCap ?? false)
    const raw = Math.floor(i.share * Math.min(clientH / N, acctH / n_a))
    const budget = shouldHalve ? Math.floor(raw / 2) : raw

    const basis: Basis[] = [
      budgetBasis(clientH, N, acctH, n_a, i.share, raw, i.currency),
    ]
    const halveEntry = halveBasis(i.halve.client, accountFlags)
    if (halveEntry) basis.push(halveEntry)

    if (budget <= 0) {
      return {
        step_key: step.step_key,
        budgetMinor: null,
        why_empty: `预算余量不够这一步（客户余量 ${F(clientH)} ÷ ${N}，账户余量 ${F(acctH)} ÷ ${n_a}，剧本比例 ${i.share}）`,
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
