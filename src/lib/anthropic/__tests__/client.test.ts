/**
 * Tests for callClaudeWithTools — 通用 tool loop（P8.12.S3.1）
 *
 * Mock strategy: 整个 @anthropic-ai/sdk 被 mock，new Anthropic() 返回带
 * mock messages.create 的实例。每个测试按需排好 create 的返回序列。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate }
  },
}))

import { callClaudeWithTools } from '../client'

// ─── Helpers — 构造 Anthropic 风格的 message 响应 ──────────────────────────────

function endTurnMsg(text: string, input = 10, output = 5) {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: input, output_tokens: output },
  }
}

function toolUseMsg(name: string, input: unknown, id = 'tu_1', inTok = 20, outTok = 8) {
  return {
    content: [{ type: 'tool_use', id, name, input }],
    stop_reason: 'tool_use',
    usage: { input_tokens: inTok, output_tokens: outTok },
  }
}

const baseParams = {
  systemPrompt: 'you are a test agent',
  messages: [{ role: 'user' as const, content: 'hi' }],
  tools: [
    {
      name: 'echo',
      description: 'echo back',
      input_schema: { type: 'object' as const, properties: {}, required: [] },
    },
  ],
}

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key'
  mockCreate.mockReset()
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('callClaudeWithTools', () => {
  it('直接 end_turn（无工具调用）返回文本', async () => {
    mockCreate.mockResolvedValueOnce(endTurnMsg('hello world'))

    const result = await callClaudeWithTools({
      ...baseParams,
      toolHandlers: { echo: async () => 'ok' },
    })

    expect(result.text).toBe('hello world')
    expect(result.tool_rounds).toBe(0)
    expect(result.tool_calls).toEqual([])
    expect(result.input_tokens).toBe(10)
    expect(result.output_tokens).toBe(5)
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('一轮工具调用：handler 执行后结果回灌，再 end_turn', async () => {
    mockCreate
      .mockResolvedValueOnce(toolUseMsg('echo', { msg: 'ping' }))
      .mockResolvedValueOnce(endTurnMsg('done'))

    const handler = vi.fn(async () => 'pong')
    const result = await callClaudeWithTools({
      ...baseParams,
      toolHandlers: { echo: handler },
    })

    expect(handler).toHaveBeenCalledWith({ msg: 'ping' })
    expect(result.text).toBe('done')
    expect(result.tool_rounds).toBe(1)
    expect(result.tool_calls).toEqual([
      { name: 'echo', input: { msg: 'ping' }, result: 'pong', is_error: false },
    ])
    // token 累计跨两轮：20+10 / 8+5
    expect(result.input_tokens).toBe(30)
    expect(result.output_tokens).toBe(13)
    expect(mockCreate).toHaveBeenCalledTimes(2)
  })

  it('未知工具名 → tool_calls 标记 is_error', async () => {
    mockCreate
      .mockResolvedValueOnce(toolUseMsg('nonexistent', {}))
      .mockResolvedValueOnce(endTurnMsg('recovered'))

    const result = await callClaudeWithTools({
      ...baseParams,
      toolHandlers: { echo: async () => 'ok' },
    })

    expect(result.tool_calls).toHaveLength(1)
    expect(result.tool_calls[0].is_error).toBe(true)
    expect(result.tool_calls[0].result).toContain('Unknown tool')
    expect(result.text).toBe('recovered')
  })

  it('handler 抛错 → tool_calls 标记 is_error 且不中断循环', async () => {
    mockCreate
      .mockResolvedValueOnce(toolUseMsg('echo', {}))
      .mockResolvedValueOnce(endTurnMsg('handled'))

    const result = await callClaudeWithTools({
      ...baseParams,
      toolHandlers: {
        echo: async () => { throw new Error('boom') },
      },
    })

    expect(result.tool_calls[0].is_error).toBe(true)
    expect(result.tool_calls[0].result).toContain('boom')
    expect(result.text).toBe('handled')
  })

  it('撞 maxToolRounds → 去掉 tools 再调一次强制收尾', async () => {
    mockCreate
      .mockResolvedValueOnce(toolUseMsg('echo', {}))   // 第 1 轮（唯一一轮）
      .mockResolvedValueOnce(endTurnMsg('final text')) // 收尾调用

    const result = await callClaudeWithTools({
      ...baseParams,
      toolHandlers: { echo: async () => 'ok' },
      maxToolRounds: 1,
    })

    expect(mockCreate).toHaveBeenCalledTimes(2)
    // 收尾那次调用不带 tools
    const finalCallArgs = mockCreate.mock.calls[1][0]
    expect(finalCallArgs.tools).toBeUndefined()
    expect(result.text).toBe('final text')
    expect(result.tool_rounds).toBe(1)
  })
})

describe('budgeted single-attempt chat', () => {
  it('disables SDK retries and does not invoke fetch fallback after an ambiguous error', async () => {
    const { callClaudeChat } = await import('../client')
    const originalFetch = globalThis.fetch
    const fallback = vi.fn()
    globalThis.fetch = fallback
    mockCreate.mockRejectedValueOnce(new Error('response interrupted'))
    try {
      await expect(callClaudeChat({ systemPrompt: 'test', messages: [{ role: 'user', content: 'test' }], singleAttempt: true })).rejects.toThrow('response interrupted')
      expect(mockCreate).toHaveBeenCalledTimes(1)
      expect(mockCreate).toHaveBeenCalledWith(expect.anything(), { maxRetries: 0, timeout: 60000 })
      expect(fallback).not.toHaveBeenCalled()
    } finally { globalThis.fetch = originalFetch }
  })
})
