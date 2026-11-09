/** Network backoff before attempt 2 and attempt 3. The third failure escalates. */

export const MAX_PLAN_DRAFT_ATTEMPTS = 3

const DELAY_BEFORE_ATTEMPT_MS = [30 * 60 * 1000, 2 * 60 * 60 * 1000]

const NETWORK = [
  /timeout/i,
  /timed out/i,
  /econnreset/i,
  /econnrefused/i,
  /enotfound/i,
  /network/i,
  /fetch failed/i,
  /socket/i,
  /\b429\b/,
  /\b502\b/,
  /\b503\b/,
  /\b504\b/,
  /aborted/i,
]

export function delayBeforePlanDraftAttempt(attempt: number): number | null {
  if (attempt <= 1 || attempt > MAX_PLAN_DRAFT_ATTEMPTS) return null
  return DELAY_BEFORE_ATTEMPT_MS[attempt - 2] ?? null
}

export function isNetworkFailure(err: unknown): boolean {
  const message = err instanceof Error ? `${err.name} ${err.message}` : String(err)
  return NETWORK.some(pattern => pattern.test(message))
}

export class AccountReadError extends Error {
  constructor(message = 'account read failed') {
    super(message)
    this.name = 'AccountReadError'
  }
}

export function isRetryablePlanDraftError(err: unknown): boolean {
  return err instanceof AccountReadError || isNetworkFailure(err)
}

export function planDraftFailureDisposition(
  attempt: number,
  err: unknown,
): { retryable: boolean; escalated: boolean } {
  if (!isRetryablePlanDraftError(err)) return { retryable: false, escalated: false }
  if (attempt >= MAX_PLAN_DRAFT_ATTEMPTS) return { retryable: false, escalated: true }
  return { retryable: true, escalated: false }
}
