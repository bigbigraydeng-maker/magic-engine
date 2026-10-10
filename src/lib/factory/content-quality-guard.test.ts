// 2026-09-20 Jev 评估 — 成片文案品控回归测试。
//
// 用例取自真实生产工单原文(内部广告文案,非客户 PII,按 CLAUDE.md 指引不做脱敏):
//   A. Oztop(client d5c98811)工单 4fb005b9/e70d0e80:角度写成 "mapei brisbane"/"karndean brisbane"
//   B. Oztop 6f97a4c5/6fa3938f/af6e4e99 + CTS 7c2809e1:字幕逐段写成内部内容分类标签
//   C. CTS 4812f7dc/9ba53cb0:brief 要求 Baker Gu 第一人称,AI 写成 "Our own offices. Our own guides."
//      对照组 CTS 402c98b9:同一叙事人格意图,AI 正确写成第一人称 "I've watched it happen..."

import { describe, expect, it, vi, beforeEach } from 'vitest'

const callJev = vi.fn()
vi.mock('@/lib/jev/client', () => ({
  callJev: (...a: unknown[]) => callJev(...a),
}))

import { findRepeatedCaption, scanContentQualityFlags } from './content-quality-guard'

const BAKER_GU_NARRATOR =
  'a single first-person narrator (a real CTS Tours representative named Baker Gu, ' +
  'tour guide, speaking about their own experience)'

beforeEach(() => {
  callJev.mockReset()
  delete process.env.FACTORY_QUALITY_GUARD_DISABLED
})

describe('findRepeatedCaption(确定性检测,零成本)', () => {
  it('🔴 真实 CTS 案例:同一内部标签重复 7 次 → 命中', () => {
    const texts = Array(7).fill('Expertise & Heritage Stories')
    const hit = findRepeatedCaption(texts)
    expect(hit).toEqual({ text: 'Expertise & Heritage Stories', count: 7 })
  })

  it('真实 Oztop 案例:三段字幕都是同一个内容分类标签 → 命中', () => {
    const hit = findRepeatedCaption(['Customer Stories & Community', 'Customer Stories & Community', 'Customer Stories & Community'])
    expect(hit?.text).toBe('Customer Stories & Community')
    expect(hit?.count).toBe(3)
  })

  it('两段完全相同的长字幕 → 命中(阈值 2,不是 3)', () => {
    const hit = findRepeatedCaption(['Backed by nearly a century of expertise', 'Backed by nearly a century of expertise'])
    expect(hit).not.toBeNull()
  })

  it('短 CTA 重复(如两段都写 "Shop now")→ 不命中,这是正常复用', () => {
    const hit = findRepeatedCaption(['Shop now', 'Shop now', 'Learn more'])
    expect(hit).toBeNull()
  })

  it('干净案例:各段字幕都不同 → 不命中', () => {
    const hit = findRepeatedCaption(['Destination Inspiration', 'See the story unfold'])
    expect(hit).toBeNull()
  })
})

describe('scanContentQualityFlags — A 竞品品牌当角度', () => {
  it('🔴 真实 Oztop 案例:角度 "mapei brisbane" → Jev 命中 → competitor_brand 标记', async () => {
    callJev.mockResolvedValue({ answers: { competitor_angle: { noul: 0.92 }, placeholder_leak: { noul: 0.05 } } })
    const flags = await scanContentQualityFlags({
      brandName: 'Oztop Building Supplies',
      angleLabel: 'mapei brisbane',
      onScreenHook: '$35.50/m²',
      captions: ['$35.50/m²', 'mapei brisbane'],
      intendedNarrator: null,
    })
    expect(flags.some((f) => f.category === 'competitor_brand')).toBe(true)
  })

  it('干净案例:角度是自己产品线 → Jev 低分 → 不标记', async () => {
    callJev.mockResolvedValue({ answers: { competitor_angle: { noul: 0.1 }, placeholder_leak: { noul: 0.05 } } })
    const flags = await scanContentQualityFlags({
      brandName: 'Oztop Building Supplies',
      angleLabel: 'SPC hybrid flooring clearance',
      onScreenHook: '$29.90/m²',
      captions: ['$29.90/m²'],
      intendedNarrator: null,
    })
    expect(flags.some((f) => f.category === 'competitor_brand')).toBe(false)
  })
})

describe('scanContentQualityFlags — B 内部标签冒充字幕', () => {
  it('🔴 真实 CTS 案例:7 段全是同一内部标签 → 确定性检测命中,无需等 Jev 也能标记', async () => {
    callJev.mockResolvedValue({ answers: { placeholder_leak: { noul: 0.02 } } }) // 假设 Jev 这次判断不准
    const flags = await scanContentQualityFlags({
      brandName: 'CTS Tours',
      angleLabel: null,
      onScreenHook: null,
      captions: Array(7).fill('Expertise & Heritage Stories'),
      intendedNarrator: null,
    })
    expect(flags.some((f) => f.category === 'placeholder_caption')).toBe(true)
  })

  it('非精确重复但读起来像占位符 → 只靠 Jev 判断命中(确定性检测抓不到这种)', async () => {
    callJev.mockResolvedValue({ answers: { placeholder_leak: { noul: 0.8 } } })
    const flags = await scanContentQualityFlags({
      brandName: 'CTS Tours',
      angleLabel: null,
      onScreenHook: null,
      captions: ['Customer Stories & Community', 'Offers & Product Highlights'], // 两段不同标签,不精确重复
      intendedNarrator: null,
    })
    expect(flags.some((f) => f.category === 'placeholder_caption')).toBe(true)
  })

  it('干净案例(真实文案):Jev 低分 + 无重复 → 不标记', async () => {
    callJev.mockResolvedValue({ answers: { placeholder_leak: { noul: 0.1 } } })
    const flags = await scanContentQualityFlags({
      brandName: 'Oztop Building Supplies',
      angleLabel: null,
      onScreenHook: null,
      captions: ['This waterproof floor took 3 years to perfect.', 'Installed by our Brisbane team in one day.', 'Get a free sample before you buy.'],
      intendedNarrator: null,
    })
    expect(flags.some((f) => f.category === 'placeholder_caption')).toBe(false)
  })
})

describe('scanContentQualityFlags — C 人称口吻不符简报', () => {
  it('🔴 真实 CTS 案例:brief 要求 Baker Gu 第一人称,文案却是 "Our own offices..." → 命中', async () => {
    callJev.mockResolvedValue({
      answers: { placeholder_leak: { noul: 0.05 }, wrong_voice: { noul: 0.88 } },
    })
    const flags = await scanContentQualityFlags({
      brandName: 'CTS Tours',
      angleLabel: null,
      onScreenHook: null,
      captions: [
        'Our own offices. Our own guides.',
        'No middlemen. No markups.',
        'The China locals know — not guidebook China.',
      ],
      intendedNarrator: BAKER_GU_NARRATOR,
    })
    expect(flags.some((f) => f.category === 'narrator_voice_mismatch')).toBe(true)
  })

  it('对照组(真实 CTS 402c98b9):同一叙事意图,AI 正确写成第一人称 → 不命中', async () => {
    callJev.mockResolvedValue({
      answers: { placeholder_leak: { noul: 0.05 }, wrong_voice: { noul: 0.1 } },
    })
    const flags = await scanContentQualityFlags({
      brandName: 'CTS Tours',
      angleLabel: null,
      onScreenHook: null,
      captions: ["I've watched it happen again and again — people leave for China nervous, and come back quietly changed."],
      intendedNarrator: BAKER_GU_NARRATOR,
    })
    expect(flags.some((f) => f.category === 'narrator_voice_mismatch')).toBe(false)
  })

  it('反向用例:brief 没声明具体叙述者 → 根本不该发起人称检测(不能对品牌口吻文案误报)', async () => {
    callJev.mockResolvedValue({ answers: { placeholder_leak: { noul: 0.05 } } })
    const flags = await scanContentQualityFlags({
      brandName: 'Oztop Building Supplies',
      angleLabel: null,
      onScreenHook: null,
      captions: ['We deliver excellence in every trip.', 'Our team handles logistics for you.'],
      intendedNarrator: null,
    })
    expect(flags.some((f) => f.category === 'narrator_voice_mismatch')).toBe(false)
    // 没配叙述人格就不该问 Jev 人称问题 —— 断言实际发出的 questions 里没有 wrong_voice
    const [, questions] = callJev.mock.calls[0]
    expect(questions.wrong_voice).toBeUndefined()
  })
})

describe('scanContentQualityFlags — fail-closed(Jev 不可用)', () => {
  it('🔴 Jev 调用失败 → quality_check_unavailable 标记,不静默放行,也不抛异常拖垮调用方', async () => {
    callJev.mockRejectedValue(new Error('network timeout'))
    const flags = await scanContentQualityFlags({
      brandName: 'Oztop Building Supplies',
      angleLabel: 'mapei brisbane',
      onScreenHook: '$35.50/m²',
      captions: ['$35.50/m²'],
      intendedNarrator: null,
    })
    expect(flags.some((f) => f.category === 'quality_check_unavailable')).toBe(true)
  })

  it('Jev 失败时,确定性检测(B 的精确重复)仍照常生效,不受 Jev 故障牵连', async () => {
    callJev.mockRejectedValue(new Error('network timeout'))
    const flags = await scanContentQualityFlags({
      brandName: 'CTS Tours',
      angleLabel: null,
      onScreenHook: null,
      captions: Array(7).fill('Expertise & Heritage Stories'),
      intendedNarrator: null,
    })
    expect(flags.some((f) => f.category === 'placeholder_caption')).toBe(true)
    expect(flags.some((f) => f.category === 'quality_check_unavailable')).toBe(true)
  })
})

describe('scanContentQualityFlags — 总开关', () => {
  it('FACTORY_QUALITY_GUARD_DISABLED=true → 完全跳过 Jev 调用(确定性检测仍生效)', async () => {
    process.env.FACTORY_QUALITY_GUARD_DISABLED = 'true'
    const flags = await scanContentQualityFlags({
      brandName: 'Oztop Building Supplies',
      angleLabel: 'mapei brisbane',
      onScreenHook: '$35.50/m²',
      captions: Array(3).fill('Customer Stories & Community'),
      intendedNarrator: null,
    })
    expect(callJev).not.toHaveBeenCalled()
    expect(flags.some((f) => f.category === 'placeholder_caption')).toBe(true)
    expect(flags.some((f) => f.category === 'competitor_brand')).toBe(false)
  })

  it('没有任何可判断文本(全空)→ 不发起 Jev 调用', async () => {
    const flags = await scanContentQualityFlags({
      brandName: 'Oztop Building Supplies',
      angleLabel: null,
      onScreenHook: null,
      captions: [],
      intendedNarrator: null,
    })
    expect(callJev).not.toHaveBeenCalled()
    expect(flags).toEqual([])
  })
})
