import type { LetterStatus, LetterSummary, RecipientStatus } from './types'

/** Tone token consumed by the pill component; carries no meaning beyond styling. */
export type PillTone = 'track' | 'exec' | 'attn' | 'sched' | 'rej'

/** How a letter-level status is shown: pill label + tone token. */
export const LETTER_STATUS_META: Readonly<Record<LetterStatus, { label: string; tone: PillTone }>> = {
  not_enabled: { label: '还没开通', tone: 'attn' },
  planned: { label: '计划中', tone: 'attn' },
  draft: { label: '草稿', tone: 'attn' },
  awaiting_release: { label: '等你放行', tone: 'sched' },
  sent: { label: '已发出', tone: 'track' },
  not_sent: { label: '没发出去', tone: 'rej' },
  unknown: { label: '结果不明', tone: 'exec' },
}

/** How a single recipient's outcome is shown: pill label + tone token. */
export const RECIPIENT_STATUS_META: Readonly<Record<RecipientStatus, { label: string; tone: PillTone }>> = {
  sent: { label: '已发出', tone: 'track' },
  blocked: { label: '被拦', tone: 'exec' },
  failed: { label: '出错', tone: 'rej' },
  rehearsal: { label: '演练', tone: 'attn' },
  pending: { label: '还没发', tone: 'attn' },
  unknown: { label: '结果不明', tone: 'exec' },
}

/** Row filter offered above the list. */
export type LetterFilter = 'all' | 'draft' | 'awaiting_release' | 'sent' | 'not_sent' | 'unknown' | 'blocked'

export const FILTER_OPTIONS: ReadonlyArray<{ key: LetterFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'draft', label: '草稿' },
  { key: 'awaiting_release', label: '等你放行' },
  { key: 'sent', label: '已发' },
  { key: 'not_sent', label: '没发出去' },
  { key: 'unknown', label: '结果不明' },
  { key: 'blocked', label: '有被拦的' },
]

/**
 * Does this letter belong in the list while `filter` is active?
 *
 * `sent` means "has really gone out at least once". Rehearsal rows never count as sent,
 * so `rehearsalCount` is deliberately ignored here.
 */
export function matchesFilter(letter: LetterSummary, filter: LetterFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'draft':
      return letter.status === 'draft'
    case 'awaiting_release':
      return letter.status === 'awaiting_release'
    case 'sent':
      return letter.status === 'sent' || (letter.sentCount !== null && letter.sentCount > 0)
    case 'not_sent':
      return letter.status === 'not_sent'
    case 'unknown':
      return letter.status === 'unknown' || letter.unknownCount > 0
    case 'blocked':
      return (letter.blockedCount ?? 0) + (letter.failedCount ?? 0) > 0
  }
}

/**
 * One plain-language sentence about where the next batch stands.
 * Kept as a lookup so that a new status fails to compile until a sentence exists.
 */
const NEXT_BATCH_SENTENCES: Readonly<Record<LetterStatus, string>> = {
  draft: '现在是草稿，发出前会请你看稿并点头',
  awaiting_release: '已经提交，等你点头才会发',
  sent: '已经发出',
  not_sent: '这一批里有信没送到客人手里，要去看一下原因',
  unknown: '这一批有结果不明的，信可能已经送到，先别重发',
  planned: '排期有了，信还没写',
  not_enabled: '这类信的自动发送还没开通',
}

export function nextBatchSentence(status: LetterStatus): string {
  return NEXT_BATCH_SENTENCES[status]
}

/** Legend shown at the bottom of the page; `dashed` marks the "not a real send" pill. */
export const STATUS_LEGEND: ReadonlyArray<{
  label: string
  tone: PillTone
  dashed: boolean
  text: string
}> = [
  {
    label: '草稿',
    tone: 'attn',
    dashed: false,
    text: '信的稿子已经在 ME 里，但还没提交给你放行，客人不会收到。',
  },
  {
    label: '等你放行',
    tone: 'sched',
    dashed: false,
    text: '已经提交给你，等你点头才会发。',
  },
  {
    label: '已发出',
    tone: 'track',
    dashed: false,
    text: '已经发给这位客人了。',
  },
  {
    label: '没发出去',
    tone: 'rej',
    dashed: false,
    text: '这一批一封都没送到客人手里（被拦、发送失败或被退回）。放行了却没有任何发送记录、发信日也过了，同样算没发出去。',
  },
  {
    label: '结果不明',
    tone: 'exec',
    dashed: false,
    text: '发出了，但没拿到最终结果，信可能已经送到客人手里：先别重发。',
  },
  {
    label: '被拦',
    tone: 'exec',
    dashed: false,
    text: '发信前的检查没过（比如这位客人最近 7 天已经收了 2 封），这封没发，会写明原因。',
  },
  {
    label: '出错',
    tone: 'rej',
    dashed: false,
    text: '发了但对方邮箱退回，或系统出错，会写明原因。',
  },
  {
    label: '计划中',
    tone: 'attn',
    dashed: false,
    text: '排期有了，信还没写。',
  },
  {
    label: '还没开通',
    tone: 'attn',
    dashed: false,
    text: '这类信的自动发送还没打开。',
  },
  {
    label: '演练',
    tone: 'attn',
    dashed: true,
    text: '系统彩排了一遍，没有真的发出去，不算「已发出」。',
  },
]
