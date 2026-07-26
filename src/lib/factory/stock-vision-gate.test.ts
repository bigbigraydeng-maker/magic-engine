/**
 * 视觉相关性闸测试。
 *
 * 🔴 这个模块出过一次真事故,所以最重的一条断言是「调用失败 ≠ 判定不相关」:
 * 2026-07-26 视觉调用因环境问题连续失败 7 次,旧代码一律返回 relevant:false,
 * 调用方据此把 7 张好素材**永久下架**。调用挂了不是证据,只能「本轮别用」。
 */

import { describe, expect, it } from 'vitest'
import { buildVisionGatePrompt, parseVisionVerdict } from './stock-vision-gate'

/** 模型返回的两条判定都齐了才算完整 —— 少任何一条都当「没拿到判定」 */
const verdict = (o: { relevant?: boolean; has_text?: boolean; subject?: string; reason?: string }) =>
  JSON.stringify({ subject: 'x', relevant: true, has_text: false, ...o })

describe('parseVisionVerdict — 正常判定', () => {
  it('相关 + 无字 → 可用', () => {
    const v = parseVisionVerdict(verdict({ subject: 'Great Wall at dawn' }))
    expect(v.ok).toBe(true)
    expect(v.relevant).toBe(true)
    expect(v.reject).toBeNull()
    expect(v.subject).toBe('Great Wall at dawn')
  })

  it('模型判不相关 → reject=off_topic(这种才允许下架原图)', () => {
    const v = parseVisionVerdict(
      verdict({ subject: 'Coastal town in Italy', relevant: false, reason: 'different country' }),
    )
    expect(v.ok).toBe(true)
    expect(v.relevant).toBe(false)
    expect(v.reject).toBe('off_topic')
    expect(v.reason).toBe('different country')
  })

  it('剥掉 ```json 围栏', () => {
    const v = parseVisionVerdict('```json\n' + verdict({ subject: 'Guilin' }) + '\n```')
    expect(v.ok).toBe(true)
    expect(v.relevant).toBe(true)
  })
})

describe('🔴 画面带字要拦 —— 实测漏过一张「Hidden gem in Shanghai 🇨🇳」', () => {
  it('🔴 相关但画面上有烧死的字 → 不可用,原因是 has_text', () => {
    // 这张确实是上海豫园(**相关**),所以只问「相不相关」的旧闸一定放它过。
    // 它带着原图烧死的标题和表情,进片子会跟我们自己压的字幕叠在一起。
    const v = parseVisionVerdict(verdict({ subject: 'Shanghai garden pond', has_text: true }))
    expect(v.ok).toBe(true)
    expect(v.hasText).toBe(true)
    expect(v.relevant).toBe(false) // relevant 语义 = 「能不能用」
    expect(v.reject).toBe('has_text')
    expect(v.reason).toBeTruthy() // 没给原因也要有兜底话术,便于排查
  })

  it('两条都不过 → 报 off_topic(该换搜索词,比「有字」更能指导下一步)', () => {
    const v = parseVisionVerdict(verdict({ relevant: false, has_text: true }))
    expect(v.reject).toBe('off_topic')
  })

  it('🔴 缺 has_text 字段 → 当没拿到判定,不许据此下架', () => {
    const v = parseVisionVerdict('{"subject":"Great Wall","relevant":true}')
    expect(v.ok).toBe(false)
  })

  it('提示词点名要看上下边缘(叠加字幕通常在那儿)', () => {
    const p = buildVisionGatePrompt('x')
    expect(p).toMatch(/has_text/)
    expect(p).toMatch(/watermark|emoji/i)
    expect(p).toMatch(/top and bottom edges/i)
  })
})

describe('🔴 调用/返回失败 —— 绝不能被当成「判定为不相关」', () => {
  it('🔴 返回不是 JSON → ok=false(调用方不许据此下架)', () => {
    const v = parseVisionVerdict('It looks like you are running in a browser-like environment.')
    expect(v.ok).toBe(false)
    expect(v.relevant).toBe(false) // 仍然不用这张图 —— 但这是「跳过」不是「判死」
  })

  it('🔴 JSON 合法但缺 relevant 字段 → ok=false(返回不完整,不是判定)', () => {
    const v = parseVisionVerdict('{"subject":"Great Wall","has_text":false}')
    expect(v.ok).toBe(false)
  })

  it('🔴 relevant 是字符串而不是布尔 → ok=false(不猜模型意思)', () => {
    expect(parseVisionVerdict('{"subject":"x","relevant":"true","has_text":false}').ok).toBe(false)
    expect(parseVisionVerdict('{"subject":"x","relevant":"false","has_text":false}').ok).toBe(false)
  })

  it('空返回 / null → ok=false,不炸', () => {
    expect(parseVisionVerdict('').ok).toBe(false)
    expect(parseVisionVerdict('{}').ok).toBe(false)
    expect(parseVisionVerdict('null').ok).toBe(false)
  })

  it('🔴 ok=true 且 relevant=false 才是真判定 —— 两者不可混为一谈', () => {
    const failed = parseVisionVerdict('boom')
    const judged = parseVisionVerdict(verdict({ subject: 'Santorini', relevant: false }))
    expect(failed.relevant).toBe(judged.relevant) // 两者 relevant 都是 false
    expect(failed.ok).not.toBe(judged.ok) // 但只有后者能触发下架
  })
})

describe('提示词', () => {
  it('带上业务语境,并要求先说画面内容再判(直接问「相关吗」模型倾向一律答 yes)', () => {
    const p = buildVisionGatePrompt('China travel scenery. Imagery must NOT show: italy.')
    expect(p).toContain('China travel scenery')
    expect(p).toContain('italy')
    expect(p).toContain('subject')
  })

  it('明确要求拿不准就判不过(错图进成片比少一张贵得多)', () => {
    expect(buildVisionGatePrompt('x')).toMatch(/in doubt.*fail it/i)
  })

  it('长文本被截断,不让脏数据撑爆提示词', () => {
    const v = parseVisionVerdict(verdict({ subject: 'x'.repeat(500) }))
    expect(v.subject.length).toBeLessThanOrEqual(80)
  })
})
