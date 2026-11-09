/**
 * Test suite for POST /api/cron/site-audit-jobs
 * Tests cleanup, watchdog, and recovery operations for site-audit jobs
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '../route'
import { supabaseAdmin } from '@/lib/supabase'
import { JobRunner } from '@/lib/site-audit/job-runner'

// Mock Supabase
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

// Mock JobRunner
vi.mock('@/lib/site-audit/job-runner', () => ({
  JobRunner: vi.fn(),
}))

// Mock cron_run_logs receipt (route calls startCronRun before any work)
const mockCronFinish = vi.fn(async () => {})
vi.mock('@/lib/cron/run-logger', () => ({
  startCronRun: vi.fn(async () => ({ finish: mockCronFinish })),
}))

describe('POST /api/cron/site-audit-jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // =========================================================================
  // Authentication Tests
  // =========================================================================

  describe('Authentication', () => {
    it('should return 401 when CRON_SECRET is missing', async () => {
      process.env.CRON_SECRET = 'test-secret'

      const request = new NextRequest('http://localhost:3000/api/cron/site-audit-jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      const response = await POST(request)

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized')
    })

    it('should return 401 when CRON_SECRET is incorrect', async () => {
      process.env.CRON_SECRET = 'correct-secret'

      const request = new NextRequest('http://localhost:3000/api/cron/site-audit-jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-cron-secret': 'wrong-secret',
        },
      })

      const response = await POST(request)

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized')
    })
  })

  // =========================================================================
  // Cleanup Tests
  // =========================================================================

  describe('Job cleanup', () => {
    beforeEach(() => {
      process.env.CRON_SECRET = 'test-secret'
    })

    it('should clean up old jobs (retention 30 days)', async () => {
      const mockFrom = vi.fn()

      // Watchdog query (no failed jobs)
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            not: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        }),
      })

      // Zombie watchdog query (22.E.S15): no in_progress jobs stuck > 2h
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            lt: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        }),
      })

      // Recovery query (no stale pending jobs)
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            lt: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        }),
      })

      vi.mocked(supabaseAdmin).from = mockFrom
      const mockJobRunner = {
        cleanupOldJobs: vi.fn().mockResolvedValue(5),
      }

      vi.mocked(JobRunner).mockReturnValue(mockJobRunner as unknown as JobRunner)

      const request = new NextRequest('http://localhost:3000/api/cron/site-audit-jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-cron-secret': 'test-secret',
        },
      })

      const response = await POST(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.cleaned_jobs).toBe(5)
      expect(mockJobRunner.cleanupOldJobs).toHaveBeenCalledWith(30)
    })

    it('should handle cleanup errors gracefully', async () => {
      const mockJobRunner = {
        cleanupOldJobs: vi.fn().mockRejectedValue(new Error('Cleanup failed')),
      }

      vi.mocked(JobRunner).mockReturnValue(mockJobRunner as unknown as JobRunner)

      const request = new NextRequest('http://localhost:3000/api/cron/site-audit-jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-cron-secret': 'test-secret',
        },
      })

      const response = await POST(request)

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data.error).toContain('Cleanup failed')
    })
  })

  // =========================================================================
  // Watchdog Tests
  // =========================================================================

  describe('Watchdog (failed jobs)', () => {
    beforeEach(() => {
      process.env.CRON_SECRET = 'test-secret'
    })

    it('should detect and log failed jobs (status=failed with error_message)', async () => {
      const mockFrom = vi.fn()

      // Watchdog query (failed jobs)
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            not: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'job-1',
                  client_id: 'client-1',
                  status: 'failed',
                  error_message: 'Network timeout',
                  failed_urls: ['https://example.com/page1'],
                },
              ],
              error: null,
            }),
          }),
        }),
      })

      // Zombie watchdog query (22.E.S15): no in_progress jobs stuck > 2h
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            lt: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        }),
      })

      // Recovery query (no stale pending jobs)
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            lt: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        }),
      })

      vi.mocked(supabaseAdmin).from = mockFrom
      const mockJobRunner = {
        cleanupOldJobs: vi.fn().mockResolvedValue(0),
      }
      vi.mocked(JobRunner).mockReturnValue(mockJobRunner as unknown as JobRunner)

      const request = new NextRequest('http://localhost:3000/api/cron/site-audit-jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-cron-secret': 'test-secret',
        },
      })

      const response = await POST(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.failed_jobs_found).toBe(1)
    })
  })

  // =========================================================================
  // Recovery Tests
  // =========================================================================

  describe('Recovery (stale pending jobs)', () => {
    beforeEach(() => {
      process.env.CRON_SECRET = 'test-secret'
    }
    )

    it('should resume pending jobs stuck > 1 hour', async () => {
      const now = new Date()
      const oneHourAgo = new Date(now.getTime() - 61 * 60 * 1000).toISOString()

      const mockFrom = vi.fn()

      // Watchdog query (failed jobs)
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            not: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        }),
      })

      // Zombie watchdog query (22.E.S15): no in_progress jobs stuck > 2h
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            lt: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        }),
      })

      // Recovery query (pending jobs stuck > 1 hour)
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            lt: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'job-2',
                  client_id: 'client-2',
                  domain: 'example.com',
                  status: 'pending',
                  created_at: oneHourAgo,
                },
              ],
              error: null,
            }),
          }),
        }),
      })

      vi.mocked(supabaseAdmin).from = mockFrom
      const mockJobRunner = {
        cleanupOldJobs: vi.fn().mockResolvedValue(0),
        startJob: vi.fn().mockResolvedValue({ id: 'job-2', status: 'in_progress' }),
      }
      vi.mocked(JobRunner).mockReturnValue(mockJobRunner as unknown as JobRunner)

      const request = new NextRequest('http://localhost:3000/api/cron/site-audit-jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-cron-secret': 'test-secret',
        },
      })

      const response = await POST(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.resumed_jobs).toBe(1)
      expect(mockJobRunner.startJob).toHaveBeenCalledWith('job-2')
    })
  })

  // =========================================================================
  // Response Format Tests
  // =========================================================================

  describe('Response format', () => {
    beforeEach(() => {
      process.env.CRON_SECRET = 'test-secret'
    })

    it('should return complete status report', async () => {
      const mockFrom = vi.fn()

      // Watchdog query
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            not: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        }),
      })

      // Zombie watchdog query (22.E.S15): no in_progress jobs stuck > 2h
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            lt: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        }),
      })

      // Recovery query
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            lt: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        }),
      })

      vi.mocked(supabaseAdmin).from = mockFrom
      const mockJobRunner = {
        cleanupOldJobs: vi.fn().mockResolvedValue(3),
      }
      vi.mocked(JobRunner).mockReturnValue(mockJobRunner as unknown as JobRunner)

      const request = new NextRequest('http://localhost:3000/api/cron/site-audit-jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-cron-secret': 'test-secret',
        },
      })

      const response = await POST(request)

      expect(response.status).toBe(200)
      const data = await response.json()

      expect(data).toHaveProperty('timestamp')
      expect(data).toHaveProperty('cleaned_jobs')
      expect(data).toHaveProperty('failed_jobs_found')
      expect(data).toHaveProperty('resumed_jobs')
      expect(data).toHaveProperty('zombies_failed')
      expect(data.cleaned_jobs).toBe(3)
      expect(data.failed_jobs_found).toBe(0)
      expect(data.resumed_jobs).toBe(0)
      expect(data.zombies_failed).toBe(0)

      // cron_run_logs receipt is closed with the same numbers
      expect(mockCronFinish).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: { cleaned_jobs: 3, failed_jobs_found: 0, resumed_jobs: 0, zombies_failed: 0 },
        })
      )
    })
  })

  // =========================================================================
  // Zombie Watchdog Tests (22.E.S15)
  // =========================================================================

  describe('Zombie watchdog (in_progress > 2h)', () => {
    beforeEach(() => {
      process.env.CRON_SECRET = 'test-secret'
    })

    it('should fail in_progress jobs stuck > 2 hours', async () => {
      const mockFrom = vi.fn()

      // Watchdog query (no failed jobs)
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            not: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      })

      // Zombie watchdog query (one stuck job)
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            lt: vi.fn().mockResolvedValue({ data: [{ id: 'job-zombie' }], error: null }),
          }),
        }),
      })

      // Recovery query (no stale pending jobs)
      mockFrom.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            lt: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      })

      vi.mocked(supabaseAdmin).from = mockFrom
      const mockJobRunner = {
        cleanupOldJobs: vi.fn().mockResolvedValue(0),
        failJob: vi.fn().mockResolvedValue(undefined),
      }
      vi.mocked(JobRunner).mockReturnValue(mockJobRunner as unknown as JobRunner)

      const request = new NextRequest('http://localhost:3000/api/cron/site-audit-jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-cron-secret': 'test-secret',
        },
      })

      const response = await POST(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.zombies_failed).toBe(1)
      expect(mockJobRunner.failJob).toHaveBeenCalledWith(
        'job-zombie',
        expect.stringContaining('in_progress > 2h')
      )
    })
  })

  // =========================================================================
  // Error Handling Tests
  // =========================================================================

  describe('Error handling', () => {
    beforeEach(() => {
      process.env.CRON_SECRET = 'test-secret'
    })

    it('should return 500 on unexpected error', async () => {
      vi.mocked(JobRunner).mockImplementation(() => {
        throw new Error('Unexpected error')
      })

      const request = new NextRequest('http://localhost:3000/api/cron/site-audit-jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-cron-secret': 'test-secret',
        },
      })

      const response = await POST(request)

      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data.error).toBe('Unexpected error')
    })
  })
})
