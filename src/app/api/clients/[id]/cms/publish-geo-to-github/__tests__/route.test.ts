/**
 * Tests for POST /api/clients/[id]/cms/publish-geo-to-github (B2 template-injection rev)
 *
 * Coverage:
 *   1. Auth guard → 403
 *   2. No GitHub connection → 422 NO_CONNECTION
 *   3. Connection not verified → 422 CONNECTION_NOT_VERIFIED
 *   4. No content_targets configured → 422 NO_TARGETS_CONFIGURED
 *   5. No active directive → 404 NO_DIRECTIVE
 *   6. Template file missing in repo → 422 TEMPLATE_NOT_FOUND
 *   7. Template has no </head> → 422 HEAD_TAG_NOT_FOUND
 *   8. Drift detected (no force_overwrite) → 422 EXTERNAL_DRIFT + drifted_targets
 *   9. Drift with force_overwrite=true → 200 (proceeds)
 *  10. Happy path single target → 200 + commitFile called + recordDeployment
 *  11. Happy path multi target → 200 + commitFile called per target
 *  12. Stale blobSha (GitHub 409) → 409 STALE_BLOB_SHA
 *  13. Closes stale PR before opening new one
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: vi.fn().mockResolvedValue({ ok: true, user: { id: 'test-user', email: 'test@magiclab.com' }, role: 'admin', tier: 'admin', allowedClientId: null }),
  requirePaidClientAccess: vi.fn().mockResolvedValue({ ok: true, user: { id: 'test-user', email: 'test@magiclab.com' }, role: 'admin', tier: 'admin', allowedClientId: null }),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

vi.mock('@/lib/cms/connection-store', () => ({
  getConnection: vi.fn(),
}))

vi.mock('@/lib/cms/geo-deployments-store', async () => {
  // Re-export the real ConcurrentDeploymentError class — route uses
  // `instanceof` for branching, so a vi.fn() stub would break that.
  const actual = await vi.importActual<typeof import('@/lib/cms/geo-deployments-store')>('@/lib/cms/geo-deployments-store')
  return {
    ConcurrentDeploymentError: actual.ConcurrentDeploymentError,
    findLatestLiveDeployment:  vi.fn(),
    findOpenDeployment:        vi.fn(),
    markSuperseded:            vi.fn(),
    recordDeployment:          vi.fn(),
  }
})

vi.mock('@/lib/geo/html-generator', () => ({
  generateDirectiveHtml: vi.fn(() => '<script>GEO</script>'),
}))

vi.mock('@/lib/cms/github-client', () => {
  const mockClient = {
    getRepo:           vi.fn(),
    getFileContent:    vi.fn(),
    getBranchSha:      vi.fn(),
    createBranch:      vi.fn(),
    commitFile:        vi.fn(),
    createPullRequest: vi.fn(),
    closePullRequest:  vi.fn(),
    deleteBranch:      vi.fn(),
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
import { requireDashboardClientAccess, requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { getConnection } from '@/lib/cms/connection-store'
import {
  findLatestLiveDeployment,
  findOpenDeployment,
  markSuperseded,
  recordDeployment,
} from '@/lib/cms/geo-deployments-store'
import * as githubClientModule from '@/lib/cms/github-client'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGh = (githubClientModule as any).__mockClient as {
  getFileContent:    ReturnType<typeof vi.fn>
  getBranchSha:      ReturnType<typeof vi.fn>
  createBranch:      ReturnType<typeof vi.fn>
  commitFile:        ReturnType<typeof vi.fn>
  createPullRequest: ReturnType<typeof vi.fn>
  closePullRequest:  ReturnType<typeof vi.fn>
  deleteBranch:      ReturnType<typeof vi.fn>
}

const CLIENT_ID = 'client-abc'
const DIRECTIVE_ID = '12345678-abcd-0000-0000-000000000000'

const HTML_TEMPLATE = `<!DOCTYPE html>
<html>
<head>
  <title>Acme</title>
</head>
<body>Hello</body>
</html>`

function makeRequest(body: object = {}) {
  return new NextRequest(`http://localhost/api/clients/${CLIENT_ID}/cms/publish-geo-to-github`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeContext() {
  return { params: { id: CLIENT_ID } }
}

function mockAuth(ok: boolean) {
  vi.mocked(requirePaidClientAccess).mockResolvedValue(
    ok ? ({ ok: true, clientId: CLIENT_ID } as unknown as Awaited<ReturnType<typeof requireDashboardClientAccess>>)
       : ({ ok: false, error: 'Unauthorized', status: 403 } as unknown as Awaited<ReturnType<typeof requireDashboardClientAccess>>),
  )
}

function mockDirective(rows: unknown[] | null, error?: string) {
  const chain = {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data:  rows ? rows[0] ?? null : null,
      error: error ? { message: error } : null,
    }),
  }
  vi.mocked(supabaseAdmin.from).mockReturnValue(chain as unknown as ReturnType<typeof supabaseAdmin.from>)
}

const CONN_WITH_TARGETS = {
  plainToken:     'ghp_test',
  repoOwner:      'acme',
  repoName:       'website',
  branch:         'main',
  status:         'connected' as const,
  connected:      true,
  provider:       'github' as const,
  tokenHint:      'oken',
  lastError:      null,
  lastTestedAt:   null,
  contentTargets: [
    { path: 'layouts/main.html', syntax: 'html' as const, role: 'global_head' as const },
  ],
}

const CONN_NO_TARGETS = {
  ...CONN_WITH_TARGETS,
  contentTargets: [],
}

const CONN_MULTI_TARGETS = {
  ...CONN_WITH_TARGETS,
  contentTargets: [
    { path: 'layouts/main.html', syntax: 'html' as const, role: 'global_head' as const },
    { path: 'header.php',         syntax: 'php' as const,  role: 'global_head' as const },
  ],
}

const DIRECTIVE_ROW = {
  id:        DIRECTIVE_ID,
  client_id: CLIENT_ID,
  status:    'active',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGh.getFileContent.mockResolvedValue({
    sha:            'blobsha123',
    content:        Buffer.from(HTML_TEMPLATE, 'utf8').toString('base64'),
    size:           HTML_TEMPLATE.length,
    decodedContent: HTML_TEMPLATE,
  })
  mockGh.getBranchSha.mockResolvedValue('basesha1234')
  mockGh.createBranch.mockResolvedValue(undefined)
  mockGh.commitFile.mockResolvedValue(undefined)
  mockGh.createPullRequest.mockResolvedValue({
    number:   42,
    html_url: 'https://github.com/acme/website/pull/42',
    title:    'GEO Directive',
  })
  vi.mocked(findLatestLiveDeployment).mockResolvedValue(null)
  vi.mocked(findOpenDeployment).mockResolvedValue(null)
  vi.mocked(recordDeployment).mockResolvedValue({
    id:            'dep1',
    client_id:     CLIENT_ID,
    directive_id:  DIRECTIVE_ID,
    target_path:   'layouts/main.html',
    branch:        'geo-directive/12345678-x',
    pr_number:     42,
    pr_url:        'https://github.com/acme/website/pull/42',
    injected_hash: 'h',
    status:        'pending_pr',
    created_at:    '',
    updated_at:    '',
  })
})

describe('publish-geo-to-github route (B2)', () => {
  it('returns 403 when auth fails', async () => {
    mockAuth(false)
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(403)
  })

  it('returns 422 NO_CONNECTION when no GitHub conn', async () => {
    mockAuth(true)
    vi.mocked(getConnection).mockResolvedValue(null)
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(422)
    expect((await res.json() as { code: string }).code).toBe('NO_CONNECTION')
  })

  it('returns 422 CONNECTION_NOT_VERIFIED', async () => {
    mockAuth(true)
    vi.mocked(getConnection).mockResolvedValue({ ...CONN_WITH_TARGETS, status: 'error', connected: false })
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(422)
    expect((await res.json() as { code: string }).code).toBe('CONNECTION_NOT_VERIFIED')
  })

  it('returns 422 NO_TARGETS_CONFIGURED when content_targets is empty', async () => {
    mockAuth(true)
    vi.mocked(getConnection).mockResolvedValue(CONN_NO_TARGETS)
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(422)
    expect((await res.json() as { code: string }).code).toBe('NO_TARGETS_CONFIGURED')
  })

  it('returns 404 NO_DIRECTIVE', async () => {
    mockAuth(true)
    vi.mocked(getConnection).mockResolvedValue(CONN_WITH_TARGETS)
    mockDirective([])
    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(404)
    expect((await res.json() as { code: string }).code).toBe('NO_DIRECTIVE')
  })

  it('returns 422 TEMPLATE_NOT_FOUND when target file missing', async () => {
    mockAuth(true)
    vi.mocked(getConnection).mockResolvedValue(CONN_WITH_TARGETS)
    mockDirective([DIRECTIVE_ROW])
    const { GitHubApiError } = await import('@/lib/cms/github-client')
    mockGh.getFileContent.mockRejectedValue(new GitHubApiError(404, 'Not Found'))

    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(422)
    expect((await res.json() as { code: string }).code).toBe('TEMPLATE_NOT_FOUND')
  })

  it('returns 422 HEAD_TAG_NOT_FOUND when template lacks </head>', async () => {
    mockAuth(true)
    vi.mocked(getConnection).mockResolvedValue(CONN_WITH_TARGETS)
    mockDirective([DIRECTIVE_ROW])
    const BAD = '<html><body>No head</body></html>'
    mockGh.getFileContent.mockResolvedValue({
      sha:            'blobsha',
      content:        Buffer.from(BAD, 'utf8').toString('base64'),
      size:           BAD.length,
      decodedContent: BAD,
    })

    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(422)
    expect((await res.json() as { code: string }).code).toBe('HEAD_TAG_NOT_FOUND')
  })

  it('returns 422 EXTERNAL_DRIFT when live hash ≠ recorded hash and no force', async () => {
    mockAuth(true)
    vi.mocked(getConnection).mockResolvedValue(CONN_WITH_TARGETS)
    mockDirective([DIRECTIVE_ROW])
    // Pre-existing block in template with content X; recorded hash = different
    const TEMPLATE_WITH_BLOCK = `<html><head>
<!-- ME-GEO-START (do not edit between these markers — managed by Magic Engine) -->
<script>OLD</script>
<!-- ME-GEO-END -->
</head><body></body></html>`
    mockGh.getFileContent.mockResolvedValue({
      sha: 'b',
      content: Buffer.from(TEMPLATE_WITH_BLOCK, 'utf8').toString('base64'),
      size: TEMPLATE_WITH_BLOCK.length,
      decodedContent: TEMPLATE_WITH_BLOCK,
    })
    vi.mocked(findLatestLiveDeployment).mockResolvedValue({
      id:            'dep0',
      client_id:     CLIENT_ID,
      directive_id:  DIRECTIVE_ID,
      target_path:   'layouts/main.html',
      branch:        'old-branch',
      pr_number:     1,
      pr_url:        'u',
      injected_hash: 'recorded_hash_does_not_match_live',
      status:        'merged',
      created_at:    '',
      updated_at:    '',
    })

    const res = await POST(makeRequest({}), makeContext())
    expect(res.status).toBe(422)
    const body = await res.json() as { code: string; drifted_targets: Array<{ path: string }> }
    expect(body.code).toBe('EXTERNAL_DRIFT')
    expect(body.drifted_targets).toHaveLength(1)
    expect(body.drifted_targets[0]?.path).toBe('layouts/main.html')
    // GitHub should NOT have been touched
    expect(mockGh.createBranch).not.toHaveBeenCalled()
  })

  it('proceeds when force_overwrite=true despite drift', async () => {
    mockAuth(true)
    vi.mocked(getConnection).mockResolvedValue(CONN_WITH_TARGETS)
    mockDirective([DIRECTIVE_ROW])
    const TEMPLATE_WITH_BLOCK = `<html><head>
<!-- ME-GEO-START (do not edit between these markers — managed by Magic Engine) -->
<script>EVIL</script>
<!-- ME-GEO-END -->
</head><body></body></html>`
    mockGh.getFileContent.mockResolvedValue({
      sha: 'b',
      content: Buffer.from(TEMPLATE_WITH_BLOCK, 'utf8').toString('base64'),
      size: TEMPLATE_WITH_BLOCK.length,
      decodedContent: TEMPLATE_WITH_BLOCK,
    })
    vi.mocked(findLatestLiveDeployment).mockResolvedValue({
      id:            'dep0',
      client_id:     CLIENT_ID,
      directive_id:  DIRECTIVE_ID,
      target_path:   'layouts/main.html',
      branch:        'old',
      pr_number:     1,
      pr_url:        'u',
      injected_hash: 'no_match',
      status:        'merged',
      created_at:    '',
      updated_at:    '',
    })

    const res = await POST(makeRequest({ force_overwrite: true }), makeContext())
    expect(res.status).toBe(200)
    expect(mockGh.createBranch).toHaveBeenCalled()
  })

  it('happy path: single target — opens PR + commits + records', async () => {
    mockAuth(true)
    vi.mocked(getConnection).mockResolvedValue(CONN_WITH_TARGETS)
    mockDirective([DIRECTIVE_ROW])

    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(200)
    const body = await res.json() as { success: boolean; pr_url: string; target_paths: string[] }
    expect(body.success).toBe(true)
    expect(body.target_paths).toEqual(['layouts/main.html'])
    expect(mockGh.commitFile).toHaveBeenCalledTimes(1)
    // commitFile gets blobSha threaded for the GitHub If-Match guard
    expect(mockGh.commitFile.mock.calls[0]).toEqual(expect.arrayContaining(['blobsha123']))
    expect(vi.mocked(recordDeployment)).toHaveBeenCalledTimes(1)
  })

  it('happy path: multi target — commits per target', async () => {
    mockAuth(true)
    vi.mocked(getConnection).mockResolvedValue(CONN_MULTI_TARGETS)
    mockDirective([DIRECTIVE_ROW])

    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(200)
    expect(mockGh.commitFile).toHaveBeenCalledTimes(2)
    expect(vi.mocked(recordDeployment)).toHaveBeenCalledTimes(2)
  })

  it('returns 409 STALE_BLOB_SHA when GitHub rejects commit due to sha mismatch', async () => {
    mockAuth(true)
    vi.mocked(getConnection).mockResolvedValue(CONN_WITH_TARGETS)
    mockDirective([DIRECTIVE_ROW])
    const { GitHubApiError } = await import('@/lib/cms/github-client')
    mockGh.commitFile.mockRejectedValue(new GitHubApiError(409, 'sha does not match'))

    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(409)
    expect((await res.json() as { code: string }).code).toBe('STALE_BLOB_SHA')
  })

  // ── MF must-fix companion tests ───────────────────────────────────────────

  it('MF1: returns 422 SNIPPET_CONTAINS_MARKER when directive HTML smuggles a marker', async () => {
    mockAuth(true)
    vi.mocked(getConnection).mockResolvedValue(CONN_WITH_TARGETS)
    mockDirective([DIRECTIVE_ROW])

    // Make generateDirectiveHtml return a payload that includes our START marker
    const { generateDirectiveHtml } = await import('@/lib/geo/html-generator')
    vi.mocked(generateDirectiveHtml).mockReturnValueOnce(
      '<script>x</script><!-- ME-GEO-START (do not edit between these markers — managed by Magic Engine) -->',
    )

    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(422)
    expect((await res.json() as { code: string }).code).toBe('SNIPPET_CONTAINS_MARKER')
    expect(mockGh.createBranch).not.toHaveBeenCalled()
  })

  it('MF2: half-built branch is deleted when commitFile fails mid-loop', async () => {
    mockAuth(true)
    vi.mocked(getConnection).mockResolvedValue(CONN_MULTI_TARGETS)
    mockDirective([DIRECTIVE_ROW])
    const { GitHubApiError } = await import('@/lib/cms/github-client')
    // First commit succeeds, second fails with a non-sha error
    mockGh.commitFile
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new GitHubApiError(502, 'Bad Gateway'))

    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(502)
    // The route must clean up the orphan branch
    expect(mockGh.deleteBranch).toHaveBeenCalledWith('acme', 'website', expect.stringMatching(/^geo-directive\//))
  })

  it('MF3: markSuperseded throw is swallowed (still returns 200)', async () => {
    mockAuth(true)
    vi.mocked(getConnection).mockResolvedValue(CONN_WITH_TARGETS)
    mockDirective([DIRECTIVE_ROW])
    vi.mocked(findOpenDeployment).mockResolvedValue({
      id:            'stale1',
      client_id:     CLIENT_ID,
      directive_id:  DIRECTIVE_ID,
      target_path:   'layouts/main.html',
      branch:        'geo-directive/old',
      pr_number:     10,
      pr_url:        'u',
      injected_hash: 'h',
      status:        'pending_pr',
      created_at:    '',
      updated_at:    '',
    })
    vi.mocked(markSuperseded).mockRejectedValue(new Error('DB blip'))

    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(200)
    // close+delete still executed
    expect(mockGh.closePullRequest).toHaveBeenCalled()
    expect(mockGh.deleteBranch).toHaveBeenCalledWith('acme', 'website', 'geo-directive/old')
  })

  it('MF4: orphan ME-GEO block (lastDeployment=null) routes to drift', async () => {
    mockAuth(true)
    vi.mocked(getConnection).mockResolvedValue(CONN_WITH_TARGETS)
    mockDirective([DIRECTIVE_ROW])
    const ORPHAN_TEMPLATE = `<html><head>
<!-- ME-GEO-START (do not edit between these markers — managed by Magic Engine) -->
<script>ORPHAN</script>
<!-- ME-GEO-END -->
</head><body></body></html>`
    mockGh.getFileContent.mockResolvedValue({
      sha:            'b',
      content:        Buffer.from(ORPHAN_TEMPLATE, 'utf8').toString('base64'),
      size:           ORPHAN_TEMPLATE.length,
      decodedContent: ORPHAN_TEMPLATE,
    })
    // No DB record for this target — that's the orphan case
    vi.mocked(findLatestLiveDeployment).mockResolvedValue(null)

    const res = await POST(makeRequest({}), makeContext())
    expect(res.status).toBe(422)
    const body = await res.json() as { code: string; drifted_targets: Array<{ path: string; expected_hash: string }> }
    expect(body.code).toBe('EXTERNAL_DRIFT')
    expect(body.drifted_targets[0]?.expected_hash).toBe('orphan_no_record')
    // No GitHub mutation on drift
    expect(mockGh.createBranch).not.toHaveBeenCalled()
  })

  it('MF4: orphan block proceeds when force_overwrite=true', async () => {
    mockAuth(true)
    vi.mocked(getConnection).mockResolvedValue(CONN_WITH_TARGETS)
    mockDirective([DIRECTIVE_ROW])
    const ORPHAN_TEMPLATE = `<html><head>
<!-- ME-GEO-START (do not edit between these markers — managed by Magic Engine) -->
<script>ORPHAN</script>
<!-- ME-GEO-END -->
</head><body></body></html>`
    mockGh.getFileContent.mockResolvedValue({
      sha:            'b',
      content:        Buffer.from(ORPHAN_TEMPLATE, 'utf8').toString('base64'),
      size:           ORPHAN_TEMPLATE.length,
      decodedContent: ORPHAN_TEMPLATE,
    })
    vi.mocked(findLatestLiveDeployment).mockResolvedValue(null)

    const res = await POST(makeRequest({ force_overwrite: true }), makeContext())
    expect(res.status).toBe(200)
    expect(mockGh.commitFile).toHaveBeenCalled()
  })

  it('MF5: when closePullRequest fails (non-404), deleteBranch is skipped', async () => {
    mockAuth(true)
    vi.mocked(getConnection).mockResolvedValue(CONN_WITH_TARGETS)
    mockDirective([DIRECTIVE_ROW])
    vi.mocked(findOpenDeployment).mockResolvedValue({
      id:            'stale1',
      client_id:     CLIENT_ID,
      directive_id:  DIRECTIVE_ID,
      target_path:   'layouts/main.html',
      branch:        'geo-directive/old',
      pr_number:     10,
      pr_url:        'u',
      injected_hash: 'h',
      status:        'pending_pr',
      created_at:    '',
      updated_at:    '',
    })
    const { GitHubApiError } = await import('@/lib/cms/github-client')
    mockGh.closePullRequest.mockRejectedValueOnce(new GitHubApiError(500, 'rate limit'))

    const res = await POST(makeRequest(), makeContext())
    // Main publish still succeeds (close stale is best-effort)
    expect(res.status).toBe(200)
    // Critical: branch must NOT have been deleted when close failed
    expect(mockGh.deleteBranch).not.toHaveBeenCalledWith('acme', 'website', 'geo-directive/old')
  })

  it('MF6: ConcurrentDeploymentError from recordDeployment → 422 CONCURRENT_PUBLISH_IN_PROGRESS', async () => {
    mockAuth(true)
    vi.mocked(getConnection).mockResolvedValue(CONN_WITH_TARGETS)
    mockDirective([DIRECTIVE_ROW])
    const { ConcurrentDeploymentError } = await import('@/lib/cms/geo-deployments-store')
    vi.mocked(recordDeployment).mockRejectedValueOnce(new ConcurrentDeploymentError())

    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(422)
    expect((await res.json() as { code: string }).code).toBe('CONCURRENT_PUBLISH_IN_PROGRESS')
    // The rollback path must close the PR + delete the branch we just opened
    expect(mockGh.closePullRequest).toHaveBeenCalled()
    expect(mockGh.deleteBranch).toHaveBeenCalled()
  })

  it('MF7: PR body does NOT contain the raw clientId UUID', async () => {
    mockAuth(true)
    vi.mocked(getConnection).mockResolvedValue(CONN_WITH_TARGETS)
    mockDirective([DIRECTIVE_ROW])

    await POST(makeRequest(), makeContext())
    const prCall = mockGh.createPullRequest.mock.calls[0] as [unknown, unknown, { body: string }]
    const prBody = prCall[2].body
    expect(prBody).not.toContain(CLIENT_ID)
    // shortId is OK to include
    expect(prBody).toContain(DIRECTIVE_ID.slice(0, 8))
  })

  it('closes stale PR + supersedes row before opening new PR', async () => {
    mockAuth(true)
    vi.mocked(getConnection).mockResolvedValue(CONN_WITH_TARGETS)
    mockDirective([DIRECTIVE_ROW])
    vi.mocked(findOpenDeployment).mockResolvedValue({
      id:            'stale1',
      client_id:     CLIENT_ID,
      directive_id:  DIRECTIVE_ID,
      target_path:   'layouts/main.html',
      branch:        'geo-directive/old',
      pr_number:     10,
      pr_url:        'u',
      injected_hash: 'h',
      status:        'pending_pr',
      created_at:    '',
      updated_at:    '',
    })

    const res = await POST(makeRequest(), makeContext())
    expect(res.status).toBe(200)
    expect(mockGh.closePullRequest).toHaveBeenCalledWith('acme', 'website', 10)
    expect(mockGh.deleteBranch).toHaveBeenCalledWith('acme', 'website', 'geo-directive/old')
    expect(vi.mocked(markSuperseded)).toHaveBeenCalledWith('stale1')
  })
})
