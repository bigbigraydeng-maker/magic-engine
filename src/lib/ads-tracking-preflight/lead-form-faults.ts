/**
 * 表单留资系列的三种故障。纯函数：不读网络、不读库、不读时钟（时刻由调用方给）。
 * 读不到的数不当成 0，也不因此判成故障（判不了就写在 notes 里）。
 * 不点名任何客户。
 */

import { formatCents } from './objective-watch-text'
import { isInPlay, type EntityFact } from './objective-watch'
import type { LeadFormStopFault, StopFaultCode } from './lead-form-types'

export const DEFAULT_CRM_LAG_HOURS = 2
export const DEFAULT_SYNC_FAILURE_RUNS = 3

const PROBLEM_STATUSES: ReadonlySet<string> = new Set(['DISAPPROVED', 'WITH_ISSUES'])

export interface LeadFormMoney {
  todaySpendCents: number | null
  lifetimeSpendCents: number | null
  dailyBudgetCents: number | null
  /** 这一条系列所在账户的日上限（分）。null = 没配或没读到，调用方用 capKnown 分开。 */
  accountCapCents: number | null
  accountCapKnown: boolean
  accountTodaySpendCents: number | null
  totalCapCents: number | null
  totalCapKnown: boolean
  clientTodaySpendCents: number | null
  /** 正数才按倍数判；null = 这条系列没配倍数 */
  multiple: number | null
  currency: string
}

export interface LeadFormCrm {
  read: boolean
  /** 账户时区「今天」CRM 里新进来的表单留资条数。没读到 = null */
  leadsToday: number | null
  /** Meta 今天报的线索数。没读到 = null */
  metaLeadsToday: number | null
  lagHours: number
  /** 上一小时回执里「Meta 比 CRM 多」开始的时刻；没有 = null */
  previousSurplusSince: string | null
}

export interface LeadFormSync {
  read: boolean
  /** 从最近一轮往前数，连续失败了几轮。没读到 = null */
  streak: number | null
  failureRuns: number
}

export interface LeadFormJudgeInput {
  now: Date
  money: LeadFormMoney
  crm: LeadFormCrm
  sync: LeadFormSync
  ads: readonly EntityFact[]
  adsets: readonly EntityFact[]
  campaignEffectiveStatus: string | null
}

export interface LeadFormReview {
  faults: LeadFormStopFault[]
  notes: string[]
  /** 这一小时结束时，盈余从什么时候开始；对上了或判不了 = null */
  crmSurplusSince: string | null
}

interface Piece {
  fault: LeadFormStopFault | null
  notes: string[]
}

function fault(code: StopFaultCode, what: string): LeadFormStopFault {
  return { code, what }
}

function moneyText(cents: number, currency: string): string {
  return formatCents(cents, currency)
}

function overMultiple(money: LeadFormMoney): string | null {
  const { multiple, dailyBudgetCents, todaySpendCents } = money
  if (multiple === null) return null
  if (dailyBudgetCents === null || dailyBudgetCents <= 0 || todaySpendCents === null) return null
  if (todaySpendCents > dailyBudgetCents * multiple) {
    return `当天花费 ${moneyText(todaySpendCents, money.currency)}，超过日预算 ${moneyText(dailyBudgetCents, money.currency)} 的 ${multiple} 倍`
  }
  return null
}

function overAccount(money: LeadFormMoney): { line: string | null; note: string | null } {
  if (!money.accountCapKnown) return { line: null, note: '账户日上限没读到，这项不判' }
  if (money.accountCapCents === null) return { line: null, note: '账户日上限没配，这项不判' }
  if (money.accountTodaySpendCents === null) return { line: null, note: '账户当天花费没读到，这项不判' }
  if (money.accountTodaySpendCents > money.accountCapCents) {
    return {
      line: `账户当天花费 ${moneyText(money.accountTodaySpendCents, money.currency)}，超过账户日上限 ${moneyText(money.accountCapCents, money.currency)}`,
      note: null,
    }
  }
  return { line: null, note: null }
}

function overTotal(money: LeadFormMoney): { line: string | null; note: string | null } {
  if (!money.totalCapKnown) return { line: null, note: '总日上限没读到，这项不判' }
  if (money.totalCapCents === null) return { line: null, note: '总日上限没配，这项不判' }
  if (money.clientTodaySpendCents === null) return { line: null, note: '客户当天总花费没读到，这项不判' }
  if (money.clientTodaySpendCents > money.totalCapCents) {
    return {
      line: `全部账户当天花费 ${moneyText(money.clientTodaySpendCents, money.currency)}，超过总日上限 ${moneyText(money.totalCapCents, money.currency)}`,
      note: null,
    }
  }
  return { line: null, note: null }
}

function judgeOverCap(money: LeadFormMoney): Piece {
  const notes: string[] = []
  const lines: string[] = []
  if (money.multiple === null) notes.push('没配日花费倍数，不按倍数判')
  else if (money.dailyBudgetCents === null || money.dailyBudgetCents <= 0) notes.push('系列日预算没读到，不按倍数判')
  else if (money.todaySpendCents === null) notes.push('系列当天花费没读到，不按倍数判')
  const multipleLine = overMultiple(money)
  if (multipleLine !== null) lines.push(multipleLine)
  const account = overAccount(money)
  if (account.note !== null) notes.push(account.note)
  if (account.line !== null) lines.push(account.line)
  const total = overTotal(money)
  if (total.note !== null) notes.push(total.note)
  if (total.line !== null) lines.push(total.line)
  if (lines.length === 0) return { fault: null, notes }
  return { fault: fault('over_daily_cap', lines.join('。')), notes }
}

/** Meta 今天的线索比 CRM 今天多，而且这种落后已经持续到阈值。第一小时只记时刻，不停。 */
export function resolveCrmSurplus(input: {
  now: Date
  metaLeadsToday: number | null
  crmLeadsToday: number | null
  previousSince: string | null
  lagHours: number
}): { since: string | null; stale: boolean; note: string | null } {
  if (input.metaLeadsToday === null || input.crmLeadsToday === null) {
    return { since: null, stale: false, note: '线索数没读全，CRM 对账这项不判' }
  }
  if (input.metaLeadsToday <= input.crmLeadsToday) return { since: null, stale: false, note: null }
  const previousMs = input.previousSince === null ? Number.NaN : Date.parse(input.previousSince)
  const since = Number.isFinite(previousMs) ? input.previousSince : input.now.toISOString()
  const elapsed = input.now.getTime() - Date.parse(since ?? '')
  const stale = Number.isFinite(elapsed) && elapsed >= input.lagHours * 3_600_000
  return { since, stale, note: null }
}

function judgeCrm(input: LeadFormJudgeInput): Piece & { since: string | null } {
  const notes: string[] = []
  const lines: string[] = []
  const surplus = input.crm.read
    ? resolveCrmSurplus({
      now: input.now,
      metaLeadsToday: input.crm.metaLeadsToday,
      crmLeadsToday: input.crm.leadsToday,
      previousSince: input.crm.previousSurplusSince,
      lagHours: input.crm.lagHours,
    })
    : { since: null, stale: false, note: 'CRM 没读到，对账这项不判' }
  if (surplus.note !== null) notes.push(surplus.note)
  if (surplus.stale && input.crm.metaLeadsToday !== null && input.crm.leadsToday !== null) {
    lines.push(`Meta 今天 ${input.crm.metaLeadsToday} 条线索，CRM 今天 ${input.crm.leadsToday} 条，已经超过 ${input.crm.lagHours} 小时没有跟上`)
  }
  if (!input.sync.read || input.sync.streak === null) notes.push('表单留资同步记录没读到，连续失败这项不判')
  else if (input.sync.streak >= input.sync.failureRuns) {
    lines.push(`表单留资同步连续 ${input.sync.streak} 次失败`)
  }
  if (lines.length === 0) return { fault: null, notes, since: surplus.since }
  return { fault: fault('crm_leads_missing', lines.join('。')), notes, since: surplus.since }
}

function problemLabel(status: string): string {
  if (status === 'DISAPPROVED') return '被拒'
  if (status === 'WITH_ISSUES') return '有问题'
  return status
}

function problemLines(kind: string, rows: readonly EntityFact[]): string[] {
  const lines: string[] = []
  for (const row of rows) {
    const status = row.effective_status
    if (!isInPlay(status) || status === null || !PROBLEM_STATUSES.has(status)) continue
    lines.push(`${kind}「${row.name}」${problemLabel(status)}`)
  }
  return lines
}

function judgeRejected(input: LeadFormJudgeInput): Piece {
  const lines = [
    ...problemLines('广告组', input.adsets),
    ...problemLines('广告', input.ads),
  ]
  const campaign = input.campaignEffectiveStatus
  if (campaign !== null && PROBLEM_STATUSES.has(campaign)) lines.unshift(`系列本身${problemLabel(campaign)}`)
  if (lines.length === 0) return { fault: null, notes: [] }
  return { fault: fault('ad_rejected', `${lines.join('，')}，会影响投放`), notes: [] }
}

/** 判一个表单留资系列。三种故障各自独立，读不到的那一项跳过。 */
export function judgeLeadFormFaults(input: LeadFormJudgeInput): LeadFormReview {
  const over = judgeOverCap(input.money)
  const crm = judgeCrm(input)
  const rejected = judgeRejected(input)
  const faults = [over.fault, crm.fault, rejected.fault].filter((item): item is LeadFormStopFault => item !== null)
  return {
    faults,
    notes: [...over.notes, ...crm.notes, ...rejected.notes],
    crmSurplusSince: crm.since,
  }
}
