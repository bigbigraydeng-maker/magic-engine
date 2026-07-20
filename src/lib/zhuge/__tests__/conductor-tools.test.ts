/**
 * 诸葛亮 v2 — conductor opt-in 工具路径测试（spec §3.4 / §3.5）
 *
 * - 传入 supabase → 走 callClaudeWithTools（多步），trace 落 output
 * - max_tokens 截断 → 抛错，绝不解析残缺 JSON（条款截断保护）
 * - 不传 supabase → 回退 callClaudeChat（v1 向后兼容）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/anthropic/client', () => ({
  callClaudeChat: vi.fn(),
  callClaudeWithTools: vi.fn(),
}))
vi.mock('@/lib/agent-tools/readonly', () => ({
  buildReadonlyTools: vi.fn(async () => ({ tools: [{ name: 'query_keyword_detail' }], handlers: {} })),
  summariseToolTrace: (calls: Array<{ name: string; input: unknown; result: string; is_error: boolean }>) =>
    calls.map(c => ({ name: c.name, input: c.input, summary: c.result, is_error: c.is_error })),
}))

import { callClaudeChat, callClaudeWithTools } from '@/lib/anthropic/client'
import { buildReadonlyTools } from '@/lib/agent-tools/readonly'
import { conductPriorityActions } from '../conductor'
import type { ZhugeInput } from '../types'
import type { SupabaseClient } from '@supabase/supabase-js'

const mockChat = vi.mocked(callClaudeChat)
const mockTools = vi.mocked(callClaudeWithTools)
const mockBuild = vi.mocked(buildReadonlyTools)

const VALID_JSON = JSON.stringify({
  top_actions: [{
    rank: 1, dimension: 'seo', action_type: 'fix_page',
    why_now: '修那一页', evidence_refs: ['oztop laminate flooring'],
    expected_impact: 'high', effort: 'low', execution_mode: 'in_house', executable_by: null,
  }],
})

function makeInput(overrides: Partial<ZhugeInput> = {}): ZhugeInput {
  return {
    client: {
      id: 'client-1', name: 'Oztop', domain: 'oztop.com.au',
      semrush_db: 'au', monthly_quota: 20, plan_tier: 'growth', created_at: '2025-01-01T00:00:00Z',
    },
    discoveryEvidence: {
      schema_version: 1, domain: 'oztop.com.au',
      business: { name: 'Oztop', industry: ['building'], location: { city: 'Melbourne', region: 'VIC', country: 'AU' }, description: '', target_audience: [], unique_selling_points: [], confidence: 0.9 },
      social_profiles: [], gbp: null, review_platforms: [], seed_keywords: [], competitors: [],
      ai_tracker_questions: [], notes: '', semrush_snapshot: null, ai_visibility_results: [],
    } as unknown as ZhugeInput['discoveryEvidence'],
    diagnosticScores: { seo: 42, ai_visibility: 30 },
    findings: [],
    availableLubanTools: [],
    businessContext: { monthly_budget_aud: 1000, primary_goal: null, blockers: [], has_fde: true, market: 'AU' },
    ...overrides,
  }
}

const fakeSupabase = {} as SupabaseClient

beforeEach(() => vi.clearAllMocks())

describe('opt-in 工具路径', () => {
  it('传入 supabase → 走 callClaudeWithTools，不走 callClaudeChat', async () => {
    mockTools.mockResolvedValue({
      text: VALID_JSON, input_tokens: 100, output_tokens: 50, cost_usd: 0.01,
      tool_rounds: 2, tool_calls: [{ name: 'query_keyword_detail', input: {}, result: 'ok', is_error: false }],
      stop_reason: 'end_turn',
    })
    const out = await conductPriorityActions(makeInput({ supabase: fakeSupabase }))

    expect(mockTools).toHaveBeenCalledTimes(1)
    expect(mockChat).not.toHaveBeenCalled()
    expect(mockBuild).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'client-1', domain: 'oztop.com.au', market: 'AU' }),
    )
    expect(out.top_actions).toHaveLength(1)
    expect(out.tool_rounds).toBe(2)
    expect(out.tool_trace).toEqual([
      { name: 'query_keyword_detail', input: {}, summary: 'ok', is_error: false },
    ])
  })

  it('long 模式 maxToolRounds=4', async () => {
    mockTools.mockResolvedValue({
      text: VALID_JSON, input_tokens: 1, output_tokens: 1, cost_usd: 0,
      tool_rounds: 0, tool_calls: [], stop_reason: 'end_turn',
    })
    await conductPriorityActions(makeInput({ supabase: fakeSupabase, promptMode: 'long' }))
    expect(mockTools.mock.calls[0][0].maxToolRounds).toBe(4)
  })

  it('short 模式 maxToolRounds=2', async () => {
    mockTools.mockResolvedValue({
      text: VALID_JSON, input_tokens: 1, output_tokens: 1, cost_usd: 0,
      tool_rounds: 0, tool_calls: [], stop_reason: 'end_turn',
    })
    await conductPriorityActions(makeInput({ supabase: fakeSupabase, promptMode: 'short' }))
    expect(mockTools.mock.calls[0][0].maxToolRounds).toBe(2)
  })

  it('🔴 max_tokens 截断 → 抛错，绝不解析残缺 JSON', async () => {
    mockTools.mockResolvedValue({
      text: '{"top_actions":[{"rank":1,"dimen', // 截断的坏 JSON
      input_tokens: 1, output_tokens: 2048, cost_usd: 0.03,
      tool_rounds: 1, tool_calls: [], stop_reason: 'max_tokens',
    })
    await expect(conductPriorityActions(makeInput({ supabase: fakeSupabase }))).rejects.toThrow(/截断/)
  })
})

describe('向后兼容（不传 supabase）', () => {
  it('不传 supabase → 走 callClaudeChat，不走工具', async () => {
    mockChat.mockResolvedValue({ text: VALID_JSON, input_tokens: 10, output_tokens: 5, cost_usd: 0.001 })
    const out = await conductPriorityActions(makeInput())

    expect(mockChat).toHaveBeenCalledTimes(1)
    expect(mockTools).not.toHaveBeenCalled()
    expect(mockBuild).not.toHaveBeenCalled()
    expect(out.tool_trace).toBeUndefined()
    expect(out.top_actions).toHaveLength(1)
  })
})
