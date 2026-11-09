/** Plain Chinese for the ad set daily budget card. No server imports. */

export const BUDGET_CARD_WHAT_PREFIX = '把广告组 '

export function money(cents: number): string {
  return (cents / 100).toFixed(2)
}

export function clipName(name: string | null): string {
  const clean = (name ?? '').trim().replace(/[{}[\]`]/g, '')
  const text = clean.length > 0 ? clean : '这一组'
  return text.slice(0, 40)
}

export function pctText(before: number, after: number): string {
  const pct = ((after - before) / before) * 100
  const rounded = Math.round(pct * 10) / 10
  const body = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
  return `${rounded > 0 ? '+' : ''}${body}%`
}

export function limitText(ratio: number): string {
  const pct = Math.round(ratio * 1000) / 10
  const body = Number.isInteger(pct) ? String(pct) : pct.toFixed(1)
  return `${body}%`
}

export function budgetWhat(name: string | null, before: number, after: number): string {
  const who = clipName(name)
  return `${BUDGET_CARD_WHAT_PREFIX}${who} 的日预算从 ${money(before)} 调到 ${money(after)}（${pctText(before, after)}）`
}

export function amountLine(before: number, after: number): string {
  return `从 ${money(before)} 调到 ${money(after)}（${pctText(before, after)}）`
}
