/**
 * Backoff for the lead-form Graph reads.
 *
 * Meta signals a throttle with HTTP 429, error codes 4 / 17 / 32 / 613,
 * the 80000–89999 block, or a usage header near 100. The lead sync now runs
 * four times as often and still re-reads a 24-hour window, so a hot header
 * has to pause the next page instead of immediately walking again.
 */

export const LEAD_GRAPH_MAX_ATTEMPTS = 3
export const USAGE_HOT_PERCENT = 90

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613])
const BACKOFF_BASE_MS = 1000
const BACKOFF_CAP_MS = 8000

export const leadGraphDelay = {
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms)
    })
  },
}

export interface GraphThrottleHints {
  retryAfterSeconds: number | null
  regainAccessMinutes: number | null
  usagePercent: number | null
}

export function metaGraphRateLimited(status: number, body: string): boolean {
  if (status === 429) return true
  const parsed = parseGraphError(body)
  if (parsed.code != null && RATE_LIMIT_CODES.has(parsed.code)) return true
  if (parsed.code != null && parsed.code >= 80000 && parsed.code < 90000) return true
  return parsed.transient && (parsed.code == null || RATE_LIMIT_CODES.has(parsed.code))
}

/** attempt is 1 for the first retry. A long Retry-After is capped so one cron cannot sleep for an hour. */
export function leadGraphBackoffMs(
  attempt: number,
  hints: { retryAfterSeconds?: number | null; regainAccessMinutes?: number | null },
): number {
  const exp = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1))
  const fromRetry =
    hints.retryAfterSeconds != null && hints.retryAfterSeconds > 0 ? hints.retryAfterSeconds * 1000 : null
  const fromBuc =
    hints.regainAccessMinutes != null && hints.regainAccessMinutes > 0
      ? hints.regainAccessMinutes * 60_000
      : null
  const hinted = fromRetry ?? fromBuc
  if (hinted == null) return exp
  return Math.min(hinted, BACKOFF_CAP_MS)
}

export function readGraphThrottleHints(
  headers: { get(name: string): string | null } | null | undefined,
): GraphThrottleHints {
  if (!headers || typeof headers.get !== 'function') {
    return { retryAfterSeconds: null, regainAccessMinutes: null, usagePercent: null }
  }
  const retryRaw = headers.get('retry-after')
  const retryAfterSeconds =
    retryRaw != null && /^\d+$/.test(retryRaw.trim()) ? Number(retryRaw.trim()) : null
  const usage: number[] = []
  let regain: number | null = null
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    const rec = node as Record<string, unknown>
    for (const key of ['call_count', 'total_cputime', 'total_time']) {
      const n = rec[key]
      if (typeof n === 'number' && Number.isFinite(n)) usage.push(n)
    }
    const eta = rec.estimated_time_to_regain_access
    if (typeof eta === 'number' && Number.isFinite(eta) && eta > 0) {
      regain = regain == null ? eta : Math.max(regain, eta)
    }
    for (const value of Object.values(rec)) walk(value)
  }
  for (const name of ['x-app-usage', 'x-page-usage', 'x-business-use-case-usage']) {
    const raw = headers.get(name)
    if (!raw) continue
    try {
      walk(JSON.parse(raw))
    } catch {
      // A changed header must not fail the read. The call still counts.
    }
  }
  return {
    retryAfterSeconds,
    regainAccessMinutes: regain,
    usagePercent: usage.length > 0 ? Math.max(...usage) : null,
  }
}

export async function pauseIfGraphUsageHot(percent: number | null): Promise<void> {
  if (percent == null || percent < USAGE_HOT_PERCENT) return
  await leadGraphDelay.sleep(leadGraphBackoffMs(1, {}))
}

function parseGraphError(body: string): { code: number | null; transient: boolean } {
  try {
    const parsed = JSON.parse(body) as { error?: { code?: unknown; is_transient?: unknown } }
    const code = typeof parsed.error?.code === 'number' ? parsed.error.code : null
    return { code, transient: parsed.error?.is_transient === true }
  } catch {
    return { code: null, transient: false }
  }
}
