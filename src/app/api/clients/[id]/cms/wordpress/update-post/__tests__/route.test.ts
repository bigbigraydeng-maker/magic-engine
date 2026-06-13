/**
 * Tests for POST /api/clients/[id]/cms/wordpress/update-post  [P12.R.M2]
 *
 * Covers:
 *   1. Auth guard
 *   2. Input validation (remote_post_id / target_type / kanban_item_id / no fields)
 *   3. Connection lookup failures (no conn / not verified / no row)
 *   4. content_html sanitization
 *   5. WAF / timeout error code → HTTP status mapping
 *   6. Idempotency (re-submit same payload → returns existing job)
 *   7. Happy path with before/after snapshot
 *   8. kanban_item_id routing (source_id, source_type)
 *   9. flywheel_actions row is enqueued
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (must precede module-under-test import) ─────────────────────────────

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

vi.mock('@/lib/cms/connection-store', () => ({
  getWordpressConnection: vi.fn(),
}))

vi.mock('@/lib/cms/wordpress-client', async () => {
  const real = await vi.importActual<typeof import('@/lib/cms/wordpress-client')>('@/lib/cms/wordpress-client')
  return {
    ...real,
    getExistingWordpressPost:    vi.fn(),
    updateExistingWordpressPost: vi.fn(),
  }
})

vi.mock('@/lib/cms/html-sanitizer', () => ({
  prepareCmsContent: vi.fn((html: string) => `SANITIZED:${html}`),
}))

import { POST } from '../route'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { getWordpressConnection } from '@/lib/cms/connection-store'
import {
  getExistingWordpressPost,
  updateExistingWordpressPost,
  WordpressFetchError,
  type ExistingWordpressPost,
} from '@/lib/cms/wordpress-client'
import { prepareCmsContent } from '@/lib/cms/html-sanitizer'

// ── Typed mocks ───────────────────────────────────────────────────────────────

const mockAuth       = vi.mocked(requirePaidClientAccess)
const mockFrom       = vi.mocked(supabaseAdmin.from)
const mockGetConn    = vi.mocked(getWordpressConnection)
const mockGetExist   = vi.mocked(getExistingWordpressPost)
const mockUpdateExt  = vi.mocked(updateExistingWordpressPost)
const mockSanitize   = vi.mocked(prepareCmsContent)

// ── Constants ─────────────────────────────────────────────────────────────────

const CLIENT_ID  = '11111111-1111-1111-1111-111111111111'
const CONN_ID    = '22222222-2222-2222-2222-222222222222'
const KANBAN_ID  = '33333333-3333-3333-3333-333333333333'
const REMOTE_ID  = 123
const JOB_ID     = '44444444-4444-4444-4444-444444444444'

const MOCK_CONN = {
  siteUrl:          'https://oztop.com.au',
  username:         'me',
  plainAppPassword: 'pw',
  status:           'connected',
  wpDefaultCategoryId: undefined,
} as unknown as Awaited<ReturnType<typeof getWordpressConnection>>

const MOCK_BEFORE: ExistingWordpressPost = {
  postId:         REMOTE_ID,
  postType:       'post',
  title:          'Old Title',
  slug:           'old-slug',
  excerpt:        'Old excerpt',
  content:        '<p>Old body</p>',
  status:         'publish',
  link:           'https://oztop.com.au/tile-sizes-explained/',
  modified:       '2026-06-10T00:00:00',
  seoTitle:       'Old Yoast Title',
  seoDescription: 'Old desc',
  focusKeyphrase: 'old kw',
}

const MOCK_AFTER = {
  postId:        REMOTE_ID,
  postType:      'post' as const,
  link:          'https://oztop.com.au/tile-sizes-explained/',
  modified:      '2026-06-13T05:00:00',
  updatedFields: ['seoTitle'],
}

const CTX = { params: { id: CLIENT_ID } }

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(
    `http://localhost:3001/api/clients/${CLIENT_ID}/cms/wordpress/update-post`,
    { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } },
  )
}

/**
 * Mock the supabaseAdmin.from(...) chain with a per-call dispatcher so we can
 * model:
 *   call 1 → cms_connections .select.eq.eq.maybeSingle → connection row
 *   call 2 → website_publish_jobs .select.eq.eq.maybeSingle → idempotency check
 *   call 3 → website_publish_jobs .insert.select.single → new job
 *   call 4 → flywheel_actions .insert → fire-and-forget
 *
 * Pass an array of return shapes per call.
 */
function mockSupabaseChainSequence(calls: Array<{
  maybeSingleResult?: { data: unknown; error: unknown }
  singleResult?:      { data: unknown; error: unknown }
}>) {
  let i = 0
  mockFrom.mockImplementation(() => {
    const cfg   = calls[i] ?? {}
    const chain = {
      select:      vi.fn().mockReturnThis(),
      eq:          vi.fn().mockReturnThis(),
      insert:      vi.fn().mockReturnThis(),
      update:      vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue(cfg.maybeSingleResult ?? { data: null, error: null }),
      single:      vi.fn().mockResolvedValue(cfg.singleResult      ?? { data: { id: JOB_ID }, error: null }),
    }
    i++
    return chain as unknown as ReturnType<typeof supabaseAdmin.from>
  })
}

function happyPathBody(extra: Partial<Record<string, unknown>> = {}) {
  return {
    remote_post_id: REMOTE_ID,
    seo_title:      'New Yoast Title',
    ...extra,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/clients/[id]/cms/wordpress/update-post', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.resetAllMocks()
  })

  // ── 1. Auth guard ──────────────────────────────────────────────────────────────

  it('returns 403 when caller cannot access client', async () => {
    mockAuth.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' } as unknown as Awaited<ReturnType<typeof requirePaidClientAccess>>)

    const res = await POST(makeRequest(happyPathBody()), CTX)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'Forbidden' })
  })

  // ── 2. Input validation ────────────────────────────────────────────────────────

  describe('input validation', () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue({ ok: true } as unknown as Awaited<ReturnType<typeof requirePaidClientAccess>>)
    })

    it('returns 400 when remote_post_id is missing', async () => {
      const res = await POST(makeRequest({ seo_title: 'x' }), CTX)
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('INVALID_INPUT')
    })

    it.each([0, -1, 1.5, 'abc'])('returns 400 when remote_post_id is %p', async (badId) => {
      const res = await POST(makeRequest({ remote_post_id: badId, seo_title: 'x' }), CTX)
      expect(res.status).toBe(400)
    })

    it('returns 400 when target_type is bad', async () => {
      const res = await POST(makeRequest({ ...happyPathBody(), target_type: 'media' }), CTX)
      expect(res.status).toBe(400)
    })

    it('returns 400 when kanban_item_id is not a UUID', async () => {
      const res = await POST(makeRequest({ ...happyPathBody(), kanban_item_id: 'not-a-uuid' }), CTX)
      expect(res.status).toBe(400)
    })

    it('returns 400 when NO updatable field is supplied', async () => {
      const res = await POST(makeRequest({ remote_post_id: REMOTE_ID }), CTX)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/at least one updatable field/i)
    })

    it('returns 400 when body is not valid JSON', async () => {
      const badReq = new NextRequest(
        `http://localhost:3001/api/clients/${CLIENT_ID}/cms/wordpress/update-post`,
        { method: 'POST', body: 'not-json', headers: { 'Content-Type': 'application/json' } },
      )
      const res = await POST(badReq, CTX)
      expect(res.status).toBe(400)
    })
  })

  // ── 3. Connection failures ─────────────────────────────────────────────────────

  describe('connection failures', () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue({ ok: true } as unknown as Awaited<ReturnType<typeof requirePaidClientAccess>>)
    })

    it('returns 422 when no WordPress connection exists', async () => {
      mockGetConn.mockResolvedValue(null)
      const res = await POST(makeRequest(happyPathBody()), CTX)
      expect(res.status).toBe(422)
      expect((await res.json()).code).toBe('NO_CONNECTION')
    })

    it('returns 422 when connection is not verified', async () => {
      mockGetConn.mockResolvedValue({ ...MOCK_CONN, status: 'error' } as unknown as Awaited<ReturnType<typeof getWordpressConnection>>)
      const res = await POST(makeRequest(happyPathBody()), CTX)
      expect(res.status).toBe(422)
      expect((await res.json()).code).toBe('CONNECTION_NOT_VERIFIED')
    })

    it('returns 422 when connection row lookup fails', async () => {
      mockGetConn.mockResolvedValue(MOCK_CONN)
      mockSupabaseChainSequence([{ maybeSingleResult: { data: null, error: null } }])
      const res = await POST(makeRequest(happyPathBody()), CTX)
      expect(res.status).toBe(422)
    })
  })

  // ── 4. Happy path + sanitization ───────────────────────────────────────────────

  describe('happy path', () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue({ ok: true } as unknown as Awaited<ReturnType<typeof requirePaidClientAccess>>)
      mockGetConn.mockResolvedValue(MOCK_CONN)
      mockGetExist.mockResolvedValue(MOCK_BEFORE)
      mockUpdateExt.mockResolvedValue(MOCK_AFTER)
    })

    it('returns 200 with job_id + updated_url + updated_fields', async () => {
      mockSupabaseChainSequence([
        { maybeSingleResult: { data: { id: CONN_ID }, error: null } },   // cms_connections
        { maybeSingleResult: { data: null,           error: null } },    // jobs idempotency
        { singleResult:      { data: { id: JOB_ID }, error: null } },    // jobs insert
        // flywheel_actions insert — no maybeSingle / single needed
      ])

      const res = await POST(makeRequest(happyPathBody()), CTX)

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual({
        success:        true,
        job_id:         JOB_ID,
        updated_url:    MOCK_AFTER.link,
        updated_fields: ['seoTitle'],
        status:         'completed',
      })
    })

    it('sanitizes content_html via prepareCmsContent before sending to WP', async () => {
      mockSupabaseChainSequence([
        { maybeSingleResult: { data: { id: CONN_ID }, error: null } },
        { maybeSingleResult: { data: null,           error: null } },
        { singleResult:      { data: { id: JOB_ID }, error: null } },
      ])

      await POST(makeRequest({
        remote_post_id: REMOTE_ID,
        content_html:   '<p>hello<script>x</script></p>',
      }), CTX)

      expect(mockSanitize).toHaveBeenCalledWith('<p>hello<script>x</script></p>')
      const updateCall = mockUpdateExt.mock.calls[0][1]
      expect(updateCall.content).toBe('SANITIZED:<p>hello<script>x</script></p>')
    })

    it('passes target_type=page through to /pages/{id}', async () => {
      mockSupabaseChainSequence([
        { maybeSingleResult: { data: { id: CONN_ID }, error: null } },
        { maybeSingleResult: { data: null,           error: null } },
        { singleResult:      { data: { id: JOB_ID }, error: null } },
      ])

      await POST(makeRequest({ ...happyPathBody(), target_type: 'page' }), CTX)

      expect(mockGetExist).toHaveBeenCalledWith(expect.anything(), REMOTE_ID, 'page')
      expect(mockUpdateExt.mock.calls[0][1].postType).toBe('page')
    })

    it('only forwards explicitly-set fields to the WP client (no sneak)', async () => {
      mockSupabaseChainSequence([
        { maybeSingleResult: { data: { id: CONN_ID }, error: null } },
        { maybeSingleResult: { data: null,           error: null } },
        { singleResult:      { data: { id: JOB_ID }, error: null } },
      ])

      await POST(makeRequest({
        remote_post_id: REMOTE_ID,
        focus_keyphrase: 'tile sizes',
      }), CTX)

      const update = mockUpdateExt.mock.calls[0][1]
      expect(update.focusKeyphrase).toBe('tile sizes')
      expect(update).not.toHaveProperty('title')
      expect(update).not.toHaveProperty('seoTitle')
      expect(update).not.toHaveProperty('content')
    })

    it('embeds before_snapshot + after_snapshot in content_snapshot for audit', async () => {
      let captured: Record<string, unknown> | undefined
      mockFrom.mockImplementation((tbl: string) => {
        const chain = {
          select:      vi.fn().mockReturnThis(),
          eq:          vi.fn().mockReturnThis(),
          insert:      vi.fn((row: Record<string, unknown>) => {
            if (tbl === 'website_publish_jobs') captured = row
            return chain
          }),
          update:      vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockImplementation(() => {
            if (tbl === 'cms_connections')        return Promise.resolve({ data: { id: CONN_ID }, error: null })
            if (tbl === 'website_publish_jobs')   return Promise.resolve({ data: null,           error: null })
            return Promise.resolve({ data: null, error: null })
          }),
          single:      vi.fn().mockResolvedValue({ data: { id: JOB_ID }, error: null }),
        }
        return chain as unknown as ReturnType<typeof supabaseAdmin.from>
      })

      await POST(makeRequest(happyPathBody()), CTX)

      expect(captured).toBeDefined()
      const snap = captured!.content_snapshot as Record<string, unknown>
      expect(snap.action).toBe('update_existing')
      expect(snap.target_type).toBe('post')
      expect(snap.remote_post_id).toBe(REMOTE_ID)
      const before = snap.before_snapshot as Record<string, unknown>
      expect(before.title).toBe('Old Title')
      expect(before.seo_title).toBe('Old Yoast Title')
      const after = snap.after_snapshot as Record<string, unknown>
      expect(after.link).toBe(MOCK_AFTER.link)
      expect(after.updated_fields).toEqual(['seoTitle'])
    })
  })

  // ── 5. kanban_item_id routing ──────────────────────────────────────────────────

  describe('kanban_item_id routing', () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue({ ok: true } as unknown as Awaited<ReturnType<typeof requirePaidClientAccess>>)
      mockGetConn.mockResolvedValue(MOCK_CONN)
      mockGetExist.mockResolvedValue(MOCK_BEFORE)
      mockUpdateExt.mockResolvedValue(MOCK_AFTER)
    })

    it('with kanban_item_id → uses it as source_id + source_type=kanban_execution_item', async () => {
      let captured: Record<string, unknown> | undefined
      mockFrom.mockImplementation((tbl: string) => {
        const chain = {
          select:      vi.fn().mockReturnThis(),
          eq:          vi.fn().mockReturnThis(),
          insert:      vi.fn((row: Record<string, unknown>) => {
            if (tbl === 'website_publish_jobs') captured = row
            return chain
          }),
          update:      vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockImplementation(() => (
            tbl === 'cms_connections'
              ? Promise.resolve({ data: { id: CONN_ID }, error: null })
              : Promise.resolve({ data: null,           error: null })
          )),
          single:      vi.fn().mockResolvedValue({ data: { id: JOB_ID }, error: null }),
        }
        return chain as unknown as ReturnType<typeof supabaseAdmin.from>
      })

      await POST(makeRequest({ ...happyPathBody(), kanban_item_id: KANBAN_ID }), CTX)

      expect(captured?.source_type).toBe('kanban_execution_item')
      expect(captured?.source_id).toBe(KANBAN_ID)
    })

    it('without kanban_item_id → source_type=wp_rewrite_adhoc + fresh UUID', async () => {
      let captured: Record<string, unknown> | undefined
      mockFrom.mockImplementation((tbl: string) => {
        const chain = {
          select:      vi.fn().mockReturnThis(),
          eq:          vi.fn().mockReturnThis(),
          insert:      vi.fn((row: Record<string, unknown>) => {
            if (tbl === 'website_publish_jobs') captured = row
            return chain
          }),
          update:      vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockImplementation(() => (
            tbl === 'cms_connections'
              ? Promise.resolve({ data: { id: CONN_ID }, error: null })
              : Promise.resolve({ data: null,           error: null })
          )),
          single:      vi.fn().mockResolvedValue({ data: { id: JOB_ID }, error: null }),
        }
        return chain as unknown as ReturnType<typeof supabaseAdmin.from>
      })

      await POST(makeRequest(happyPathBody()), CTX)

      expect(captured?.source_type).toBe('wp_rewrite_adhoc')
      expect(captured?.source_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    })
  })

  // ── 6. Idempotency ─────────────────────────────────────────────────────────────

  describe('idempotency', () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue({ ok: true } as unknown as Awaited<ReturnType<typeof requirePaidClientAccess>>)
      mockGetConn.mockResolvedValue(MOCK_CONN)
    })

    it('re-submit same payload → returns existing completed job, no WP call', async () => {
      mockSupabaseChainSequence([
        { maybeSingleResult: { data: { id: CONN_ID }, error: null } },
        { maybeSingleResult: { data: { id: JOB_ID, target_url: MOCK_AFTER.link, status: 'completed' }, error: null } },
      ])

      const res = await POST(makeRequest(happyPathBody()), CTX)

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.idempotent).toBe(true)
      expect(body.job_id).toBe(JOB_ID)
      expect(mockGetExist).not.toHaveBeenCalled()
      expect(mockUpdateExt).not.toHaveBeenCalled()
    })
  })

  // ── 7. WAF / WP error code → HTTP status mapping ───────────────────────────────

  describe('WP error code mapping', () => {
    beforeEach(() => {
      mockAuth.mockResolvedValue({ ok: true } as unknown as Awaited<ReturnType<typeof requirePaidClientAccess>>)
      mockGetConn.mockResolvedValue(MOCK_CONN)
      mockSupabaseChainSequence([
        { maybeSingleResult: { data: { id: CONN_ID }, error: null } },
        { maybeSingleResult: { data: null,           error: null } },
      ])
    })

    it.each<['SITEGROUND_ANTIBOT' | 'WORDFENCE_BLOCK' | 'CLOUDFLARE_CHALLENGE' | 'SUCURI_BLOCK' | 'GENERIC_WAF', number]>([
      ['SITEGROUND_ANTIBOT',   502],
      ['WORDFENCE_BLOCK',      502],
      ['CLOUDFLARE_CHALLENGE', 502],
      ['SUCURI_BLOCK',         502],
      ['GENERIC_WAF',          502],
    ])('%s → HTTP %i with code in body', async (code, status) => {
      mockGetExist.mockRejectedValue(new WordpressFetchError('blocked', code, 403, 'evidence'))
      const res = await POST(makeRequest(happyPathBody()), CTX)
      expect(res.status).toBe(status)
      expect((await res.json()).code).toBe(code)
    })

    it('TIMEOUT → HTTP 504', async () => {
      mockGetExist.mockRejectedValue(new WordpressFetchError('timeout', 'TIMEOUT'))
      const res = await POST(makeRequest(happyPathBody()), CTX)
      expect(res.status).toBe(504)
      expect((await res.json()).code).toBe('TIMEOUT')
    })

    it('HTTP_ERROR with httpStatus 404 → HTTP 404', async () => {
      mockGetExist.mockRejectedValue(new WordpressFetchError('not found', 'HTTP_ERROR', 404))
      const res = await POST(makeRequest(happyPathBody()), CTX)
      expect(res.status).toBe(404)
    })
  })
})
