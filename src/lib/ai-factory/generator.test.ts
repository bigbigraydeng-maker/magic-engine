/**
 * TDD — P21.2 AI Factory 服务层 + 记忆注入
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Module-level mocks (hoisted before imports) ───────────────────────────────

const mockCreate = vi.fn()

vi.mock('@/lib/anthropic/client', async actual => ({
  ...(await actual<typeof import('@/lib/anthropic/client')>()),
  getAnthropicClient: () => ({ messages: { create: mockCreate } }),
}))

vi.mock('@/lib/memory/service', () => ({
  loadMemoryForClient: vi.fn(),
}))

// ── Imports after mocks ───────────────────────────────────────────────────────

import { MODEL_HAIKU } from '@/lib/anthropic/client'
import { loadMemoryForClient } from '@/lib/memory/service'
import { buildSystemPrompt, buildUserPrompt } from './prompts'
import { runFactoryJob } from './generator'
import type { FactoryJobInput } from './types'
import type { MemoryContext } from '@/lib/memory/types'

const mockLoadMemory = vi.mocked(loadMemoryForClient)

// ── Test fixtures ─────────────────────────────────────────────────────────────

const emptyMemory: MemoryContext = {
  has_content: false,
  preferences: [],
  proven_patterns: [],
  failed_experiments: [],
  recent_decisions: [],
}

const richMemory: MemoryContext = {
  has_content: true,
  preferences: [
    {
      preference_type: 'tone',
      content: 'Friendly and approachable, avoid corporate jargon',
      confidence_score: 0.9,
      flywheel: undefined,
    },
  ],
  proven_patterns: [
    {
      pattern_type: 'hook',
      pattern_content: 'Questions outperform statements — CTR +28%',
      performance_metric: 'CTR +28%',
      flywheel: undefined,
    },
  ],
  failed_experiments: [],
  recent_decisions: [],
}

const baseInput: FactoryJobInput = {
  clientId:    'client-123',
  platform:    'facebook',
  contentType: 'post',
  topic:       'Summer travel deals for New Zealand families',
}

function makeApiResponse(text: string, inputTok = 100, outputTok = 50) {
  return {
    content: [{ type: 'text', text }],
    usage:   { input_tokens: inputTok, output_tokens: outputTok },
  }
}

// ── buildSystemPrompt ─────────────────────────────────────────────────────────

describe('buildSystemPrompt', () => {
  it('空记忆时不包含 Memory 段', () => {
    const sys = buildSystemPrompt(baseInput, emptyMemory)
    expect(sys).not.toContain('Client Memory')
  })

  it('有记忆时注入 formatMemoryForPrompt 块', () => {
    const sys = buildSystemPrompt(baseInput, richMemory)
    expect(sys).toContain('Client Memory')
    expect(sys).toContain('Friendly and approachable')
    expect(sys).toContain('Questions outperform statements')
  })

  it('包含 AU/NZ 上下文指引', () => {
    const sys = buildSystemPrompt(baseInput, emptyMemory)
    expect(sys).toContain('AU/NZ')
  })

  it('包含 Facebook 平台指引', () => {
    const sys = buildSystemPrompt(baseInput, emptyMemory)
    expect(sys.toLowerCase()).toContain('facebook')
  })

  it('注入 masterBrief 品牌信息时包含品牌名', () => {
    const input: FactoryJobInput = {
      ...baseInput,
      masterBrief: {
        id: 'b1',
        client_id: 'c1',
        version: 1,
        status: 'active',
        brand_name: 'CTS Tours NZ',
      } as never,
    }
    const sys = buildSystemPrompt(input, emptyMemory)
    expect(sys).toContain('CTS Tours NZ')
  })

  it('记忆块不包含 Recent Decisions（production 层省 token）', () => {
    const memWithDecisions: MemoryContext = {
      ...richMemory,
      recent_decisions: [
        {
          decision_context: 'test',
          chosen_action: 'Chose storytelling format',
          alternatives_rejected: [],
          reasoning: 'higher engagement',
          outcome_verdict: 'success',
          created_at: '',
        },
      ],
    }
    const sys = buildSystemPrompt(baseInput, memWithDecisions)
    // includeRecentDecisions: false → Recent Decisions 段不出现
    expect(sys).not.toContain('Recent Decisions')
  })
})

// ── buildUserPrompt ───────────────────────────────────────────────────────────

describe('buildUserPrompt', () => {
  it('包含 topic', () => {
    const up = buildUserPrompt(baseInput)
    expect(up).toContain('Summer travel deals for New Zealand families')
  })

  it('默认生成 1 个变体', () => {
    const up = buildUserPrompt(baseInput)
    expect(up).toContain('1 content variant')
  })

  it('variants=3 时要求生成 3 个变体', () => {
    const up = buildUserPrompt({ ...baseInput, variants: 3 })
    expect(up).toContain('3 distinct content variants')
  })

  it('variants 上限钳制为 5', () => {
    const up = buildUserPrompt({ ...baseInput, variants: 99 })
    expect(up).toContain('5 distinct content variants')
  })

  it('包含 fdeNote 时注入追加指令', () => {
    const up = buildUserPrompt({ ...baseInput, fdeNote: '强调限时 48 小时优惠' })
    expect(up).toContain('强调限时 48 小时优惠')
  })

  it('不含 fdeNote 时不输出 Additional instruction 行', () => {
    const up = buildUserPrompt(baseInput)
    expect(up).not.toContain('Additional instruction')
  })

  it('要求返回 JSON variants 格式', () => {
    const up = buildUserPrompt(baseInput)
    expect(up).toContain('"variants"')
  })
})

// ── runFactoryJob ─────────────────────────────────────────────────────────────

describe('runFactoryJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('使用 production 档位（Haiku），不使用 Sonnet', async () => {
    mockCreate.mockResolvedValue(makeApiResponse(
      '{"variants":[{"content":"Test post","hashtags":["#nz"]}]}',
    ))
    mockLoadMemory.mockResolvedValue(emptyMemory)

    const result = await runFactoryJob({} as never, baseInput)

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: MODEL_HAIKU }),
    )
    expect(result.modelUsed).toBe(MODEL_HAIKU)
    expect(result.memoryInjected).toBe(false)
  })

  it('有记忆时 memoryInjected = true', async () => {
    mockCreate.mockResolvedValue(makeApiResponse(
      '{"variants":[{"content":"Post","hashtags":[]}]}',
    ))
    mockLoadMemory.mockResolvedValue(richMemory)

    const result = await runFactoryJob({} as never, baseInput)

    expect(result.memoryInjected).toBe(true)
  })

  it('costUsd = production tier 计算值', async () => {
    mockCreate.mockResolvedValue(makeApiResponse(
      '{"variants":[{"content":"x","hashtags":[]}]}',
      1_000_000,
      1_000_000,
    ))
    mockLoadMemory.mockResolvedValue(emptyMemory)

    const result = await runFactoryJob({} as never, baseInput)

    // Haiku: $0.80/MTok in + $4/MTok out = $4.80 for 1M+1M
    expect(result.costUsd).toBeCloseTo(4.8, 4)
  })

  it('JSON 解析失败时优雅降级返回原始文本', async () => {
    mockCreate.mockResolvedValue(makeApiResponse(
      'Here is a great post about travel!',
    ))
    mockLoadMemory.mockResolvedValue(emptyMemory)

    const result = await runFactoryJob({} as never, baseInput)

    expect(result.variants).toHaveLength(1)
    expect(result.variants[0].content).toContain('great post about travel')
    expect(result.variants[0].hashtags).toEqual([])
  })

  it('结果包含 jobId、generatedAt 等元数据字段', async () => {
    mockCreate.mockResolvedValue(makeApiResponse(
      '{"variants":[{"content":"Post","hashtags":[]}]}',
    ))
    mockLoadMemory.mockResolvedValue(emptyMemory)

    const result = await runFactoryJob({} as never, baseInput)

    expect(result.jobId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    expect(result.clientId).toBe('client-123')
    expect(result.platform).toBe('facebook')
    expect(result.generatedAt).toBeTruthy()
  })

  it('flywheel 过滤器传给 loadMemoryForClient', async () => {
    mockCreate.mockResolvedValue(makeApiResponse(
      '{"variants":[{"content":"Post","hashtags":[]}]}',
    ))
    mockLoadMemory.mockResolvedValue(emptyMemory)

    await runFactoryJob({} as never, { ...baseInput, flywheel: 'social' })

    expect(mockLoadMemory).toHaveBeenCalledWith(
      expect.anything(),
      'client-123',
      expect.objectContaining({ flywheel: 'social' }),
    )
  })
})
