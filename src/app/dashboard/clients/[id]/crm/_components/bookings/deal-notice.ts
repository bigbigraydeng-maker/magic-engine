/** Plain-language result of trying to record a deal after a payment. */

export interface DealNotice {
  recorded: boolean
  alreadyRecorded: boolean
  reason: string | null
  message: string
}

export const MISSING_PARTY_MESSAGE = '订单没有人数，不能按标价估算，成交记录没有写成。'

export function readDealNotice(data: unknown): DealNotice | null {
  if (typeof data !== 'object' || data === null) return null
  const deal = (data as { deal?: unknown }).deal
  if (typeof deal !== 'object' || deal === null) return null
  const row = deal as { recorded?: unknown; alreadyRecorded?: unknown; reason?: unknown; message?: unknown }
  if (typeof row.message !== 'string' || row.message.trim() === '') return null
  return {
    recorded: row.recorded === true,
    alreadyRecorded: row.alreadyRecorded === true,
    reason: typeof row.reason === 'string' ? row.reason : null,
    message: row.message,
  }
}

export function dealSettled(notice: DealNotice | null): boolean {
  return notice?.recorded === true || notice?.alreadyRecorded === true
}

export interface DealRetryEntry {
  message: string
  bookingId: string
  kind: 'deposit' | 'balance'
  paidOn: string
}

/** Staff can retry only when the payment response names the booking and the milestone. */
export function readDealRetry(data: unknown, paidOnFallback: string): DealRetryEntry | null {
  const notice = readDealNotice(data)
  if (!notice || dealSettled(notice)) return null
  const row = recordOf(data)
  if (!row) return null
  const booking = recordOf(row.booking)
  const bookingId = typeof booking?.id === 'string'
    ? booking.id
    : typeof row.bookingId === 'string' ? row.bookingId : null
  const kind = row.milestoneKind === 'deposit' || row.milestoneKind === 'balance' ? row.milestoneKind : null
  if (!bookingId || !kind) return null
  return {
    message: notice.message,
    bookingId,
    kind,
    paidOn: paidOnFrom(booking?.milestones, kind) ?? paidOnFallback,
  }
}

function paidOnFrom(milestones: unknown, kind: string): string | null {
  if (!Array.isArray(milestones)) return null
  for (const item of milestones) {
    const row = recordOf(item)
    if (row?.kind === kind && typeof row.paidOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.paidOn)) {
      return row.paidOn
    }
  }
  return null
}

function recordOf(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>
  return null
}
