/** 钱一律按元显示，不得把 minor 整数直接拼进用户可见文案。 */
export function formatMinor(minor: number, currency: string | null): string {
  const safeMinor = Number.isFinite(minor) ? minor : 0
  const amount = `$${(safeMinor / 100).toFixed(2)}`
  const trimmed = currency === null ? '' : currency.trim()
  if (trimmed.length > 0) {
    return `${amount} ${trimmed.toUpperCase()}`
  }
  return `${amount}（币种读不到）`
}
