// Pure masking and preview rendering for the local booking import tool.
// Produces human-readable Simplified Chinese lines with no PII.
// Guests are referenced only by a spreadsheet-style label.
// Never touches IO, never logs.

import type { PlanItem, PlanSummary } from './types'

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** Spreadsheet-style label: 0 -> A, 25 -> Z, 26 -> AA, 27 -> AB. */
export function guestLabel(index: number): string {
  let n = index
  let out = ''
  do {
    const rem = n % 26
    out = LETTERS.charAt(rem) + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return `客人 ${out}`
}

/** Keep first 3 and last 2 digits, mask the middle. */
export function maskPhone(p: string | null): string {
  if (p === null) return '-'
  const digits = p.replace(/\D+/g, '')
  if (digits.length === 0) return '-'
  if (digits.length < 6) return '***'
  return `${digits.slice(0, 3)}***${digits.slice(-2)}`
}

/** First character plus masked local part, then the domain. */
export function maskEmail(e: string | null): string {
  if (e === null) return '-'
  const at = e.indexOf('@')
  if (at <= 0) return '***'
  const first = e.charAt(0)
  const domain = e.slice(at + 1)
  return `${first}***@${domain}`
}

function statusText(item: PlanItem): string {
  if (item.status === 'ready') return '可导入'
  if (item.status === 'skip_already_imported') return '已导入过'
  return '要人判断'
}

/** Render the preview lines. No PII; guests only by label. */
export function renderPreview(items: PlanItem[], summary: PlanSummary): string[] {
  const lines: string[] = []
  lines.push(
    `预览（只读，没有写入任何东西）：共 ${summary.total} 行，可导入 ${summary.ready}，已导入过 ${summary.skipAlreadyImported}，要人判断 ${summary.needsHuman}`,
  )
  lines.push(
    `可导入合计 ${summary.readyPeople} 人；其中要标「定金已收」的 ${summary.depositsToMarkPaid} 单`,
  )
  for (const item of items) {
    lines.push(
      `${guestLabel(item.index)} · 发票 ${item.invoice} · ${item.partySize} 人 · ${statusText(item)} ${item.reasons.join(',')}`,
    )
  }
  if (summary.needsHuman > 0) {
    const pairs = Object.keys(summary.reasonCounts)
      .sort()
      .map((reason) => `${reason}: ${summary.reasonCounts[reason]}`)
    lines.push(`要人判断的原因：${pairs.join('；')}`)
  }
  return lines
}
