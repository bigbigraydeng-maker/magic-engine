import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Module-level mocks (hoisted before imports) ───────────────────────────────

const { mockMaybeSingle, mockEq, mockSelect, mockFrom } = vi.hoisted(() => {
  const mockMaybeSingle = vi.fn()
  const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }))
  const mockSelect = vi.fn(() => ({ eq: mockEq }))
  const mockFrom = vi.fn(() => ({ select: mockSelect }))
  return { mockMaybeSingle, mockEq, mockSelect, mockFrom }
})

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mockFrom },
}))

// ── Imports after mocks ───────────────────────────────────────────────────────

import { isBriefComplete, invalidateBriefCache } from '../completion'

// ── Helpers ───────────────────────────────────────────────────────────────────

function dbReturns(brief_completed_at: string | null) {
  mockMaybeSingle.mockResolvedValueOnce({
    data: { brief_completed_at },
    error: null,
  })
}

function dbReturnsNull() {
  mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null })
}

function dbReturnsError() {
  mockMaybeSingle.mockResolvedValueOnce({
    data: null,
    error: { message: 'DB error' },
  })
}

const CLIENT_ID = 'client-abc-123'

beforeEach(() => {
  vi.clearAllMocks()
  invalidateBriefCache(CLIENT_ID)
  invalidateBriefCache('other-client')
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('isBriefComplete', () => {
  describe('DB return — completed', () => {
    it('returns true when brief_completed_at is a timestamp', async () => {
      dbReturns('2026-06-01T10:00:00Z')
      const result = await isBriefComplete(CLIENT_ID)
      expect(result).toBe(true)
    })

    it('queries the clients table with the correct clientId', async () => {
      dbReturns('2026-06-01T10:00:00Z')
      await isBriefComplete(CLIENT_ID)
      expect(mockFrom).toHaveBeenCalledWith('clients')
      expect(mockSelect).toHaveBeenCalledWith('brief_completed_at')
      expect(mockEq).toHaveBeenCalledWith('id', CLIENT_ID)
    })
  })

  describe('DB return — not completed', () => {
    it('returns false when brief_completed_at is null', async () => {
      dbReturns(null)
      const result = await isBriefComplete(CLIENT_ID)
      expect(result).toBe(false)
    })
  })

  describe('DB return — row not found', () => {
    it('returns false when data is null (client not found)', async () => {
      dbReturnsNull()
      const result = await isBriefComplete(CLIENT_ID)
      expect(result).toBe(false)
    })
  })

  describe('DB return — error', () => {
    it('returns false on DB error', async () => {
      dbReturnsError()
      const result = await isBriefComplete(CLIENT_ID)
      expect(result).toBe(false)
    })
  })

  describe('cache — hit', () => {
    it('does not re-query DB on second call within TTL', async () => {
      dbReturns('2026-06-01T10:00:00Z')
      await isBriefComplete(CLIENT_ID)
      await isBriefComplete(CLIENT_ID)
      expect(mockMaybeSingle).toHaveBeenCalledTimes(1)
    })

    it('returns the cached result on second call', async () => {
      dbReturns('2026-06-01T10:00:00Z')
      const first = await isBriefComplete(CLIENT_ID)
      const second = await isBriefComplete(CLIENT_ID)
      expect(first).toBe(true)
      expect(second).toBe(true)
    })

    it('caches false result as well', async () => {
      dbReturns(null)
      await isBriefComplete(CLIENT_ID)
      await isBriefComplete(CLIENT_ID)
      expect(mockMaybeSingle).toHaveBeenCalledTimes(1)
    })
  })

  describe('cache — expiry', () => {
    it('re-queries DB after cache TTL expires', async () => {
      vi.useFakeTimers()
      dbReturns('2026-06-01T10:00:00Z')
      await isBriefComplete(CLIENT_ID)

      // Advance past 5 minute TTL
      vi.advanceTimersByTime(5 * 60 * 1000 + 1)

      dbReturns('2026-06-01T10:00:00Z')
      await isBriefComplete(CLIENT_ID)

      expect(mockMaybeSingle).toHaveBeenCalledTimes(2)
      vi.useRealTimers()
    })

    it('does NOT re-query before TTL expires', async () => {
      vi.useFakeTimers()
      dbReturns('2026-06-01T10:00:00Z')
      await isBriefComplete(CLIENT_ID)

      // Advance just under 5 minutes
      vi.advanceTimersByTime(5 * 60 * 1000 - 1)

      await isBriefComplete(CLIENT_ID)
      expect(mockMaybeSingle).toHaveBeenCalledTimes(1)
      vi.useRealTimers()
    })
  })

  describe('invalidateBriefCache', () => {
    it('forces re-query after invalidation', async () => {
      dbReturns('2026-06-01T10:00:00Z')
      await isBriefComplete(CLIENT_ID)

      invalidateBriefCache(CLIENT_ID)

      dbReturns('2026-06-01T10:00:00Z')
      await isBriefComplete(CLIENT_ID)

      expect(mockMaybeSingle).toHaveBeenCalledTimes(2)
    })

    it('only invalidates the specified clientId, not others', async () => {
      dbReturns('2026-06-01T10:00:00Z')
      dbReturns('2026-06-01T10:00:00Z')
      await isBriefComplete(CLIENT_ID)
      await isBriefComplete('other-client')

      invalidateBriefCache(CLIENT_ID)

      dbReturns('2026-06-01T10:00:00Z')
      await isBriefComplete(CLIENT_ID)       // re-queries
      await isBriefComplete('other-client')  // still cached

      expect(mockMaybeSingle).toHaveBeenCalledTimes(3)
    })
  })
})
