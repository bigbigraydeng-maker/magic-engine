// The retired Airtable approve path must also require the V3 checklist and stamp the version.
import { describe, expect, it, vi } from 'vitest'
import { REEL_AUTO_CHECK_KEYS, REEL_HUMAN_CHECK_KEYS_V2, REEL_HUMAN_CHECK_KEYS_V3 } from '@/lib/social/content-review'

const { updates, from } = vi.hoisted(() => {
  const updates: Array<Record<string, unknown>> = []
  const chain: Record<string, unknown> = {}
  chain.update = (p: Record<string, unknown>) => { updates.push(p); return chain }
  chain.eq = () => chain
  chain.select = () => Promise.resolve({ data: [{ id: 'wo-1' }], error: null })
  return { updates, from: vi.fn(() => chain) }
})
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from } }))

import { applyApprove } from './review-sync'

const pass = (keys: readonly string[]) => keys.map((key) => ({ key, judge: 'HUMAN', outcome: 'PASS', detail: null, source_ref: key.startsWith('factual_') ? 'https://example.test/s' : null }))
const auto = REEL_AUTO_CHECK_KEYS.map((key) => ({ key, judge: 'AUTO', outcome: 'PASS', detail: 'm', source_ref: null }))
const rec = { id: 'r1', fields: {} } as never

describe('review-sync applyApprove — V3', () => {
  it('a V2-shaped stored checklist is refused (no receipt the publisher would later refuse)', async () => {
    updates.length = 0
    const wo = { id: 'wo-1', brief: {}, review_ref: { checklist_human: pass(REEL_HUMAN_CHECK_KEYS_V2) }, output: { quality_checklist_auto: auto } }
    expect(await applyApprove(wo, rec)).toBe(false)
    expect(updates).toHaveLength(0)
  })

  it('a V3 checklist is approved and the version is stamped', async () => {
    updates.length = 0
    const wo = { id: 'wo-1', brief: {}, review_ref: { checklist_human: pass(REEL_HUMAN_CHECK_KEYS_V3) }, output: { quality_checklist_auto: auto } }
    expect(await applyApprove(wo, rec)).toBe(true)
    expect((updates[0].review_ref as Record<string, unknown>).checklist_version).toBe('v3')
  })
})
