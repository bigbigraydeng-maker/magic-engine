import type {
  AutoSendOverview,
  BodyBlock,
  LetterSection,
  LetterSummary,
  OpenInfo,
  RecipientRow,
} from './types'
import { matchesFilter, type LetterFilter } from './status'
import { formatCount } from './format'

/**
 * Sections reduced to the letters that pass the current filter and batch-date
 * selection. Sections without any remaining letter are dropped. The input
 * overview is never mutated: every returned section is a new object with a new
 * letters array.
 */
export function visibleSections(
  overview: AutoSendOverview,
  filter: LetterFilter,
  batchDate: string | null,
): LetterSection[] {
  const sections: LetterSection[] = []

  for (const section of overview.sections) {
    const letters = section.letters.filter(
      (letter) =>
        matchesFilter(letter, filter) &&
        (batchDate === null || letter.sendDate === batchDate),
    )

    if (letters.length > 0) {
      sections.push({ ...section, letters })
    }
  }

  return sections
}

/** Number of letters across every section, regardless of filters. */
export function totalLetterCount(overview: AutoSendOverview): number {
  return overview.sections.reduce(
    (total, section) => total + section.letters.length,
    0,
  )
}

/** True when the overview holds no letter at all. */
export function isOverviewEmpty(overview: AutoSendOverview): boolean {
  return totalLetterCount(overview) === 0
}

/**
 * Splits the body preview into the blocks that fit and the count of the rest.
 * The limit is clamped so at least one block is always shown.
 */
export function splitBodyPreview(
  blocks: readonly BodyBlock[],
  maxBlocks: number,
): { shown: BodyBlock[]; hiddenCount: number } {
  const limit = Math.max(1, maxBlocks)
  const shown = blocks.slice(0, limit)

  return { shown, hiddenCount: blocks.length - shown.length }
}

/** Tiles shown above the recipient list on the detail view. */
export function detailTiles(summary: LetterSummary): Array<{
  key: 'recipients' | 'sent' | 'blocked' | 'failed' | 'rehearsal'
  label: string
  value: string
}> {
  const tiles: Array<{
    key: 'recipients' | 'sent' | 'blocked' | 'failed' | 'rehearsal'
    label: string
    value: string
  }> = [
    {
      key: 'recipients',
      label: '收件人',
      value: String(summary.recipientCount),
    },
    { key: 'sent', label: '已发', value: formatCount(summary.sentCount) },
    { key: 'blocked', label: '被拦', value: formatCount(summary.blockedCount) },
    { key: 'failed', label: '出错', value: formatCount(summary.failedCount) },
  ]

  if (summary.rehearsalCount > 0) {
    tiles.push({
      key: 'rehearsal',
      label: '演练',
      value: String(summary.rehearsalCount),
    })
  }

  return tiles
}

/** Label of the recipient tab, including how many people it lists. */
export function recipientsTabLabel(summary: LetterSummary): string {
  return `收件人与发送情况 ${summary.recipientCount}`
}

/** One grey line explaining where open data comes from; null when there is none. */
export function openInfoLine(info: OpenInfo): string | null {
  if (info.kind === 'per_recipient') {
    return `Mailchimp 回传：已打开 ${info.openedPeople} 位 · 其中点了链接 ${info.clickedPeople} 位`
  }

  if (info.kind === 'totals_only') {
    return `ME 自己发的信：打开 / 点击只记总数（打开 ${info.opens} 次 · 点击 ${info.clicks} 次），不记每位客人。`
  }

  return null
}

/**
 * Engagement cell of one recipient row. Only Mailchimp letters have
 * per-recipient data; everything else shows an em dash.
 */
export function engagementText(
  info: OpenInfo,
  row: Pick<RecipientRow, 'engagement'>,
): string {
  if (info.kind !== 'per_recipient') {
    return '—'
  }

  if (row.engagement === 'clicked') {
    return '点了链接'
  }

  if (row.engagement === 'opened') {
    return '已打开'
  }

  return '—'
}

/** Footnote under the recipient list, matching the open-info kind. */
export function recipientsFootnote(info: OpenInfo): string {
  if (info.kind === 'per_recipient') {
    return '只显示姓名，不显示邮箱；点姓名可以打开这位客人的资料。座位数来自订单，订单没填就显示「—」。'
  }

  return '只显示姓名，不显示邮箱。被拦的原因会写成人话：没有同意依据 / 最近 7 天已收满 2 封 / 客人说了别再联系 / 已在 Mailchimp 退订。'
}
