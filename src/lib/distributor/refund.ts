import { toMs } from './time'
import type { Sale } from './types'

export class DistributorRefundError extends Error {}

export interface SaleBook {
  saleById: ReadonlyMap<string, Sale>
  /** Refunds per original sale id, ordered by (paidAt, id). */
  refundsByOriginal: ReadonlyMap<string, readonly Sale[]>
}

/** Indexes every known sale once (period sales may repeat entries of allSales). */
export function buildSaleBook(...lists: ReadonlyArray<readonly Sale[]>): SaleBook {
  const saleById = new Map<string, Sale>()
  for (const list of lists) for (const s of list) saleById.set(s.id, s)
  const refundsByOriginal = new Map<string, Sale[]>()
  for (const s of saleById.values()) {
    if (s.kind !== 'refund' || !s.refundOfSaleId) continue
    const list = refundsByOriginal.get(s.refundOfSaleId) ?? []
    list.push(s)
    refundsByOriginal.set(s.refundOfSaleId, list)
  }
  for (const list of refundsByOriginal.values()) {
    list.sort((a, b) => toMs(a.paidAt) - toMs(b.paidAt) || a.id.localeCompare(b.id))
  }
  return { saleById, refundsByOriginal }
}

export interface ResolvedRefund {
  original: Sale
  /** Net amount of the original sale still unrefunded before this refund. */
  beforeCents: number
  /** ... and after it (≥ 0). */
  afterCents: number
}

/** Validates a refund against its original sale and earlier refunds. Fails closed. */
export function resolveRefund(refund: Sale, book: SaleBook): ResolvedRefund {
  const original = refund.refundOfSaleId ? book.saleById.get(refund.refundOfSaleId) : undefined
  if (!original) throw new DistributorRefundError(`refund ${refund.id} has no known original sale`)
  if (original.kind === 'refund') throw new DistributorRefundError(`refund ${refund.id} points at another refund`)
  if (original.sellerId !== refund.sellerId) {
    throw new DistributorRefundError(`refund ${refund.id} seller differs from original ${original.id}`)
  }
  if (original.currency !== refund.currency) throw new DistributorRefundError(`refund ${refund.id} currency differs`)
  if (refund.amountCents >= 0) throw new DistributorRefundError(`refund ${refund.id} must be negative`)
  let beforeCents = original.amountCents
  for (const earlier of book.refundsByOriginal.get(original.id) ?? []) {
    if (earlier.id === refund.id) break
    beforeCents += earlier.amountCents
  }
  const afterCents = beforeCents + refund.amountCents
  if (afterCents < 0) throw new DistributorRefundError(`refunds of ${original.id} exceed the original amount`)
  return { original, beforeCents, afterCents }
}

/** Net amount of a non-refund sale after every known refund (or only refunds paid before `beforeMs`). */
export function netOfRefunds(sale: Sale, book: SaleBook, beforeMs = Number.POSITIVE_INFINITY): number {
  return (book.refundsByOriginal.get(sale.id) ?? [])
    .filter((r) => toMs(r.paidAt) < beforeMs)
    .reduce((sum, r) => sum + r.amountCents, sale.amountCents)
}
