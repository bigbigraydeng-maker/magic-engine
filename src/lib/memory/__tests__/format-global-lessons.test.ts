/**
 * 跨客户经验（global_lessons）注入 prompt 的行为测试。
 *
 * 核心不变量：
 *   1. has_content=false（客户无自身记忆）时，只要有全局经验就必须输出
 *      —— 新客户恰恰是最需要先验的时候，旧逻辑会把它整块吞掉
 *   2. 四类客户级记忆与全局经验都为空 → 仍返回空串（向后兼容）
 *   3. 全局经验排在客户偏好之前（多为「别再犯」类硬约束）
 */
import { describe, it, expect } from 'vitest'
import { formatMemoryForPrompt } from '../format'
import type { MemoryContext } from '../types'

const EMPTY: MemoryContext = {
  preferences: [],
  proven_patterns: [],
  failed_experiments: [],
  recent_decisions: [],
  has_content: false,
}

const LESSON = {
  lesson: '学区盘广告不要只投住在楼盘附近的人',
  rationale: '为学区搬家的买家现在不住在该学区里',
  scope: 'industry' as const,
  industry: 'real_estate',
  flywheel: 'ads' as const,
  confidence: 0.7,
}

describe('formatMemoryForPrompt — global lessons', () => {
  it('客户无自身记忆时仍输出全局经验（本次改动的核心目的）', () => {
    const out = formatMemoryForPrompt({ ...EMPTY, global_lessons: [LESSON] })
    expect(out).toContain('Cross-Client Lessons')
    expect(out).toContain('学区盘广告不要只投住在楼盘附近的人')
    // rationale 必须一起给出 —— 只给结论、不给依据的经验容易被 AI 误用
    expect(out).toContain('为学区搬家的买家现在不住在该学区里')
  })

  it('industry 层渲染出行业标签，便于 AI 判断适用范围', () => {
    const out = formatMemoryForPrompt({ ...EMPTY, global_lessons: [LESSON] })
    expect(out).toContain('[industry:real_estate/ads]')
  })

  it('全局经验排在客户偏好之前', () => {
    const ctx: MemoryContext = {
      ...EMPTY,
      has_content: true,
      preferences: [{
        preference_type: 'style',
        content: '客户偏好占位',
        confidence_score: 0.9,
        flywheel: null,
      }],
      global_lessons: [LESSON],
    }
    const out = formatMemoryForPrompt(ctx)
    expect(out.indexOf('Cross-Client Lessons')).toBeLessThan(out.indexOf('Content Preferences'))
  })

  it('includeGlobalLessons=false 时不输出，且无其他内容则整块为空', () => {
    const out = formatMemoryForPrompt(
      { ...EMPTY, global_lessons: [LESSON] },
      { includeGlobalLessons: false },
    )
    expect(out).toBe('')
  })

  it('全空时仍返回空串（向后兼容，旧调用方行为不变）', () => {
    expect(formatMemoryForPrompt(EMPTY)).toBe('')
    expect(formatMemoryForPrompt({ ...EMPTY, global_lessons: [] })).toBe('')
    expect(formatMemoryForPrompt(undefined)).toBe('')
  })

  it('global_lessons 字段缺失（旧调用方构造的字面量）不报错', () => {
    expect(() => formatMemoryForPrompt(EMPTY)).not.toThrow()
    expect(formatMemoryForPrompt(EMPTY)).toBe('')
  })

  it('scope=global / channel 不渲染行业标签', () => {
    const out = formatMemoryForPrompt({
      ...EMPTY,
      global_lessons: [{
        lesson: '配置一律走后台界面，禁止直接改数据库',
        rationale: null,
        scope: 'global',
        industry: null,
        flywheel: 'cross',
        confidence: 0.9,
      }],
    })
    expect(out).toContain('[global/cross]')
    expect(out).not.toContain('industry:')
    // 没有 rationale 时不该出现空的 "why:" 尾巴
    expect(out).not.toContain('— why:')
  })
})
