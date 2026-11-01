import { describe, it, expect } from 'vitest'
import { routeComment } from '../comment-routing'

describe('routeComment', () => {
  it('问价（中英文）→ human + guide_to_dm', () => {
    expect(routeComment({ category: 'question', comment_text: 'How much is this tour?' })).toEqual({
      route: 'human',
      intent: 'price',
      guide_to_dm: true,
    })
    expect(routeComment({ category: 'question', comment_text: '这个团多少钱？' })).toMatchObject({
      route: 'human',
      intent: 'price',
      guide_to_dm: true,
    })
  })

  it('退款 / 改单 / 投诉 → human', () => {
    expect(routeComment({ category: 'question', comment_text: 'I need a refund please' }).intent).toBe(
      'refund',
    )
    expect(routeComment({ category: 'other', comment_text: '想改一下出发日期' }).intent).toBe(
      'booking_change',
    )
    expect(routeComment({ category: 'complaint', comment_text: 'Terrible service' }).intent).toBe(
      'complaint',
    )
    expect(routeComment({ category: 'complaint', comment_text: '我要投诉' }).intent).toBe('complaint')
  })

  it('行程 / 签证 / 怎么报名 / 问候 → auto_ok', () => {
    expect(routeComment({ category: 'question', comment_text: 'What is the itinerary for day 2?' }).route).toBe(
      'auto_ok',
    )
    expect(routeComment({ category: 'question', comment_text: '需要签证吗' }).intent).toBe('faq_visa')
    expect(routeComment({ category: 'question', comment_text: '怎么报名这个团' }).intent).toBe(
      'faq_signup',
    )
    expect(routeComment({ category: 'praise', comment_text: 'Hello, looks great!' }).intent).toBe('greeting')
    expect(routeComment({ category: 'question', comment_text: '你好' }).route).toBe('auto_ok')
  })

  it('空文本、纯表情、判不出 → human', () => {
    expect(routeComment({ category: 'other', comment_text: '' }).route).toBe('human')
    expect(routeComment({ category: 'other', comment_text: '   ' }).intent).toBe('unknown')
    expect(routeComment({ category: 'other', comment_text: '😀👍🔥' }).route).toBe('human')
    expect(routeComment({ category: 'other', comment_text: 'random gibberish xyzzy' }).route).toBe(
      'human',
    )
  })
})
