/**
 * 「账户与账单」灯里，关于客户另外登记的广告账户的那句话。
 *
 * 为什么要有：隐藏 ≠ 没预算。广告健康页隐藏只是不显示，账户里开着的系列照样在花 / 随时会花；
 * 欠款账户现在投不出去，但里面开着的系列一旦还款就立刻恢复投放。所以不能因为「隐藏」就判绿。
 *
 * 🔴 纯函数、平台通用：不许出现客户名 / 客户 ID / 像素编号 / 域名。
 */

import type { OtherAccountFact } from './types'

export type OtherAccountsSummary =
  | { kind: 'cannot_sum' }
  | { kind: 'none_open'; accounts: number; hidden: number }
  | { kind: 'open'; reason: string; how: string }

export interface SummarizeInput {
  /** 客户登记的广告账户总数（含本次核对的这个） */
  registered: number
  others: readonly OtherAccountFact[]
  /** 本次核对账户的在投日预算合计（分） */
  live: number
  /** 库里的客户日预算总上限（分）；没设 = null */
  clientCap: number | null
  /** 本次核对账户的币种 */
  currency: string
  money: (minor: number, currency: string) => string
}

function hasOpenBudget(o: OtherAccountFact): boolean {
  return o.live_daily_budget_cents > 0 || o.live_lifetime_budget_count > 0
}

function statusText(o: OtherAccountFact): string {
  if (o.account_status === 1) return '账户正常，正在投放'
  if (o.account_status === 3) return '账户欠款、现在投不出去'
  if (o.account_status === null) return '账户状态没读到'
  return `账户状态码 ${o.account_status}、可能投不出去`
}

function describe(o: OtherAccountFact, currency: string, money: SummarizeInput['money']): string {
  const hiddenNote = o.hidden ? '，已在广告健康页隐藏' : ''
  const lifetimeNote =
    o.live_lifetime_budget_count > 0
      ? `，另有 ${o.live_lifetime_budget_count} 个用终身预算、折不出日预算`
      : ''
  return (
    `账户「${o.label ?? '未命名'}」（尾号 ${o.tail}${hiddenNote}，${statusText(o)}）里仍有 ` +
    `${o.open_campaign_count} 个系列开着，日预算合计 ${money(o.live_daily_budget_cents, currency)}` +
    lifetimeNote
  )
}

export function summarizeOtherAccounts(input: SummarizeInput): OtherAccountsSummary {
  const { registered, others, live, clientCap, currency, money } = input

  const mixedCurrency = others.some(
    (o) => o.currency !== null && o.currency.toUpperCase() !== currency.toUpperCase(),
  )
  if (others.length === 0 || mixedCurrency) return { kind: 'cannot_sum' }

  const openOnes = others.filter(hasOpenBudget)
  if (openOnes.length === 0) {
    return {
      kind: 'none_open',
      accounts: others.length,
      hidden: others.filter((o) => o.hidden).length,
    }
  }

  const lead =
    openOnes.length === 1
      ? '另一个' + describe(openOnes[0], currency, money)
      : '另有 ' +
        openOnes.length +
        ' 个账户有开着的预算：' +
        openOnes.map((o) => describe(o, currency, money)).join('；')

  const restNote =
    others.length > openOnes.length
      ? `（另有 ${others.length - openOnes.length} 个登记账户没有开着的预算）`
      : ''

  const combined = live + openOnes.reduce((sum, o) => sum + o.live_daily_budget_cents, 0)
  const allBlocked = openOnes.every((o) => o.account_status !== null && o.account_status !== 1)
  const anyRunning = openOnes.some((o) => o.account_status === 1)
  const pair = openOnes.length === 1 ? '两个账户合计' : '各账户合计'

  let tail: string
  if (clientCap === null) {
    tail = '客户总上限没设，合计没法比'
  } else if (combined > clientCap) {
    if (allBlocked) {
      tail = `它现在投不出去，但一旦恢复投放（比如还款），${pair} ${money(combined, currency)}，会超过客户总上限 ${money(clientCap, currency)}`
    } else if (anyRunning) {
      tail = `它正在投放，${pair} ${money(combined, currency)}，已经超过客户总上限 ${money(clientCap, currency)}`
    } else {
      tail = `${pair} ${money(combined, currency)}，超过客户总上限 ${money(clientCap, currency)}（状态没读到，不确定它现在能不能投）`
    }
  } else {
    tail = `${pair} ${money(combined, currency)}，在客户总上限 ${money(clientCap, currency)} 内`
  }

  const reason = `客户登记了 ${registered} 个广告账户，这里只核对这一个账户；${lead}${restNote}。${tail}`

  let how: string
  if (openOnes.every((o) => o.account_status === 3)) {
    how =
      '不要给欠款的账户还款；如必须还款，先通知广告总控，还款后立刻把它里面开着的系列暂停（欠款期间 Meta 不允许改动，没法先停）'
  } else if (anyRunning) {
    how = '把这个账户里开着的预算计入客户总上限；超了就先降预算或暂停多余的系列'
  } else {
    how = '先弄清这个账户为什么投不出去（状态码 / 欠款 / 停用）；恢复之前先处理它里面开着的系列'
  }

  return { kind: 'open', reason, how }
}
