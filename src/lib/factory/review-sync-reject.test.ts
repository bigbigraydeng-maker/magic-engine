import { describe, expect, it, vi } from 'vitest'
import { REEL_HUMAN_CHECK_KEYS_V3 } from '@/lib/social/content-review'

const { updates, inserts, from } = vi.hoisted(() => {
  const updates: Array<Record<string, unknown>> = []
  const inserts: Array<Record<string, unknown>> = []
  const chain: Record<string, unknown> = {}
  chain.update = (p: Record<string, unknown>) => { updates.push(p); return chain }
  chain.insert = (row: Record<string, unknown>) => { inserts.push(row); return Promise.resolve({ error: null }) }
  chain.eq = () => chain
  chain.select = () => Promise.resolve({ data: [{ id: 'wo-1' }], error: null })
  return { updates, inserts, from: vi.fn(() => chain) }
})
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from } }))

import { applyQualityReject } from './review-sync'

describe('review-sync applyQualityReject', () => {
  it('reopens the work order as a draft without the weekly pack and records feedback', async () => {
    updates.length = 0
    inserts.length = 0

    const checklist = REEL_HUMAN_CHECK_KEYS_V3.map((key) => ({
      key,
      judge: 'HUMAN',
      outcome: key === 'viral_recipe_hook_matched' ? 'FAIL' : 'NOT_MEASURED',
      detail: key === 'viral_recipe_hook_matched' ? 'Hook did not match recipe' : null,
      source_ref: key.startsWith('factual_') ? 'https://example.test/source' : null,
    }))

    const wo = {
      id: 'wo-1',
      client_id: 'c-1',
      signal_id: 's-1',
      goal_id: 'g-1',
      master_brief_id: 'mb-1',
      winner_structure_id: null,
      order_type: 'fresh_angle',
      angle: 'X',
      angle_source: {},
      rationale_one_liner: 'why',
      budget_cap_usd: 2,
      source_ad_id: 'ad-1',
      brief: { segments: [], weekly_pack: { publish_on: '2026-11-10' } },
      review_ref: { checklist_version: 'v3', checklist_human: checklist },
    }

    const ok = await applyQualityReject(wo, 'too slow', 'me@x.com')

    expect(ok).toBe(true)
    expect(inserts).toHaveLength(1)
    const brief = (inserts[0] as { brief: Record<string, unknown> }).brief
    expect('weekly_pack' in brief).toBe(false)
    expect(brief.reopened_from).toBe('wo-1')
    expect(brief.review_feedback).toBe('too slow')
  })
})
