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
