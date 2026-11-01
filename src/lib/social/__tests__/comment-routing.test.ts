import { describe, it, expect } from 'vitest'
import { routeComment, intentForNeedsHumanRow } from '../comment-routing'

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
    expect(routeComment({ category: 'question', comment_text: '团费怎么收' }).intent).toBe('price')
    expect(routeComment({ category: 'question', comment_text: '价钱多少' }).intent).toBe('price')
  })

  it('review examples: overcharged / worst / 导游态度', () => {
    expect(routeComment({ category: 'question', comment_text: 'Hi there, I was overcharged' }).intent).toBe(
      'price',
    )
    expect(
      routeComment({ category: 'other', comment_text: 'Thanks for nothing, worst experience ever' }).intent,
    ).toBe('complaint')
    expect(routeComment({ category: 'other', comment_text: '你好，你们导游态度很差' }).intent).toBe(
      'complaint',
    )
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
    expect(routeComment({ category: 'question', comment_text: '想退团' }).intent).toBe('refund')
    expect(routeComment({ category: 'question', comment_text: 'please cancel my booking' }).intent).toBe(
      'refund',
    )
    expect(routeComment({ category: 'other', comment_text: 'ripoff total waste of money' }).intent).toBe(
      'complaint',
    )
    expect(routeComment({ category: 'other', comment_text: 'not happy with payment process' }).intent).toBe(
      'complaint',
    )
  })

  it('英文子串误伤：accurate / costume / ideal 不判成问价', () => {
    expect(routeComment({ category: 'other', comment_text: 'Your info was accurate' }).intent).not.toBe(
      'price',
    )
    expect(routeComment({ category: 'other', comment_text: 'Nice costume party photo' }).intent).not.toBe(
      'price',
    )
    expect(routeComment({ category: 'other', comment_text: 'This is ideal for us' }).intent).not.toBe('price')
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

describe('intentForNeedsHumanRow', () => {
  it('needs_human=true 且关键词 auto_ok → unknown', () => {
    expect(
      intentForNeedsHumanRow({
        category: 'question',
        comment_text: '你好，这个行程包含什么？',
        needs_human: true,
      }),
    ).toBe('unknown')
  })
})
