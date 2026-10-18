import { describe, expect, it } from 'vitest'
import { parseSkillCard } from '../parse'

function index(points: unknown[]): string {
  return ['## 机器索引', '<!-- 注释 -->', '```json', JSON.stringify({ points }), '```', ''].join('\n')
}

function card(indexBlock: string): string {
  return [
    '# 测试卡标题',
    '',
    '来源：YouTube「x」https://www.youtube.com/watch?v=abc | 作者 y',
    '',
    '## 裁决',
    '正文',
    '',
    indexBlock,
  ].join('\n')
}

const FILE = '2026-01-01-test-card.md'

describe('parseSkillCard', () => {
  it('合法卡能解析出标题、来源、点', () => {
    const text = card(
      index([
        { key: 'a', text: '点A', state: 'learning' },
        { key: 'b', text: '点B', state: 'verifying', handoff: '2026-01-01-skill-handoff-1-x' },
      ]),
    )
    const result = parseSkillCard(FILE, text)
    if (!result.ok) throw new Error('expected ok')
    expect(result.card.id).toBe('2026-01-01-test-card')
    expect(result.card.title).toBe('测试卡标题')
    expect(result.card.sourceUrl).toBe('https://www.youtube.com/watch?v=abc')
    expect(result.card.hasCorrection).toBe(false)
    expect(result.card.points).toHaveLength(2)
    expect(result.card.points[0].handoff).toBeNull()
    expect(result.card.points[1].handoff).toBe('2026-01-01-skill-handoff-1-x')
  })

  it('有「复核更正」时 hasCorrection 为 true', () => {
    const text = card(index([{ key: 'a', text: '点A', state: 'learning' }])) + '\n## 复核更正（x）\n'
    const result = parseSkillCard(FILE, text)
    if (!result.ok) throw new Error('expected ok')
    expect(result.card.hasCorrection).toBe(true)
  })

  it('缺少「## 机器索引」一节时报错', () => {
    const text = ['# 测试卡标题', '', '来源：https://example.com/x', '', '正文'].join('\n')
    const result = parseSkillCard(FILE, text)
    if (result.ok) throw new Error('expected error')
    expect(result.error.reason).toContain('机器索引')
  })

  it('有机器索引标题但没有 json 代码块时报错', () => {
    const text = card(['## 机器索引', '<!-- 注释 -->', ''].join('\n'))
    const result = parseSkillCard(FILE, text)
    if (result.ok) throw new Error('expected error')
    expect(result.error.reason).toContain('代码块')
  })

  it('JSON 不合法时报错', () => {
    const text = card(['## 机器索引', '```json', '{"points": [', '```', ''].join('\n'))
    const result = parseSkillCard(FILE, text)
    if (result.ok) throw new Error('expected error')
    expect(result.error.reason).toContain('JSON 不合法')
  })

  it('state 不在词表里时报错', () => {
    const text = card(index([{ key: 'a', text: '点A', state: 'done' }]))
    const result = parseSkillCard(FILE, text)
    if (result.ok) throw new Error('expected error')
    expect(result.error.reason).toContain('不在词表里')
  })

  it('verifying 缺少 handoff 时报错', () => {
    const text = card(index([{ key: 'a', text: '点A', state: 'verifying' }]))
    const result = parseSkillCard(FILE, text)
    if (result.ok) throw new Error('expected error')
    expect(result.error.reason).toContain('缺少 handoff')
  })

  it('not_applicable 缺少 note 时报错', () => {
    const text = card(index([{ key: 'a', text: '点A', state: 'not_applicable' }]))
    const result = parseSkillCard(FILE, text)
    if (result.ok) throw new Error('expected error')
    expect(result.error.reason).toContain('缺少 note')
  })

  it('tried_failed 有 handoff 但缺 note 时报错', () => {
    const text = card(
      index([{ key: 'a', text: '点A', state: 'tried_failed', handoff: '2026-01-01-skill-handoff-1-x' }]),
    )
    const result = parseSkillCard(FILE, text)
    if (result.ok) throw new Error('expected error')
    expect(result.error.reason).toContain('缺少 note')
  })

  it('merged 缺少 merged_into 时报错', () => {
    const text = card(index([{ key: 'a', text: '点A', state: 'merged' }]))
    const result = parseSkillCard(FILE, text)
    if (result.ok) throw new Error('expected error')
    expect(result.error.reason).toContain('缺少 merged_into')
  })

  it('key 重复时报错', () => {
    const text = card(
      index([
        { key: 'a', text: '点A', state: 'learning' },
        { key: 'a', text: '点A2', state: 'learning' },
      ]),
    )
    const result = parseSkillCard(FILE, text)
    if (result.ok) throw new Error('expected error')
    expect(result.error.reason).toContain('key 重复')
  })

  it('points 为空时报错', () => {
    const text = card(index([]))
    const result = parseSkillCard(FILE, text)
    if (result.ok) throw new Error('expected error')
    expect(result.error.reason).toContain('points')
  })

  it('没有标题行时报错', () => {
    const text = ['来源：https://example.com/x', '', index([{ key: 'a', text: '点A', state: 'learning' }])].join('\n')
    const result = parseSkillCard(FILE, text)
    if (result.ok) throw new Error('expected error')
    expect(result.error.reason).toContain('标题')
  })
})
