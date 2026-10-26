import { describe, expect, it } from 'vitest'
import {
  ANALYSIS_BACKOFF_BASE_MS,
  ANALYSIS_BACKOFF_CAP_MS,
  backoffDelayMs,
  compareRetryRows,
  isQueueableViralSourceUrl,
  isRetryEligible,
  isTerminalAnalysisError,
  planAnalysisFailure,
  terminalErrorOrFilter,
} from '../viral-analyzer-retry'

const NOW = new Date('2026-10-24T06:00:00.000Z')

describe('permanent analysis failures', () => {
  it('treats prohibited content and missing video formats as terminal', () => {
    expect(isTerminalAnalysisError('blocked: PROHIBITED_CONTENT')).toBe(true)
    expect(isTerminalAnalysisError('ERROR: No video formats found')).toBe(true)
    expect(isTerminalAnalysisError('[429 Too Many Requests] quota exceeded')).toBe(false)
  })

  it('plans a terminal row that will not be scheduled again', () => {
    const plan = planAnalysisFailure({
      message: 'Response blocked: PROHIBITED_CONTENT',
      previousAttempts: null,
      now: NOW,
      sourceUrl: 'https://www.youtube.com/watch?v=abc',
    })
    expect(plan).toMatchObject({
      analysis_status: 'terminal',
      analysis_attempts: 1,
      next_retry_at: null,
      updated_at: NOW.toISOString(),
    })
  })

  it('marks XiaoHongShu hosts terminal even when the downloader message is generic', () => {
    const plan = planAnalysisFailure({
      message: 'Command failed: yt-dlp',
      previousAttempts: 4,
      now: NOW,
      sourceUrl: 'https://xhslink.com/a/abc',
    })
    expect(plan.analysis_status).toBe('terminal')
    expect(plan.analysis_attempts).toBe(5)
    expect(plan.next_retry_at).toBeNull()
  })
})

describe('retry backoff and rotation', () => {
  it('doubles the wait and then caps it', () => {
    expect(backoffDelayMs(1)).toBe(ANALYSIS_BACKOFF_BASE_MS)
    expect(backoffDelayMs(2)).toBe(ANALYSIS_BACKOFF_BASE_MS * 2)
    expect(backoffDelayMs(20)).toBe(ANALYSIS_BACKOFF_CAP_MS)
  })

  it('keeps a quota failure retryable and stamps the next time plus updated_at', () => {
    const plan = planAnalysisFailure({
      message: '[429 Too Many Requests] You exceeded your current quota',
      previousAttempts: 1,
      now: NOW,
      sourceUrl: 'https://www.youtube.com/watch?v=abc',
    })
    expect(plan.analysis_status).toBe('error')
    expect(plan.analysis_attempts).toBe(2)
    expect(plan.updated_at).toBe(NOW.toISOString())
    expect(Date.parse(plan.next_retry_at ?? '')).toBe(NOW.getTime() + ANALYSIS_BACKOFF_BASE_MS * 2)
  })

  it('does not claim a row whose backoff has not elapsed', () => {
    const future = new Date(NOW.getTime() + 60_000).toISOString()
    expect(isRetryEligible({
      analysis_status: 'error',
      source_url: 'https://www.youtube.com/watch?v=abc',
      next_retry_at: future,
      platform: 'youtube',
    }, NOW)).toBe(false)
  })

  it('skips permanent messages and XiaoHongShu rows', () => {
    expect(isRetryEligible({
      analysis_status: 'error',
      source_url: 'https://www.youtube.com/watch?v=abc',
      analysis_error: 'PROHIBITED_CONTENT',
      platform: 'youtube',
    }, NOW)).toBe(false)
    expect(isRetryEligible({
      analysis_status: 'error',
      source_url: 'https://www.xiaohongshu.com/explore/abc',
      analysis_error: '429',
      platform: 'youtube',
    }, NOW)).toBe(false)
  })

  it('orders untouched error rows ahead of rows already retried', () => {
    const fresh = {
      analysis_status: 'error', source_url: 'https://youtu.be/a', updated_at: null, created_at: '2026-08-02T00:00:00.000Z',
    }
    const touched = {
      analysis_status: 'error', source_url: 'https://youtu.be/b', updated_at: '2026-10-24T01:00:00.000Z', created_at: '2026-06-01T00:00:00.000Z',
    }
    const olderFresh = {
      analysis_status: 'error', source_url: 'https://youtu.be/c', updated_at: null, created_at: '2026-06-03T00:00:00.000Z',
    }
    const pending = {
      analysis_status: 'pending', source_url: 'https://youtu.be/d', updated_at: '2026-10-24T05:00:00.000Z', created_at: '2026-10-01T00:00:00.000Z',
    }
    expect([touched, fresh, pending, olderFresh].sort(compareRetryRows).map(row => row.source_url)).toEqual([
      'https://youtu.be/d',
      'https://youtu.be/c',
      'https://youtu.be/a',
      'https://youtu.be/b',
    ])
  })
})

describe('discovery intake', () => {
  it('drops XiaoHongShu links and keeps downloadable hosts', () => {
    expect(isQueueableViralSourceUrl('https://www.youtube.com/watch?v=abc')).toBe(true)
    expect(isQueueableViralSourceUrl('https://www.youtube.com/watch?v=abc&note=xiaohongshu.com')).toBe(true)
    expect(isQueueableViralSourceUrl('https://www.xiaohongshu.com/explore/abc')).toBe(false)
    expect(isQueueableViralSourceUrl('https://xhslink.com/a/abc')).toBe(false)
    expect(isQueueableViralSourceUrl('https://www.xiaohongshu.cn/discovery/item/abc')).toBe(false)
    expect(terminalErrorOrFilter()).toContain('PROHIBITED_CONTENT')
    expect(terminalErrorOrFilter()).toContain('No video formats found')
  })
})
