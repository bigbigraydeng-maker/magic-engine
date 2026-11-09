const DAY_MS = 86_400_000
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function localDay(at: string | Date, timeZone: string): string | null {
  const date = typeof at === 'string' ? new Date(at) : at
  if (Number.isNaN(date.getTime())) return null

  try {
    const formatted = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date)
    return DAY_PATTERN.test(formatted) ? formatted : null
  } catch {
    // Invalid IANA time zone throws RangeError.
    return null
  }
}

export type ContactAge =
  | 'before_proposal'
  | 'not_yet'
  | 'stale'
  | 'candidate'
  | 'invalid_date'

export function classifyContactAge(args: {
  createdAt: string
  proposedAt: string
  now: Date
  timeZone: string
  maxAgeDays: number
}): ContactAge {
  const { createdAt, proposedAt, now, timeZone, maxAgeDays } = args

  const createdMs = Date.parse(createdAt)
  const proposedMs = Date.parse(proposedAt)
  const nowMs = now.getTime()

  if (Number.isNaN(createdMs) || Number.isNaN(proposedMs) || Number.isNaN(nowMs)) {
    return 'invalid_date'
  }

  const createdDay = localDay(createdAt, timeZone)
  const nowDay = localDay(now, timeZone)
  if (createdDay === null || nowDay === null) return 'invalid_date'

  if (createdMs < proposedMs) return 'before_proposal'

  if (createdDay >= nowDay) return 'not_yet'

  if (nowMs - createdMs > maxAgeDays * DAY_MS) return 'stale'

  return 'candidate'
}
