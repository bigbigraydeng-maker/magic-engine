/**
 * TDD — P21.3 变体扇出引擎
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Module-level mocks (hoisted before imports) ───────────────────────────────

vi.mock('./generator', () => ({
  runFactoryJob: vi.fn(),
}))

// ── Imports after mocks ───────────────────────────────────────────────────────

import { runFactoryJob } from './generator'
import { fanOutToPlatforms } from './fan-out'
import type { FanOutInput } from './fan-out'
import type { FactoryResult } from './types'

const mockRunFactoryJob = vi.mocked(runFactoryJob)

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeFactoryResult(platform: string): FactoryResult {
  return {
    jobId:          `job-${platform}`,
    clientId:       'client-123',
    platform:       platform as never,
    contentType:    'post',
    topic:          'Summer travel',
    variants:       [{ content: `Post for ${platform}`, hashtags: [`#${platform}`] }],
    memoryInjected: false,
    modelUsed:      'claude-haiku-4-5-20251001',
    inputTokens:    100,
    outputTokens:   50,
    costUsd:        0.0003,
    generatedAt:    new Date().toISOString(),
  }
}

const baseInput: FanOutInput = {
  clientId: 'client-123',
  topic:    'Summer travel deals for NZ families',
}

// ── fanOutToPlatforms ─────────────────────────────────────────────────────────

describe('fanOutToPlatforms', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('指定 2 个平台时返回 2 条结果', async () => {
    mockRunFactoryJob
      .mockResolvedValueOnce(makeFactoryResult('facebook'))
      .mockResolvedValueOnce(makeFactoryResult('instagram'))

    const result = await fanOutToPlatforms({} as never, {
      ...baseInput,
      platforms: ['facebook', 'instagram'],
    })

    expect(result.results).toHaveLength(2)
    expect(result.successCount).toBe(2)
  })

  it('不指定 platforms 时默认对全部 5 个平台扇出', async () => {
    mockRunFactoryJob.mockResolvedValue(makeFactoryResult('facebook'))

    const result = await fanOutToPlatforms({} as never, baseInput)

    expect(mockRunFactoryJob).toHaveBeenCalledTimes(5)
    expect(result.platforms).toHaveLength(5)
  })

  it('totalCostUsd = 各平台成本之和', async () => {
    mockRunFactoryJob
      .mockResolvedValueOnce(makeFactoryResult('facebook'))
      .mockResolvedValueOnce(makeFactoryResult('instagram'))

    const result = await fanOutToPlatforms({} as never, {
      ...baseInput,
      platforms: ['facebook', 'instagram'],
    })

    expect(result.totalCostUsd).toBeCloseTo(0.0006, 6)
  })

  it('一个平台失败时 successCount = n-1，失败项含 error 字段', async () => {
    mockRunFactoryJob
      .mockResolvedValueOnce(makeFactoryResult('facebook'))
      .mockRejectedValueOnce(new Error('Rate limit'))

    const result = await fanOutToPlatforms({} as never, {
      ...baseInput,
      platforms: ['facebook', 'instagram'],
    })

    expect(result.successCount).toBe(1)
    const failed = result.results.find(r => r.error !== undefined)
    expect(failed).toBeTruthy()
    expect(failed?.error).toContain('Rate limit')
    expect(failed?.result).toBeNull()
  })

  it('全部失败时 successCount = 0，totalCostUsd = 0', async () => {
    mockRunFactoryJob.mockRejectedValue(new Error('API error'))

    const result = await fanOutToPlatforms({} as never, {
      ...baseInput,
      platforms: ['facebook', 'instagram'],
    })

    expect(result.successCount).toBe(0)
    expect(result.totalCostUsd).toBe(0)
  })

  it('每个 runFactoryJob 调用使用对应平台', async () => {
    mockRunFactoryJob.mockResolvedValue(makeFactoryResult('facebook'))

    await fanOutToPlatforms({} as never, {
      ...baseInput,
      platforms: ['linkedin', 'tiktok'],
    })

    const platforms = mockRunFactoryJob.mock.calls.map(([, input]) => input.platform)
    expect(platforms).toContain('linkedin')
    expect(platforms).toContain('tiktok')
  })

  it('将 FanOutInput.contentType 传递给每个子任务', async () => {
    mockRunFactoryJob.mockResolvedValue(makeFactoryResult('facebook'))

    await fanOutToPlatforms({} as never, {
      ...baseInput,
      platforms:   ['facebook'],
      contentType: 'ad_copy',
    })

    expect(mockRunFactoryJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ contentType: 'ad_copy' }),
    )
  })

  it('platforms 重复时去重，只调用一次', async () => {
    mockRunFactoryJob.mockResolvedValue(makeFactoryResult('facebook'))

    await fanOutToPlatforms({} as never, {
      ...baseInput,
      platforms: ['facebook', 'facebook', 'instagram'],
    })

    expect(mockRunFactoryJob).toHaveBeenCalledTimes(2)
  })

  it('结果包含 topic 和 generatedAt 元数据', async () => {
    mockRunFactoryJob.mockResolvedValue(makeFactoryResult('facebook'))

    const result = await fanOutToPlatforms({} as never, {
      ...baseInput,
      platforms: ['facebook'],
    })

    expect(result.topic).toBe('Summer travel deals for NZ families')
    expect(result.generatedAt).toBeTruthy()
  })

  it('totalInputTokens / totalOutputTokens 为各平台之和', async () => {
    mockRunFactoryJob
      .mockResolvedValueOnce(makeFactoryResult('facebook'))   // inputTokens: 100, outputTokens: 50
      .mockResolvedValueOnce(makeFactoryResult('linkedin'))   // inputTokens: 100, outputTokens: 50

    const result = await fanOutToPlatforms({} as never, {
      ...baseInput,
      platforms: ['facebook', 'linkedin'],
    })

    expect(result.totalInputTokens).toBe(200)
    expect(result.totalOutputTokens).toBe(100)
  })

  it('成功结果的 platform 字段与输入平台对应', async () => {
    mockRunFactoryJob
      .mockResolvedValueOnce(makeFactoryResult('facebook'))
      .mockResolvedValueOnce(makeFactoryResult('instagram'))

    const result = await fanOutToPlatforms({} as never, {
      ...baseInput,
      platforms: ['facebook', 'instagram'],
    })

    const platforms = result.results.map(r => r.platform)
    expect(platforms).toContain('facebook')
    expect(platforms).toContain('instagram')
  })
})
