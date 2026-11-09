import type { DispatchBucket } from './types'

/**
 * Floor to the 5-minute window this dispatcher tick belongs to.
 * A tick that arrives late, but still inside its 5 minutes, keeps the
 * jobs scheduled at the window start. A tick that lands in the next
 * window is that later window — missed windows are not backfilled.
 */
export function dispatchInstant(now: Date): Date {
  const t = new Date(now.getTime())
  t.setUTCSeconds(0, 0)
  const minute = t.getUTCMinutes()
  t.setUTCMinutes(minute - (minute % 5))
  return t
}

/** Sub-daily, weekday-constrained, or once-a-day. Both dom and dow restricted is refused. */
export function bucketForSchedule(schedule: string): DispatchBucket | null {
  const parts = schedule.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const [, hour, dom, , dow] = parts
  if (dom !== '*' && dow !== '*') return null
  if (hour === '*' || hour.startsWith('*/')) return 'frequent'
  if (dow !== '*') return 'weekly'
  return 'daily'
}

function fieldMatches(field: string, value: number): boolean {
  if (field.includes(',')) {
    const parts = field.split(',')
    if (parts.length < 2 || parts.some((part) => part.length === 0)) return false
    return parts.some((part) => fieldMatches(part, value))
  }
  if (field === '*') return true
  const step = field.match(/^\*\/(\d+)$/)
  if (step) {
    const n = Number(step[1])
    return n > 0 && value % n === 0
  }
  const range = field.match(/^(\d+)-(\d+)$/)
  if (range) {
    return value >= Number(range[1]) && value <= Number(range[2])
  }
  if (/^\d+$/.test(field)) return Number(field) === value
  return false
}

/** Five-field UTC cron, limited to the forms this repo actually schedules. */
export function cronMatches(schedule: string, at: Date): boolean {
  const parts = schedule.trim().split(/\s+/)
  if (parts.length !== 5) return false
  const [min, hour, dom, mon, dow] = parts
  if (dom !== '*' && dow !== '*') return false
  return (
    fieldMatches(min, at.getUTCMinutes()) &&
    fieldMatches(hour, at.getUTCHours()) &&
    fieldMatches(dom, at.getUTCDate()) &&
    fieldMatches(mon, at.getUTCMonth() + 1) &&
    fieldMatches(dow, at.getUTCDay())
  )
}
