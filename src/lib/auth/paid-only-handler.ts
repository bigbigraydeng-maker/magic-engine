/**
 * Phase X.S4 — Client-side handler for `paid_only` 403 responses.
 *
 * Wrap any fetch call to a possibly-locked endpoint with `withPaidOnlyTrap`,
 * and when the backend returns 403 + body.reason === 'paid_only' the
 * FeatureLockGate modal will open with the given feature label.
 *
 *   const data = await withPaidOnlyTrap('Goals', () =>
 *     fetch('/api/clients/x/goals').then(r => r.json())
 *   )
 *
 * If you need to inspect the raw status (e.g. distinguish 402 insufficient
 * balance from 403 paid_only), use `isPaidOnly(response)` instead.
 */

import { triggerFeatureLock } from '@/components/auth/FeatureLockGate'

interface PaidOnlyBody {
  reason?: string
  error?: string
}

/** Returns true when the response is a 403 with reason='paid_only'. */
export async function isPaidOnly(res: Response): Promise<boolean> {
  if (res.status !== 403) return false
  try {
    const clone = res.clone()
    const body = await clone.json() as PaidOnlyBody
    return body.reason === 'paid_only'
  } catch {
    return false
  }
}

/**
 * Run `fetchFn` and, if the resulting Response (or thrown ResponseError)
 * is a paid_only 403, surface the FeatureLockGate modal automatically.
 *
 * Returns the parsed JSON on success. Throws a regular Error for any
 * non-paid_only failure so the caller can show its own toast.
 */
export async function withPaidOnlyTrap<T = unknown>(
  feature: string,
  fetchFn: () => Promise<Response>,
): Promise<T> {
  const res = await fetchFn()
  if (await isPaidOnly(res)) {
    triggerFeatureLock(feature)
    throw new PaidOnlyError(feature)
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body = await res.clone().json() as PaidOnlyBody
      if (body.error) detail = body.error
    } catch { /* swallow */ }
    throw new Error(detail)
  }
  return res.json() as Promise<T>
}

export class PaidOnlyError extends Error {
  readonly feature: string
  constructor(feature: string) {
    super(`Feature locked behind paid plan: ${feature}`)
    this.name = 'PaidOnlyError'
    this.feature = feature
  }
}
