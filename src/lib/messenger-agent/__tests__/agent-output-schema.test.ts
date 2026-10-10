/**
 * `MessengerAgentOutputSchema` 校验测试（Issue #1580 验证要求）。
 *
 * 这个 schema 是 Issue #1579（Verifier provenance 闸门）唯一认的输入契约
 * （v3 补丁#8：`offerings` 是 `{name, code}` 配对数组，不是两个独立数组）——
 * 这里只测 schema 本身的校验行为，不测 Verifier 逻辑（那是 #1579 的范围）。
 */

import { describe, it, expect } from 'vitest'
import { MessengerAgentOutputSchema } from '../agent-output-schema'

const VALID_OUTPUT = {
  reply_text: '你好，这个团目前还在售，价格是 NZ$4999。',
  confidence: 0.92,
  offerings: [{ name: 'Golden China', code: 'golden-china' }],
}

describe('MessengerAgentOutputSchema — 合法输出', () => {
  it('接受完整合法输出', () => {
    const parsed = MessengerAgentOutputSchema.parse(VALID_OUTPUT)
    expect(parsed).toEqual(VALID_OUTPUT)
  })

  it('offerings 允许空数组（纯政策类回答，不涉及具体团）', () => {
    const parsed = MessengerAgentOutputSchema.parse({
      reply_text: '这个问题会有人工同事跟进。',
      confidence: 0.3,
      offerings: [],
    })
    expect(parsed.offerings).toEqual([])
  })

  it('confidence 边界值 0 和 1 都合法', () => {
    expect(() => MessengerAgentOutputSchema.parse({ ...VALID_OUTPUT, confidence: 0 })).not.toThrow()
    expect(() => MessengerAgentOutputSchema.parse({ ...VALID_OUTPUT, confidence: 1 })).not.toThrow()
  })

  it('offerings 支持多个团配对', () => {
    const parsed = MessengerAgentOutputSchema.parse({
      ...VALID_OUTPUT,
      offerings: [
        { name: 'Golden China', code: 'golden-china' },
        { name: 'Silk Road', code: 'silk-road-discovery' },
      ],
    })
    expect(parsed.offerings).toHaveLength(2)
  })
})

describe('MessengerAgentOutputSchema — 非法输出必须被拒绝', () => {
  it('缺 reply_text', () => {
    const { confidence, offerings } = VALID_OUTPUT
    expect(() => MessengerAgentOutputSchema.parse({ confidence, offerings })).toThrow()
  })

  it('缺 confidence', () => {
    const { reply_text, offerings } = VALID_OUTPUT
    expect(() => MessengerAgentOutputSchema.parse({ reply_text, offerings })).toThrow()
  })

  it('缺 offerings 字段（不是空数组，是整个字段被省略）', () => {
    const { reply_text, confidence } = VALID_OUTPUT
    expect(() => MessengerAgentOutputSchema.parse({ reply_text, confidence })).toThrow()
  })

  it('reply_text 为空字符串', () => {
    expect(() => MessengerAgentOutputSchema.parse({ ...VALID_OUTPUT, reply_text: '' })).toThrow()
  })

  it('reply_text 类型错误（数字而非字符串）', () => {
    expect(() => MessengerAgentOutputSchema.parse({ ...VALID_OUTPUT, reply_text: 123 })).toThrow()
  })

  it.each([
    [-0.01, '略小于 0'],
    [1.01, '略大于 1'],
    [-1, '明显越界'],
    [2, '明显越界'],
  ])('confidence 超出 0-1 范围（%s，%s）被拒绝', (bad) => {
    expect(() => MessengerAgentOutputSchema.parse({ ...VALID_OUTPUT, confidence: bad })).toThrow()
  })

  it('confidence 类型错误（字符串而非数字）', () => {
    expect(() => MessengerAgentOutputSchema.parse({ ...VALID_OUTPUT, confidence: '0.9' })).toThrow()
  })

  it('offerings 不是数组', () => {
    expect(() =>
      MessengerAgentOutputSchema.parse({ ...VALID_OUTPUT, offerings: { name: 'x', code: 'y' } }),
    ).toThrow()
  })

  it('offerings 元素缺 code（v3 补丁#8 的核心：不能只给 name）', () => {
    expect(() =>
      MessengerAgentOutputSchema.parse({ ...VALID_OUTPUT, offerings: [{ name: 'Golden China' }] }),
    ).toThrow()
  })

  it('offerings 元素缺 name', () => {
    expect(() =>
      MessengerAgentOutputSchema.parse({ ...VALID_OUTPUT, offerings: [{ code: 'golden-china' }] }),
    ).toThrow()
  })

  it('offerings 元素字段类型错误', () => {
    expect(() =>
      MessengerAgentOutputSchema.parse({ ...VALID_OUTPUT, offerings: [{ name: 'x', code: 123 }] }),
    ).toThrow()
  })

  it('旧形状（两个独立数组 source_offering_codes/quoted_offering_names）必须被拒绝', () => {
    // 回归守卫：确保没有人不小心把 schema 改回 v3 补丁#8 之前的形状。
    expect(() =>
      MessengerAgentOutputSchema.parse({
        reply_text: VALID_OUTPUT.reply_text,
        confidence: VALID_OUTPUT.confidence,
        source_offering_codes: ['golden-china'],
        quoted_offering_names: ['Golden China'],
      }),
    ).toThrow()
  })

  it('多余的顶层字段被拒绝（.strict()）', () => {
    expect(() =>
      MessengerAgentOutputSchema.parse({ ...VALID_OUTPUT, extra_field: 'nope' }),
    ).toThrow()
  })
})
