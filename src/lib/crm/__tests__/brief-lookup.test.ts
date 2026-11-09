/**
 * brief-lookup 的纯函数部分：多会话取最新一张、非法意向值不猜、没挂人的会话丢掉。
 * 查库那层（loadLatestBriefByContact）靠 contacts 路由测试的假库覆盖。
 */
import { describe, expect, it } from 'vitest'
import { latestBriefPerContact, normaliseIntent } from '../brief-lookup'

describe('normaliseIntent —— 只认四个值，别的一律 null', () => {
  it.each(['high', 'medium', 'low', 'unknown'])('%s → 原样', (v) => {
    expect(normaliseIntent(v)).toBe(v)
  })
  it('大小写 / 空白 / 别的词 / 非字符串 → null（不猜）', () => {
    expect(normaliseIntent('High')).toBeNull()
    expect(normaliseIntent(' high ')).toBe('high')
    expect(normaliseIntent('hot')).toBeNull()
    expect(normaliseIntent(3)).toBeNull()
    expect(normaliseIntent(null)).toBeNull()
  })
})

describe('latestBriefPerContact', () => {
  const convs = [
    { id: 'c1', contact_id: 'p1' },
    { id: 'c2', contact_id: 'p1' },
    { id: 'c9', contact_id: null },
  ]

  it('同一个人多段对话 → 取 generated_at 最新的一张', () => {
    const out = latestBriefPerContact(convs, [
      { conversation_id: 'c1', intent_level: 'low', next_action: '旧的', summary: null, generated_at: '2026-09-01T00:00:00Z' },
      { conversation_id: 'c2', intent_level: 'high', next_action: ' 新的 ', summary: '  客户想要 4 月上海团  ', generated_at: '2026-10-01T00:00:00Z' },
    ])
    expect(out.get('p1')).toEqual({ intent: 'high', nextAction: '新的', summary: '客户想要 4 月上海团', generatedAt: '2026-10-01T00:00:00Z' })
  })

  it('顺序反着给也一样 —— 比的是时间不是先后', () => {
    const out = latestBriefPerContact(convs, [
      { conversation_id: 'c2', intent_level: 'high', next_action: null, summary: null, generated_at: '2026-10-01T00:00:00Z' },
      { conversation_id: 'c1', intent_level: 'low', next_action: null, summary: null, generated_at: '2026-09-01T00:00:00Z' },
    ])
    expect(out.get('p1')?.intent).toBe('high')
  })

  it('会话没挂到人（contact_id null）→ 这张摘要丢掉，不进任何人', () => {
    const out = latestBriefPerContact(convs, [
      { conversation_id: 'c9', intent_level: 'high', next_action: 'x', summary: null, generated_at: '2026-10-01T00:00:00Z' },
    ])
    expect(out.size).toBe(0)
  })

  it('generated_at 为空的当成最旧；next_action 空串 → null', () => {
    const out = latestBriefPerContact(convs, [
      { conversation_id: 'c1', intent_level: 'high', next_action: '', summary: null, generated_at: null },
      { conversation_id: 'c2', intent_level: 'medium', next_action: '', summary: null, generated_at: '2026-09-01T00:00:00Z' },
    ])
    expect(out.get('p1')).toEqual({ intent: 'medium', nextAction: null, summary: null, generatedAt: '2026-09-01T00:00:00Z' })
  })
})
