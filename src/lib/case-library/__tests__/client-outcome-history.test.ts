/**
 * fetchClientOutcomeHistory — 条款 A：per-client 归因历史必须强制 client_id 过滤，
 * 绝不像 fetchOutcomeConfidenceMap 那样查全表跨客户。
 */

import { describe, it, expect } from 'vitest'
import { fetchClientOutcomeHistory } from '../outcome-confidence'
import type { SupabaseClient } from '@supabase/supabase-js'

/** Thenable fake query builder that records every .eq() call. */
function fakeSupabase(rows: unknown[], captured: Array<[string, string]>) {
  const q: Record<string, unknown> = {
    select() { return q },
    eq(col: string, val: string) { captured.push([col, val]); return q },
    then(resolve: (v: { data: unknown; error: null }) => unknown) {
      return resolve({ data: rows, error: null })
    },
  }
  return { from: () => q } as unknown as SupabaseClient
}

describe('fetchClientOutcomeHistory 客户作用域', () => {
  it('总是强制 .eq(flywheel_actions.client_id, clientId)', async () => {
    const captured: Array<[string, string]> = []
    const supabase = fakeSupabase(
      [{ verdict: 'confirmed', flywheel_actions: { action_type: 'seo.publish_blog' } }],
      captured,
    )
    await fetchClientOutcomeHistory(supabase, 'client-1')
    // 🔴 客户作用域谓词必须存在，且是传入的 clientId
    expect(captured).toContainEqual(['flywheel_actions.client_id', 'client-1'])
  })

  it('计算本客户 action_type 成功率', async () => {
    const captured: Array<[string, string]> = []
    const supabase = fakeSupabase([
      { verdict: 'confirmed', flywheel_actions: { action_type: 'seo.publish_blog' } },
      { verdict: 'refuted',   flywheel_actions: { action_type: 'seo.publish_blog' } },
    ], captured)
    const map = await fetchClientOutcomeHistory(supabase, 'client-1')
    expect(map['seo.publish_blog']).toEqual({ successRate: 0.5, sampleSize: 2 })
  })

  it('可选 flywheel / action_type 过滤也带上', async () => {
    const captured: Array<[string, string]> = []
    const supabase = fakeSupabase([], captured)
    await fetchClientOutcomeHistory(supabase, 'client-9', { flywheel: 'seo', actionType: 'seo.publish_blog' })
    expect(captured).toContainEqual(['flywheel_actions.client_id', 'client-9'])
    expect(captured).toContainEqual(['flywheel_actions.flywheel', 'seo'])
    expect(captured).toContainEqual(['flywheel_actions.action_type', 'seo.publish_blog'])
  })

  it('空 clientId → 直接返回 {}（不触库）', async () => {
    const captured: Array<[string, string]> = []
    const supabase = fakeSupabase([], captured)
    const map = await fetchClientOutcomeHistory(supabase, '')
    expect(map).toEqual({})
    expect(captured).toHaveLength(0)
  })
})
