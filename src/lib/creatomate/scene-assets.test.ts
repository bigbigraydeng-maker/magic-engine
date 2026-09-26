import { describe, it, expect, vi, beforeEach } from 'vitest'

const planScenes = vi.fn()
vi.mock('@/lib/factory/scene-plan', () => ({ planScenes: (...a: unknown[]) => planScenes(...a) }))

const classifyRenderMode = vi.fn()
vi.mock('@/lib/factory/shot-guards', () => ({ classifyRenderMode: (...a: unknown[]) => classifyRenderMode(...a) }))

const imageToClip = vi.fn()
vi.mock('@/lib/factory/broll-clip', () => ({ imageToClip: (...a: unknown[]) => imageToClip(...a) }))

const generateImage = vi.fn()
vi.mock('@/lib/visual/openai-images', () => ({ generateImage: (...a: unknown[]) => generateImage(...a) }))

const uploadFromBase64 = vi.fn()
vi.mock('@/lib/visual/storage', () => ({ uploadFromBase64: (...a: unknown[]) => uploadFromBase64(...a) }))

const generateVoiceover = vi.fn()
vi.mock('@/lib/audio/minimax-voice', () => ({ generateVoiceover: (...a: unknown[]) => generateVoiceover(...a) }))

const loadRankableClientAssets = vi.fn()
vi.mock('@/lib/factory/client-asset-pool', () => ({
  loadRankableClientAssets: (...a: unknown[]) => loadRankableClientAssets(...a),
}))

const rankAssetsByPrompt = vi.fn()
vi.mock('@/lib/factory/rank-assets-by-prompt', () => ({
  rankAssetsByPrompt: (...a: unknown[]) => rankAssetsByPrompt(...a),
}))

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

const CLIENT_ID = 'client-cts'
const JOB_ID = 'job-1'
const FACTORY_CONFIG = { render: { voice_id: 'bigrayvoice01' } }

beforeEach(() => {
  vi.clearAllMocks()
  planScenes.mockResolvedValue({
    scenes: [
      { index: 0, imagePrompt: 'great wall at sunrise', motionPrompt: 'slow push in', voText: '长城', captionText: 'GREAT WALL' },
    ],
  })
  generateVoiceover.mockResolvedValue({ audioUrl: 'https://x/vo.mp3', costUsd: 0.01 })
})

describe('prepareSceneAssets — 真实照片优先', () => {
  it('素材池命中真实照片时直接用，不调用 generateImage/imageToClip', async () => {
    loadRankableClientAssets.mockResolvedValue([
      { id: 'p1', storage_url: 'https://x/greatwall.jpg', original_filename: 'greatwall.jpg', vision_metadata: {}, source: 'client_verified' },
    ])
    rankAssetsByPrompt.mockResolvedValue([
      { id: 'p1', storageUrl: 'https://x/greatwall.jpg', reason: 'match', qualityScore: 8, metadata: null, source: 'client_verified' },
    ])

    const { prepareSceneAssets } = await import('./scene-assets')
    const scenes = await prepareSceneAssets({
      clientId: CLIENT_ID,
      jobId: JOB_ID,
      title: 't',
      script: 's',
      factoryConfig: FACTORY_CONFIG,
    })

    expect(scenes).toHaveLength(1)
    expect(scenes[0].visualUrl).toBe('https://x/greatwall.jpg')
    expect(scenes[0].visualType).toBe('image')
    expect(scenes[0].visualSource).toBe('real_photo')
    expect(scenes[0].costUsd).toBeCloseTo(0.01) // 只有配音成本，画面免费
    expect(generateImage).not.toHaveBeenCalled()
    expect(imageToClip).not.toHaveBeenCalled()
    // requireVerified 必须开 —— 出片自动选图不能选到未核实来源
    expect(rankAssetsByPrompt).toHaveBeenCalledWith(
      'great wall at sunrise',
      expect.anything(),
      1,
      { requireVerified: true, requireConfidentMatch: true },
    )
  })

  it('素材池为空数组时跳过排序调用，直接走 AI 现画回退（不浪费一次 LLM 调用）', async () => {
    loadRankableClientAssets.mockResolvedValue([])
    classifyRenderMode.mockReturnValue({ mode: 'real_pixel' })
    generateImage.mockResolvedValue({ b64: 'BASE64' })
    uploadFromBase64.mockResolvedValue({ storage_url: 'https://x/ai.jpg' })

    const { prepareSceneAssets } = await import('./scene-assets')
    const scenes = await prepareSceneAssets({
      clientId: CLIENT_ID,
      jobId: JOB_ID,
      title: 't',
      script: 's',
      factoryConfig: FACTORY_CONFIG,
    })

    expect(scenes[0].visualSource).toBe('ai_generated')
    expect(scenes[0].visualUrl).toBe('https://x/ai.jpg')
    expect(rankAssetsByPrompt).not.toHaveBeenCalled()
    expect(generateImage).toHaveBeenCalledTimes(1)
  })

  it('素材池非空但没有匹配（rankAssetsByPrompt 返回空）时回退 AI 现画 + i2v', async () => {
    loadRankableClientAssets.mockResolvedValue([
      { id: 'p1', storage_url: 'https://x/other.jpg', original_filename: 'other.jpg', vision_metadata: {}, source: 'client_verified' },
    ])
    rankAssetsByPrompt.mockResolvedValue([])
    classifyRenderMode.mockReturnValue({ mode: 'i2v' })
    generateImage.mockResolvedValue({ b64: 'BASE64' })
    uploadFromBase64.mockResolvedValue({ storage_url: 'https://x/ai.jpg' })
    imageToClip.mockResolvedValue({ clipUrl: 'https://x/ai-clip.mp4', costUsd: 0.3 })

    const { prepareSceneAssets } = await import('./scene-assets')
    const scenes = await prepareSceneAssets({
      clientId: CLIENT_ID,
      jobId: JOB_ID,
      title: 't',
      script: 's',
      factoryConfig: FACTORY_CONFIG,
    })

    expect(scenes[0].visualSource).toBe('ai_generated')
    expect(scenes[0].visualType).toBe('video')
    expect(scenes[0].visualUrl).toBe('https://x/ai-clip.mp4')
    expect(scenes[0].costUsd).toBeCloseTo(0.31)
  })

  it('projectId/listingId 默认 null 时显式透传给 loadRankableClientAssets（CTS 不需要楼盘/房源隔离，但不能漏传）', async () => {
    loadRankableClientAssets.mockResolvedValue([])
    classifyRenderMode.mockReturnValue({ mode: 'real_pixel' })
    generateImage.mockResolvedValue({ b64: 'BASE64' })
    uploadFromBase64.mockResolvedValue({ storage_url: 'https://x/ai.jpg' })

    const { prepareSceneAssets } = await import('./scene-assets')
    await prepareSceneAssets({
      clientId: CLIENT_ID,
      jobId: JOB_ID,
      title: 't',
      script: 's',
      factoryConfig: FACTORY_CONFIG,
    })

    expect(loadRankableClientAssets).toHaveBeenCalledWith(CLIENT_ID, {}, null, null)
  })
})
