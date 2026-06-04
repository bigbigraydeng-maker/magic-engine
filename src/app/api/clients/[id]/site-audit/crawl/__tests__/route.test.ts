/**
 * Tests for POST /api/clients/[id]/site-audit/crawl
 *
 * TDD: GREEN phase — tests must pass against the implementation.
 * Reference: ROADMAP.md P8.0.5.2
 *
 * Mock strategy:
 * - vi.mock factories use vi.fn() directly (no top-level variable references)
 *   to avoid hoisting issues with const declarations.
 * - Concrete mock references are obtained via vi.mocked() after import.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks — factories must NOT reference top-level variables (hoisting rule)
// ---------------------------------------------------------------------------

vi.mock('@/lib/site-audit/job-runner', () => ({
  JobRunner: vi.fn(),
}))

vi.mock('@/lib/site-audit/job-executor', () => ({
  executeJob: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

// ---------------------------------------------------------------------------
// Import after mocks are declared
// ---------------------------------------------------------------------------

import { POST, type CrawlRequestBody, type CrawlResponse } from '../route'
import { supabaseAdmin } from '@/lib/supabase'
import { JobRunner } from '@/lib/site-audit/job-runner'
import { executeJob } from '@/lib/site-audit/job-executor'

// Phase X.S2: paid-tier auth bypass — these route tests target the business
// logic, not the auth path. Real wiring is covered in
// src/lib/auth/__tests__/client-access.test.ts.
vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: vi.fn().mockResolvedValue({
    ok: true,
    user: { id: 'test-user', email: 'test@magiclab.com' },
    role: 'admin',
    tier: 'admin',
    allowedClientId: null,
  }),
  requirePaidClientAccess: vi.fn().mockResolvedValue({
    ok: true,
    user: { id: 'test-user', email: 'test@magiclab.com' },
    role: 'admin',
    tier: 'admin',
    allowedClientId: null,
  }),
}))


// ---------------------------------------------------------------------------
// Typed references to mock internals
// ---------------------------------------------------------------------------

const MockJobRunner = vi.mocked(JobRunner)
const mockExecuteJob = vi.mocked(executeJob)

// The instance-level methods — populated in beforeEach
let mockCreateJob: ReturnType<typeof vi.fn>
let mockGetInProgressJob: ReturnType<typeof vi.fn>
let mockFailJob: ReturnType<typeof vi.fn>

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const VALID_JOB = {
  id: 'job-123',
  client_id: 'client-1',
  status: 'pending' as const,
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

const VALID_CLIENT = { id: 'client-1', domain: 'example.com' }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body?: CrawlRequestBody): NextRequest {
  const url = 'http://localhost/api/clients/client-1/site-audit/crawl'
  if (body === undefined) {
    return new NextRequest(url, { method: 'POST' })
  }
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeParams(id: string) {
  return { params: { id } }
}

function setupClientMock(clientData: { id: string; domain: string | null } | null, error: unknown = null) {
  vi.mocked(supabaseAdmin.from).mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: clientData, error }),
      }),
    }),
  } as any)
}

// ---------------------------------------------------------------------------
// beforeEach — reset all mocks and re-establish defaults
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()

  // Set up JobRunner instance mock methods
  mockCreateJob = vi.fn().mockResolvedValue(VALID_JOB)
  mockGetInProgressJob = vi.fn().mockResolvedValue(null)
  mockFailJob = vi.fn().mockResolvedValue({ ...VALID_JOB, status: 'failed' })

  MockJobRunner.mockImplementation(() => ({
    createJob: mockCreateJob,
    getInProgressJob: mockGetInProgressJob,
    failJob: mockFailJob,
  }) as any)

  // Default: valid client
  setupClientMock(VALID_CLIENT)

  // Default: executeJob resolves immediately
  mockExecuteJob.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Test Suites
// ---------------------------------------------------------------------------

describe('POST /api/clients/[id]/site-audit/crawl', () => {

  // =========================================================================
  // Suite 1: Client validation
  // =========================================================================

  describe('Suite 1: Client validation', () => {
    it('returns 201 with jobId when client exists and has a valid domain', async () => {
      const response = await POST(makeRequest(), makeParams('client-1'))
      const body = await response.json() as CrawlResponse

      expect(response.status).toBe(201)
      expect(body.jobId).toBe('job-123')
      expect(body.status).toBe('pending')
    })

    it('returns 404 when client does not exist', async () => {
      setupClientMock(null, { code: 'PGRST116', message: 'Not found' })

      const response = await POST(makeRequest(), makeParams('nonexistent-id'))
      const body = await response.json()

      expect(response.status).toBe(404)
      expect(body.error).toMatch(/client not found/i)
    })

    it('returns 400 when client exists but has empty domain string', async () => {
      setupClientMock({ id: 'client-1', domain: '' })

      const response = await POST(makeRequest(), makeParams('client-1'))
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toMatch(/domain/i)
    })

    it('returns 400 when client domain is null', async () => {
      setupClientMock({ id: 'client-1', domain: null })

      const response = await POST(makeRequest(), makeParams('client-1'))
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toMatch(/domain/i)
    })
  })

  // =========================================================================
  // Suite 2: Body validation
  // =========================================================================

  describe('Suite 2: Body validation', () => {
    it('uses defaults when no body is provided (maxPages=100, rateLimitMs=1000)', async () => {
      const response = await POST(makeRequest(), makeParams('client-1'))

      expect(response.status).toBe(201)
      expect(mockCreateJob).toHaveBeenCalledWith(
        'client-1',
        expect.objectContaining({
          domain: 'example.com',
          maxPages: 100,
          rateLimitMs: 1000,
        })
      )
    })

    it('uses defaults when body is empty object {}', async () => {
      const response = await POST(makeRequest({}), makeParams('client-1'))

      expect(response.status).toBe(201)
      expect(mockCreateJob).toHaveBeenCalledWith(
        'client-1',
        expect.objectContaining({ maxPages: 100, rateLimitMs: 1000 })
      )
    })

    it('returns 400 when maxPages > 100', async () => {
      const response = await POST(makeRequest({ maxPages: 101 }), makeParams('client-1'))
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toMatch(/maxPages/i)
    })

    it('returns 400 when maxPages < 1', async () => {
      const response = await POST(makeRequest({ maxPages: 0 }), makeParams('client-1'))
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toMatch(/maxPages/i)
    })

    it('returns 400 when maxPages is negative', async () => {
      const response = await POST(makeRequest({ maxPages: -5 }), makeParams('client-1'))
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toMatch(/maxPages/i)
    })

    it('returns 400 when rateLimitMs < 500', async () => {
      const response = await POST(makeRequest({ rateLimitMs: 499 }), makeParams('client-1'))
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toMatch(/rateLimitMs/i)
    })

    it('returns 400 when rateLimitMs is 0', async () => {
      const response = await POST(makeRequest({ rateLimitMs: 0 }), makeParams('client-1'))
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toMatch(/rateLimitMs/i)
    })

    it('returns 400 when force is not a boolean', async () => {
      const response = await POST(
        makeRequest({ force: 'yes' as unknown as boolean }),
        makeParams('client-1')
      )
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toMatch(/force/i)
    })

    it('accepts valid custom values (maxPages=50, rateLimitMs=500)', async () => {
      const response = await POST(
        makeRequest({ maxPages: 50, rateLimitMs: 500 }),
        makeParams('client-1')
      )

      expect(response.status).toBe(201)
      expect(mockCreateJob).toHaveBeenCalledWith(
        'client-1',
        expect.objectContaining({ maxPages: 50, rateLimitMs: 500 })
      )
    })

    it('accepts maxPages=100 (boundary maximum)', async () => {
      const response = await POST(makeRequest({ maxPages: 100 }), makeParams('client-1'))
      expect(response.status).toBe(201)
    })

    it('accepts maxPages=1 (boundary minimum)', async () => {
      const response = await POST(makeRequest({ maxPages: 1 }), makeParams('client-1'))
      expect(response.status).toBe(201)
    })

    it('accepts rateLimitMs=500 (boundary minimum)', async () => {
      const response = await POST(makeRequest({ rateLimitMs: 500 }), makeParams('client-1'))
      expect(response.status).toBe(201)
    })
  })

  // =========================================================================
  // Suite 3: Concurrency control
  // =========================================================================

  describe('Suite 3: Concurrency control', () => {
    it('creates a new job when no in_progress job exists', async () => {
      mockGetInProgressJob.mockResolvedValue(null)

      const response = await POST(makeRequest(), makeParams('client-1'))
      const body = await response.json() as CrawlResponse

      expect(response.status).toBe(201)
      expect(mockCreateJob).toHaveBeenCalledTimes(1)
      expect(body.jobId).toBe('job-123')
    })

    it('returns 409 with existing jobId when in_progress job exists and force=false', async () => {
      const existingJob = { ...VALID_JOB, id: 'existing-job-456', status: 'in_progress' as const }
      mockGetInProgressJob.mockResolvedValue(existingJob)

      const response = await POST(makeRequest({ force: false }), makeParams('client-1'))
      const body = await response.json()

      expect(response.status).toBe(409)
      expect(body.jobId).toBe('existing-job-456')
      expect(body.error).toMatch(/already in progress/i)
      expect(mockCreateJob).not.toHaveBeenCalled()
    })

    it('returns 409 when no force param provided and in_progress job exists', async () => {
      const existingJob = { ...VALID_JOB, id: 'existing-job-456', status: 'in_progress' as const }
      mockGetInProgressJob.mockResolvedValue(existingJob)

      const response = await POST(makeRequest(), makeParams('client-1'))
      const body = await response.json()

      expect(response.status).toBe(409)
      expect(body.jobId).toBe('existing-job-456')
      expect(mockCreateJob).not.toHaveBeenCalled()
    })

    it('marks old job as failed and creates new job when force=true', async () => {
      const existingJob = { ...VALID_JOB, id: 'existing-job-456', status: 'in_progress' as const }
      mockGetInProgressJob.mockResolvedValue(existingJob)
      mockFailJob.mockResolvedValue({ ...existingJob, status: 'failed' })
      mockCreateJob.mockResolvedValue({ ...VALID_JOB, id: 'new-job-789' })

      const response = await POST(makeRequest({ force: true }), makeParams('client-1'))
      const body = await response.json() as CrawlResponse

      expect(response.status).toBe(201)
      expect(mockFailJob).toHaveBeenCalledWith(
        'existing-job-456',
        expect.stringMatching(/forced/i)
      )
      expect(mockCreateJob).toHaveBeenCalledTimes(1)
      expect(body.jobId).toBe('new-job-789')
    })
  })

  // =========================================================================
  // Suite 4: Multi-tenant isolation
  // =========================================================================

  describe('Suite 4: Multi-tenant isolation', () => {
    it('clientA in_progress job does not block clientB from creating a new job', async () => {
      // Both clients have no in_progress jobs
      mockGetInProgressJob.mockResolvedValue(null)

      const clientAResponse = await POST(makeRequest(), makeParams('client-A'))
      const clientBResponse = await POST(makeRequest(), makeParams('client-B'))

      expect(clientAResponse.status).toBe(201)
      expect(clientBResponse.status).toBe(201)
      // createJob called twice — once per client
      expect(mockCreateJob).toHaveBeenCalledTimes(2)
    })

    it('getInProgressJob is called with the correct clientId for isolation', async () => {
      mockGetInProgressJob.mockResolvedValue(null)

      await POST(makeRequest(), makeParams('specific-client-id'))

      expect(mockGetInProgressJob).toHaveBeenCalledWith('specific-client-id')
    })

    it('createJob receives the correct clientId', async () => {
      await POST(makeRequest(), makeParams('my-client-xyz'))

      expect(mockCreateJob).toHaveBeenCalledWith(
        'my-client-xyz',
        expect.any(Object)
      )
    })
  })

  // =========================================================================
  // Suite 5: Response format
  // =========================================================================

  describe('Suite 5: Response format', () => {
    it('returns correct shape: { jobId, status, estimatedDurationSec }', async () => {
      const response = await POST(makeRequest(), makeParams('client-1'))
      const body = await response.json() as CrawlResponse

      expect(body).toMatchObject({
        jobId: expect.any(String),
        status: 'pending',
        estimatedDurationSec: expect.any(Number),
      })
    })

    it('calculates estimatedDurationSec as maxPages * 2 (default 100 → 200)', async () => {
      const response = await POST(makeRequest(), makeParams('client-1'))
      const body = await response.json() as CrawlResponse

      expect(body.estimatedDurationSec).toBe(200) // 100 * 2
    })

    it('calculates estimatedDurationSec for custom maxPages (50 → 100)', async () => {
      const response = await POST(makeRequest({ maxPages: 50 }), makeParams('client-1'))
      const body = await response.json() as CrawlResponse

      expect(body.estimatedDurationSec).toBe(100) // 50 * 2
    })

    it('includes optional message field as a string when present', async () => {
      const response = await POST(makeRequest(), makeParams('client-1'))
      const body = await response.json() as CrawlResponse

      if (body.message !== undefined) {
        expect(typeof body.message).toBe('string')
      }
    })

    it('returns Content-Type: application/json', async () => {
      const response = await POST(makeRequest(), makeParams('client-1'))

      expect(response.headers.get('content-type')).toContain('application/json')
    })
  })

  // =========================================================================
  // Suite 6: Fire-and-forget async verification
  // =========================================================================

  describe('Suite 6: Fire-and-forget async', () => {
    it('returns 201 immediately without waiting for executeJob to complete', async () => {
      // executeJob never resolves — but response must still arrive
      mockExecuteJob.mockImplementation(
        () => new Promise<void>(() => { /* intentionally never resolves */ })
      )

      const response = await POST(makeRequest(), makeParams('client-1'))

      expect(response.status).toBe(201)
    })

    it('calls executeJob with correct jobId and options after response', async () => {
      await POST(makeRequest({ maxPages: 50, rateLimitMs: 750 }), makeParams('client-1'))

      // Allow microtasks to flush
      await new Promise((r) => setTimeout(r, 0))

      expect(mockExecuteJob).toHaveBeenCalledWith(
        expect.anything(), // supabase client
        'job-123',
        expect.objectContaining({ maxPages: 50, rateLimitMs: 750 })
      )
    })

    it('does not reject the HTTP response even if executeJob throws', async () => {
      mockExecuteJob.mockRejectedValue(new Error('Crawl failed catastrophically'))

      // Allow the rejected promise to be caught in the fire-and-forget handler
      const response = await POST(makeRequest(), makeParams('client-1'))
      await new Promise((r) => setTimeout(r, 10))

      expect(response.status).toBe(201)
    })
  })

  // =========================================================================
  // Suite 7: Error handling — 500 paths
  // =========================================================================

  describe('Suite 7: Error handling', () => {
    it('returns 500 when supabase throws an unexpected error fetching client', async () => {
      vi.mocked(supabaseAdmin.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockRejectedValue(new Error('DB connection lost')),
          }),
        }),
      } as any)

      const response = await POST(makeRequest(), makeParams('client-1'))

      expect(response.status).toBe(500)
    })

    it('returns 500 when createJob throws', async () => {
      mockCreateJob.mockRejectedValue(new Error('Insert failed'))

      const response = await POST(makeRequest(), makeParams('client-1'))

      expect(response.status).toBe(500)
    })

    it('returns 500 when failJob throws during force=true flow', async () => {
      const existingJob = { ...VALID_JOB, id: 'existing-job-456', status: 'in_progress' as const }
      mockGetInProgressJob.mockResolvedValue(existingJob)
      mockFailJob.mockRejectedValue(new Error('Cannot mark job as failed'))

      const response = await POST(makeRequest({ force: true }), makeParams('client-1'))

      expect(response.status).toBe(500)
    })

    it('returns 400 for invalid JSON body', async () => {
      const url = 'http://localhost/api/clients/client-1/site-audit/crawl'
      const badRequest = new NextRequest(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{ invalid json :::',
      })

      const response = await POST(badRequest, makeParams('client-1'))

      expect(response.status).toBe(400)
    })
  })
})
