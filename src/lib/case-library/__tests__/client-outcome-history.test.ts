/**
 * fetchClientOutcomeHistory — 条款 A：per-client 归因历史必须强制 client_id 过滤，
 * 绝不像 fetchOutcomeConfidenceMap 那样查全表跨客户。
 */

import { describe, it, expect } from 'vitest'
import { fetchClientOutcomeHistory, fetchSeoBlogConfidenceByMode } from '../outcome-confidence'
import type { SupabaseClient } from '@supabase/supabase-js'

/** Thenable fake query builder that records every .eq() call. */
function fakeSupabase(rows: unknown[], captured: Array<[string, string]>) {
  // 这两个读取方现在分页读全（fetchAll → .order().range()）。桩子照着真链条建模,
  // 否则「读全」这件事在测试里根本不存在。
  const q: Record<string, unknown> = {
    select() { return q },
    eq(col: string, val: string) { captured.push([col, val]); return q },
    order() { return q },
    async range(from: number, to: number) {
      return { data: rows.slice(from, to + 1), error: null }
    },
  }
  return { from: () => q } as unknown as SupabaseClient
}

describe('fetchClientOutcomeHistory 客户作用域', () => {
  it('总是强制 .eq(flywheel_actions.client_id, clientId)', async () => {
    const captured: Array<[string, string]> = []
    const supabase = fakeSupabase(
      [{ action_id: 'a1', metric_key: 'm', window_days: 28, verdict: 'confirmed', flywheel_actions: { action_type: 'seo.publish_blog' } }],
      captured,
    )
    await fetchClientOutcomeHistory(supabase, 'client-1')
    // 🔴 客户作用域谓词必须存在，且是传入的 clientId
    expect(captured).toContainEqual(['flywheel_actions.client_id', 'client-1'])
  })

  it('计算本客户 action_type 成功率', async () => {
    const captured: Array<[string, string]> = []
    const supabase = fakeSupabase([
      { action_id: 'a2', metric_key: 'm', window_days: 28, verdict: 'confirmed', flywheel_actions: { action_type: 'seo.publish_blog' } },
      { action_id: 'a3', metric_key: 'm', window_days: 28, verdict: 'refuted',   flywheel_actions: { action_type: 'seo.publish_blog' } },
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

// ── One action is one case, however many windows it was measured at ─────────

describe('fetchClientOutcomeHistory 多窗口去重', () => {
  it('同一个动作的两个窗口只算一个案例', async () => {
    // 被转交的动作会按 bridge 的 28 天节奏和 pass 1 的窗口各算一次。
    // 按行数计样本，一个动作会被当成两个「客户案例」报给诸葛亮。
    const captured: Array<[string, string]> = []
    const supabase = fakeSupabase([
      { action_id: 'a1', metric_key: 'seo.gsc.clicks', window_days: 28, verdict: 'confirmed', flywheel_actions: { action_type: 'seo.publish_blog' } },
      { action_id: 'a1', metric_key: 'seo.gsc.clicks', window_days: 14, verdict: 'confirmed', flywheel_actions: { action_type: 'seo.publish_blog' } },
    ], captured)

    const map = await fetchClientOutcomeHistory(supabase, 'client-1')

    expect(map['seo.publish_blog']).toEqual({ successRate: 1, sampleSize: 1 })
  })

  it('两个窗口结论不一致时取更长的那个窗口', async () => {
    const captured: Array<[string, string]> = []
    const supabase = fakeSupabase([
      { action_id: 'a1', metric_key: 'seo.gsc.clicks', window_days: 14, verdict: 'reversed', flywheel_actions: { action_type: 'seo.publish_blog' } },
      { action_id: 'a1', metric_key: 'seo.gsc.clicks', window_days: 28, verdict: 'confirmed', flywheel_actions: { action_type: 'seo.publish_blog' } },
    ], captured)

    const map = await fetchClientOutcomeHistory(supabase, 'client-1')

    // 28 天的观察更成熟，胜出；且样本数仍是 1，不是 2。
    expect(map['seo.publish_blog']).toEqual({ successRate: 1, sampleSize: 1 })
  })

  it('同一动作的多个指标只算一个案例，取它承诺的那个指标', async () => {
    // 一次 GSC 归因会同时产出 clicks / impressions / avg_position —— 那是
    // 同一件事的三个读数，不是三份独立证据。按指标计样本，一个动作就能自己
    // 凑够阈值，还能用三票把成功率拽偏。代表读数取动作自己承诺的那个指标。
    const captured: Array<[string, string]> = []
    const supabase = fakeSupabase([
      { action_id: 'a1', metric_key: 'seo.gsc.clicks', window_days: 28, verdict: 'confirmed',
        flywheel_actions: { action_type: 'seo.publish_blog', expected_metric: 'seo.gsc.clicks' } },
      { action_id: 'a1', metric_key: 'seo.gsc.impressions', window_days: 28, verdict: 'reversed',
        flywheel_actions: { action_type: 'seo.publish_blog', expected_metric: 'seo.gsc.clicks' } },
      { action_id: 'a1', metric_key: 'seo.gsc.avg_position', window_days: 28, verdict: 'reversed',
        flywheel_actions: { action_type: 'seo.publish_blog', expected_metric: 'seo.gsc.clicks' } },
    ], captured)

    const map = await fetchClientOutcomeHistory(supabase, 'client-1')

    // 一个动作 = 一个案例，且结论跟着 expected_metric 走（confirmed）。
    expect(map['seo.publish_blog']).toEqual({ successRate: 1, sampleSize: 1 })
  })

  it('动作承诺的指标没被量到时，退回量到的那个，样本数仍是 1', async () => {
    const captured: Array<[string, string]> = []
    const supabase = fakeSupabase([
      { action_id: 'a1', metric_key: 'seo.gsc.clicks', window_days: 28, verdict: 'reversed',
        flywheel_actions: { action_type: 'seo.publish_blog', expected_metric: 'seo.domain.organic_traffic' } },
      { action_id: 'a1', metric_key: 'seo.gsc.impressions', window_days: 28, verdict: 'reversed',
        flywheel_actions: { action_type: 'seo.publish_blog', expected_metric: 'seo.domain.organic_traffic' } },
    ], captured)

    const map = await fetchClientOutcomeHistory(supabase, 'client-1')

    expect(map['seo.publish_blog'].sampleSize).toBe(1)
  })

  it('两个不同动作仍算两个案例', async () => {
    const captured: Array<[string, string]> = []
    const supabase = fakeSupabase([
      { action_id: 'a1', metric_key: 'seo.gsc.clicks', window_days: 28, verdict: 'confirmed',
        flywheel_actions: { action_type: 'seo.publish_blog', expected_metric: 'seo.gsc.clicks' } },
      { action_id: 'a2', metric_key: 'seo.gsc.clicks', window_days: 28, verdict: 'reversed',
        flywheel_actions: { action_type: 'seo.publish_blog', expected_metric: 'seo.gsc.clicks' } },
    ], captured)

    const map = await fetchClientOutcomeHistory(supabase, 'client-1')

    expect(map['seo.publish_blog']).toEqual({ successRate: 0.5, sampleSize: 2 })
  })
})

// ── The blog-mode buckets count the same way ────────────────────────────────

describe('fetchSeoBlogConfidenceByMode 多窗口去重', () => {
  it('同一篇博客的两个窗口只进一次桶', async () => {
    const captured: Array<[string, string]> = []
    const supabase = fakeSupabase([
      { action_id: 'a1', metric_key: 'seo.gsc.clicks', window_days: 28, verdict: 'confirmed', flywheel_actions: { payload: { mode: 'unified' } } },
      { action_id: 'a1', metric_key: 'seo.gsc.clicks', window_days: 14, verdict: 'confirmed', flywheel_actions: { payload: { mode: 'unified' } } },
    ], captured)

    const byMode = await fetchSeoBlogConfidenceByMode(supabase, 'client-1')

    expect(byMode.unified.sampleSize).toBe(1)
  })

  it('两篇不同博客仍算两个样本', async () => {
    const captured: Array<[string, string]> = []
    const supabase = fakeSupabase([
      { action_id: 'a1', metric_key: 'seo.gsc.clicks', window_days: 28, verdict: 'confirmed', flywheel_actions: { payload: { mode: 'unified' } } },
      { action_id: 'a2', metric_key: 'seo.gsc.clicks', window_days: 28, verdict: 'reversed', flywheel_actions: { payload: { mode: 'unified' } } },
    ], captured)

    const byMode = await fetchSeoBlogConfidenceByMode(supabase, 'client-1')

    expect(byMode.unified.sampleSize).toBe(2)
    expect(byMode.unified.successRate).toBe(0.5)
  })
})
