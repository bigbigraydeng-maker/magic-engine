/**
 * Tests for requireSession — the session guard for /api route handlers.
 *
 * Verifies fail-closed behaviour: any request without a valid logged-in
 * Supabase user is rejected with 401, and the error message stays generic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks (declared before imports) ──────────────────────────────────────────

vi.mock('@/lib/supabase-server', () => ({
  createServerSupabaseClient: vi.fn(),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { requireSession } from '../require-session'
import { createServerSupabaseClient } from '@/lib/supabase-server'

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockGetUser(result: unknown) {
  vi.mocked(createServerSupabaseClient).mockReturnValue({
    auth: { getUser: vi.fn().mockResolvedValue(result) },
  } as unknown as ReturnType<typeof createServerSupabaseClient>)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('requireSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns { ok: true, user } when a valid session exists', async () => {
    const user = { id: 'user-1', email: 'pm@magiclab.test' }
    mockGetUser({ data: { user }, error: null })

    const result = await requireSession()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.user).toEqual(user)
    }
  })

  it('returns { ok: false, status: 401 } when there is no logged-in user', async () => {
    mockGetUser({ data: { user: null }, error: null })

    const result = await requireSession()

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(401)
      expect(result.error).toBe('Unauthorized')
    }
  })

  it('returns { ok: false, status: 401 } when the auth token is invalid', async () => {
    // Supabase returns user: null plus an error for an expired / tampered JWT
    mockGetUser({ data: { user: null }, error: { message: 'invalid JWT' } })

    const result = await requireSession()

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(401)
    }
  })

  it('returns a generic error message that does not leak token detail', async () => {
    mockGetUser({
      data: { user: null },
      error: { message: 'invalid JWT: signature mismatch' },
    })

    const result = await requireSession()

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('Unauthorized')
    }
  })
})
