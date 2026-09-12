import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { RankableAsset } from './rank-assets-by-prompt'

const asset = (id: string, opts: Partial<RankableAsset> = {}): RankableAsset => ({
  id,
  storage_url: `https://x/${id}.jpg`,
  original_filename: `${id}.jpg`,
  vision_metadata: { objects: [], quality_score: 5 },
  source: 'client_verified',
  ...opts,
})

describe('rankAssetsByPrompt — 小素材库不烧 LLM 调用', () => {
  it('素材数 <= topN 时全给，按质量分排序，不调用 OpenAI', async () => {
    const { rankAssetsByPrompt } = await import('./rank-assets-by-prompt')
    const assets = [
      asset('a', { vision_metadata: { quality_score: 3 } }),
      asset('b', { vision_metadata: { quality_score: 9 } }),
    ]
    const picks = await rankAssetsByPrompt('great wall', assets, 5)
    expect(picks.map((p) => p.id)).toEqual(['b', 'a'])
    expect(picks[0].reason).toBe('Closest available library photo')
  })

  it('requireVerified=true 时过滤掉未核实来源，剩余不足 topN 也不调用 LLM', async () => {
    const { rankAssetsByPrompt } = await import('./rank-assets-by-prompt')
    const assets = [
      asset('verified', { source: 'client_verified' }),
      asset('unverified', { source: 'client_provided' }),
      asset('ai', { source: 'ai_generated' }),
    ]
    const picks = await rankAssetsByPrompt('great wall', assets, 5, { requireVerified: true })
    expect(picks.map((p) => p.id)).toEqual(['verified'])
  })

  it('requireVerified=true 且素材池全不合格时返回空数组，不炸', async () => {
    const { rankAssetsByPrompt } = await import('./rank-assets-by-prompt')
    const assets = [asset('a', { source: 'client_provided' }), asset('b', { source: 'unknown' })]
    const picks = await rankAssetsByPrompt('great wall', assets, 5, { requireVerified: true })
    expect(picks).toEqual([])
  })

  it('素材池本来就是空数组，直接返回空，不崩', async () => {
    const { rankAssetsByPrompt } = await import('./rank-assets-by-prompt')
    expect(await rankAssetsByPrompt('great wall', [], 5)).toEqual([])
  })
})

describe('rankAssetsByPrompt — requireRelevanceMatch：素材少也不能跳过关联性判断', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('pool.length <= topN 但唯一素材跟 prompt 无关时，LLM 判空卷，整体返回空数组（不落回关键词兜底凑一张）', async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ picks: [] }) } }],
    })
    vi.doMock('@/lib/ai/openai-client', () => ({
      getOpenAIClient: () => ({ chat: { completions: { create } } }),
    }))
    const { rankAssetsByPrompt } = await import('./rank-assets-by-prompt')

    // 素材库只有一张悉尼歌剧院照片，镜头要的是西藏布达拉宫——pool.length(1) <= topN(1)，
    // 但这张图跟镜头完全不相关，不该被当"最匹配"塞出去。
    const assets = [
      asset('sydney', { vision_metadata: { objects: ['sydney opera house'], quality_score: 9 } }),
    ]
    const picks = await rankAssetsByPrompt('Potala Palace in Tibet at dawn', assets, 1, {
      requireRelevanceMatch: true,
    })

    expect(create).toHaveBeenCalledTimes(1) // 没有走"素材少跳过 LLM"的近路
    expect(picks).toEqual([])
  })

  it('requireRelevanceMatch 关闭时（人工选图界面）素材少仍然走近路，直接给最接近的一张', async () => {
    const { rankAssetsByPrompt } = await import('./rank-assets-by-prompt')
    const assets = [
      asset('sydney', { vision_metadata: { objects: ['sydney opera house'], quality_score: 9 } }),
    ]
    const picks = await rankAssetsByPrompt('Potala Palace in Tibet at dawn', assets, 1)

    expect(picks.map((p) => p.id)).toEqual(['sydney'])
    expect(picks[0].reason).toBe('Closest available library photo')
  })

  it('requireRelevanceMatch 且 LLM 调用失败时，关键词兜底也要求真有重叠，零重叠返回空而不是给"质量最高"的那张', async () => {
    vi.doMock('@/lib/ai/openai-client', () => ({
      getOpenAIClient: () => {
        throw new Error('no client in test')
      },
    }))
    const { rankAssetsByPrompt } = await import('./rank-assets-by-prompt')

    const assets = [
      asset('sydney', { vision_metadata: { objects: ['sydney opera house'], quality_score: 9 } }),
    ]
    const picks = await rankAssetsByPrompt('Potala Palace in Tibet at dawn', assets, 1, {
      requireRelevanceMatch: true,
    })

    expect(picks).toEqual([])
  })
})

describe('rankAssetsByPrompt — LLM 调用失败时降级关键词兜底', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('OpenAI 客户端不可用时，走关键词重叠兜底而不是抛错', async () => {
    vi.doMock('@/lib/ai/openai-client', () => ({
      getOpenAIClient: () => {
        throw new Error('no client in test')
      },
    }))
    const { rankAssetsByPrompt } = await import('./rank-assets-by-prompt')

    // 素材数 > topN，强制走 LLM 分支（进而触发 catch → keywordFallback）
    const assets = [
      asset('wall', { vision_metadata: { objects: ['great wall'], quality_score: 5 } }),
      asset('duck', { vision_metadata: { objects: ['peking duck'], quality_score: 8 } }),
      asset('bund', { vision_metadata: { objects: ['bund skyline'], quality_score: 6 } }),
    ]
    const picks = await rankAssetsByPrompt('a shot of the great wall at sunrise', assets, 1)
    expect(picks).toHaveLength(1)
    expect(picks[0].id).toBe('wall')
    expect(picks[0].reason).toMatch(/Matches/)
  })
})
