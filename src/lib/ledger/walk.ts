import type { LedgerEntry } from './types'

/** 决定了 / 做了 之后多少天没动就摆到 PM 眼前 */
export const STALE_DAYS = 7

/** 夜巡每晚该给到期卡盖 last_checked；两天没盖 = 夜巡没来，不是没事 */
export const PATROL_SILENT_DAYS = 2

export type LedgerFinding =
  | { kind: 'decided_stale'; entry: LedgerEntry; daysIdle: number }
  | { kind: 'done_unverified'; entry: LedgerEntry; daysIdle: number }
  | { kind: 'patrol_missing'; entry: LedgerEntry; daysSilent: number }
  | { kind: 'verification_failed'; entry: LedgerEntry }

/** 两个 YYYY-MM-DD 之间的整天数；用 UTC 避免本地时区把日期挪一天 */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  const fromMs = Date.UTC(fy, fm - 1, fd)
  const toMs = Date.UTC(ty, tm - 1, td)
  return Math.floor((toMs - fromMs) / 86_400_000)
}

/** YYYY-MM-DD 加 delta 天；用 UTC 避免本地时区把日期挪一天 */
export function shiftDate(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const ms = Date.UTC(y, m - 1, d) + delta * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

/** 没写 verify_by 的 done 卡，默认做完 7 天后到期——否则夜巡永远不会去摸它 */
export function dueDateOf(entry: LedgerEntry): string {
  return entry.verifyBy ?? shiftDate(entry.doneOn ?? entry.decidedOn, STALE_DAYS)
}

function classifyDone(entry: LedgerEntry, today: string): LedgerFinding | null {
  const due = dueDateOf(entry)
  const sinceDue = daysBetween(due, today)
  const sinceChecked =
    entry.lastChecked === null ? null : daysBetween(entry.lastChecked, today)
  if (
    sinceDue >= PATROL_SILENT_DAYS &&
    (sinceChecked === null || sinceChecked >= PATROL_SILENT_DAYS)
  ) {
    return {
      kind: 'patrol_missing',
      entry,
      daysSilent: sinceChecked ?? sinceDue,
    }
  }
  const daysIdle = daysBetween(entry.doneOn ?? entry.decidedOn, today)
  const overdue = due <= today
  if (daysIdle > STALE_DAYS || overdue) {
    return { kind: 'done_unverified', entry, daysIdle }
  }
  return null
}

function classify(entry: LedgerEntry, today: string): LedgerFinding | null {
  switch (entry.status) {
    case 'verified':
      return null
    case 'failed':
      return { kind: 'verification_failed', entry }
    case 'decided': {
      const daysIdle = daysBetween(entry.decidedOn, today)
      const overdue = entry.verifyBy !== null && entry.verifyBy < today
      if (daysIdle > STALE_DAYS || overdue) {
        return { kind: 'decided_stale', entry, daysIdle }
      }
      return null
    }
    case 'done':
      return classifyDone(entry, today)
  }
}

const KIND_ORDER: Record<LedgerFinding['kind'], number> = {
  verification_failed: 0,
  patrol_missing: 1,
  decided_stale: 2,
  done_unverified: 3,
}

function daysIdleOf(finding: LedgerFinding): number {
  switch (finding.kind) {
    case 'verification_failed':
      return -1
    case 'patrol_missing':
      return finding.daysSilent
    default:
      return finding.daysIdle
  }
}

export function walkLedger(entries: LedgerEntry[], today: string): LedgerFinding[] {
  const findings: LedgerFinding[] = []
  for (const entry of entries) {
    const finding = classify(entry, today)
    if (finding !== null) findings.push(finding)
  }
  // 稳定排序：同 kind 同 daysIdle 时保持输入顺序
  return findings
    .map((finding, index) => ({ finding, index }))
    .sort((a, b) => {
      const byKind = KIND_ORDER[a.finding.kind] - KIND_ORDER[b.finding.kind]
      if (byKind !== 0) return byKind
      const byIdle = daysIdleOf(b.finding) - daysIdleOf(a.finding)
      if (byIdle !== 0) return byIdle
      return a.index - b.index
    })
    .map(({ finding }) => finding)
}
