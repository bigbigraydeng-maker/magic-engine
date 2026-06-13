/**
 * Tests for POST /api/clients/[id]/cms/wordpress/lookup-post  [P12.R.M3]
 *
 * Covers:
 *   1. Auth guard
 *   2. Input validation (url/post_id mutex; bad target_type; bad post_id)
 *   3. Connection failures
 *   4. Lookup by URL → success
 *   5. Lookup by URL → not found (404)
 *   6. Lookup by post_id → success
 *   7. WAF / WP error code → HTTP status mapping
 *   8. same_host flag in response
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: vi.fn(),
}))

vi.mock('@/lib/cms/connection-store', () => ({
  getWordpressConnection: vi.fn(),
}))

vi.mock('@/lib/cms/wordpress-client', async () => {
  const real = await vi.importActual<typeof import('@/lib/cms/wordpress-client')>('@/lib/cms/wordpress-client')
  return {
    ...real,
    getExistingWordpressPost: vi.fn(),
    findWordpressPostByUrl:   vi.fn(),
  }
})

import { POST } from '../route'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { getWordpressConnection } from '@/lib/cms/connection-store'
import {
  getExistingWordpressPost,
  findWordpressPostByUrl,
  WordpressFetchError,
  type ExistingWordpressPost,
} from '@/lib/cms/wordpress-client'

const mockAuth     = vi.mocked(requirePaidClientAccess)
const mockGetConn  = vi.mocked(getWordpressConnection)
const mockGetById  = vi.mocked(getExistingWordpressPost)
const mockFindUrl  = vi.mocked(findWordpressPostByUrl)

const CLIENT_ID = '11111111-1111-1111-1111-111111111111'

const MOCK_CONN = {
  siteUrl:          'https://oztop.com.au',
  username:         'me',
  plainAppPassword: 'pw',
  status:           'connected',
} as unknown as Awaited<ReturnType<typeof getWordpressConnection>>

const MOCK_POST: ExistingWordpressPost = {
  postId:         123,
  postType:       'post',
  title:          'Tile Sizes Explained',
  slug:           'tile-sizes-explained',
  excerpt:        'Old',
  content:        '<p>Body</p>',
  status:         'publish',
  link:           'https://oztop.com.au/tile-sizes-explained/',
  modified:       '2026-06-10T00:00:00',
  seoTitle:       'Yoast Title',
  seoDescription: 'Yoast Desc',
  focusKeyphrase: 'tile sizes',
}

const CTX = { params: { id: CLIENT_ID } }

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(
    `http://localhost:3001/api/clients/${CLIENT_ID}/cms/wordpress/lookup-post`,
    { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } },
  )
}

describe('POST /api/clients/[id]/cms/wordpress/lookup-post', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.resetAllMocks()
  })

  // ── Auth ────────────────────────────────────────────────────────────────────

  it('returns 403 when caller cannot access client', async () => {
    mockAuth.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' } as unknown as Awaited<ReturnType<typeof requirePaidClientAccess>>)
    const res = await POST(makeRequest({ url: 'https://oztop.com.au/x/' }), CTX)
    expect(res.status).toBe(403)
  })

  // ── Input validation ────────────────────────────────────────────────────────

  describe('input validation', () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue({ ok: true } as unknown as Awaited<ReturnType<typeof requirePaidClientAccess>>)
    })

    it('400 when both url and post_id are absent', async () => {
      const res = await POST(makeRequest({}), CTX)
      expect(res.status).toBe(400)
    })

    it('400 when both url AND post_id are provided', async () => {
      const res = await POST(makeRequest({ url: 'https://x/', post_id: 1 }), CTX)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/either.*or/i)
    })

    it.each([0, -1, 1.5])('400 when post_id is %p', async (badId) => {
      const res = await POST(makeRequest({ post_id: badId }), CTX)
      expect(res.status).toBe(400)
    })

    it('400 when url is empty string', async () => {
      const res = await POST(makeRequest({ url: '   ' }), CTX)
      expect(res.status).toBe(400)
    })

    it('400 when target_type is invalid', async () => {
      const res = await POST(makeRequest({ post_id: 1, target_type: 'media' }), CTX)
      expect(res.status).toBe(400)
    })

    it('400 when body is not valid JSON', async () => {
      const badReq = new NextRequest(
        `http://localhost:3001/api/clients/${CLIENT_ID}/cms/wordpress/lookup-post`,
        { method: 'POST', body: 'oops', headers: { 'Content-Type': 'application/json' } },
      )
      const res = await POST(badReq, CTX)
      expect(res.status).toBe(400)
    })
  })

  // ── Connection failures ─────────────────────────────────────────────────────

  describe('connection failures', () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue({ ok: true } as unknown as Awaited<ReturnType<typeof requirePaidClientAccess>>)
    })

    it('422 NO_CONNECTION when there is no WP connection', async () => {
      mockGetConn.mockResolvedValue(null)
      const res = await POST(makeRequest({ url: 'https://x/y/' }), CTX)
      expect(res.status).toBe(422)
      expect((await res.json()).code).toBe('NO_CONNECTION')
    })

    it('422 CONNECTION_NOT_VERIFIED when status is not connected', async () => {
      mockGetConn.mockResolvedValue({ ...MOCK_CONN, status: 'error' } as unknown as Awaited<ReturnType<typeof getWordpressConnection>>)
      const res = await POST(makeRequest({ url: 'https://x/y/' }), CTX)
      expect(res.status).toBe(422)
      expect((await res.json()).code).toBe('CONNECTION_NOT_VERIFIED')
    })
  })

  // ── Lookup by URL ───────────────────────────────────────────────────────────

  describe('lookup by URL', () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue({ ok: true } as unknown as Awaited<ReturnType<typeof requirePaidClientAccess>>)
      mockGetConn.mockResolvedValue(MOCK_CONN)
    })

    it('returns 200 + post + same_host=true when URL matches', async () => {
      mockFindUrl.mockResolvedValue({ post: MOCK_POST, meta: { searchedAs: 'post', postsTried: 1, pagesTried: 0 } })

      const res = await POST(makeRequest({ url: 'https://oztop.com.au/tile-sizes-explained/' }), CTX)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.post.postId).toBe(123)
      expect(body.same_host).toBe(true)
    })

    it('returns same_host=false when URL host differs from siteUrl', async () => {
      mockFindUrl.mockResolvedValue({ post: MOCK_POST, meta: { searchedAs: 'post', postsTried: 1, pagesTried: 0 } })

      const res = await POST(makeRequest({ url: 'https://wrong.example.com/tile-sizes-explained/' }), CTX)
      expect(res.status).toBe(200)
      expect((await res.json()).same_host).toBe(false)
    })

    it('404 when neither posts nor pages match', async () => {
      mockFindUrl.mockResolvedValue({ post: null, meta: { searchedAs: 'both', postsTried: 0, pagesTried: 0 } })

      const res = await POST(makeRequest({ url: 'https://oztop.com.au/missing/' }), CTX)
      expect(res.status).toBe(404)
      expect((await res.json()).code).toBe('NOT_FOUND')
    })
  })

  // ── Lookup by post_id ───────────────────────────────────────────────────────

  describe('lookup by post_id', () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue({ ok: true } as unknown as Awaited<ReturnType<typeof requirePaidClientAccess>>)
      mockGetConn.mockResolvedValue(MOCK_CONN)
    })

    it('passes target_type=page through to getExistingWordpressPost', async () => {
      mockGetById.mockResolvedValue({ ...MOCK_POST, postType: 'page' })
      const res = await POST(makeRequest({ post_id: 7, target_type: 'page' }), CTX)
      expect(res.status).toBe(200)
      expect(mockGetById).toHaveBeenCalledWith(expect.anything(), 7, 'page')
    })

    it('defaults target_type to "post" when omitted', async () => {
      mockGetById.mockResolvedValue(MOCK_POST)
      await POST(makeRequest({ post_id: 123 }), CTX)
      expect(mockGetById).toHaveBeenCalledWith(expect.anything(), 123, 'post')
    })
  })

  // ── WAF / error mapping ─────────────────────────────────────────────────────

  describe('error mapping', () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue({ ok: true } as unknown as Awaited<ReturnType<typeof requirePaidClientAccess>>)
      mockGetConn.mockResolvedValue(MOCK_CONN)
    })

    it('SITEGROUND_ANTIBOT → 502', async () => {
      mockFindUrl.mockRejectedValue(new WordpressFetchError('blocked', 'SITEGROUND_ANTIBOT', 403, 'redirect'))
      const res = await POST(makeRequest({ url: 'https://oztop.com.au/x/' }), CTX)
      expect(res.status).toBe(502)
      expect((await res.json()).code).toBe('SITEGROUND_ANTIBOT')
    })

    it('TIMEOUT → 504', async () => {
      mockGetById.mockRejectedValue(new WordpressFetchError('timeout', 'TIMEOUT'))
      const res = await POST(makeRequest({ post_id: 9 }), CTX)
      expect(res.status).toBe(504)
    })

    it('HTTP_ERROR with httpStatus 404 → 404 (id not found upstream)', async () => {
      mockGetById.mockRejectedValue(new WordpressFetchError('not found', 'HTTP_ERROR', 404))
      const res = await POST(makeRequest({ post_id: 999_999 }), CTX)
      expect(res.status).toBe(404)
    })
  })
})
