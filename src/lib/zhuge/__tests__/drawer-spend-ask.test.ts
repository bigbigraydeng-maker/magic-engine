import { describe, expect, it } from 'vitest'
import { classifyDrawerTurn, textAsksToSpend } from '../drawer-spend-ask'

describe('drawer spend ask', () => {
  it('treats a bare yes as not a click and not an order', () => {
    for (const word of ['好', '可以', '确认', '好的', 'OK', '同意']) {
      expect(classifyDrawerTurn(word).kind).toBe('affirmation')
    }
  })

  it('issues a card kind for spend, publish, and ad-account writes', () => {
    expect(classifyDrawerTurn('开投，每天 100')).toMatchObject({ kind: 'spend', spend: 'launch' })
    expect(classifyDrawerTurn('确认开投')).toMatchObject({ kind: 'spend', spend: 'launch' })
    expect(classifyDrawerTurn('建暂停草稿并送审')).toMatchObject({ kind: 'spend', spend: 'paused-draft' })
    expect(classifyDrawerTurn('加到 120')).toMatchObject({ kind: 'spend', spend: 'raise-budget' })
    expect(classifyDrawerTurn('先停掉某个系列')).toMatchObject({ kind: 'spend', spend: 'pause' })
    expect(classifyDrawerTurn('帮我发布广告')).toMatchObject({ kind: 'spend', spend: 'publish' })
    expect(classifyDrawerTurn('改广告账户的名字')).toMatchObject({ kind: 'spend', spend: 'meta-write' })
    expect(classifyDrawerTurn('给这个客户花钱')).toMatchObject({ kind: 'spend', spend: 'spend' })
  })

  it('leaves read-only and draft sentences on the chat path', () => {
    expect(classifyDrawerTurn('开投前检查做了没').kind).toBe('chat')
    expect(classifyDrawerTurn('开投了吗').kind).toBe('chat')
    expect(classifyDrawerTurn('查一下花费和线索').kind).toBe('chat')
    expect(classifyDrawerTurn('开个方，预算 3700，要 300 条线索').kind).toBe('chat')
    expect(classifyDrawerTurn('不要开投').kind).toBe('chat')
  })

  it('strips long digit runs from the summary', () => {
    const turn = classifyDrawerTurn('开投账户 1234567890123')
    expect(turn.kind).toBe('spend')
    if (turn.kind !== 'spend') return
    expect(turn.summary).not.toMatch(/\d{10,}/)
    expect(turn.summary).toContain('数字已略')
  })

  it('finds a spend order nested in the suggestion body', () => {
    expect(textAsksToSpend({ businessContext: { goals: ['先看进度'] } })).toBe(false)
    expect(textAsksToSpend({ businessContext: { goals: '开投' } })).toBe(true)
  })
})
