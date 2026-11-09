const WEEKDAY_CHARS = '日一二三四五六'

interface ParsedIsoDate {
  year: number
  month: number
  day: number
  weekday: string
}

function parseIsoDate(iso: string): ParsedIsoDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) {
    return null
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }

  return {
    year,
    month,
    day,
    weekday: WEEKDAY_CHARS.charAt(date.getUTCDay()),
  }
}

export function formatSendDate(iso: string): string {
  const parsed = parseIsoDate(iso)
  if (!parsed) {
    return iso
  }

  return `${parsed.month}月${parsed.day}日（周${parsed.weekday}）`
}

export function formatShortDate(iso: string): string {
  const parsed = parseIsoDate(iso)
  if (!parsed) {
    return iso
  }

  return `${parsed.month}月${parsed.day}日`
}

export function formatCount(n: number | null): string {
  return n === null ? '—' : String(n)
}

export function formatSeats(n: number | null): string {
  return n === null ? '—' : String(n)
}
