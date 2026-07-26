/**
 * 改图指令测试。
 *
 * 这条 prompt 里每一条约束都是 PM 看片抓出来的缺陷换来的,很容易在后续改动里被顺手删掉。
 * 这些用例就是钉子:删一条,测试就红。
 */

import { describe, expect, it } from 'vitest'
import { buildTransformedMeta, buildTransformPrompt } from './stock-transform'

describe('buildTransformPrompt — 三条事故约束', () => {
  const p = buildTransformPrompt({ title: 'Great Wall', sceneHint: 'establishing' })

  it('保场景保构图(改成别的地方 = 编造客户不去的目的地)', () => {
    expect(p).toMatch(/same scene/i)
    expect(p).toMatch(/camera angle/i)
  })

  it('🔴 写实,禁一切「电影感」加持(PM:「AI 生成的图很夸张,太假」)', () => {
    expect(p).toMatch(/documentary realism/i)
    expect(p).toMatch(/not over-saturated/i)
    expect(p).toMatch(/no illustration|no painting|no 3D render/i)
  })

  it('🔴 调色不在这一步做(装配层会再调一遍,叠成过饱和橙)', () => {
    // 传了 look 也不该把它写进指令 —— 参数只为兼容旧调用方
    const withLook = buildTransformPrompt({ title: 'x', look: 'golden_hour' })
    expect(withLook).not.toMatch(/golden_hour/)
    expect(withLook).toMatch(/no heavy golden or orange cast/i)
  })

  it('🔴 招牌要整个拿掉,不能留空白板(留白板比乱码还假)', () => {
    expect(p).toMatch(/remove signage entirely/i)
    expect(p).toMatch(/never leave empty white panels|blank rectangles/i)
  })

  it('🔴 零文字 —— 生成的中文必然是乱码,且会跟压上去的字幕打架', () => {
    expect(p).toMatch(/zero Chinese characters/i)
    expect(p).toMatch(/no watermark/i)
  })

  it('竖屏 + 上三分之一留白给字幕', () => {
    expect(p).toMatch(/9:16/)
    expect(p).toMatch(/upper third/i)
  })

  it('标题会进指令(告诉模型画的是什么),缺标题也不炸', () => {
    expect(buildTransformPrompt({ title: 'Zhangjiajie' })).toContain('Zhangjiajie')
    expect(() => buildTransformPrompt({})).not.toThrow()
    expect(buildTransformPrompt({ title: null, sceneHint: null }).length).toBeGreaterThan(100)
  })

  it('超长标题被截断,不让脏数据撑爆指令', () => {
    expect(buildTransformPrompt({ title: 'x'.repeat(400) })).not.toContain('x'.repeat(200))
  })
})

describe('buildTransformedMeta — 版权隔离的证据链', () => {
  const m = buildTransformedMeta({
    sourceClipId: 'src-1',
    sourceUrl: 'https://i.pinimg.com/a.jpg',
    prompt: 'p',
    query: 'china travel',
  })

  it('🔴 标明是 AI 衍生图,不是抓来的原件', () => {
    expect(m.is_ai_transformed).toBe(true)
    expect(m.origin).toBe('stock_transformed')
  })

  it('🔴 不是真拍素材 —— 绝不能被当客户真实产品画面用', () => {
    expect(m.is_real_footage).toBe(false)
    expect(m.is_still_image).toBe(true)
  })

  it('能查回是哪张原图、用什么指令改的', () => {
    expect(m.derived_from_clip_id).toBe('src-1')
    expect(m.derived_from_url).toBe('https://i.pinimg.com/a.jpg')
    expect(m.transform_prompt).toBe('p')
  })

  it('指令过长会截断存,不把整段塞进 jsonb', () => {
    const big = buildTransformedMeta({ sourceClipId: 'a', sourceUrl: null, prompt: 'y'.repeat(2000), query: null })
    expect((big.transform_prompt as string).length).toBeLessThanOrEqual(500)
  })
})
