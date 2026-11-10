import type {
  AutoSendOverview,
  BodyBlock,
  LetterSection,
  LetterSummary,
  OpenInfo,
  RecipientRow,
  TourGroupSummary,
} from './types'
import { matchesFilter, type LetterFilter } from './status'
import { formatCount, formatShortDate } from './format'

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

/** 换个角度看：按团（每个团一行）还是按信（每封信一行）。 */
export type ViewChoice = 'groups' | 'letters'

export const VIEW_OPTIONS: ReadonlyArray<{ key: ViewChoice; label: string }> = [
  { key: 'groups', label: '按团看' },
  { key: 'letters', label: '按信看' },
]

/** 没有团可看就只能按信看；员工还没选过时，有团就先按团看（PM 要的就是「按团看发没发」）。 */
export function resolveView(choice: ViewChoice | null, overview: AutoSendOverview): ViewChoice {
  if (overview.groups.length === 0) return 'letters'
  return choice ?? 'groups'
}

/** 页面上所有的信（按 letterId）；按团看展开一个团时用。 */
export function lettersById(overview: AutoSendOverview): Map<string, LetterSummary> {
  const byId = new Map<string, LetterSummary>()
  for (const section of overview.sections) {
    for (const letter of section.letters) byId.set(letter.letterId, letter)
  }
  return byId
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

export type TileKey = 'recipients' | 'sent' | 'blocked' | 'failed' | 'rehearsal' | 'opened'

/** Tiles shown above the recipient list on the detail view. */
export function detailTiles(summary: LetterSummary): Array<{
  key: TileKey
  label: string
  value: string
}> {
  const tiles: Array<{
    key: TileKey
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

  // 打开只在这类信记录打开时才有一块；不记录的信不放一块永远是「—」的格子。
  if (summary.openedCount !== null) {
    tiles.push({
      key: 'opened',
      label: '打开（仅供参考）',
      value: String(summary.openedCount),
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
    const counts = `已打开 ${info.openedPeople} 位 · 其中点了链接 ${info.clickedPeople} 位`
    return info.fromMailchimp ? `Mailchimp 回传：${counts}` : `${counts}（仅供参考）`
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

/** 列表和「按团看」底下共用的一句话：打开数只能当参考。 */
export const OPENED_NOTE =
  '「打开」只能当参考：有些邮箱会提前加载图片，把没看的信也算成已打开；这类信不记录打开的，显示「—」。'

/** 「按团看」里「最近一封」那一格：12月2日 · 已发 8 · 被拦 1 · 出错 1 · 打开 6（出错为 0 就不写；没有记录打开的显示「—」）。 */
export function lastSentLine(last: NonNullable<TourGroupSummary['lastSent']>): string {
  const parts = [formatShortDate(last.sendDate), `已发 ${last.sentCount}`, `被拦 ${last.blockedCount}`]
  if (last.failedCount > 0) parts.push(`出错 ${last.failedCount}`)
  parts.push(`打开 ${formatCount(last.openedCount)}`)
  return parts.join(' · ')
}

/** 一封信在展开的团里那一行的小字：已发 8 · 被拦 1 · 打开 —（还没发的信只写「还没发」）。 */
export function letterResultLine(letter: LetterSummary): string {
  if (letter.sentCount === null) return '还没发'
  const parts = [`已发 ${letter.sentCount}`, `被拦 ${formatCount(letter.blockedCount)}`]
  if ((letter.failedCount ?? 0) > 0) parts.push(`出错 ${letter.failedCount}`)
  parts.push(`打开 ${formatCount(letter.openedCount)}`)
  return parts.join(' · ')
}

/** Footnote under the recipient list, matching the open-info kind. */
export function recipientsFootnote(info: OpenInfo): string {
  if (info.kind === 'per_recipient') {
    return '只显示姓名，不显示邮箱；点姓名可以打开这位客人的资料。座位数来自订单，订单没填就显示「—」。'
  }

  return '只显示姓名，不显示邮箱。被拦的原因会写成人话：没有同意依据 / 最近 7 天已收满 2 封 / 客人说了别再联系 / 已在 Mailchimp 退订。'
}
