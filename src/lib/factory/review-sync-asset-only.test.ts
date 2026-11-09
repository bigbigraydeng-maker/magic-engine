// The legacy Airtable approve path must refuse asset_only material before touching the database.
import { describe, expect, it, vi } from 'vitest'

const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from } }))

import { applyApprove } from './review-sync'

describe('review-sync applyApprove — asset_only', () => {
  it('refuses asset_only material and never queries the database', async () => {
    const wo = { id: 'wo-1', status: 'in_review', brief: { remotion: { deliverable: 'asset_only' } }, review_ref: {}, output: {} }
    const ok = await applyApprove(wo, { id: 'rec-1', fields: {} } as never)
    expect(ok).toBe(false)
    expect(from).not.toHaveBeenCalled()
  })
})
