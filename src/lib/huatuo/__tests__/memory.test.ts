/**
 * Tests for src/lib/huatuo/memory.ts — DAPE W1 三层 memory + 双模式 prompt
 *
 * Ref: docs/superpowers/specs/2026-06-08-me-dape-redefine-v0.2.md §3 + §5 Week 1
 *
 * 覆盖：
 *   - loadHuatuoMemoryBundle 真正读 3 张表（mocked supabase）
 *   - prompt 双模式渲染（short vs long）有显著差异
 *   - memory 真注入到生成 prompt（buildHuatuoGenerationPrompt）
 *   - 子查询失败时降级为空（非阻塞）
 *   - 计算 fulfillment_ratio 正确
 *   - logging 真触发（魏征要求 — 能验 agent 真用 memory）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  loadHuatuoMemoryBundle,
  formatHuatuoMemoryForPrompt,
  computeFulfillmentRatio,
  type HuatuoMemoryBundle,
} from '../memory'
import { buildHuatuoGenerationPrompt } from '../prompts'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DiscoveryReport } from '@/lib/zhangqian/types'
import type { PrescriptionIntake } from '@/types/diagnostic'
import type { HuatuoLookupContext } from '../types'

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * 构造一个最小可用的 Supabase mock。返回对每张表的 query 的细粒度控制。
 *
 * tablesPayload[tableName] 是该表 query 的最终 data（用 last-method 决定返回）。
 * 失败用 tablesError[tableName]。
 */
function makeMockSupabase(
  tablesPayload: Record<string, unknown[] | unknown> = {},
  tablesError: Record<string, { message: string } | null> = {},
): SupabaseClient {
  function makeQuery(table: string) {
    const payload = tablesPayload[table] ?? []
    const error = tablesError[table] ?? null
    const builder: Record<string, unknown> = {}

    // chainable no-ops
    const noopChain = ['select', 'eq', 'gte', 'or', 'order', 'limit']
    for (const m of noopChain) {
      ;(builder as Record<string, (...a: unknown[]) => unknown>)[m] = () => builder
    }
    // 终结方法
    builder.maybeSingle = async () => ({
      data: Array.isArray(payload) ? (payload[0] ?? null) : payload,
      error,
    })
    builder.single = async () => ({
      data: Array.isArray(payload) ? payload[0] : payload,
      error,
    })
    // then 让"未调终结方法的链"直接 await
    builder.then = (
      onResolved: (v: { data: unknown; error: unknown }) => unknown,
    ) => Promise.resolve({ data: payload, error }).then(onResolved)
    return builder
  }

  return { from: (table: string) => makeQuery(table) } as unknown as SupabaseClient
}

const TEST_CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'

// ─── computeFulfillmentRatio ─────────────────────────────────────────────────

describe('computeFulfillmentRatio', () => {
  it('returns null when target or actual missing', () => {
    expect(computeFulfillmentRatio(null, 10)).toBeNull()
    expect(computeFulfillmentRatio(10, null)).toBeNull()
    expect(computeFulfillmentRatio(null, null)).toBeNull()
  })

  it('returns null when target is 0 (avoid div-by-zero)', () => {
    expect(computeFulfillmentRatio(0, 5)).toBeNull()
  })

  it('computes actual/target rounded to 2 decimals', () => {
    expect(computeFulfillmentRatio(100, 75)).toBe(0.75)
    expect(computeFulfillmentRatio(100, 150)).toBe(1.5)
    expect(computeFulfillmentRatio(3, 1)).toBe(0.33)
  })

  it('returns null for non-finite numbers', () => {
    expect(computeFulfillmentRatio(Infinity, 10)).toBeNull()
    expect(computeFulfillmentRatio(10, Number.NaN)).toBeNull()
  })
})

// ─── loadHuatuoMemoryBundle ──────────────────────────────────────────────────

describe('loadHuatuoMemoryBundle — table reads + degrade behaviour', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    infoSpy.mockRestore()
    warnSpy.mockRestore()
  })

  it('long mode reads all 3 memory layers + emits [huatuo:memory] info log', async () => {
    const supabase = makeMockSupabase({
      client_learned_preferences: [
        { preference_type: 'tone', content: '简洁直接', confidence_score: 0.9, flywheel: null, source: 'fde_annotation', is_active: true, id: 'p1', client_id: TEST_CLIENT_ID, created_at: '', updated_at: '' },
      ],
      client_proven_patterns: [],
      client_failed_experiments: [],
      client_decision_history: [],
      zhuge_feedback_events: [
        { suggestion_title: '加 1 篇 SEO 博客', feedback_state: 'done', current_area_label: 'SEO', created_at: '2026-06-01T00:00:00Z' },
        { suggestion_title: '换字号', feedback_state: 'dismissed', current_area_label: 'UI', created_at: '2026-06-02T00:00:00Z' },
      ],
      prescriptions: [{ id: 'rx-last' }],
      prescription_outcomes: [
        { kpi_metric: '自然流量月均访客', target_value: 1000, actual_value: 850, unit: '人', dimension: 'seo', days_since_approval: 90, measured_at: '2026-05-31T00:00:00Z' },
      ],
    })

    const bundle = await loadHuatuoMemoryBundle(supabase, TEST_CLIENT_ID, { mode: 'long' })

    expect(bundle.has_content).toBe(true)
    expect(bundle.memoryContext.preferences).toHaveLength(1)
    expect(bundle.recentFeedback).toHaveLength(2)
    expect(bundle.lastPrescriptionOutcomes).toHaveLength(1)
    expect(bundle.lastPrescriptionOutcomes[0].fulfillment_ratio).toBe(0.85)

    // 魏征要求：log 必须真触发，且带 client_id + mode + counts
    expect(infoSpy).toHaveBeenCalledWith(
      '[huatuo:memory] loaded',
      expect.objectContaining({
        client_id: TEST_CLIENT_ID,
        mode: 'long',
        preferences: 1,
        recent_feedback: 2,
        last_prescription_outcomes: 1,
        has_content: true,
      }),
    )
  })

  it('short mode trims patterns/failed/decisions and uses tighter limits', async () => {
    const supabase = makeMockSupabase({
      client_learned_preferences: [
        { preference_type: 'tone', content: '简洁', confidence_score: 0.9, flywheel: null, source: 'fde_annotation', is_active: true, id: 'p1', client_id: TEST_CLIENT_ID, created_at: '', updated_at: '' },
      ],
      client_proven_patterns: [
        { pattern_type: 'hook', pattern_content: '提问开头', performance_metric: 'CTR +12%', flywheel: null, is_active: true, id: 'pp1', client_id: TEST_CLIENT_ID, created_at: '', updated_at: '' },
      ],
      client_failed_experiments: [
        { experiment_description: '黑五大促', failure_reason: 'ROI 负', dimension: null, id: 'fe1', client_id: TEST_CLIENT_ID, created_at: '' },
      ],
      client_decision_history: [
        { decision_context: 'X', chosen_action: 'Y', alternatives_rejected: [], reasoning: 'Z', outcome_verdict: null, created_at: '', id: 'd1', client_id: TEST_CLIENT_ID },
      ],
      zhuge_feedback_events: [],
      prescriptions: [],
      prescription_outcomes: [],
    })

    const bundle = await loadHuatuoMemoryBundle(supabase, TEST_CLIENT_ID, { mode: 'short' })

    // 短模式只保留 preferences；patterns/failed/decisions 被裁空
    expect(bundle.memoryContext.preferences.length).toBeGreaterThan(0)
    expect(bundle.memoryContext.proven_patterns).toEqual([])
    expect(bundle.memoryContext.failed_experiments).toEqual([])
    expect(bundle.memoryContext.recent_decisions).toEqual([])
  })

  it('feedback table query error → returns [] (non-blocking)', async () => {
    const supabase = makeMockSupabase(
      {
        client_learned_preferences: [],
        client_proven_patterns: [],
        client_failed_experiments: [],
        client_decision_history: [],
        zhuge_feedback_events: [],
        prescriptions: [],
        prescription_outcomes: [],
      },
      {
        zhuge_feedback_events: { message: 'simulated DB error' },
      },
    )

    const bundle = await loadHuatuoMemoryBundle(supabase, TEST_CLIENT_ID, { mode: 'long' })
    expect(bundle.recentFeedback).toEqual([])
    // 仍然 emit info log — 不阻塞 + 验证降级
    expect(infoSpy).toHaveBeenCalled()
  })

  it('no approved prescription → outcomes is [] without error', async () => {
    const supabase = makeMockSupabase({
      client_learned_preferences: [],
      client_proven_patterns: [],
      client_failed_experiments: [],
      client_decision_history: [],
      zhuge_feedback_events: [],
      prescriptions: [],  // 无 approved 处方
      prescription_outcomes: [],
    })

    const bundle = await loadHuatuoMemoryBundle(supabase, TEST_CLIENT_ID, { mode: 'long' })
    expect(bundle.lastPrescriptionOutcomes).toEqual([])
    expect(bundle.has_content).toBe(false)
  })
})

// ─── formatHuatuoMemoryForPrompt — 双模式输出差异 ────────────────────────────

describe('formatHuatuoMemoryForPrompt', () => {
  function makeBundle(): HuatuoMemoryBundle {
    return {
      memoryContext: {
        preferences: [
          { preference_type: 'tone', content: '简洁直接', confidence_score: 0.9, flywheel: null },
        ],
        proven_patterns: [
          { pattern_type: 'hook', pattern_content: '提问开头', performance_metric: 'CTR +12%', flywheel: 'social' },
        ],
        failed_experiments: [
          { experiment_description: '黑五大促', failure_reason: 'ROI 负', dimension: null },
        ],
        recent_decisions: [
          { decision_context: 'X', chosen_action: 'Y', alternatives_rejected: ['Z'], reasoning: '因为 reason', outcome_verdict: 'success', created_at: '' },
        ],
        has_content: true,
      },
      recentFeedback: [
        { suggestion_title: '加 1 篇 SEO 博客', feedback_state: 'done', current_area_label: 'SEO', created_at: '2026-06-01T00:00:00Z' },
        { suggestion_title: '换字号', feedback_state: 'dismissed', current_area_label: 'UI', created_at: '2026-06-02T00:00:00Z' },
      ],
      lastPrescriptionOutcomes: [
        { kpi_metric: '自然流量', target_value: 1000, actual_value: 850, unit: '人', dimension: 'seo', days_since_approval: 90, fulfillment_ratio: 0.85 },
      ],
      has_content: true,
    }
  }

  it('has_content=false → returns empty string', () => {
    const empty: HuatuoMemoryBundle = {
      memoryContext: {
        preferences: [], proven_patterns: [], failed_experiments: [], recent_decisions: [], has_content: false,
      },
      recentFeedback: [],
      lastPrescriptionOutcomes: [],
      has_content: false,
    }
    expect(formatHuatuoMemoryForPrompt(empty, 'short')).toBe('')
    expect(formatHuatuoMemoryForPrompt(empty, 'long')).toBe('')
  })

  it('short mode skips patterns / failed_experiments / decisions', () => {
    const bundle = makeBundle()
    // 短模式 caller 应已裁空，但 format 还是显式 includeXxx=false 防御性兜底
    bundle.memoryContext.proven_patterns = []
    bundle.memoryContext.failed_experiments = []
    bundle.memoryContext.recent_decisions = []
    bundle.memoryContext.has_content = bundle.memoryContext.preferences.length > 0

    const text = formatHuatuoMemoryForPrompt(bundle, 'short')
    expect(text).toContain('Client Memory (Quick)')
    expect(text).not.toContain('Proven Winning Patterns')
    expect(text).not.toContain('Failed Experiments')
    expect(text).not.toContain('Recent Decisions')
  })

  it('long mode includes preferences + patterns + failed + decisions', () => {
    const text = formatHuatuoMemoryForPrompt(makeBundle(), 'long')
    expect(text).toContain('Client Memory (L3 Long-term Learning)')
    expect(text).toContain('Content Preferences')
    expect(text).toContain('Proven Winning Patterns')
    expect(text).toContain('Failed Experiments')
    expect(text).toContain('Recent Decisions')
  })

  it('renders feedback section with done/dismissed labels', () => {
    const text = formatHuatuoMemoryForPrompt(makeBundle(), 'long')
    expect(text).toContain('客户最近反馈')
    expect(text).toContain('✓ 已采纳')
    expect(text).toContain('✗ 已忽略')
    expect(text).toContain('加 1 篇 SEO 博客')
  })

  it('renders outcomes section with fulfillment ratio + avg', () => {
    const text = formatHuatuoMemoryForPrompt(makeBundle(), 'long')
    expect(text).toContain('上次处方兑现率')
    expect(text).toContain('85%')  // single fulfillment ratio
    expect(text).toContain('target 1000人')
    expect(text).toContain('actual 850人')
  })

  it('long output is substantially longer than short for the same bundle', () => {
    const bundle = makeBundle()
    const longText = formatHuatuoMemoryForPrompt(bundle, 'long')

    // Re-create short input (caller would have trimmed)
    const shortBundle: HuatuoMemoryBundle = {
      ...bundle,
      memoryContext: {
        ...bundle.memoryContext,
        proven_patterns: [],
        failed_experiments: [],
        recent_decisions: [],
      },
    }
    const shortText = formatHuatuoMemoryForPrompt(shortBundle, 'short')

    expect(longText.length).toBeGreaterThan(shortText.length)
  })
})

// ─── buildHuatuoGenerationPrompt — bundle is really injected ─────────────────

describe('buildHuatuoGenerationPrompt — memoryBundle injection', () => {
  function makeDiscovery(): DiscoveryReport {
    return {
      domain: 'example.com.au',
      business: { name: 'Acme', industry: ['retail'] },
      diagnosis: null,
    } as unknown as DiscoveryReport
  }
  function makeIntake(): PrescriptionIntake {
    return {
      business_goal: '提升品牌曝光',
      timeline_urgency: 'normal',
      monthly_budget_aud: 3000,
      priority_dimensions: ['seo'],
    } as unknown as PrescriptionIntake
  }
  function makeLookup(): HuatuoLookupContext {
    return {
      benchmarks: { seo: null, social: null, reputation: null, ai_visibility: null },
      industry_category: 'retail',
      trend_summary: null,
    }
  }
  function makeBundle(): HuatuoMemoryBundle {
    return {
      memoryContext: {
        preferences: [
          { preference_type: 'tone', content: '简洁直接', confidence_score: 0.9, flywheel: null },
        ],
        proven_patterns: [],
        failed_experiments: [],
        recent_decisions: [],
        has_content: true,
      },
      recentFeedback: [
        { suggestion_title: '加 1 篇 SEO 博客', feedback_state: 'done', current_area_label: 'SEO', created_at: '2026-06-01T00:00:00Z' },
      ],
      lastPrescriptionOutcomes: [
        { kpi_metric: '自然流量', target_value: 1000, actual_value: 850, unit: '人', dimension: 'seo', days_since_approval: 90, fulfillment_ratio: 0.85 },
      ],
      has_content: true,
    }
  }

  it('memoryBundle inserts feedback + outcome blocks into the prompt', () => {
    const prompt = buildHuatuoGenerationPrompt(
      makeDiscovery(), makeIntake(), makeLookup(),
      undefined, undefined,
      makeBundle(), 'long',
    )
    expect(prompt).toContain('客户最近反馈')
    expect(prompt).toContain('上次处方兑现率')
    expect(prompt).toContain('简洁直接')
    expect(prompt).toContain('加 1 篇 SEO 博客')
  })

  it('no memoryBundle and no memoryContext → no memory section', () => {
    const prompt = buildHuatuoGenerationPrompt(
      makeDiscovery(), makeIntake(), makeLookup(),
    )
    expect(prompt).not.toContain('客户最近反馈')
    expect(prompt).not.toContain('上次处方兑现率')
    expect(prompt).not.toContain('Client Memory')
  })

  it('short mode uses short heading and skips patterns even if bundle has them', () => {
    const bundle = makeBundle()
    bundle.memoryContext.proven_patterns = [
      { pattern_type: 'hook', pattern_content: 'X', performance_metric: 'Y', flywheel: null },
    ]
    const prompt = buildHuatuoGenerationPrompt(
      makeDiscovery(), makeIntake(), makeLookup(),
      undefined, undefined,
      bundle, 'short',
    )
    expect(prompt).toContain('Client Memory (Quick)')
    expect(prompt).not.toContain('Proven Winning Patterns')
  })

  it('memoryBundle takes precedence over legacy memoryContext', () => {
    const bundle = makeBundle()
    const legacyOnly = {
      preferences: [
        { preference_type: 'topic' as const, content: '只能从 legacy 看到', confidence_score: 0.9, flywheel: null },
      ],
      proven_patterns: [],
      failed_experiments: [],
      recent_decisions: [],
      has_content: true,
    }
    const prompt = buildHuatuoGenerationPrompt(
      makeDiscovery(), makeIntake(), makeLookup(),
      undefined, legacyOnly,
      bundle, 'long',
    )
    // bundle 的 preference 出现
    expect(prompt).toContain('简洁直接')
    // legacy 不出现（bundle 路径优先）
    expect(prompt).not.toContain('只能从 legacy 看到')
  })

  it('legacy-only path still works (back-compat with Phase 23.D.2)', () => {
    const legacyOnly = {
      preferences: [
        { preference_type: 'topic' as const, content: '客户偏好 X', confidence_score: 0.9, flywheel: null },
      ],
      proven_patterns: [],
      failed_experiments: [],
      recent_decisions: [],
      has_content: true,
    }
    const prompt = buildHuatuoGenerationPrompt(
      makeDiscovery(), makeIntake(), makeLookup(),
      undefined, legacyOnly,
    )
    expect(prompt).toContain('客户偏好 X')
    expect(prompt).toContain('Client Memory (L3 Long-term Learning)')
  })
})
