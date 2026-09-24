/**
 * 今日待办里的「台账」栏。
 *
 * 台账（docs/ledger/*.md）是「决定了 / 做了」的登记簿：每条记着决定了什么、
 * 谁在做、什么时候该验、验的结果。`walkLedger` 负责挑出「决定了太久没动」、
 * 「做完了还没验」、「验过了不成」三类，这里把它们翻成 PM 能直接动手的待办。
 *
 * 台账文件在仓库里（不在数据库），所以读的是本地目录；目录读不出来时**必须**
 * 单独报一条 `ledger_unreadable` —— 这一栏空着不等于没事，正是铁律 3 下半
 * 「发现不许死在日志里」要防的那种静默。
 */

import type { ManualItem } from './manual-item-types'
import { loadLedger } from '@/lib/ledger/load'
import { walkLedger, type LedgerFinding } from '@/lib/ledger/walk'
import type { LedgerParseError } from '@/lib/ledger/types'

export const LEDGER_ENTRY_URL = 'https://github.com/bigbigraydeng-maker/magic-engine/blob/main/docs/ledger/'

/** PM 在新西兰，台账的「今天」按他看邮件的日子算。 */
export function nzToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

function infraItem(kind: ManualItem['kind'], what: string, how: string, href: string): ManualItem {
  return { kind, client_id: 'infra', client_name: 'Magic Engine 平台治理', what, how, href }
}

function findingItem(finding: LedgerFinding): ManualItem {
  const entry = finding.entry
  const t = truncate(entry.title, 120)
  const href = `${LEDGER_ENTRY_URL}${entry.id}.md`
  switch (finding.kind) {
    case 'decided_stale':
      return infraItem(
        'ledger_decided_stale',
        `「${t}」决定了 ${finding.daysIdle} 天还没动（台账 ${entry.id}）`,
        `告诉我哪个窗口在做；不做了就回一句「台账 ${entry.id} 取消」，做了就让那个窗口把记录改成 done`,
        href,
      )
    case 'done_unverified':
      return infraItem(
        'ledger_done_unverified',
        `「${t}」做完 ${finding.daysIdle} 天了还没验：${entry.verifyHow}`,
        '让做的窗口按上面那句去验，验完把记录改成 verified 或 failed',
        href,
      )
    case 'verification_failed':
      return infraItem(
        'ledger_verification_failed',
        `「${t}」验过了，不成（证据：${entry.verifiedRef ?? '未填'}）`,
        `决定重做还是放弃：重做就新开一条台账，放弃就回一句「台账 ${entry.id} 关闭」`,
        href,
      )
  }
}

export function buildLedgerItems(findings: LedgerFinding[], errors: LedgerParseError[]): ManualItem[] {
  return [
    ...findings.map(findingItem),
    ...errors.map((error) =>
      infraItem('ledger_unreadable', `台账 ${error.file} 读不出来：${error.reason}——这一栏空着不等于没事`, '回我一句「修台账」', ''),
    ),
  ]
}

export function pushLedgerItems(items: ManualItem[], now: Date, dir?: string): void {
  let loaded
  try {
    loaded = dir === undefined ? loadLedger() : loadLedger(dir)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    items.push(infraItem('ledger_unreadable', `台账目录读不出来（${message}）——这一栏空着不等于没事`, '回我一句「修台账」', ''))
    return
  }
  items.push(...buildLedgerItems(walkLedger(loaded.entries, nzToday(now)), loaded.errors))
}
