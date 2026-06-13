/**
 * Tests for GET /api/clients/[id]/cms/wordpress/theme-uppercase-check  [P12.R.A8]
 *
 * 1. Auth guard
 * 2. No WP connection → success:true + uppercase:null + warning
 * 3. Connection not verified → success:true + uppercase:null + warning
 * 4. Happy path uppercase=true → remediation hint included
 * 5. Happy path uppercase=false → remediation:null
 * 6. detectThemeUppercase throws → success:true + warning, never 500s
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (before module-under-test import) ───────────────────────────────────

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: vi.fn(),
}))

vi.mock('@/lib/cms/connection-store', () => ({
  getWordpressConnection: vi.fn(),
}))

vi.mock('@/lib/cms/theme-text-transform-check', () => ({
  detectThemeUppercase: vi.fn(),
}))

import { GET } from '../route'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { getWordpressConnection } from '@/lib/cms/connection-store'
import { detectThemeUppercase } from '@/lib/cms/theme-text-transform-check'

const mockAuth   = vi.mocked(requirePaidClientAccess)
const mockConn   = vi.mocked(getWordpressConnection)
const mockDetect = vi.mocked(detectThemeUppercase)

const CLIENT_ID = '11111111-1111-1111-1111-111111111111'
const CTX = { params: { id: CLIENT_ID } }

const MOCK_CONN = {
  siteUrl:          'https://oztop.com.au',
  username:         'me',
  plainAppPassword: 'pw',
  status:           'connected',
} as unknown as Awaited<ReturnType<typeof getWordpressConnection>>

function makeRequest(): NextRequest {
  return new NextRequest(
    `http://localhost:3001/api/clients/${CLIENT_ID}/cms/wordpress/theme-uppercase-check`,
    { method: 'GET' },
  )
}

describe('GET /api/clients/[id]/cms/wordpress/theme-uppercase-check', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.resetAllMocks()
  })

  it('returns 403 when caller cannot access client', async () => {
    mockAuth.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' } as unknown as Awaited<ReturnType<typeof requirePaidClientAccess>>)

    const res = await GET(makeRequest(), CTX)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'Forbidden' })
  })

  it('returns success:true with uppercase:null when there is no WP connection', async () => {
    mockAuth.mockResolvedValue({ ok: true } as unknown as Awaited<ReturnType<typeof requirePaidClientAccess>>)
    mockConn.mockResolvedValue(null)

    const res = await GET(makeRequest(), CTX)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.uppercase).toBeNull()
    expect(body.matches).toEqual([])
    expect(body.warnings[0]).toMatch(/No WordPress connection/i)
    expect(mockDetect).not.toHaveBeenCalled()
  })

  it('returns success:true with uppercase:null when connection is not verified', async () => {
    mockAuth.mockResolvedValue({ ok: true } as unknown as Awaited<ReturnType<typeof requirePaidClientAccess>>)
    mockConn.mockResolvedValue({ ...MOCK_CONN, status: 'error' } as unknown as Awaited<ReturnType<typeof getWordpressConnection>>)

    const res = await GET(makeRequest(), CTX)
    const body = await res.json()
    expect(body.uppercase).toBeNull()
    expect(body.warnings[0]).toMatch(/not verified/i)
    expect(mockDetect).not.toHaveBeenCalled()
  })

  it('passes the WP siteUrl to detectThemeUppercase on the happy path', async () => {
    mockAuth.mockResolvedValue({ ok: true } as unknown as Awaited<ReturnType<typeof requirePaidClientAccess>>)
    mockConn.mockResolvedValue(MOCK_CONN)
    mockDetect.mockResolvedValue({
      uppercase: true,
      matches:   [{ selector: '.entry-content p', source: 'https://oztop.com.au/style.css' }],
      warnings:  [],
    })

    const res = await GET(makeRequest(), CTX)
    const body = await res.json()

    expect(mockDetect).toHaveBeenCalledWith('https://oztop.com.au')
    expect(body.uppercase).toBe(true)
    expect(body.matches).toHaveLength(1)
    expect(body.remediation).toMatch(/UPPERCASE/i)
    expect(body.remediation).toMatch(/Customizer/i)
  })

  it('returns remediation:null when uppercase=false', async () => {
    mockAuth.mockResolvedValue({ ok: true } as unknown as Awaited<ReturnType<typeof requirePaidClientAccess>>)
    mockConn.mockResolvedValue(MOCK_CONN)
    mockDetect.mockResolvedValue({ uppercase: false, matches: [], warnings: [] })

    const res = await GET(makeRequest(), CTX)
    const body = await res.json()

    expect(body.uppercase).toBe(false)
    expect(body.remediation).toBeNull()
  })

  it('forwards lib warnings (e.g. failed stylesheet fetches) to the response', async () => {
    mockAuth.mockResolvedValue({ ok: true } as unknown as Awaited<ReturnType<typeof requirePaidClientAccess>>)
    mockConn.mockResolvedValue(MOCK_CONN)
    mockDetect.mockResolvedValue({
      uppercase: false,
      matches:   [],
      warnings:  ['Stylesheet fetch failed (style.css): HTTP 404'],
    })

    const res = await GET(makeRequest(), CTX)
    expect((await res.json()).warnings[0]).toContain('HTTP 404')
  })

  it('NEVER 500s — when detectThemeUppercase throws, returns 200 with a warning', async () => {
    mockAuth.mockResolvedValue({ ok: true } as unknown as Awaited<ReturnType<typeof requirePaidClientAccess>>)
    mockConn.mockResolvedValue(MOCK_CONN)
    mockDetect.mockRejectedValue(new Error('SSRF rejected: private host'))

    const res = await GET(makeRequest(), CTX)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.uppercase).toBeNull()
    expect(body.warnings[0]).toMatch(/Theme check failed/i)
    expect(body.warnings[0]).toMatch(/SSRF rejected/)
  })
})
