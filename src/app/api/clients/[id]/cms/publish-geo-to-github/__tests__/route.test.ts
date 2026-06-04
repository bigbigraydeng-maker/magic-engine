/**
 * Tests for POST /api/clients/[id]/cms/publish-geo-to-github
 *
 * Covers:
 *   1. Auth guard → 403
 *   2. No GitHub connection → 422
 *   3. Connection not verified → 422
 *   4. No active GEO directive → 404
 *   5. Happy path → 200 + pr_url + pr_number
 *   6. Branch already exists (GitHub 422) → 409
 *   7. Generic GitHub API error → 502
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

vi.mock('@/lib/cms/connection-store', () => ({
  getConnection: vi.fn(),
}))

vi.mock('@/lib/geo/html-generator', () => ({
  generateDirectiveHtml: vi.fn(() => '<div>GEO snippet</div>'),
}))

vi.mock('@/lib/cms/github-client', () => {
  const mockClient = {
    getBranchSha:      vi.fn(),
    createBranch:      vi.fn(),
    commitFile:        vi.fn(),
    createPullRequest: vi.fn(),
  }
  return {
    GithubClient:   vi.fn(() => mockClient),
    GitHubApiError: class GitHubApiError extends Error {
      status: number
      constructor(status: number, message: string) {
        super(`GitHub API ${status}: ${message}`)
        this.name   = 'GitHubApiError'
        this.status = status
      }
    },
    __mockClient: mockClient,
  }
})

import { POST } from '../route'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { getConnection } from '@/lib/cms/connection-store'
import * as githubClientModule from '@/lib/cms/github-client'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGh = (githubClientModule as any).__mockClient as {
  getBranchSha:      ReturnType<typeof vi.fn>
  createBranch:      ReturnType<typeof vi.fn>
  commitFile:        ReturnType<typeof vi.fn>
  createPullRequest: ReturnType<typeof vi.fn>
}

const CLIENT_ID = 'client-abc'
const DIRECTIVE_ID = '12345678-abcd-0000-0000-000000000000'

function makeRequest() {
  return new NextRequest(`http://localhost/api/clients/${CLIENT_ID}/cms/publish-geo-to-github`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
}

function makeContext() {
  return { params: { id: CLIENT_ID } }
}

function mockAuth(ok: boolean) {
  vi.mocked(requireDashboardClientAccess).mockResolvedValue(
    ok ? ({ ok: true, clientId: CLIENT_ID } as unknown as Awaited<ReturnType<typeof requireDashboardClientAccess>>)
       : ({ ok: false, error: 'Unauthorized', status: 403 } as unknown as Awaited<ReturnType<typeof requireDashboardClientAccess>>),
  )
}

function mockDirective(rows: unknown[] | null, error?: string) {
  const chain = {
    select:     vi.fn().mockReturnThis(),
    eq:         vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data:  rows ? rows[0] ?? null : null,
      error: error ? { message: error } : null,
    }),
  }
  vi.mocked(supabaseAdmin.from).mockReturnValue(chain as unknown as ReturnType<typeof supabaseAdmin.from>)
}

const GOOD_CONN = {
  plainToken:     'ghp_testtoken',
  repoOwner:      'acme',
  repoName:       'website',
  branch:         'main',
  status:         'connected' as const,
  connected:      true,
  provider:       'github' as const,
  tokenHint:      'oken',
  lastError:      null,
  lastTestedAt:   null,
  contentTargets: [],
}

const DIRECTIVE_ROW = {
  id:        DIRECTIVE_ID,
  client_id: CLIENT_ID,
  status:    'active',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGh.getBranchSha.mockResolvedValue('abc123sha')
  mockGh.createBranch.mockResolvedValue(undefined)
  mockGh.commitFile.mockResolvedValue(undefined)
  mockGh.createPullRequest.mockResolvedValue({ number: 42, html_url: 'https://github.com/acme/website/pull/42', title: 'GEO Directive' })
})

describe('POST /api/clients/[id]/cms/publish-geo-to-github', () => {
  it('returns 403 when auth fails', async () => {
    mockAuth(false)
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(403)
  })

  it('returns 422 when no GitHub connection exists', async () => {
    mockAuth(true)
    vi.mocked(getConnection).mockResolvedValue(null)
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(422)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('NO_CONNECTION')
  })

  it('returns 422 when connection is not verified', async () => {
    mockAuth(true)
    vi.mocked(getConnection).mockResolvedValue({ ...GOOD_CONN, status: 'error', connected: false })
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(422)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('CONNECTION_NOT_VERIFIED')
  })

  it('returns 404 when no active directive exists', async () => {
    mockAuth(true)
    vi.mocked(getConnection).mockResolvedValue(GOOD_CONN)
    mockDirective([])
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(404)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('NO_DIRECTIVE')
  })

  it('returns 200 with pr_url on happy path', async () => {
    mockAuth(true)
    vi.mocked(getConnection).mockResolvedValue(GOOD_CONN)
    mockDirective([DIRECTIVE_ROW])

    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(200)
    const body = await res.json() as { success: boolean; pr_url: string; pr_number: number; branch: string }
    expect(body.success).toBe(true)
    expect(body.pr_url).toBe('https://github.com/acme/website/pull/42')
    expect(body.pr_number).toBe(42)
    expect(body.branch).toMatch(/^geo-directive\//)

    // Verify GitHub API calls
    expect(mockGh.getBranchSha).toHaveBeenCalledWith('acme', 'website', 'main')
    expect(mockGh.createBranch).toHaveBeenCalled()
    expect(mockGh.commitFile).toHaveBeenCalled()
    expect(mockGh.createPullRequest).toHaveBeenCalled()
  })

  it('returns 409 when branch already exists (GitHub 422)', async () => {
    mockAuth(true)
    vi.mocked(getConnection).mockResolvedValue(GOOD_CONN)
    mockDirective([DIRECTIVE_ROW])

    const { GitHubApiError } = await import('@/lib/cms/github-client')
    mockGh.createBranch.mockRejectedValue(new GitHubApiError(422, 'Reference already exists'))

    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(409)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('BRANCH_EXISTS')
  })

  it('returns 502 on generic GitHub API error', async () => {
    mockAuth(true)
    vi.mocked(getConnection).mockResolvedValue(GOOD_CONN)
    mockDirective([DIRECTIVE_ROW])

    const { GitHubApiError } = await import('@/lib/cms/github-client')
    mockGh.getBranchSha.mockRejectedValue(new GitHubApiError(401, 'Bad credentials'))

    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(502)
    const body = await res.json() as { code: string }
    expect(body.code).toBe('GITHUB_API_ERROR')
  })
})
