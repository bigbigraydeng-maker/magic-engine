/**
 * 按团汇总（纯函数，不读数据库）：每个（团 × 出发日）一行——收件人数、已发几封、往后几封、过期没发几封、
 * 最近一封发出去的结果、下一封哪天发。数据来自 buildList 已经算好的「计划里的每一封信 + 它现在的一行」。
 *
 * 口径：
 *  - 只列还没出发的团（出发日 ≥ 今天）。
 *  - 已发 = 状态是「已发」的信（至少一位真发出去，演练不算）；往后 = 发信日 ≥ 今天且还没发出的信。
 *  - 前面错过的批次不补（计划规则），所以发信日已过、没发出去的信不算进「往后」，也不算进「已发」；
 *    其中系统里有痕迹的（提案 / 发送记录）、以及状态是「没发出去」且要人去看的（有出错 / 被退回，或放行了却没有记录；
 *    全是规则内跳过的不提醒），单独数成「过期没发」，让人一眼看到「这批没发出去」；
 *  - 状态是「结果不明」的信（信可能已经送到）单独数成 lettersUnknown，不并进「过期没发」，也不算「往后」。
 *  - 远期的信没读记录（页面只关心最近几批），按草稿算。
 */

import { needsAttention } from './attention'
import type { LetterEntry } from './history'
import { tourCodeOf } from './keys'
import type { LetterRow, NzDate, TourGroupRow } from './types'

function lastSentOf(row: LetterRow): NonNullable<TourGroupRow['lastSent']> {
  return {
    letterKey: row.letterKey,
    sendDate: row.sendDate,
    recipients: row.counts.recipients,
    sent: row.counts.sent ?? 0,
    blocked: row.counts.blocked ?? 0,
    failed: row.counts.failed ?? 0,
    unknown: row.counts.unknown,
    opened: row.counts.opened,
  }
}

/** 这封信算不算「过期没发」：要人去看的没发出去，或者发信日已过、系统里有痕迹却还是草稿 / 等你放行。 */
function isOverdue(entry: LetterEntry, today: NzDate): boolean {
  const { status } = entry.row
  if (status === 'not_sent') return needsAttention(entry.row)
  if (status === 'sent' || status === 'unknown') return false
  return entry.letter.sendDate < today && entry.traced
}

function compareByDate(a: LetterEntry, b: LetterEntry): number {
  return a.letter.sendDate.localeCompare(b.letter.sendDate) || a.letter.letterKey.localeCompare(b.letter.letterKey)
}

function groupRow(bucket: readonly LetterEntry[], today: NzDate, displayed: ReadonlySet<string>): TourGroupRow {
  const ordered = [...bucket].sort(compareByDate)
  const sent = ordered.filter((entry) => entry.row.status === 'sent')
  const unknown = ordered.filter((entry) => entry.row.status === 'unknown')
  const ahead = ordered.filter(
    (entry) => entry.letter.sendDate >= today && !['sent', 'not_sent', 'unknown'].includes(entry.row.status),
  )
  const overdue = ordered.filter((entry) => isOverdue(entry, today))
  const identity = ordered[0].letter
  const last = sent[sent.length - 1]
  const next = ahead[0]
  return {
    groupKey: `g:${tourCodeOf(identity.tourId)}:${identity.departOn}`,
    tourName: identity.tourName,
    departOn: identity.departOn,
    recipients: identity.recipients.length,
    lettersSent: sent.length,
    lettersAhead: ahead.length,
    lettersOverdue: overdue.length,
    lettersUnknown: unknown.length,
    lastSent: last === undefined ? null : lastSentOf(last.row),
    next: next === undefined ? null : { letterKey: next.row.letterKey, sendDate: next.row.sendDate, status: next.row.status },
    letterKeys: ordered.filter((entry) => displayed.has(entry.row.letterKey)).map((entry) => entry.row.letterKey),
  }
}

/** `displayed`：已经在列表里有行可看的信的编号（pastLetters ∪ scheduledLetters），点开一个团时用。 */
export function buildTourGroups(
  entries: readonly LetterEntry[],
  today: NzDate,
  displayed: ReadonlySet<string>,
): TourGroupRow[] {
  const buckets = new Map<string, LetterEntry[]>()
  for (const entry of entries) {
    if (entry.letter.departOn < today) continue
    const key = `${entry.letter.tourId}\u0000${entry.letter.departOn}`
    buckets.set(key, [...(buckets.get(key) ?? []), entry])
  }
  return Array.from(buckets.values(), (bucket) => groupRow(bucket, today, displayed)).sort(
    (a, b) => a.departOn.localeCompare(b.departOn) || a.tourName.localeCompare(b.tourName) || a.groupKey.localeCompare(b.groupKey),
  )
}
