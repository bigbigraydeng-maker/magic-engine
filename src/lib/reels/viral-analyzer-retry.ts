/**
 * Retry policy for viral reference analysis.
 *
 * The worker used to re-select the oldest `error` rows on every run, and the
 * analyzer swallowed failures, so the same four videos were logged as success
 * forever. Permanent downloader / safety failures must leave the queue.
 * Transient failures (quota, timeouts) stay retryable, with a growing wait,
 * and are ordered by `updated_at` so every row gets a turn.
 */

export const ANALYSIS_BACKOFF_BASE_MS = 10 * 60 * 1000
export const ANALYSIS_BACKOFF_CAP_MS = 6 * 60 * 60 * 1000
export const STALE_ANALYZING_MS = 15 * 60 * 1000

const TERMINAL_ERROR_MARKERS = ['prohibited_content', 'no video formats found'] as const

/** Hosts yt-dlp cannot download. Matched on the URL host, not the query string. */
const UNSUPPORTED_DOWNLOAD_HOSTS = [
  'xiaohongshu.com',
  'xiaohongshu.cn',
  'xhslink.com',
  'xhs.cn',
] as const

export interface FailurePlan {
  analysis_status: 'error' | 'terminal'
  analysis_error: string
  analysis_attempts: number
  next_retry_at: string | null
  updated_at: string
}

export interface RetryCandidate {
  analysis_status: string
  analysis_error?: string | null
  source_url: string
  next_retry_at?: string | null
  updated_at?: string | null
  created_at?: string | null
  platform?: string | null
}

export function isTerminalAnalysisError(message: string): boolean {
  const hay = message.toLowerCase()
  return TERMINAL_ERROR_MARKERS.some(marker => hay.includes(marker))
}

export function isUnsupportedViralDownloadUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/\.$/, '')
    return UNSUPPORTED_DOWNLOAD_HOSTS.some(domain => host === domain || host.endsWith(`.${domain}`))
  } catch {
    return false
  }
}

/** Discovery and manual import must not enqueue links the downloader cannot fetch. */
export function isQueueableViralSourceUrl(raw: string): boolean {
  return !isUnsupportedViralDownloadUrl(raw)
}

export function backoffDelayMs(failedAttempts: number): number {
  const exponent = Math.min(8, Math.max(0, failedAttempts - 1))
  const raw = ANALYSIS_BACKOFF_BASE_MS * (2 ** exponent)
  return Math.min(raw, ANALYSIS_BACKOFF_CAP_MS)
}

export function planAnalysisFailure(input: {
  message: string
  previousAttempts: number | null
  now: Date
  sourceUrl?: string
}): FailurePlan {
  const previous = input.previousAttempts ?? 0
  const attempts = (Number.isFinite(previous) && previous > 0 ? previous : 0) + 1
  const updatedAt = input.now.toISOString()
  const terminal = isTerminalAnalysisError(input.message)
    || (input.sourceUrl ? isUnsupportedViralDownloadUrl(input.sourceUrl) : false)
  if (terminal) {
    return {
      analysis_status: 'terminal',
      analysis_error: input.message,
      analysis_attempts: attempts,
      next_retry_at: null,
      updated_at: updatedAt,
    }
  }
  return {
    analysis_status: 'error',
    analysis_error: input.message,
    analysis_attempts: attempts,
    next_retry_at: new Date(input.now.getTime() + backoffDelayMs(attempts)).toISOString(),
    updated_at: updatedAt,
  }
}

export function isRetryEligible(row: RetryCandidate, now: Date): boolean {
  if (row.analysis_status === 'pending') return !isUnsupportedViralDownloadUrl(row.source_url)
  if (row.analysis_status !== 'error') return false
  if (row.platform === 'xiaohongshu') return false
  if (isUnsupportedViralDownloadUrl(row.source_url)) return false
  if (row.analysis_error && isTerminalAnalysisError(row.analysis_error)) return false
  if (!row.next_retry_at) return true
  const due = Date.parse(row.next_retry_at)
  if (Number.isNaN(due)) return true
  return due <= now.getTime()
}

function timeKey(value: string | null | undefined): string {
  return value ?? ''
}

/** Pending first (oldest created_at). Error retries: updated_at ascending, nulls first. */
export function compareRetryRows(a: RetryCandidate, b: RetryCandidate): number {
  const rank = (status: string) => (status === 'pending' ? 0 : 1)
  const byStatus = rank(a.analysis_status) - rank(b.analysis_status)
  if (byStatus !== 0) return byStatus
  if (a.analysis_status === 'pending') return timeKey(a.created_at).localeCompare(timeKey(b.created_at))
  if (a.updated_at == null && b.updated_at != null) return -1
  if (a.updated_at != null && b.updated_at == null) return 1
  const byUpdated = timeKey(a.updated_at).localeCompare(timeKey(b.updated_at))
  if (byUpdated !== 0) return byUpdated
  return timeKey(a.created_at).localeCompare(timeKey(b.created_at))
}

/** PostgREST `or` filter for rows that must never be retried. */
export function terminalErrorOrFilter(): string {
  return [
    'analysis_error.ilike.%PROHIBITED_CONTENT%',
    'analysis_error.ilike."%No video formats found%"',
    'platform.eq.xiaohongshu',
    'source_url.ilike.%xiaohongshu.com%',
    'source_url.ilike.%xiaohongshu.cn%',
    'source_url.ilike.%xhslink.com%',
    'source_url.ilike.%xhs.cn%',
  ].join(',')
}

export function retryDueOrFilter(nowIso: string): string {
  return `next_retry_at.is.null,next_retry_at.lte.${nowIso}`
}
