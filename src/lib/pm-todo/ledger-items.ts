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

/** 每种发现对应的 what / how 文案。拆出来是为了让 findingItem 保持短小。 */
function findingText(finding: LedgerFinding): { what: string; how: string } {
  const entry = finding.entry
  const t = truncate(entry.title, 120)
  switch (finding.kind) {
    case 'decided_stale':
      return {
        what: `「${t}」决定了 ${finding.daysIdle} 天还没动（台账 ${entry.id}）`,
        how: `找任何一个 Claude Code 窗口说「台账 ${entry.id} 取消」或「台账 ${entry.id} 谁在做」，它会开 PR 改这张卡`,
      }
    case 'done_unverified': {
      const checked =
        entry.lastChecked === null
          ? ''
          : `｜上次自动核查 ${entry.lastChecked}：${entry.checkNote ?? '（没留备注）'}`
      return {
        what: `「${t}」做完 ${finding.daysIdle} 天了还没验：${entry.verifyHow}${checked}`,
        how: '让做的窗口按上面那句去验，验完把记录改成 verified 或 failed',
      }
    }
    case 'patrol_missing':
      return {
        what: `「${t}」到了该验的日子，夜巡已经 ${finding.daysSilent} 天没来摸这张卡——不是没事，是没人查`,
        how: '找任何一个 Claude Code 窗口说「查夜巡」，让它看 ledger-nightly-verify 这个定时任务最近跑没跑',
      }
    case 'verification_failed':
      return {
        what: `「${t}」验过了，不成（证据：${entry.verifiedRef ?? '未填'}）`,
        how: `找任何一个 Claude Code 窗口说「台账 ${entry.id} 重做」或「台账 ${entry.id} 关闭」，重做会新开一张卡`,
      }
  }
}

function findingItem(finding: LedgerFinding): ManualItem {
  const { what, how } = findingText(finding)
  return infraItem(
    `ledger_${finding.kind}`,
    what,
    how,
    `${LEDGER_ENTRY_URL}${finding.entry.id}.md`,
  )
}

export function buildLedgerItems(findings: LedgerFinding[], errors: LedgerParseError[]): ManualItem[] {
  return [
    ...findings.map(findingItem),
    ...errors.map((error) =>
      infraItem(
        'ledger_unreadable',
        `台账 ${error.file} 读不出来：${error.reason}——这一栏空着不等于没事`,
        '找任何一个 Claude Code 窗口说「修台账」',
        '',
      ),
    ),
  ]
}

export function pushLedgerItems(items: ManualItem[], now: Date, dir?: string): void {
  let loaded
  try {
    loaded = dir === undefined ? loadLedger() : loadLedger(dir)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    items.push(
      infraItem(
        'ledger_unreadable',
        `台账目录读不出来（${message}）——这一栏空着不等于没事`,
        '找任何一个 Claude Code 窗口说「修台账」',
        '',
      ),
    )
    return
  }
  items.push(...buildLedgerItems(walkLedger(loaded.entries, nzToday(now)), loaded.errors))
}
