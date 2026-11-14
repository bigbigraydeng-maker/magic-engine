import { toMs } from '../time'
import { MnConfigError } from './money'

export interface CustomerLock {
  sellerId: string
  lockedAt: string
}

export interface LockPolicy {
  /**
   * null = the commission plan's rule: the first valid purchase stays with that partner
   * until an operator rebinds it. A number is a window in days, for when that duration is decided.
   * There is no default day count.
   */
  lockDays: number | null
}

export interface Attribution {
  sellerId: string | null
  lock: CustomerLock | null
  reason: 'existing-lock' | 'new-code' | 'unlocked'
}

function lockOpen(lock: CustomerLock, now: string, policy: LockPolicy): boolean {
  if (policy.lockDays === null) return true
  if (!Number.isInteger(policy.lockDays) || policy.lockDays < 0) throw new MnConfigError('lock window is not usable')
  return toMs(now) < toMs(lock.lockedAt) + policy.lockDays * 86_400_000
}

/**
 * A purchase is attributed by an open lock, otherwise by the share code on this order.
 * A missing code does not let anyone claim the sale afterwards.
 */
export function attributePurchase(input: {
  now: string
  codeOwnerId: string | null
  existing: CustomerLock | null
  policy: LockPolicy
}): Attribution {
  if (input.existing && lockOpen(input.existing, input.now, input.policy)) {
    return { sellerId: input.existing.sellerId, lock: input.existing, reason: 'existing-lock' }
  }
  if (input.codeOwnerId) {
    const lock = { sellerId: input.codeOwnerId, lockedAt: input.now }
    return { sellerId: input.codeOwnerId, lock, reason: 'new-code' }
  }
  return { sellerId: null, lock: input.existing, reason: 'unlocked' }
}
