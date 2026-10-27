import type { LiveDelivering } from './live-delivering'
import type { PassingStep, PlanSeedDeps } from './shared'

/**
 * Race a promise against a timeout. Resolves with the promise's value if it
 * settles within `capMs`, otherwise resolves with `null`. Never rejects: a
 * synchronous throw or a rejection both resolve to `null`. The timer is always
 * cleared so no timer leaks.
 */
function withCap<T>(promise: Promise<T>, capMs: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolve(null)
    }, capMs)

    promise.then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(null)
      },
    )
  })
}

/**
 * Read live delivering totals for the accounts referenced by the passing
 * steps. Never throws and never rejects.
 *
 * - Distinct account ids are collected in first-seen order.
 * - If no live reader is provided, `capMs <= 0`, or there are no accounts,
 *   every distinct account id maps to `null`.
 * - Otherwise each account is read once, in parallel, each call capped at
 *   `capMs`; a call that throws, rejects, or never settles yields `null`.
 */
export async function readLiveForSelected(
  clientId: string,
  passing: PassingStep[],
  deps: PlanSeedDeps,
  capMs: number,
): Promise<Map<string, LiveDelivering | null>> {
  const accountIds: string[] = []
  const seen = new Set<string>()
  for (const step of passing) {
    const id = step.accountId
    if (seen.has(id)) continue
    seen.add(id)
    accountIds.push(id)
  }

  const result = new Map<string, LiveDelivering | null>()
  for (const id of accountIds) {
    result.set(id, null)
  }

  const reader = deps.readLiveDelivering
  if (reader === undefined || capMs <= 0 || accountIds.length === 0) {
    return result
  }

  const entries = await Promise.all(
    accountIds.map(async (accountId): Promise<[string, LiveDelivering | null]> => {
      let call: Promise<LiveDelivering | null>
      try {
        call = reader(clientId, accountId)
      } catch {
        return [accountId, null]
      }
      const value = await withCap(call, capMs)
      return [accountId, value]
    }),
  )

  for (const [accountId, value] of entries) {
    result.set(accountId, value)
  }
  return result
}
