import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// Mock the persistor + advanced agent so no real work fires.
const mockCreateDiscoveryJob = vi.fn()
const mockGetLatestDiscovery = vi.fn()

vi.mock('../persistor', () => ({
  createDiscoveryJob: (...a: unknown[]) => mockCreateDiscoveryJob(...a),
  getLatestDiscovery: (...a: unknown[]) => mockGetLatestDiscovery(...a),
  failJob: vi.fn(),
  mergeAdvancedPayload: vi.fn(),
  updateJobProgress: vi.fn(),
}))
vi.mock('../advanced-agent', () => ({ runZhangqianAdvanced: vi.fn().mockResolvedValue({}) }))

import { startAdvancedDiscovery } from '../start-advanced-discovery'

const CLIENT_ID = 'c1'

/**
 * Supabase mock: `clients` returns a record; `client_discovery_jobs` returns
 * whatever `inFlight` is configured to (the dedup lookup uses maybeSingle).
 */
function makeSupabase(inFlight: { id: string } | null): SupabaseClient {
  return {
    from: vi.fn((table: string) => {
      if (table === 'clients') {
        return {
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { id: CLIENT_ID, domain: 'x.co.nz' }, error: null }) }) }),
        }
      }
      // client_discovery_jobs — the in-flight dedup lookup chain.
      return {
        select: () => ({ eq: () => ({ eq: () => ({ in: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: inFlight, error: null }) }) }) }) }) }),
      }
    }),
  } as unknown as SupabaseClient
}

describe('startAdvancedDiscovery — cost-DoS dedup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetLatestDiscovery.mockResolvedValue({ payload: {} })
    mockCreateDiscoveryJob.mockResolvedValue('new-job-1')
  })

  it('reuses an in-flight advanced job instead of enqueuing another (no double-spend)', async () => {
    const supabase = makeSupabase({ id: 'inflight-job-9' })

    const result = await startAdvancedDiscovery(supabase, CLIENT_ID, { triggeredBy: 'test' })

    expect(result.jobId).toBe('inflight-job-9')
    expect(mockCreateDiscoveryJob).not.toHaveBeenCalled() // <-- the anti-DoS assertion
  })

  it('enqueues a new job when nothing is in flight', async () => {
    const supabase = makeSupabase(null)

    const result = await startAdvancedDiscovery(supabase, CLIENT_ID, { triggeredBy: 'test' })

    expect(result.jobId).toBe('new-job-1')
    expect(mockCreateDiscoveryJob).toHaveBeenCalledOnce()
  })
})
