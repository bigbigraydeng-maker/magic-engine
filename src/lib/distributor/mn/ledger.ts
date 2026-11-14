import { monthKey } from '../time'
import { MnConfigError, roundDiv } from './money'

export type LedgerStatus = 'pending' | 'valid' | 'settled' | 'clawed_back' | 'paid'

export interface LedgerMark {
  status: LedgerStatus
  qualifiedAt: string | null
  salesMonth: string | null
}

const DAY_MS = 86_400_000

/** 45×24 hours, same clock the existing refund window uses. The sales month is the calendar month of that instant. */
export function qualifyInstant(paidAt: string, observationDays: number): string {
  const qualified = new Date(Date.parse(paidAt) + observationDays * DAY_MS)
  if (Number.isNaN(qualified.getTime())) throw new MnConfigError(`invalid paidAt ${paidAt}`)
  return qualified.toISOString()
}

export function classifySale(input: {
  paidAt: string
  now: string
  refunded: boolean
  observationDays: number
  timeZone: string
}): LedgerMark {
  if (input.refunded) return { status: 'clawed_back', qualifiedAt: null, salesMonth: null }
  const qualifiedAt = qualifyInstant(input.paidAt, input.observationDays)
  if (Date.parse(input.now) < Date.parse(qualifiedAt)) {
    return { status: 'pending', qualifiedAt: null, salesMonth: null }
  }
  return { status: 'valid', qualifiedAt, salesMonth: monthKey(qualifiedAt, input.timeZone) }
}

export function markSettled(current: LedgerStatus): LedgerStatus {
  if (current !== 'valid') throw new MnConfigError(`only valid MU can be settled (was ${current})`)
  return 'settled'
}

export function markPaid(current: LedgerStatus): LedgerStatus {
  if (current !== 'settled') throw new MnConfigError(`only settled MU can be paid (was ${current})`)
  return 'paid'
}

/** Proportional clawback of a module already paid on a sale. Negative cents. */
export function clawbackCents(paidCents: number, refundedMuCents: number, originalMuCents: number): number {
  if (refundedMuCents < 0 || originalMuCents <= 0 || refundedMuCents > originalMuCents) {
    throw new MnConfigError('refund must be within the original MU')
  }
  if (refundedMuCents === 0 || paidCents === 0) return 0
  return -Number(roundDiv(BigInt(paidCents) * BigInt(refundedMuCents), BigInt(originalMuCents)))
}
