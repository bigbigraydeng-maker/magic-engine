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

/** 把 ISO 时间显示成新西兰时间「10月26日 14:31」；解析失败返回「时间读不到」。 */
export function formatNzTime(iso: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return '时间读不到'
  const parts = new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms))
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? ''
  return `${Number(get('month'))}月${Number(get('day'))}日 ${get('hour').padStart(2, '0')}:${get('minute').padStart(2, '0')}`
}
