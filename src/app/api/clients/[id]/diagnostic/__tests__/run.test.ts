import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.hoisted ensures variables are available at factory time
// ---------------------------------------------------------------------------

const {
  mockIsValidModule,
  mockCreateDiagnosticRun,
  mockExecuteDiagnosticRun,
} = vi.hoisted(() => ({
  mockIsValidModule: vi.fn(),
  mockCreateDiagnosticRun: vi.fn(),
  mockExecuteDiagnosticRun: vi.fn(),
}))

vi.mock('@/lib/diagnostic/runner', () => ({
  isValidModule: mockIsValidModule,
  createDiagnosticRun: mockCreateDiagnosticRun,
  executeDiagnosticRun: mockExecuteDiagnosticRun,
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { POST } from '../run/route'
import { GET as getLatest } from '../latest/route'
import { GET as getRuns } from '../runs/route'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

const mockAccess = vi.mocked(requireDashboardClientAccess)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CLIENT_ID = 'client-abc'

function allowAccess() {
  mockAccess.mockResolvedValue({ ok: true, user: { email: 'test@test.com' } as never, role: 'admin', allowedClientId: null })
}

function denyAccess() {
  mockAccess.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' })
}

function makeRequest(method: string, body?: unknown): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' }

  return new NextRequest(`http://localhost/api/clients/${CLIENT_ID}/diagnostic/run`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

const PARAMS = { params: { id: CLIENT_ID } }

// ---------------------------------------------------------------------------
// POST /diagnostic/run
// ---------------------------------------------------------------------------

describe('POST /api/clients/[id]/diagnostic/run', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsValidModule.mockReturnValue(true)
    mockCreateDiagnosticRun.mockResolvedValue('run-new-123')
    mockExecuteDiagnosticRun.mockResolvedValue(undefined)
    allowAccess()
  })

  it('returns 401 when no session', async () => {
    denyAccess()
    const req = makeRequest('POST', { module: 'seo' })
    const res = await POST(req, PARAMS)
    expect(res.status).toBe(401)
    const json = await res.json() as { error: string }
    expect(json.error).toBeDefined()
  })

  it('returns 400 for missing module field', async () => {
    mockIsValidModule.mockReturnValue(false)
    const req = makeRequest('POST', {})
    const res = await POST(req, PARAMS)
    expect(res.status).toBe(400)
    const json = await res.json() as { success: boolean }
    expect(json.success).toBe(false)
  })

  it('returns 400 for unsupported module value', async () => {
    mockIsValidModule.mockReturnValue(false)
    const req = makeRequest('POST', { module: 'ads' })
    const res = await POST(req, PARAMS)
    expect(res.status).toBe(400)
  })

  it('returns 202 with run_id for valid request', async () => {
    const req = makeRequest('POST', { module: 'seo' })
    const res = await POST(req, PARAMS)
    expect(res.status).toBe(202)
    const json = await res.json() as { success: boolean; run_id: string }
    expect(json.success).toBe(true)
    expect(json.run_id).toBe('run-new-123')
  })

  it('calls createDiagnosticRun with correct clientId and module', async () => {
    const req = makeRequest('POST', { module: 'seo' })
    await POST(req, PARAMS)
    expect(mockCreateDiagnosticRun).toHaveBeenCalledWith(
      expect.anything(),
      CLIENT_ID,
      'seo',
    )
  })

  it('fires executeDiagnosticRun in background (does not await)', async () => {
    let resolveExec!: () => void
    mockExecuteDiagnosticRun.mockReturnValue(
      new Promise<void>(resolve => { resolveExec = resolve }),
    )
    const req = makeRequest('POST', { module: 'seo' })
    const res = await POST(req, PARAMS)
    expect(res.status).toBe(202)
    resolveExec()
  })
})

// ---------------------------------------------------------------------------
// GET /diagnostic/latest
// ---------------------------------------------------------------------------

describe('GET /api/clients/[id]/diagnostic/latest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    allowAccess()
  })

  it('returns 401 when no session', async () => {
    denyAccess()
    const req = makeRequest('GET')
    const res = await getLatest(req, PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 404 when no completed run exists', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      }),
    } as never)

    const req = makeRequest('GET')
    const res = await getLatest(req, PARAMS)
    expect(res.status).toBe(404)
    const json = await res.json() as { success: boolean }
    expect(json.success).toBe(false)
  })

  it('returns 200 with run and findings when a completed run exists', async () => {
    const fakeRun = { id: 'run-xyz', client_id: CLIENT_ID, status: 'completed' }
    const fakeFindings = [{ id: 'f-1', finding_type: 'low_domain_rank', priority_score: 75 }]

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'diagnostic_runs') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: [fakeRun], error: null }),
                }),
              }),
            }),
          }),
        } as never
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: fakeFindings }),
          }),
        }),
      } as never
    })

    const req = makeRequest('GET')
    const res = await getLatest(req, PARAMS)
    expect(res.status).toBe(200)
    const json = await res.json() as { success: boolean; run: unknown; findings: unknown[] }
    expect(json.success).toBe(true)
    expect(json.run).toEqual(fakeRun)
    expect(json.findings).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// GET /diagnostic/runs
// ---------------------------------------------------------------------------

describe('GET /api/clients/[id]/diagnostic/runs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    allowAccess()
  })

  it('returns 401 when no session', async () => {
    denyAccess()
    const req = makeRequest('GET')
    const res = await getRuns(req, PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 200 with empty array when client has no runs', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      }),
    } as never)

    const req = makeRequest('GET')
    const res = await getRuns(req, PARAMS)
    expect(res.status).toBe(200)
    const json = await res.json() as { success: boolean; runs: unknown[] }
    expect(json.success).toBe(true)
    expect(json.runs).toHaveLength(0)
  })

  it('returns 200 with list of runs ordered by created_at desc', async () => {
    const fakeRuns = [
      { id: 'run-2', status: 'completed', created_at: '2026-05-13T10:00:00Z' },
      { id: 'run-1', status: 'completed', created_at: '2026-05-12T10:00:00Z' },
    ]
    vi.mocked(supabaseAdmin.from).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: fakeRuns, error: null }),
          }),
        }),
      }),
    } as never)

    const req = makeRequest('GET')
    const res = await getRuns(req, PARAMS)
    expect(res.status).toBe(200)
    const json = await res.json() as { success: boolean; runs: { id: string }[] }
    expect(json.runs).toHaveLength(2)
    expect(json.runs[0].id).toBe('run-2')
  })
})
