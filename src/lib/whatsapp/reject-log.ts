/**
 * Rate-limited "why was this webhook delivery refused" log line.
 *
 * A refused delivery used to leave no trace at all (so a mismatched app secret looked exactly like
 * "Meta never sent it"). One fixed-text line per refusal fixes that, but the endpoint is public and
 * unauthenticated: an attacker must not be able to turn it into a log flood that buries real
 * errors. So each (reason, secret source) pair may log at most MAX_PER_WINDOW lines per minute;
 * the rest are counted and reported as a single "suppressed" line when the window rolls over.
 *
 * Only fixed text and counters pass through here — callers must never include secrets, signatures,
 * phone numbers, ids or any body text.
 */

const WINDOW_MS = 60_000
export const MAX_REJECT_LOGS_PER_WINDOW = 20

interface Bucket {
  windowStart: number
  logged: number
  suppressed: number
}

const buckets = new Map<string, Bucket>()

export function logRejection(key: string, line: string, now: number = Date.now()): void {
  const bucket = buckets.get(key)
  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    if (bucket && bucket.suppressed > 0) {
      console.error(
        `[webhooks/whatsapp] ${bucket.suppressed} similar rejection(s) not logged in the last minute (${key})`,
      )
    }
    buckets.set(key, { windowStart: now, logged: 1, suppressed: 0 })
    console.error(line)
    return
  }
  if (bucket.logged < MAX_REJECT_LOGS_PER_WINDOW) {
    bucket.logged++
    console.error(line)
    return
  }
  bucket.suppressed++
}

/** Test helper: forget all windows. */
export function resetRejectLog(): void {
  buckets.clear()
}
