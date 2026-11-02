export interface ShadowRowForCompare {
  contactId: string
  status: string
  reasonCode: string | null
  annotations: Record<string, unknown>
}

export type LeadVerdict = 'agree' | 'explained' | 'unexplained' | 'unavailable'

const EXPLAINED_REASONS: ReadonlySet<string> = new Set([
  'bad_email',
  'system_address',
  'not_in_allowlist',
  'dnc',
  'mailchimp_suppressed',
  'no_consent_basis',
  'frequency_full',
])

const LEAD_LOCAL_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const INVALID_DAY = '0000-00-00'

export function judgeLead(row: ShadowRowForCompare): LeadVerdict {
  const legacyWelcomed = row.annotations.legacy_welcomed
  const wouldSend = row.annotations.would_send

  if (typeof legacyWelcomed !== 'boolean') return 'unavailable'
  if (row.reasonCode === 'stale') return 'unavailable'
  if (typeof wouldSend !== 'boolean') return 'unavailable'

  const covers = wouldSend === true || row.reasonCode === 'sales_email_exists'

  if (legacyWelcomed === covers) return 'agree'

  if (legacyWelcomed === true && covers === false) {
    return row.reasonCode !== null && EXPLAINED_REASONS.has(row.reasonCode)
      ? 'explained'
      : 'unexplained'
  }

  // legacyWelcomed === false && covers === true
  return 'unexplained'
}

export interface CompareDay {
  leadLocalDay: string
  total: number
  wouldSend: number
  salesSkipped: number
  legacyWelcomed: number
  agree: number
  explained: number
  unexplained: number
  unavailable: number
  unexplainedContactIds: string[]
}

function resolveLeadLocalDay(annotations: Record<string, unknown>): string {
  const value = annotations.lead_local_day
  return typeof value === 'string' && LEAD_LOCAL_DAY_PATTERN.test(value) ? value : INVALID_DAY
}

export function compareShadowRows(rows: readonly ShadowRowForCompare[]): CompareDay[] {
  const byDay = new Map<string, CompareDay>()

  for (const row of rows) {
    const leadLocalDay = resolveLeadLocalDay(row.annotations)
    let day = byDay.get(leadLocalDay)
    if (day === undefined) {
      day = {
        leadLocalDay,
        total: 0,
        wouldSend: 0,
        salesSkipped: 0,
        legacyWelcomed: 0,
        agree: 0,
        explained: 0,
        unexplained: 0,
        unavailable: 0,
        unexplainedContactIds: [],
      }
      byDay.set(leadLocalDay, day)
    }

    day.total += 1
    if (row.annotations.would_send === true) day.wouldSend += 1
    if (row.reasonCode === 'sales_email_exists') day.salesSkipped += 1
    if (row.annotations.legacy_welcomed === true) day.legacyWelcomed += 1

    const verdict = judgeLead(row)
    if (verdict === 'agree') day.agree += 1
    else if (verdict === 'explained') day.explained += 1
    else if (verdict === 'unexplained') {
      day.unexplained += 1
      day.unexplainedContactIds.push(row.contactId)
    } else {
      day.unavailable += 1
    }
  }

  const days = Array.from(byDay.values())
  for (const day of days) {
    day.unexplainedContactIds.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  }
  days.sort((a, b) => (a.leadLocalDay < b.leadLocalDay ? -1 : a.leadLocalDay > b.leadLocalDay ? 1 : 0))
  return days
}

export function isConsistentDay(day: CompareDay): boolean {
  return day.total > 0 && day.unexplained === 0 && day.unavailable === 0
}

export function consecutiveConsistentDays(days: readonly CompareDay[]): number {
  const sorted = [...days].sort((a, b) =>
    a.leadLocalDay < b.leadLocalDay ? -1 : a.leadLocalDay > b.leadLocalDay ? 1 : 0,
  )

  let streak = 0
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const day = sorted[i]
    if (day.total === 0) continue
    if (!isConsistentDay(day)) break
    streak += 1
  }
  return streak
}
