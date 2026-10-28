/**
 * How the go-live card treats this check.
 * A failed or unreadable result blocks until a person confirms this exact result.
 * This does not replace the plan's separate "the offer is really on the page" check.
 */

import { receiptIsStale, TRACKING_RECEIPT_STALE_HOURS } from '@/lib/ads-tracking-preflight/receipt'
import type { HardCheck } from '@/lib/confirmation-card'
import { needsPerson } from './judge'
import type { LandingReceipt } from './receipt'

function clip(value: string): string {
  return value.replace(/[{}[\]`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
}

export function landingHardCheck(input: {
  readonly receipt: LandingReceipt | null
  readonly confirmed: boolean
  readonly now: Date
}): HardCheck {
  const label = '落地页已核实'
  const receipt = input.receipt
  if (!receipt) return { label, state: 'unread', reason: '还没有查过这条广告的去处' }
  if (receiptIsStale(receipt.checkedAt, input.now, TRACKING_RECEIPT_STALE_HOURS)) {
    return { label, state: 'unread', reason: '上次核实过期了，请再查一次' }
  }
  if (!needsPerson(receipt.items)) {
    return { label, state: 'green', reason: '能打开，而且是这一页' }
  }
  const detail = clip(receipt.items
    .filter((row) => row.state === 'fail' || row.state === 'unchecked')
    .map((row) => row.detail)
    .join('；'))
  if (input.confirmed) return { label, state: 'green', reason: clip(`已有人确认。${detail}`) }
  const failed = receipt.items.some((row) => row.state === 'fail')
  if (failed) return { label, state: 'red', reason: clip(`没通过，还没有人确认。${detail}`) }
  return { label, state: 'unread', reason: clip(`还有查不了的地方，还没有人确认。${detail}`) }
}

export function landingHeadline(check: HardCheck): string {
  if (check.state === 'green' && check.reason.startsWith('能打开')) return '落地页已核实。可以继续看开投。'
  if (check.state === 'green') return '已有人确认这次核实。可以继续看开投。'
  if (check.state === 'red') return '落地页没通过，还没有人确认，还不能开投。'
  return '落地页还没核实完，还不能开投。'
}
