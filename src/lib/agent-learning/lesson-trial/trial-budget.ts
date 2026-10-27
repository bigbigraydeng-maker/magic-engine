/**
 * 对照试验的花费额度：每天 1 美元硬上限，复用 budget/reserve 的"先预留后结算"。
 * 账本是进程内存版（fake-ledger）：服务重启会清零；多实例各算各的，
 * 最坏情况下总花费 = 实例数 × 1 美元。要精确跨实例/重启就得持久化（写库/迁移，A 级），本 PR 不做。
 */
import { periodKeys } from '@/lib/agent-learning/budget/reserve'
import { createFakeLedger, type FakeLedger } from '@/lib/agent-learning/budget/fake-ledger'

export const TRIAL_DAILY_USD_CAP = 1

let ledger: FakeLedger | null = null

export function getTrialLedger(): FakeLedger {
  if (!ledger) ledger = createFakeLedger()
  return ledger
}

/** 测试用：重置进程内账本。 */
export function resetTrialLedger(): void {
  ledger = null
}

export function trialPeriodKey(now: Date): string {
  return `trial:usd:day:${periodKeys('distill', now).day}`
}

export interface TrialStatus {
  spentUsd: number
  capUsd: number
  trials: number
}

/** 今天已花多少、已对照几次（每次对照 = 一笔已结算的预留）。 */
export function trialStatus(l: FakeLedger, now: Date): TrialStatus {
  const key = trialPeriodKey(now)
  const row = l.row(key)
  const trials = l.holds().filter((h) => h.periodKey === key && h.status === 'settled').length
  return { spentUsd: row ? row.spent : 0, capUsd: TRIAL_DAILY_USD_CAP, trials }
}
