/**
 * Tests for POST /api/cms/github/webhook (B3 — GEO PR merge tracking)
 *
 * Coverage:
 *   1. ping event → 200 pong
 *   2. non-PR event → 200 ignored
 *   3. invalid HMAC signature → 401
 *   4. missing GITHUB_WEBHOOK_SECRET → 401
 *   5. PR closed but not merged → 200 ignored
 *   6. Blog PR merged → 200 success + blog_post_id
 *   7. GEO-only PR merged (no blog_post match) → 200 ignored + geo_deployments_merged=N
 *   8. PR merged matching both blog + GEO → 200 success + geo_deployments_merged=N
 *   9. blog_posts lookup error → 500
 *  10. blog_posts update error → 500
 *  11. markMergedByPr throws → 200 (best-effort, still processes blog)
 *  12. invalid JSON body → 400
 */

import { createHmac } from 'crypto'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

vi.mock('@/lib/google-oauth/client', () => ({
  getValidAccessToken: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/gsc/indexing-client', () => ({
  requestIndexing: vi.fn().mockResolvedValue({ ok: false, errorMsg: 'not supported' }),
}))

vi.mock('@/lib/gsc/sitemap-ping', () => ({
  pingSitemap:              vi.fn().mockResolvedValue({ attempted: false, reason: 'test' }),
  buildSitemapUrlFromDomain: vi.fn().mockReturnValue(null),
}))

vi.mock('@/lib/cms/geo-deployments-store', () => ({
  markMergedByPr: vi.fn().mockResolvedValue(0),
}))

import { POST } from '../route'
import { supabaseAdmin } from '@/lib/supabase'
import { markMergedByPr } from '@/lib/cms/geo-deployments-store'

// ── Helpers ───────────────────────────────────────────────────────────────────

const SECRET = 'test-webhook-secret'

function sign(body: string): string {
  return 'sha256=' + createHmac('sha256', SECRET).update(body, 'utf8').digest('hex')
}

function makeRequest(body: object, opts: {
  eventType?: string
  signature?: string | null
  rawBody?: string
} = {}) {
  const raw = opts.rawBody ?? JSON.stringify(body)
  const sig = opts.signature !== undefined
    ? opts.signature
    : sign(raw)

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-github-event': opts.eventType ?? 'pull_request',
  }
  if (sig !== null) headers['x-hub-signature-256'] = sig

  return new NextRequest('http://localhost/api/cms/github/webhook', {
    method: 'POST',
    headers,
    body: raw,
  })
}

function makePrEvent(action: string, merged: boolean, prNumber = 42, prUrl = 'https://github.com/acme/repo/pull/42') {
  return {
    action,
    pull_request: {
      number:    prNumber,
      html_url:  prUrl,
      merged,
      merged_at: merged ? '2026-06-04T12:00:00Z' : null,
    },
    repository: { full_name: 'acme/repo' },
  }
}

function mockBlogLookup(rows: object[], error?: string) {
  const chain = {
    select:   vi.fn().mockReturnThis(),
    eq:       vi.fn().mockReturnThis(),
    // supabase returns the array directly (no maybeSingle for this query)
    then:     undefined as unknown,
  }
  // The route uses the promise directly from .eq() chain — simulate that
  const result = { data: rows, error: error ? { message: error } : null }
  ;(chain.eq as ReturnType<typeof vi.fn>).mockResolvedValue(result)
  vi.mocked(supabaseAdmin.from).mockReturnValue(chain as unknown as ReturnType<typeof supabaseAdmin.from>)
}

function mockBlogLookupThenUpdate(
  lookupRows: object[],
  updateError?: string,
) {
  // first call → lookup, second call → update, third call → client domain
  const lookupChain = {
    select:   vi.fn().mockReturnThis(),
    eq:       vi.fn().mockResolvedValue({ data: lookupRows, error: null }),
  }
  const updateChain = {
    update: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockResolvedValue({
      data:  null,
      error: updateError ? { message: updateError } : null,
    }),
  }
  const clientChain = {
    select:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  }
  let callCount = 0
  vi.mocked(supabaseAdmin.from).mockImplementation(() => {
    callCount++
    if (callCount === 1) return lookupChain as unknown as ReturnType<typeof supabaseAdmin.from>
    if (callCount === 2) return updateChain as unknown as ReturnType<typeof supabaseAdmin.from>
    return clientChain as unknown as ReturnType<typeof supabaseAdmin.from>
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('github webhook route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('GITHUB_WEBHOOK_SECRET', SECRET)
    vi.mocked(markMergedByPr).mockResolvedValue(0)
  })

  // 1. Ping
  it('returns 200 pong for ping event', async () => {
    const body = { zen: 'Keep it logically awesome.', hook_id: 1 }
    const req = makeRequest(body, { eventType: 'ping' })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json() as { pong: boolean }
    expect(json.pong).toBe(true)
  })

  // 2. Non-PR event
  it('returns 200 ignored for non-pull_request events', async () => {
    const body = { ref: 'refs/heads/main' }
    const req = makeRequest(body, { eventType: 'push' })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json() as { ignored: string }
    expect(json.ignored).toMatch(/event=push/)
  })

  // 3. Invalid signature
  it('returns 401 for invalid HMAC signature', async () => {
    const body = makePrEvent('closed', true)
    const req = makeRequest(body, { signature: 'sha256=badhash' })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  // 4. Missing secret
  it('returns 401 when GITHUB_WEBHOOK_SECRET is not set', async () => {
    vi.stubEnv('GITHUB_WEBHOOK_SECRET', '')
    const body = makePrEvent('closed', true)
    const req = makeRequest(body)
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  // 5. PR closed but not merged
  it('returns 200 ignored when PR is closed without merging', async () => {
    const body = makePrEvent('closed', false)
    const req = makeRequest(body)
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json() as { ignored: string }
    expect(json.ignored).toBe('not a merge')
    // Should not touch DB at all
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  // 6. Blog PR merged
  it('updates blog_post to published when blog PR is merged', async () => {
    const PR_URL = 'https://github.com/acme/repo/pull/42'
    const body = makePrEvent('closed', true, 42, PR_URL)
    mockBlogLookupThenUpdate([
      { id: 'post1', client_id: 'client1', slug: 'my-post', pr_url: PR_URL, pr_number: 42, status: 'draft' },
    ])
    const req = makeRequest(body)
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json() as { success: boolean; blog_post_id: string; geo_deployments_merged: number }
    expect(json.success).toBe(true)
    expect(json.blog_post_id).toBe('post1')
    expect(json.geo_deployments_merged).toBe(0)
  })

  // 7. GEO-only PR merged (no blog match)
  it('returns 200 with geo_deployments_merged when GEO PR merged and no blog match', async () => {
    const PR_URL = 'https://github.com/acme/repo/pull/99'
    const body = makePrEvent('closed', true, 99, PR_URL)
    vi.mocked(markMergedByPr).mockResolvedValue(2)
    mockBlogLookup([])  // no blog_posts match

    const req = makeRequest(body)
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json() as { ignored: string; geo_deployments_merged: number }
    expect(json.ignored).toBe('no matching blog_post')
    expect(json.geo_deployments_merged).toBe(2)
    expect(vi.mocked(markMergedByPr)).toHaveBeenCalledWith(99, PR_URL)
  })

  // 8. PR matched by both blog + GEO (unusual but valid)
  it('processes both blog update and GEO merge for same PR', async () => {
    const PR_URL = 'https://github.com/acme/repo/pull/55'
    const body = makePrEvent('closed', true, 55, PR_URL)
    vi.mocked(markMergedByPr).mockResolvedValue(1)
    mockBlogLookupThenUpdate([
      { id: 'post2', client_id: 'client2', slug: 'geo-blog', pr_url: PR_URL, pr_number: 55, status: 'draft' },
    ])

    const req = makeRequest(body)
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json() as { success: boolean; geo_deployments_merged: number }
    expect(json.success).toBe(true)
    expect(json.geo_deployments_merged).toBe(1)
  })

  // 9. blog_posts lookup error
  it('returns 500 when blog_posts lookup fails', async () => {
    const body = makePrEvent('closed', true)
    mockBlogLookup([], 'db timeout')

    const req = makeRequest(body)
    const res = await POST(req)
    expect(res.status).toBe(500)
  })

  // 10. blog_posts update error
  it('returns 500 when blog_posts update fails', async () => {
    const PR_URL = 'https://github.com/acme/repo/pull/42'
    const body = makePrEvent('closed', true, 42, PR_URL)
    mockBlogLookupThenUpdate(
      [{ id: 'post1', client_id: 'c1', slug: 'slug', pr_url: PR_URL, pr_number: 42, status: 'draft' }],
      'update failed',
    )

    const req = makeRequest(body)
    const res = await POST(req)
    expect(res.status).toBe(500)
  })

  // 11. markMergedByPr throws — best-effort, blog still processed
  it('still processes blog PR when markMergedByPr throws', async () => {
    const PR_URL = 'https://github.com/acme/repo/pull/42'
    const body = makePrEvent('closed', true, 42, PR_URL)
    vi.mocked(markMergedByPr).mockRejectedValue(new Error('DB blip'))
    mockBlogLookupThenUpdate([
      { id: 'post3', client_id: 'c3', slug: 'slug3', pr_url: PR_URL, pr_number: 42, status: 'draft' },
    ])

    const req = makeRequest(body)
    const res = await POST(req)
    // Should still succeed — markMergedByPr failure is swallowed
    expect(res.status).toBe(200)
    const json = await res.json() as { success: boolean }
    expect(json.success).toBe(true)
  })

  // 12. Invalid JSON
  it('returns 400 for invalid JSON body', async () => {
    const raw = '{ not valid json'
    const req = makeRequest({}, { rawBody: raw, signature: sign(raw) })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
