import { describe, it, expect, vi } from 'vitest'
import { draftExpiryCutoff, expireStaleDrafts, DRAFT_EXPIRY_DAYS } from '../draft-expiry'
import { cardExpiryCutoff, CARD_EXPIRY_DAYS } from '../../zhuge/card-expiry'
import type { SupabaseClient } from '@supabase/supabase-js'

describe('expiry cutoffs', () => {
  it('draft cutoff is exactly 30 days before now', () => {
    const now = new Date('2026-07-31T10:00:00Z')
    expect(draftExpiryCutoff(now)).toBe('2026-07-01T10:00:00.000Z')
    expect(DRAFT_EXPIRY_DAYS).toBe(30)
  })

  it('card cutoff is exactly 14 days before now', () => {
    const now = new Date('2026-07-31T10:00:00Z')
    expect(cardExpiryCutoff(now)).toBe('2026-07-17T10:00:00.000Z')
    expect(CARD_EXPIRY_DAYS).toBe(14)
  })
})

describe('expireStaleDrafts', () => {
  it('marks stale drafts rejected with auto_expired marker, preserving quality_check', async () => {
    const staleRows = [
      { id: 'p1', title: 'Old Post', topic: 't1', quality_check: { internal_link: { count: 2 } } },
    ]

    const updateEqStatus = vi.fn().mockResolvedValue({ error: null })
    const updateEqId = vi.fn().mockReturnValue({ eq: updateEqStatus })
    const update = vi.fn().mockReturnValue({ eq: updateEqId })

    const readLt = vi.fn().mockResolvedValue({ data: staleRows, error: null })
    const readEq = vi.fn().mockReturnValue({ lt: readLt })
    const select = vi.fn().mockReturnValue({ eq: readEq })

    const from = vi.fn().mockReturnValue({ select, update })
    const supabase = { from } as unknown as SupabaseClient

    const now = new Date('2026-07-31T10:00:00Z')
    const result = await expireStaleDrafts(supabase, now)

    expect(result.expired).toBe(1)
    expect(result.titles).toEqual(['Old Post'])
    // the jsonb merge keeps the prior quality_check content
    expect(update).toHaveBeenCalledWith({
      status: 'rejected',
      quality_check: {
        internal_link: { count: 2 },
        auto_expired: true,
        expired_at: now.toISOString(),
      },
    })
    // the update is double-guarded on id AND still-draft status
    expect(updateEqId).toHaveBeenCalledWith('id', 'p1')
    expect(updateEqStatus).toHaveBeenCalledWith('status', 'draft')
  })

  it('returns zero and issues no updates when nothing is stale', async () => {
    const readLt = vi.fn().mockResolvedValue({ data: [], error: null })
    const readEq = vi.fn().mockReturnValue({ lt: readLt })
    const select = vi.fn().mockReturnValue({ eq: readEq })
    const update = vi.fn()
    const from = vi.fn().mockReturnValue({ select, update })

    const result = await expireStaleDrafts({ from } as unknown as SupabaseClient)
    expect(result).toEqual({ expired: 0, titles: [] })
    expect(update).not.toHaveBeenCalled()
  })
})
