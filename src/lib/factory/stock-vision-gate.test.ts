/**
 * 视觉相关性闸测试。
 *
 * 🔴 这个模块出过一次真事故,所以最重的一条断言是「调用失败 ≠ 判定不相关」:
 * 2026-07-26 视觉调用因环境问题连续失败 7 次,旧代码一律返回 relevant:false,
 * 调用方据此把 7 张好素材**永久下架**。调用挂了不是证据,只能「本轮别用」。
 */

import { describe, expect, it } from 'vitest'
import { buildVisionGatePrompt, parseVisionVerdict } from './stock-vision-gate'

describe('parseVisionVerdict — 正常判定', () => {
  it('模型判相关 → ok + relevant', () => {
    const v = parseVisionVerdict('{"subject":"Great Wall at dawn","relevant":true,"reason":null}')
    expect(v.ok).toBe(true)
    expect(v.relevant).toBe(true)
    expect(v.subject).toBe('Great Wall at dawn')
  })

  it('模型判不相关 → ok + !relevant + 带原因(这种才允许下架)', () => {
    const v = parseVisionVerdict(
      '{"subject":"Coastal town in Italy","relevant":false,"reason":"different country"}',
    )
    expect(v.ok).toBe(true)
    expect(v.relevant).toBe(false)
    expect(v.reason).toBe('different country')
  })

  it('剥掉 ```json 围栏', () => {
    const v = parseVisionVerdict('```json\n{"subject":"Guilin","relevant":true}\n```')
    expect(v.ok).toBe(true)
    expect(v.relevant).toBe(true)
  })
})

describe('🔴 调用/返回失败 —— 绝不能被当成「判定为不相关」', () => {
  it('🔴 返回不是 JSON → ok=false(调用方不许据此下架)', () => {
    const v = parseVisionVerdict('It looks like you are running in a browser-like environment.')
    expect(v.ok).toBe(false)
    expect(v.relevant).toBe(false) // 仍然不用这张图 —— 但这是「跳过」不是「判死」
  })

  it('🔴 JSON 合法但缺 relevant 字段 → ok=false(返回不完整,不是判定)', () => {
    const v = parseVisionVerdict('{"subject":"Great Wall"}')
    expect(v.ok).toBe(false)
  })

  it('🔴 relevant 是字符串而不是布尔 → ok=false(不猜模型意思)', () => {
    expect(parseVisionVerdict('{"subject":"x","relevant":"true"}').ok).toBe(false)
    expect(parseVisionVerdict('{"subject":"x","relevant":"false"}').ok).toBe(false)
  })

  it('空返回 / null → ok=false,不炸', () => {
    expect(parseVisionVerdict('').ok).toBe(false)
    expect(parseVisionVerdict('{}').ok).toBe(false)
    expect(parseVisionVerdict('null').ok).toBe(false)
  })

  it('🔴 ok=true 且 relevant=false 才是真判定 —— 两者不可混为一谈', () => {
    const failed = parseVisionVerdict('boom')
    const judged = parseVisionVerdict('{"subject":"Santorini","relevant":false}')
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

  it('明确要求拿不准判 false(错图进成片比少一张贵得多)', () => {
    expect(buildVisionGatePrompt('x')).toMatch(/in doubt.*false/is)
  })

  it('长文本被截断,不让脏数据撑爆提示词', () => {
    const v = parseVisionVerdict(JSON.stringify({ subject: 'x'.repeat(500), relevant: true }))
    expect(v.subject.length).toBeLessThanOrEqual(80)
  })
})
