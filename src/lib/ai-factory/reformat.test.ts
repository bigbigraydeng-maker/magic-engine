/**
 * TDD — P21.3 多平台 reformat 引擎
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Module-level mocks (hoisted before imports) ───────────────────────────────

const mockCreate = vi.fn()

vi.mock('@/lib/anthropic/client', async actual => ({
  ...(await actual<typeof import('@/lib/anthropic/client')>()),
  getAnthropicClient: () => ({ messages: { create: mockCreate } }),
}))

// ── Imports after mocks ───────────────────────────────────────────────────────

import { MODEL_HAIKU } from '@/lib/anthropic/client'
import { reformatForPlatform } from './reformat'
import type { ReformatInput } from './reformat'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeApiResponse(text: string, inputTok = 80, outputTok = 120) {
  return {
    content: [{ type: 'text', text }],
    usage:   { input_tokens: inputTok, output_tokens: outputTok },
  }
}

const baseInput: ReformatInput = {
  sourceContent:  '🌊 Summer is HERE! Book your NZ getaway today. Limited spots available. #NZTravel',
  sourcePlatform: 'instagram',
  targetPlatform: 'linkedin',
}

// ── reformatForPlatform ───────────────────────────────────────────────────────

describe('reformatForPlatform', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('返回 reformattedContent 和 hashtags 字段', async () => {
    mockCreate.mockResolvedValue(makeApiResponse(
      '{"reformattedContent":"Professional NZ summer travel guide","hashtags":["#NewZealand","#BusinessTravel"]}',
    ))

    const result = await reformatForPlatform(baseInput)

    expect(result.reformattedContent).toBe('Professional NZ summer travel guide')
    expect(result.hashtags).toEqual(['#NewZealand', '#BusinessTravel'])
  })

  it('使用 production 档位（Haiku）', async () => {
    mockCreate.mockResolvedValue(makeApiResponse(
      '{"reformattedContent":"content","hashtags":[]}',
    ))

    const result = await reformatForPlatform(baseInput)

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: MODEL_HAIKU }),
    )
    expect(result.modelUsed).toBe(MODEL_HAIKU)
  })

  it('system prompt 包含 sourcePlatform 和 targetPlatform', async () => {
    mockCreate.mockResolvedValue(makeApiResponse(
      '{"reformattedContent":"content","hashtags":[]}',
    ))

    await reformatForPlatform(baseInput)

    const callArgs = mockCreate.mock.calls[0][0]
    const sys = callArgs.system as string
    expect(sys.toLowerCase()).toContain('instagram')
    expect(sys.toLowerCase()).toContain('linkedin')
  })

  it('sourceContent 出现在 user prompt 中', async () => {
    mockCreate.mockResolvedValue(makeApiResponse(
      '{"reformattedContent":"content","hashtags":[]}',
    ))

    await reformatForPlatform(baseInput)

    const callArgs = mockCreate.mock.calls[0][0]
    const messages = callArgs.messages as Array<{ role: string; content: string }>
    expect(messages[0].content).toContain(baseInput.sourceContent)
  })

  it('JSON 解析失败时优雅降级为原始文本', async () => {
    mockCreate.mockResolvedValue(makeApiResponse(
      'Here is the reformatted version: Try NZ this summer!',
    ))

    const result = await reformatForPlatform(baseInput)

    expect(result.reformattedContent).toBeTruthy()
    expect(Array.isArray(result.hashtags)).toBe(true)
    expect(result.hashtags).toEqual([])
  })

  it('包含 inputTokens / outputTokens / costUsd 元数据', async () => {
    mockCreate.mockResolvedValue(makeApiResponse(
      '{"reformattedContent":"content","hashtags":[]}',
      500,
      200,
    ))

    const result = await reformatForPlatform(baseInput)

    expect(result.inputTokens).toBe(500)
    expect(result.outputTokens).toBe(200)
    expect(result.costUsd).toBeGreaterThan(0)
  })

  it('costUsd 按 production Haiku 定价计算', async () => {
    mockCreate.mockResolvedValue(makeApiResponse(
      '{"reformattedContent":"content","hashtags":[]}',
      1_000_000,
      1_000_000,
    ))

    const result = await reformatForPlatform(baseInput)

    // Haiku: $0.80/MTok in + $4/MTok out = $4.80
    expect(result.costUsd).toBeCloseTo(4.8, 4)
  })

  it('注入 masterBrief 时品牌名出现在 system prompt 中', async () => {
    mockCreate.mockResolvedValue(makeApiResponse(
      '{"reformattedContent":"content","hashtags":[]}',
    ))

    await reformatForPlatform({
      ...baseInput,
      masterBrief: {
        id: 'b1', client_id: 'c1', version: 1, status: 'active',
        brand_name: 'CTS Tours NZ',
      } as never,
    })

    const sys = mockCreate.mock.calls[0][0].system as string
    expect(sys).toContain('CTS Tours NZ')
  })

  it('fdeNote 出现在 user prompt 中', async () => {
    mockCreate.mockResolvedValue(makeApiResponse(
      '{"reformattedContent":"content","hashtags":[]}',
    ))

    await reformatForPlatform({
      ...baseInput,
      fdeNote: '强调公务旅行报销政策',
    })

    const messages = mockCreate.mock.calls[0][0].messages as Array<{ content: string }>
    expect(messages[0].content).toContain('强调公务旅行报销政策')
  })

  it('sourcePlatform === targetPlatform 时仍然成功（不报错）', async () => {
    mockCreate.mockResolvedValue(makeApiResponse(
      '{"reformattedContent":"Same content","hashtags":["#travel"]}',
    ))

    const result = await reformatForPlatform({
      ...baseInput,
      sourcePlatform: 'instagram',
      targetPlatform: 'instagram',
    })

    expect(result.reformattedContent).toBeTruthy()
  })

  it('结果 sourcePlatform / targetPlatform 与输入一致', async () => {
    mockCreate.mockResolvedValue(makeApiResponse(
      '{"reformattedContent":"content","hashtags":[]}',
    ))

    const result = await reformatForPlatform(baseInput)

    expect(result.sourcePlatform).toBe('instagram')
    expect(result.targetPlatform).toBe('linkedin')
    expect(result.sourceContent).toBe(baseInput.sourceContent)
  })
})
