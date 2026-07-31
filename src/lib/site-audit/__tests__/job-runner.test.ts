import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { JobRunner, type SiteAuditJob } from '../job-runner'

describe('JobRunner', () => {
  let mockSupabase: SupabaseClient
  let jobRunner: JobRunner

  beforeEach(() => {
    mockSupabase = {
      from: vi.fn(),
    } as any

    jobRunner = new JobRunner(mockSupabase)
  })

  // ===== createJob Tests =====

  describe('createJob', () => {
    it('should create a new job with default values', async () => {
      const mockJob: SiteAuditJob = {
        id: 'job-123',
        client_id: 'client-1',
        status: 'pending',
        domain: 'example.com',
        max_pages: 100,
        rate_limit_ms: 1000,
        total_urls_discovered: 0,
        total_urls_crawled: 0,
        total_pages_classified: 0,
        error_message: null,
        failed_urls: [],
        started_at: null,
        completed_at: null,
        created_at: '2026-05-04T10:00:00Z',
        updated_at: '2026-05-04T10:00:00Z',
      }

      const mockSelect = vi.fn().mockResolvedValue({
        data: mockJob,
        error: null,
      })

      const mockInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: mockSelect,
        }),
      })

      vi.mocked(mockSupabase.from).mockReturnValue({
        insert: mockInsert,
      } as any)

      const result = await jobRunner.createJob('client-1', {
        domain: 'example.com',
      })

      expect(result).toEqual(mockJob)
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          client_id: 'client-1',
          domain: 'example.com',
          max_pages: 100,
          rate_limit_ms: 1000,
          status: 'pending',
        })
      )
    })

    it('should create a job with custom max_pages and rate_limit_ms', async () => {
      const mockJob: SiteAuditJob = {
        id: 'job-456',
        client_id: 'client-1',
        status: 'pending',
        domain: 'site.com',
        max_pages: 250,
        rate_limit_ms: 2000,
        total_urls_discovered: 0,
        total_urls_crawled: 0,
        total_pages_classified: 0,
        error_message: null,
        failed_urls: [],
        started_at: null,
        completed_at: null,
        created_at: '2026-05-04T10:00:00Z',
        updated_at: '2026-05-04T10:00:00Z',
      }

      const mockSelect = vi.fn().mockResolvedValue({
        data: mockJob,
        error: null,
      })

      const mockInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: mockSelect,
        }),
      })

      vi.mocked(mockSupabase.from).mockReturnValue({
        insert: mockInsert,
      } as any)

      const result = await jobRunner.createJob('client-1', {
        domain: 'site.com',
        maxPages: 250,
        rateLimitMs: 2000,
      })

      expect(result.max_pages).toBe(250)
      expect(result.rate_limit_ms).toBe(2000)
    })

    it('should throw error when client_id is missing', async () => {
      await expect(
        jobRunner.createJob('', { domain: 'example.com' })
      ).rejects.toThrow('Client ID is required')
    })

    it('should throw error when domain is missing', async () => {
      await expect(
        jobRunner.createJob('client-1', { domain: '' })
      ).rejects.toThrow('Domain is required')
    })

    it('should throw error when insert fails', async () => {
      const mockSelect = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Insert failed' },
      })

      const mockInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: mockSelect,
        }),
      })

      vi.mocked(mockSupabase.from).mockReturnValue({
        insert: mockInsert,
      } as any)

      await expect(
        jobRunner.createJob('client-1', { domain: 'example.com' })
      ).rejects.toThrow('Failed to create job')
    })
  })

  // ===== getJob Tests =====

  describe('getJob', () => {
    it('should retrieve an existing job', async () => {
      const mockJob: SiteAuditJob = {
        id: 'job-123',
        client_id: 'client-1',
        status: 'pending',
        domain: 'example.com',
        max_pages: 100,
        rate_limit_ms: 1000,
        total_urls_discovered: 0,
        total_urls_crawled: 0,
        total_pages_classified: 0,
        error_message: null,
        failed_urls: [],
        started_at: null,
        completed_at: null,
        created_at: '2026-05-04T10:00:00Z',
        updated_at: '2026-05-04T10:00:00Z',
      }

      const mockSelect = vi.fn().mockResolvedValue({
        data: mockJob,
        error: null,
      })

      vi.mocked(mockSupabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: mockSelect,
          }),
        }),
      } as any)

      const result = await jobRunner.getJob('job-123')

      expect(result).toEqual(mockJob)
    })

    it('should return null when job does not exist', async () => {
      const mockSelect = vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'Not found' },
      })

      vi.mocked(mockSupabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: mockSelect,
          }),
        }),
      } as any)

      const result = await jobRunner.getJob('nonexistent-id')

      expect(result).toBeNull()
    })

    it('should throw error when job_id is missing', async () => {
      await expect(jobRunner.getJob('')).rejects.toThrow(
        'Job ID is required'
      )
    })

    it('should throw error when query fails', async () => {
      const mockSelect = vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'OTHER_ERROR', message: 'Database error' },
      })

      vi.mocked(mockSupabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: mockSelect,
          }),
        }),
      } as any)

      await expect(jobRunner.getJob('job-123')).rejects.toThrow(
        'Failed to fetch job'
      )
    })
  })

  // ===== startJob Tests =====

  describe('startJob', () => {
    it('should start a job and set status to in_progress', async () => {
      const mockJob: SiteAuditJob = {
        id: 'job-123',
        client_id: 'client-1',
        status: 'in_progress',
        domain: 'example.com',
        max_pages: 100,
        rate_limit_ms: 1000,
        total_urls_discovered: 0,
        total_urls_crawled: 0,
        total_pages_classified: 0,
        error_message: null,
        failed_urls: [],
        started_at: '2026-05-04T10:05:00Z',
        completed_at: null,
        created_at: '2026-05-04T10:00:00Z',
        updated_at: '2026-05-04T10:05:00Z',
      }

      const mockSelect = vi.fn().mockResolvedValue({
        data: mockJob,
        error: null,
      })

      const mockEq = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: mockSelect,
        }),
      })

      const mockUpdate = vi.fn().mockReturnValue({
        eq: mockEq,
      })

      vi.mocked(mockSupabase.from).mockReturnValue({
        update: mockUpdate,
      } as any)

      const result = await jobRunner.startJob('job-123')

      expect(result.status).toBe('in_progress')
      expect(result.started_at).toBeTruthy()
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'in_progress',
        })
      )
    })

    it('should throw error when job_id is missing', async () => {
      await expect(jobRunner.startJob('')).rejects.toThrow(
        'Job ID is required'
      )
    })

    it('should throw error when update fails', async () => {
      const mockSelect = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Update failed' },
      })

      const mockEq = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: mockSelect,
        }),
      })

      const mockUpdate = vi.fn().mockReturnValue({
        eq: mockEq,
      })

      vi.mocked(mockSupabase.from).mockReturnValue({
        update: mockUpdate,
      } as any)

      await expect(jobRunner.startJob('job-123')).rejects.toThrow(
        'Failed to start job'
      )
    })
  })

  // ===== updateProgress Tests =====

  describe('updateProgress', () => {
    it('should update all progress fields', async () => {
      const mockJob: SiteAuditJob = {
        id: 'job-123',
        client_id: 'client-1',
        status: 'in_progress',
        domain: 'example.com',
        max_pages: 100,
        rate_limit_ms: 1000,
        total_urls_discovered: 150,
        total_urls_crawled: 45,
        total_pages_classified: 40,
        error_message: null,
        failed_urls: [],
        started_at: '2026-05-04T10:05:00Z',
        completed_at: null,
        created_at: '2026-05-04T10:00:00Z',
        updated_at: '2026-05-04T10:10:00Z',
      }

      const mockSelect = vi.fn().mockResolvedValue({
        data: mockJob,
        error: null,
      })

      const mockEq = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: mockSelect,
        }),
      })

      const mockUpdate = vi.fn().mockReturnValue({
        eq: mockEq,
      })

      vi.mocked(mockSupabase.from).mockReturnValue({
        update: mockUpdate,
      } as any)

      const result = await jobRunner.updateProgress('job-123', {
        totalUrlsDiscovered: 150,
        totalUrlsCrawled: 45,
        totalPagesClassified: 40,
      })

      expect(result.total_urls_discovered).toBe(150)
      expect(result.total_urls_crawled).toBe(45)
      expect(result.total_pages_classified).toBe(40)
    })

    it('should update only specified progress fields', async () => {
      const mockJob: SiteAuditJob = {
        id: 'job-123',
        client_id: 'client-1',
        status: 'in_progress',
        domain: 'example.com',
        max_pages: 100,
        rate_limit_ms: 1000,
        total_urls_discovered: 150,
        total_urls_crawled: 0,
        total_pages_classified: 0,
        error_message: null,
        failed_urls: [],
        started_at: '2026-05-04T10:05:00Z',
        completed_at: null,
        created_at: '2026-05-04T10:00:00Z',
        updated_at: '2026-05-04T10:10:00Z',
      }

      const mockSelect = vi.fn().mockResolvedValue({
        data: mockJob,
        error: null,
      })

      const mockEq = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: mockSelect,
        }),
      })

      const mockUpdate = vi.fn().mockReturnValue({
        eq: mockEq,
      })

      vi.mocked(mockSupabase.from).mockReturnValue({
        update: mockUpdate,
      } as any)

      const result = await jobRunner.updateProgress('job-123', {
        totalUrlsDiscovered: 150,
      })

      expect(result.total_urls_discovered).toBe(150)
      expect(mockUpdate).toHaveBeenCalledWith({
        total_urls_discovered: 150,
      })
    })

    it('should throw error when job_id is missing', async () => {
      await expect(
        jobRunner.updateProgress('', {
          totalUrlsDiscovered: 100,
        })
      ).rejects.toThrow('Job ID is required')
    })

    it('should throw error when update fails', async () => {
      const mockSelect = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Update failed' },
      })

      const mockEq = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: mockSelect,
        }),
      })

      const mockUpdate = vi.fn().mockReturnValue({
        eq: mockEq,
      })

      vi.mocked(mockSupabase.from).mockReturnValue({
        update: mockUpdate,
      } as any)

      await expect(
        jobRunner.updateProgress('job-123', {
          totalUrlsDiscovered: 100,
        })
      ).rejects.toThrow('Failed to update job')
    })
  })

  // ===== completeJob Tests =====

  describe('completeJob', () => {
    it('should mark job as completed', async () => {
      const mockJob: SiteAuditJob = {
        id: 'job-123',
        client_id: 'client-1',
        status: 'completed',
        domain: 'example.com',
        max_pages: 100,
        rate_limit_ms: 1000,
        total_urls_discovered: 150,
        total_urls_crawled: 45,
        total_pages_classified: 40,
        error_message: null,
        failed_urls: [],
        started_at: '2026-05-04T10:05:00Z',
        completed_at: '2026-05-04T10:30:00Z',
        created_at: '2026-05-04T10:00:00Z',
        updated_at: '2026-05-04T10:30:00Z',
      }

      const mockSelect = vi.fn().mockResolvedValue({
        data: mockJob,
        error: null,
      })

      const mockEq = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: mockSelect,
        }),
      })

      const mockUpdate = vi.fn().mockReturnValue({
        eq: mockEq,
      })

      vi.mocked(mockSupabase.from).mockReturnValue({
        update: mockUpdate,
      } as any)

      const result = await jobRunner.completeJob('job-123')

      expect(result.status).toBe('completed')
      expect(result.completed_at).toBeTruthy()
    })

    it('should throw error when job_id is missing', async () => {
      await expect(jobRunner.completeJob('')).rejects.toThrow(
        'Job ID is required'
      )
    })

    it('should throw error when update fails', async () => {
      const mockSelect = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Update failed' },
      })

      const mockEq = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: mockSelect,
        }),
      })

      const mockUpdate = vi.fn().mockReturnValue({
        eq: mockEq,
      })

      vi.mocked(mockSupabase.from).mockReturnValue({
        update: mockUpdate,
      } as any)

      await expect(jobRunner.completeJob('job-123')).rejects.toThrow(
        'Failed to complete job'
      )
    })
  })

  // ===== failJob Tests =====

  describe('failJob', () => {
    it('should mark job as failed with error message', async () => {
      const mockJob: SiteAuditJob = {
        id: 'job-123',
        client_id: 'client-1',
        status: 'failed',
        domain: 'example.com',
        max_pages: 100,
        rate_limit_ms: 1000,
        total_urls_discovered: 50,
        total_urls_crawled: 20,
        total_pages_classified: 15,
        error_message: 'Timeout while crawling pages',
        failed_urls: ['https://example.com/page1', 'https://example.com/page2'],
        started_at: '2026-05-04T10:05:00Z',
        completed_at: '2026-05-04T10:20:00Z',
        created_at: '2026-05-04T10:00:00Z',
        updated_at: '2026-05-04T10:20:00Z',
      }

      const mockSelect = vi.fn().mockResolvedValue({
        data: mockJob,
        error: null,
      })

      const mockEq = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: mockSelect,
        }),
      })

      const mockUpdate = vi.fn().mockReturnValue({
        eq: mockEq,
      })

      vi.mocked(mockSupabase.from).mockReturnValue({
        update: mockUpdate,
      } as any)

      const result = await jobRunner.failJob(
        'job-123',
        'Timeout while crawling pages',
        ['https://example.com/page1', 'https://example.com/page2']
      )

      expect(result.status).toBe('failed')
      expect(result.error_message).toBe('Timeout while crawling pages')
      expect(result.failed_urls).toEqual([
        'https://example.com/page1',
        'https://example.com/page2',
      ])
    })

    it('should throw error when job_id is missing', async () => {
      await expect(
        jobRunner.failJob('', 'Error message')
      ).rejects.toThrow('Job ID is required')
    })

    it('should throw error when error message is missing', async () => {
      await expect(jobRunner.failJob('job-123', '')).rejects.toThrow(
        'Error message is required'
      )
    })

    it('should throw error when update fails', async () => {
      const mockSelect = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Update failed' },
      })

      const mockEq = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: mockSelect,
        }),
      })

      const mockUpdate = vi.fn().mockReturnValue({
        eq: mockEq,
      })

      vi.mocked(mockSupabase.from).mockReturnValue({
        update: mockUpdate,
      } as any)

      await expect(
        jobRunner.failJob('job-123', 'Error message', [])
      ).rejects.toThrow('Failed to mark job as failed')
    })
  })

  // ===== getInProgressJob Tests =====

  describe('getInProgressJob', () => {
    it('should return the most recent in_progress job for a client', async () => {
      const mockJob: SiteAuditJob = {
        id: 'job-123',
        client_id: 'client-1',
        status: 'in_progress',
        domain: 'example.com',
        max_pages: 100,
        rate_limit_ms: 1000,
        total_urls_discovered: 50,
        total_urls_crawled: 45,
        total_pages_classified: 30,
        error_message: null,
        failed_urls: [],
        started_at: '2026-05-04T10:05:00Z',
        completed_at: null,
        created_at: '2026-05-04T10:00:00Z',
        updated_at: '2026-05-04T10:10:00Z',
      }

      const mockOrder = vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue({
          data: [mockJob],
          error: null,
        }),
      })

      const mockEq2 = vi.fn().mockReturnValue({
        order: mockOrder,
      })

      const mockEq1 = vi.fn().mockReturnValue({
        eq: mockEq2,
      })

      const mockSelect = vi.fn().mockReturnValue({
        eq: mockEq1,
      })

      vi.mocked(mockSupabase.from).mockReturnValue({
        select: mockSelect,
      } as any)

      const result = await jobRunner.getInProgressJob('client-1')

      expect(result).toEqual(mockJob)
      expect(mockEq1).toHaveBeenCalledWith('client_id', 'client-1')
      expect(mockEq2).toHaveBeenCalledWith('status', 'in_progress')
    })

    it('should return null when no in_progress job exists', async () => {
      const mockOrder = vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue({
          data: [],
          error: null,
        }),
      })

      const mockEq2 = vi.fn().mockReturnValue({
        order: mockOrder,
      })

      const mockEq1 = vi.fn().mockReturnValue({
        eq: mockEq2,
      })

      const mockSelect = vi.fn().mockReturnValue({
        eq: mockEq1,
      })

      vi.mocked(mockSupabase.from).mockReturnValue({
        select: mockSelect,
      } as any)

      const result = await jobRunner.getInProgressJob('client-1')

      expect(result).toBeNull()
    })

    it('should throw error when client_id is missing', async () => {
      await expect(jobRunner.getInProgressJob('')).rejects.toThrow(
        'Client ID is required'
      )
    })

    it('should throw error when query fails', async () => {
      const mockOrder = vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'Query failed' },
        }),
      })

      const mockEq2 = vi.fn().mockReturnValue({
        order: mockOrder,
      })

      const mockEq1 = vi.fn().mockReturnValue({
        eq: mockEq2,
      })

      const mockSelect = vi.fn().mockReturnValue({
        eq: mockEq1,
      })

      vi.mocked(mockSupabase.from).mockReturnValue({
        select: mockSelect,
      } as any)

      await expect(jobRunner.getInProgressJob('client-1')).rejects.toThrow(
        'Failed to query in-progress jobs'
      )
    })
  })

  // ===== getLatestJobByClientId Tests =====

  describe('getLatestJobByClientId', () => {
    it('should return the most recent job for a client (any status)', async () => {
      const mockJob: SiteAuditJob = {
        id: 'job-789',
        client_id: 'client-1',
        status: 'completed',
        domain: 'example.com',
        max_pages: 100,
        rate_limit_ms: 1000,
        total_urls_discovered: 150,
        total_urls_crawled: 100,
        total_pages_classified: 100,
        error_message: null,
        failed_urls: [],
        started_at: '2026-05-04T10:05:00Z',
        completed_at: '2026-05-04T10:30:00Z',
        created_at: '2026-05-04T10:00:00Z',
        updated_at: '2026-05-04T10:30:00Z',
      }

      const mockOrder = vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue({
          data: [mockJob],
          error: null,
        }),
      })

      const mockEq = vi.fn().mockReturnValue({
        order: mockOrder,
      })

      const mockSelect = vi.fn().mockReturnValue({
        eq: mockEq,
      })

      vi.mocked(mockSupabase.from).mockReturnValue({
        select: mockSelect,
      } as any)

      const result = await jobRunner.getLatestJobByClientId('client-1')

      expect(result).toEqual(mockJob)
      expect(mockEq).toHaveBeenCalledWith('client_id', 'client-1')
    })

    it('should return null when no jobs exist for client', async () => {
      const mockOrder = vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue({
          data: [],
          error: null,
        }),
      })

      const mockEq = vi.fn().mockReturnValue({
        order: mockOrder,
      })

      const mockSelect = vi.fn().mockReturnValue({
        eq: mockEq,
      })

      vi.mocked(mockSupabase.from).mockReturnValue({
        select: mockSelect,
      } as any)

      const result = await jobRunner.getLatestJobByClientId('client-1')

      expect(result).toBeNull()
    })

    it('should throw error when client_id is missing', async () => {
      await expect(jobRunner.getLatestJobByClientId('')).rejects.toThrow(
        'Client ID is required'
      )
    })

    it('should throw error when query fails', async () => {
      const mockOrder = vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'Query failed' },
        }),
      })

      const mockEq = vi.fn().mockReturnValue({
        order: mockOrder,
      })

      const mockSelect = vi.fn().mockReturnValue({
        eq: mockEq,
      })

      vi.mocked(mockSupabase.from).mockReturnValue({
        select: mockSelect,
      } as any)

      await expect(jobRunner.getLatestJobByClientId('client-1')).rejects.toThrow(
        'Failed to query latest job'
      )
    })
  })

  // ===== cleanupOldJobs Tests =====

  describe('cleanupOldJobs', () => {
    it('should delete jobs older than retention period', async () => {
      const mockSelect = vi.fn().mockResolvedValue({
        data: [{ id: 'job-old-1' }, { id: 'job-old-2' }],
        error: null,
      })

      const mockNot = vi.fn().mockReturnValue({
        select: mockSelect,
      })

      const mockLt = vi.fn().mockReturnValue({
        not: mockNot,
      })

      const mockDelete = vi.fn().mockReturnValue({
        lt: mockLt,
      })

      vi.mocked(mockSupabase.from).mockReturnValue({
        delete: mockDelete,
      } as any)

      const result = await jobRunner.cleanupOldJobs(30)

      expect(result).toBe(2)
      // .neq('completed_at', null) was the original bug: PostgREST serialises
      // it to the string "null" and Postgres rejects the timestamptz cast.
      expect(mockNot).toHaveBeenCalledWith('completed_at', 'is', null)
    })

    it('should return 0 when no jobs to cleanup', async () => {
      const mockSelect = vi.fn().mockResolvedValue({
        data: [],
        error: null,
      })

      const mockNot = vi.fn().mockReturnValue({
        select: mockSelect,
      })

      const mockLt = vi.fn().mockReturnValue({
        not: mockNot,
      })

      const mockDelete = vi.fn().mockReturnValue({
        lt: mockLt,
      })

      vi.mocked(mockSupabase.from).mockReturnValue({
        delete: mockDelete,
      } as any)

      const result = await jobRunner.cleanupOldJobs(30)

      expect(result).toBe(0)
    })

    it('should throw error when retention_days is invalid', async () => {
      await expect(jobRunner.cleanupOldJobs(0)).rejects.toThrow(
        'Retention days must be positive'
      )

      await expect(jobRunner.cleanupOldJobs(-1)).rejects.toThrow(
        'Retention days must be positive'
      )
    })

    it('should throw error when delete fails', async () => {
      const mockSelect = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Delete failed' },
      })

      const mockNot = vi.fn().mockReturnValue({
        select: mockSelect,
      })

      const mockLt = vi.fn().mockReturnValue({
        not: mockNot,
      })

      const mockDelete = vi.fn().mockReturnValue({
        lt: mockLt,
      })

      vi.mocked(mockSupabase.from).mockReturnValue({
        delete: mockDelete,
      } as any)

      await expect(jobRunner.cleanupOldJobs(30)).rejects.toThrow(
        'Failed to cleanup jobs'
      )
    })
  })
})
