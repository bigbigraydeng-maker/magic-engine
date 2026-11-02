/**
 * The rehearsal's verdict: per lead, does what ME WOULD have done agree with what the old daily batch DID?
 * Pure functions over the stored shadow rows (their `annotations`); no I/O.
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §5.4 and §16.5.
 */

export interface ShadowRowForCompare {
  contactId: string
  status: string
  reasonCode: string | null
  annotations: Record<string, unknown>
}

/**
 * agree       - ME and the old batch did the same thing for this lead.
 * explained   - the batch welcomed the lead, ME would not, and the reason is something that changes with the person's
 *               state between the batch (08:01) and the rehearsal (09:00).
 * unexplained - they differ and nothing above explains it; somebody has to look.
 * unavailable - the row cannot be judged (too old, a missing value, or the old batch had not run when it was decided).
 */
export type LeadVerdict = 'agree' | 'explained' | 'unexplained' | 'unavailable'

/**
 * Reasons that explain "the batch welcomed them, ME would not": they depend on the person's state (a salesperson wrote
 * to them after 08:01, they unsubscribed, they hit ME's e-mail cap). Reasons that come from the rule or from the data
 * (bad address, system address, allow-list, consent basis) are NOT here: a difference caused by them is a difference
 * between ME's rule and the old behaviour, and the person who authorizes the switch has to see it.
 */
const EXPLAINED_REASONS: ReadonlySet<string> = new Set([
  'sales_email_exists',
  'dnc',
  'mailchimp_suppressed',
  'frequency_full',
])

const LEAD_LOCAL_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const INVALID_DAY = '0000-00-00'

export function judgeLead(row: ShadowRowForCompare): LeadVerdict {
  const legacyWelcomed = row.annotations.legacy_welcomed
  const wouldSend = row.annotations.would_send

  if (typeof legacyWelcomed !== 'boolean') return 'unavailable'
  if (typeof wouldSend !== 'boolean') return 'unavailable'
  if (row.reasonCode === 'stale') return 'unavailable'
  // "Not welcomed" only means something if the old batch had run: otherwise it was late or skipped, and the lead
  // would have shown up as "not welcomed" whatever the batch normally does.
  if (legacyWelcomed === false && row.annotations.legacy_batch_seen !== true) return 'unavailable'

  if (wouldSend === legacyWelcomed) return 'agree'

  // ME would send, the old batch did not.
  if (legacyWelcomed === false) return 'unexplained'

  // The old batch welcomed them, ME would not.
  return row.reasonCode !== null && EXPLAINED_REASONS.has(row.reasonCode) ? 'explained' : 'unexplained'
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

// ── the batch's own totals ───────────────────────────────────────────────────────────────────────────────

/** One campaign of the old daily batch, as the sweep receipts list it (`legacy_batches`). */
export interface BatchForReconcile {
  campaignId: string
  title: string
  sentAt: string | null
  emailsSent: number
}

export interface BatchReconciliation extends BatchForReconcile {
  /** Shadow rows whose `legacy_campaign_ids` name this campaign: the people ME looked at and the batch welcomed. */
  matchedContacts: number
  /** emailsSent - matchedContacts. 0 = every recipient of the batch is a lead ME looked at. */
  gap: number
}

/**
 * Sets the batch's own recipient count against the leads ME matched to it.
 * The per-lead verdicts above only see leads ME loaded; people the batch welcomed that ME never looked at (returning
 * contacts, website sign-ups, merged contacts) are invisible there. A non-zero gap is not an error by itself, but it
 * has to be explained before anybody authorizes the switch.
 * Later entries replace earlier ones with the same campaign id (the same campaign appears in many sweep receipts).
 */
export function reconcileBatches(
  batches: readonly BatchForReconcile[],
  rows: readonly ShadowRowForCompare[],
): BatchReconciliation[] {
  const matched = new Map<string, number>()
  for (const row of rows) {
    const ids = row.annotations.legacy_campaign_ids
    if (!Array.isArray(ids)) continue
    for (const id of new Set(ids)) {
      if (typeof id === 'string') matched.set(id, (matched.get(id) ?? 0) + 1)
    }
  }

  const latest = new Map<string, BatchForReconcile>()
  for (const batch of batches) latest.set(batch.campaignId, batch)

  return Array.from(latest.values()).map((batch) => {
    const matchedContacts = matched.get(batch.campaignId) ?? 0
    return { ...batch, matchedContacts, gap: batch.emailsSent - matchedContacts }
  })
}
