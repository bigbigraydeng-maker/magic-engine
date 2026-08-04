import { describe, it, expect } from 'vitest'
import { beatFor, buildPromptHint } from './narrative-beats'

/**
 * PM 2026-08-03 看片反馈：「第 10 秒开始的铺好地板的房间，和 12 秒走后开始
 * 铺设地板的逻辑顺序不对。」
 *
 * 真因：每个生成镜头独立瞎编 —— 提示词从没说过「你是第几拍、前面演过什么」，
 * 而爆款风格里那句 process-reveal 把施工画面带进了结尾。
 */
describe('叙事位置', () => {
  it('🔴 结尾明确禁止施工/未完工画面 —— 这正是 PM 退片的那一条', () => {
    const cta = beatFor({ index: 2, total: 3, role: 'cta' })
    expect(cta).toMatch(/do NOT show installation/i)
    expect(cta).toMatch(/finished/i)
  })

  it('开场也禁止施工画面 —— 前 3 秒要给结果，不是给工地', () => {
    const hook = beatFor({ index: 0, total: 3, role: 'hook' })
    expect(hook).toMatch(/do NOT show installation/i)
    expect(hook).toMatch(/finished result/i)
  })

  it('中段才是讲「怎么做到」的地方', () => {
    expect(beatFor({ index: 1, total: 3, role: 'middle' })).toMatch(/how it is done/i)
  })

  it('每一拍都告诉它自己是第几拍、共几拍', () => {
    expect(beatFor({ index: 0, total: 3, role: 'hook' })).toContain('shot 1 of 3')
    expect(beatFor({ index: 2, total: 3, role: 'cta' })).toContain('shot 3 of 3')
  })

  it('每一拍都要求跟其它镜头连贯', () => {
    for (const role of ['hook', 'middle', 'cta']) {
      expect(beatFor({ index: 0, total: 3, role })).toMatch(/continuity/i)
    }
  })

  it('认不出的角色按中段处理，不炸', () => {
    expect(beatFor({ index: 0, total: 2, role: 'unknown_role' })).toMatch(/how it is done/i)
  })
})

describe('buildPromptHint', () => {
  const base = 'Product Education — cta segment, real motion, 9:16 vertical'
  const style = 'proven flooring style: product demonstration, process-reveal'

  it('🔴 叙事约束排在风格前面 —— 让「不许拍施工」先于「process-reveal」出现', () => {
    const out = buildPromptHint({ base, role: 'cta', index: 2, total: 3, styleDirective: style })
    expect(out.indexOf('do NOT show installation')).toBeLessThan(out.indexOf('process-reveal'))
  })

  it('保留排产拼好的开头，不重复拼角度', () => {
    const out = buildPromptHint({ base, role: 'cta', index: 2, total: 3 })
    expect(out.startsWith(base)).toBe(true)
  })

  it('没有风格提示时也能用', () => {
    const out = buildPromptHint({ base, role: 'hook', index: 0, total: 3, styleDirective: null })
    expect(out).toContain('shot 1 of 3')
    expect(out).not.toContain('Style:')
  })
})
