import type { LedgerEntry } from './types'

/** 决定了 / 做了 之后多少天没动就摆到 PM 眼前 */
export const STALE_DAYS = 7

export type LedgerFinding =
  | { kind: 'decided_stale'; entry: LedgerEntry; daysIdle: number }
  | { kind: 'done_unverified'; entry: LedgerEntry; daysIdle: number }
  | { kind: 'verification_failed'; entry: LedgerEntry }

/** 两个 YYYY-MM-DD 之间的整天数；用 UTC 避免本地时区把日期挪一天 */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  const fromMs = Date.UTC(fy, fm - 1, fd)
  const toMs = Date.UTC(ty, tm - 1, td)
  return Math.floor((toMs - fromMs) / 86_400_000)
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
    case 'done': {
      const daysIdle = daysBetween(entry.doneOn ?? entry.decidedOn, today)
      const overdue = entry.verifyBy !== null && entry.verifyBy <= today
      if (daysIdle > STALE_DAYS || overdue) {
        return { kind: 'done_unverified', entry, daysIdle }
      }
      return null
    }
  }
}

const KIND_ORDER: Record<LedgerFinding['kind'], number> = {
  verification_failed: 0,
  decided_stale: 1,
  done_unverified: 2,
}

function daysIdleOf(finding: LedgerFinding): number {
  return finding.kind === 'verification_failed' ? -1 : finding.daysIdle
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
