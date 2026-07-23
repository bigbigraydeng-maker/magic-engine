/**
 * getViralClipDirective — 给内容工厂用的精简爆款指令。
 *
 * 存在理由:爆款库(606 条)本就是为工厂做的,却一直只挂在 reels 那条产线上 ——
 * 有配方,厨房没用。工厂 worker 把 clip 的 prompt_hint 原样喂给 i2v 模型,所以指令
 * 必须**短**:getViralStyleHint 那种多行研究材料适合喂文本 LLM,喂进视频提示词只会
 * 稀释画面指令、每条 clip 还多烧 token。
 *
 * 这组测试钉死:①短且可拼进提示词 ②按出现频次取主流手法而非随便取一条
 * ③没有可用参考时返回 null(调用方保持原提示词不变,绝不塞空话)。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { getViralClipDirective } from '../viral-style-advisor'
import { supabaseAdmin } from '@/lib/supabase'

const mockFrom = vi.mocked(supabaseAdmin.from)

interface Ref {
  style_description?: string | null
  key_techniques?: string[] | null
  opening_hook?: { type?: string } | null
  view_count?: number | null
}

/** 第一次查询(带 content_goal)返回 exact,第二次(fallback)返回 fb */
function installRefs(exact: Ref[], fb: Ref[] = []) {
  let call = 0
  mockFrom.mockImplementation(() => {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'order']) b[m] = () => b
    b.limit = () => {
      call += 1
      return Promise.resolve({ data: call === 1 ? exact : fb, error: null })
    }
    return b as never
  })
}

beforeEach(() => vi.clearAllMocks())

describe('getViralClipDirective', () => {
  it('🔴 输出短小可直接拼进 i2v 提示词(不是多行研究材料)', async () => {
    installRefs([
      { opening_hook: { type: 'problem-solution' }, key_techniques: ['fast cuts', 'text overlay'] },
      { opening_hook: { type: 'problem-solution' }, key_techniques: ['fast cuts'] },
    ])
    const d = await getViralClipDirective('flooring')

    expect(d).toBeTruthy()
    expect(d).not.toContain('\n')          // 单行
    expect(d!.length).toBeLessThan(160)    // 不喧宾夺主
    expect(d).toContain('flooring')
  })

  it('🔴 取出现频次最高的开场钩子,不是随便挑一条', async () => {
    installRefs([
      { opening_hook: { type: 'talking head' }, key_techniques: [] },
      { opening_hook: { type: 'problem-solution' }, key_techniques: [] },
      { opening_hook: { type: 'problem-solution' }, key_techniques: [] },
    ])
    const d = await getViralClipDirective('travel')

    expect(d).toContain('problem-solution')
    expect(d).not.toContain('talking head')
  })

  it('手法按频次取前三,大小写归一后计数', async () => {
    installRefs([
      { key_techniques: ['Fast Cuts', 'text overlay', 'drone'] },
      { key_techniques: ['fast cuts', 'TEXT OVERLAY'] },
      { key_techniques: ['fast cuts', 'ugc feel', 'closeup'] },
    ])
    const d = await getViralClipDirective('travel')

    expect(d).toContain('fast cuts')
    expect(d).toContain('text overlay')
    // 只出现一次的长尾不该挤进前三
    expect(d).not.toContain('closeup')
  })

  it('🔴 剔掉纯声音类手法(这段字是喂给画面生成模型的)', async () => {
    // 真实数据:travel 前三高频含 meme-audio-integration,喂进 i2v 提示词是纯噪音
    installRefs([
      { key_techniques: ['meme-audio-integration', 'drone shot'] },
      { key_techniques: ['meme-audio-integration', 'drone shot'] },
      { key_techniques: ['trending-song-sync', 'voiceover narration', 'drone shot'] },
    ])
    const d = await getViralClipDirective('travel')

    expect(d).toContain('drone shot')
    expect(d).not.toContain('audio')
    expect(d).not.toContain('song')
    expect(d).not.toContain('voiceover')
  })

  it('🔴 该行业无可用参考 → null(调用方保持原提示词,不塞空话)', async () => {
    installRefs([], [])
    expect(await getViralClipDirective('nonexistent_industry')).toBeNull()
  })

  it('参考存在但既无钩子也无手法 → null(没内容就别硬编一句)', async () => {
    installRefs([{ style_description: 'nice video', key_techniques: [], opening_hook: null }])
    expect(await getViralClipDirective('travel')).toBeNull()
  })

  it('精确 content_goal 无结果时落回不限 goal 的参考', async () => {
    installRefs([], [{ opening_hook: { type: 'ugc testimonial' }, key_techniques: ['handheld'] }])
    const d = await getViralClipDirective('flooring', 'sales')

    expect(d).toContain('ugc testimonial')
    expect(d).toContain('handheld')
  })
})
