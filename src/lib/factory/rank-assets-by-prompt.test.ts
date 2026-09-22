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

describe('rankAssetsByPrompt — requireConfidentMatch 挡住文不对题的选图', () => {
  it('挑出来的图跟 prompt 零关键词重叠时丢弃,返回空数组（复现 2026-09-14 故宫误配长城）', async () => {
    const { rankAssetsByPrompt } = await import('./rank-assets-by-prompt')
    // 小素材池(<=topN)分支：只有一张长城照,prompt 问故宫,零重叠。
    const assets = [asset('great-wall', { vision_metadata: { objects: ['Great Wall', 'mountains', 'fog'], quality_score: 9 } })]
    const picks = await rankAssetsByPrompt('forbidden city courtyard', assets, 1, { requireConfidentMatch: true })
    expect(picks).toEqual([])
  })

  it('挑出来的图跟 prompt 有关键词重叠时正常返回', async () => {
    const { rankAssetsByPrompt } = await import('./rank-assets-by-prompt')
    const assets = [asset('palace', { vision_metadata: { objects: ['palace', 'lion statue'], quality_score: 8 } })]
    const picks = await rankAssetsByPrompt('forbidden city palace courtyard', assets, 1, { requireConfidentMatch: true })
    expect(picks.map((p) => p.id)).toEqual(['palace'])
  })

  it('不开 requireConfidentMatch 时保持原样,零重叠也照样返回（人工选图界面靠这个看"最接近的几张"）', async () => {
    const { rankAssetsByPrompt } = await import('./rank-assets-by-prompt')
    const assets = [asset('great-wall', { vision_metadata: { objects: ['Great Wall'], quality_score: 9 } })]
    const picks = await rankAssetsByPrompt('forbidden city courtyard', assets, 1)
    expect(picks.map((p) => p.id)).toEqual(['great-wall'])
  })

  it('通用词(city/people/building...)单独命中不算重叠,不能靠它蒙混过 requireConfidentMatch', async () => {
    const { rankAssetsByPrompt } = await import('./rank-assets-by-prompt')
    // "Forbidden City courtyard" 跟错误素材 "city skyline" 光凭 city 这个通用词就有
    // 表面重叠,但两者根本不是同一个地方——city/skyline 都太笼统,不该算数。
    const assets = [asset('wrong-city', { vision_metadata: { objects: ['city skyline'], quality_score: 9 } })]
    const picks = await rankAssetsByPrompt('Forbidden City courtyard', assets, 1, { requireConfidentMatch: true })
    expect(picks).toEqual([])
  })

  it('虚词(the/and/with...)单独命中也不算重叠,不能靠它蒙混过 requireConfidentMatch', async () => {
    const { rankAssetsByPrompt } = await import('./rank-assets-by-prompt')
    // "the Forbidden City courtyard" 跟错误素材 "the Great Wall" 光凭 the 这个虚词就有
    // 表面重叠,但两者根本不是同一个地方。
    const assets = [asset('wrong-wall', { vision_metadata: { objects: ['the Great Wall'], quality_score: 9 } })]
    const picks = await rankAssetsByPrompt('the Forbidden City courtyard', assets, 1, { requireConfidentMatch: true })
    expect(picks).toEqual([])
  })

  it('时段/氛围描述词(sunset/ancient/traditional...)单独命中也不算重叠,不能靠它蒙混过 requireConfidentMatch', async () => {
    const { rankAssetsByPrompt } = await import('./rank-assets-by-prompt')
    // "sunset at the Forbidden City courtyard" 跟错误素材 objects=['Great Wall', 'sunset']
    // 光凭 sunset 这个氛围词就有表面重叠,但主体(Great Wall vs Forbidden City)根本对不上。
    const assets = [
      asset('wrong-wall', { vision_metadata: { objects: ['Great Wall', 'sunset'], quality_score: 9 } }),
    ]
    const picks = await rankAssetsByPrompt('sunset at the Forbidden City courtyard', assets, 1, {
      requireConfidentMatch: true,
    })
    expect(picks).toEqual([])
  })

  it('大素材池、真正走 LLM 排序分支时,LLM 选出的图跟 prompt 零重叠照样会被过滤（复现 2026-09-14 真实故障链路：素材池里明明有 palace 那张对的图,LLM 却选了 great-wall）', async () => {
    vi.resetModules()
    vi.doMock('@/lib/ai/openai-client', () => ({
      getOpenAIClient: () => ({
        chat: {
          completions: {
            create: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      picks: [{ id: 'great-wall', reason: '长城雾景符合古代遗迹氛围' }],
                    }),
                  },
                },
              ],
            }),
          },
        },
      }),
    }))
    const { rankAssetsByPrompt } = await import('./rank-assets-by-prompt')
    // pool 长度(3) > topN(1),强制走 rankWithLlm,不是小池分支。
    const assets = [
      asset('great-wall', { vision_metadata: { objects: ['Great Wall', 'mountains', 'fog'], quality_score: 9 } }),
      asset('palace', { vision_metadata: { objects: ['palace', 'lion statue'], quality_score: 8 } }),
      asset('other', { vision_metadata: { objects: ['skyline'], quality_score: 7 } }),
    ]
    const picks = await rankAssetsByPrompt('forbidden city courtyard', assets, 1, { requireConfidentMatch: true })
    expect(picks).toEqual([])
    vi.doUnmock('@/lib/ai/openai-client')
  })

  it('否定分句里的词(scene-plan.ts 固定生成的 "no product/logo")不能被当成正向主体命中', async () => {
    const { rankAssetsByPrompt } = await import('./rank-assets-by-prompt')
    // prompt 明确说"不要出现 logo",但素材标了 logo——这张图恰恰是该分句要挡住的,
    // 不能因为字面上都有 "logo" 就判成"文对图对"通过置信度门。
    const assets = [asset('has-logo', { vision_metadata: { objects: ['storefront', 'logo'], quality_score: 8 } })]
    const picks = await rankAssetsByPrompt('vertical 9:16 ambient b-roll, English, no product/logo', assets, 1, {
      requireConfidentMatch: true,
    })
    expect(picks).toEqual([])
  })

  it('否定分句不连累同一 prompt 里其他正向分句的正常匹配', async () => {
    const { rankAssetsByPrompt } = await import('./rank-assets-by-prompt')
    const assets = [asset('palace', { vision_metadata: { objects: ['palace', 'lion statue'], quality_score: 8 } })]
    const picks = await rankAssetsByPrompt('forbidden city palace courtyard, no product/logo', assets, 1, {
      requireConfidentMatch: true,
    })
    expect(picks.map((p) => p.id)).toEqual(['palace'])
  })

  it('素材正向命中(palace)但 brand_elements 里带着否定分句禁止的内容(logo)时,整张图仍要被挡住', async () => {
    const { rankAssetsByPrompt } = await import('./rank-assets-by-prompt')
    // objects 里没有 logo(所以只查 objects 挡不住),但 brand_elements 明确写了可见 logo。
    const assets = [
      asset('palace-with-logo', {
        vision_metadata: { objects: ['palace'], brand_elements: ['visible logo'], quality_score: 8 },
      }),
    ]
    const picks = await rankAssetsByPrompt('palace courtyard, no product/logo', assets, 1, {
      requireConfidentMatch: true,
    })
    expect(picks).toEqual([])
  })

  it('否定分句禁止的内容出现在 scene 字段里同样要被挡住,不止查 objects/brand_elements', async () => {
    const { rankAssetsByPrompt } = await import('./rank-assets-by-prompt')
    const assets = [
      asset('storefront', {
        vision_metadata: { objects: ['palace'], scene: 'storefront with logo signage', quality_score: 8 },
      }),
    ]
    const picks = await rankAssetsByPrompt('palace courtyard, no product/logo', assets, 1, {
      requireConfidentMatch: true,
    })
    expect(picks).toEqual([])
  })

  it('否定词出现在分句中间(不是段首)也要识别——"palace courtyard with no product or logo"', async () => {
    const { rankAssetsByPrompt } = await import('./rank-assets-by-prompt')
    // scene-plan.ts 没规定否定约束必须写成独立的逗号分句,LLM 完全可能写成这种
    // 否定词夹在分句中间的自然表述。
    const assets = [
      asset('has-logo', { vision_metadata: { objects: ['palace', 'logo'], quality_score: 8 } }),
    ]
    const picks = await rankAssetsByPrompt('palace courtyard with no product or logo', assets, 1, {
      requireConfidentMatch: true,
    })
    expect(picks).toEqual([])
  })

  it('分句中间的否定不连累否定词之前的正向词——同一分句里 "palace" 仍算正向命中', async () => {
    const { rankAssetsByPrompt } = await import('./rank-assets-by-prompt')
    const assets = [asset('palace', { vision_metadata: { objects: ['palace', 'lion statue'], quality_score: 8 } })]
    const picks = await rankAssetsByPrompt('palace courtyard with no product or logo', assets, 1, {
      requireConfidentMatch: true,
    })
    expect(picks.map((p) => p.id)).toEqual(['palace'])
  })

  it('objects/brand_elements 字段本身不是数组时,否定内容检查不炸,当空数组处理', async () => {
    const { rankAssetsByPrompt } = await import('./rank-assets-by-prompt')
    // 同文件已有的"objects 字段本身不是数组"用例(见下方 describe 块)同款构造方式,这里
    // 额外覆盖 containsNegatedContent 新引入的 brand_elements 展开路径——实测跑通不抛异常,
    // 断言 picks 为空(归一化成空数组后零重叠,被过滤掉)证明了这一点,不是空口说白话。
    const assets = [
      asset('bad-shape', {
        vision_metadata: {
          objects: 'palace' as unknown as string[],
          brand_elements: { visible: true } as unknown as string[],
          quality_score: 8,
        },
      }),
    ]
    const picks = await rankAssetsByPrompt('palace courtyard, no product/logo', assets, 1, {
      requireConfidentMatch: true,
    })
    expect(picks).toEqual([])
  })

  it('句号也要结束否定范围——"No product or logo. Palace courtyard at dusk." 里的 palace 仍算正向命中', async () => {
    const { rankAssetsByPrompt } = await import('./rank-assets-by-prompt')
    // planScenes 没规定 imagePrompt 一定是逗号分句,完全可能是这种多句英文。上一版
    // parsePromptWords 只按逗号/分号分段,句号不会重置否定状态，"palace"/"courtyard"
    // 会被错误并入 negated,合法的宫殿素材因此被误判成"带着被禁内容"、不必要地
    // 走 AI 现画兜底——这条用例复现该场景，断言修复后 palace 仍能正常匹配上。
    const assets = [asset('palace', { vision_metadata: { objects: ['palace', 'courtyard'], quality_score: 8 } })]
    const picks = await rankAssetsByPrompt('No product or logo. Palace courtyard at dusk.', assets, 1, {
      requireConfidentMatch: true,
    })
    expect(picks.map((p) => p.id)).toEqual(['palace'])
  })

  it('句号分段不影响否定分句本身仍然生效——句号前的 "no logo" 依然挡住带 logo 的素材', async () => {
    const { rankAssetsByPrompt } = await import('./rank-assets-by-prompt')
    const assets = [asset('has-logo', { vision_metadata: { objects: ['palace', 'logo'], quality_score: 8 } })]
    const picks = await rankAssetsByPrompt('No product or logo. Palace courtyard at dusk.', assets, 1, {
      requireConfidentMatch: true,
    })
    expect(picks).toEqual([])
  })

  it('brand_elements 用自然描述标记 logo("Nike swoosh")而不是字面词"logo"时,仍要被挡住', async () => {
    const { rankAssetsByPrompt } = await import('./rank-assets-by-prompt')
    // Codex 复审(P1)指出:vision-analyzer.ts 只要求列出可见品牌元素,不要求逐字复述
    // "logo"/"product" 这两个词——上一版 containsNegatedContent 纯字面词匹配,找不到
    // "Nike swoosh" 里的否定词,会让真的带 logo 的素材凭一个不相关的正向词(palace)
    // 混过置信度门。这里断言:只要 brand_elements 非空、且 prompt 要求 no logo/product,
    // 不管措辞是不是字面命中,一律挡住。
    const assets = [
      asset('palace-with-swoosh', {
        vision_metadata: { objects: ['palace'], brand_elements: ['Nike swoosh'], quality_score: 8 },
      }),
    ]
    const picks = await rankAssetsByPrompt('palace courtyard, no product/logo', assets, 1, {
      requireConfidentMatch: true,
    })
    expect(picks).toEqual([])
  })

  it('brand_elements 语义类别兜底不会误伤没有品牌元素的正常素材', async () => {
    const { rankAssetsByPrompt } = await import('./rank-assets-by-prompt')
    // brand_elements 为空数组(vision-analyzer 确实没看到任何品牌元素)时,不该仅仅因为
    // prompt 要求 no product/logo 就被一律挡住——语义类别兜底只在 brand_elements
    // 真的非空时触发。
    const assets = [
      asset('palace-clean', {
        vision_metadata: { objects: ['palace'], brand_elements: [], quality_score: 8 },
      }),
    ]
    const picks = await rankAssetsByPrompt('palace courtyard, no product/logo', assets, 1, {
      requireConfidentMatch: true,
    })
    expect(picks.map((p) => p.id)).toEqual(['palace-clean'])
  })
})

describe('rankAssetsByPrompt — objects 里混进非字符串元素不炸', () => {
  it('vision_metadata.objects 含 null/数字这类坏数据时,跳过它而不是抛异常', async () => {
    const { rankAssetsByPrompt } = await import('./rank-assets-by-prompt')
    // 小素材池(<=topN)分支已经会算 keywordOverlap(requireConfidentMatch 过滤时调用),
    // objects 里混进非字符串元素不该让整条判断炸掉。
    const assets = [
      asset('bad-data', {
        vision_metadata: { objects: ['palace', null, 123] as unknown as string[], quality_score: 8 },
      }),
    ]
    const picks = await rankAssetsByPrompt('forbidden city palace courtyard', assets, 1, {
      requireConfidentMatch: true,
    })
    expect(picks.map((p) => p.id)).toEqual(['bad-data'])
  })

  it('vision_metadata.objects 字段本身不是数组(存成字符串/对象)时,当空数组处理而不是抛异常', async () => {
    const { rankAssetsByPrompt } = await import('./rank-assets-by-prompt')
    // 老数据/坏数据可能把整个 objects 字段存成字符串而不是数组,.reduce 之前就该被挡住。
    const assets = [
      asset('bad-shape', {
        vision_metadata: { objects: 'palace' as unknown as string[], quality_score: 8 },
      }),
    ]
    const picks = await rankAssetsByPrompt('forbidden city palace courtyard', assets, 1, {
      requireConfidentMatch: true,
    })
    // objects 归一化成空数组 → 零重叠 → 被 requireConfidentMatch 挡住,不炸异常。
    expect(picks).toEqual([])
  })
})

describe('rankAssetsByPrompt — 人工搜索降级路径(不开 requireConfidentMatch)保留通用主体的相关性排序', () => {
  it('LLM 不可用时,通用词(city/people...)照样贡献排序信号,不退化成纯质量分排序', async () => {
    vi.resetModules()
    vi.doMock('@/lib/ai/openai-client', () => ({
      getOpenAIClient: () => {
        throw new Error('no client in test')
      },
    }))
    const { rankAssetsByPrompt } = await import('./rank-assets-by-prompt')
    // 素材数 > topN,强制走 LLM 分支(进而触发 catch → keywordFallback)。
    // "city skyline at night" 全是通用词,但人工搜索场景下这仍是有效相关性信号——
    // 应该排在跟 prompt 毫无关系的素材前面,而不是两者都 overlap=0 靠质量分定胜负。
    const assets = [
      asset('right-skyline', { vision_metadata: { objects: ['city skyline'], quality_score: 5 } }),
      asset('unrelated', { vision_metadata: { objects: ['peking duck'], quality_score: 9 } }),
    ]
    const picks = await rankAssetsByPrompt('city skyline at night', assets, 1)
    expect(picks.map((p) => p.id)).toEqual(['right-skyline'])
    vi.doUnmock('@/lib/ai/openai-client')
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
