/**
 * 「只别打电话」进分段：只关掉电话这一路，人留在名单上走邮件 / Messenger
 * （PM 2026-11-09；设计稿 docs/specs/2026-11-09-crm-do-not-call-split-design-v0.md v1 修订 D）。
 */

import { describe, expect, it } from 'vitest'
import { segmentContact, type ContactLike } from '../segments'

const NOW = new Date('2026-07-26T12:00:00Z')

function contact(over: Partial<ContactLike> = {}): ContactLike {
  return { id: 'c1', displayName: 'Kam', doNotContact: false, touchpoints: [], ...over }
}

const form = (at: string) => ({ channel: 'meta_lead_form', direction: 'inbound' as const, occurredAt: at })
const note = (at: string, outcome: string) => ({
  channel: 'phone', direction: 'outbound' as const, occurredAt: at, outcome, source: 'me_manual',
})

/** 新客人填了表，然后客人说「不要电话」，之后他自己发邮件回来。 */
const noCallThenEmail = (over: Partial<ContactLike> = {}): ContactLike =>
  contact({
    touchpoints: [
      form('2026-07-01T00:00:00Z'),
      note('2026-07-02T00:00:00Z', 'do_not_call'),
      { channel: 'email', direction: 'inbound', occurredAt: '2026-07-26T02:00:00Z' },
    ],
    hasPhone: true,
    hasEmail: true,
    ...over,
  })

describe('只别打电话 ≠ 别再联系', () => {
  it('有邮箱 → 不被排除，建议渠道落到邮件，不是电话', () => {
    const r = segmentContact(noCallThenEmail(), NOW)
    expect(r.segment).not.toBe('excluded')
    expect(r.segment).toBe('replied')
    expect(r.suggestedChannel).toBe('email')
    expect(r.doNotCall).toBe(true)
  })

  it('号码是好的 → phoneUnusable 不能被借用成 true（那是「坏号」）', () => {
    expect(segmentContact(noCallThenEmail(), NOW).phoneUnusable).toBe(false)
  })

  it('只有 Messenger → 落到 Messenger', () => {
    const r = segmentContact(noCallThenEmail({ hasEmail: false, hasMessenger: true }), NOW)
    expect(r.suggestedChannel).toBe('messenger')
    expect(r.segment).not.toBe('excluded')
  })

  it('新客人还没联系过、但说过不要电话 → 想打电话的那一段也只给邮件', () => {
    const r = segmentContact(
      contact({ touchpoints: [form('2026-07-26T00:00:00Z'), note('2026-07-26T01:00:00Z', 'do_not_call')], hasPhone: true, hasEmail: true }),
      NOW,
    )
    expect(r.suggestedChannel).not.toBe('phone')
    expect(r.doNotCall).toBe(true)
  })

  it('没有邮箱也没有 Messenger → 退出名单，并说清缺什么', () => {
    const r = segmentContact(noCallThenEmail({ hasEmail: false, hasMessenger: false }), NOW)
    expect(r.segment).toBe('excluded')
    expect(r.reason).toContain('只别打电话，又没有邮箱和 Messenger')
    expect(r.suggestedChannel).toBe('none')
  })

  it('被人放回电话名单（更晚的 dnc_cleared）→ 电话回来', () => {
    const c = noCallThenEmail()
    c.touchpoints.push({ channel: 'note', direction: 'outbound', occurredAt: '2026-07-03T00:00:00Z', outcome: 'dnc_cleared' })
    const r = segmentContact(c, NOW)
    expect(r.doNotCall).toBe(false)
  })
})

describe('没说过不要电话的人 → 结果跟以前一模一样', () => {
  const plain = (over: Partial<ContactLike> = {}): ContactLike =>
    contact({
      touchpoints: [form('2026-07-01T00:00:00Z'), note('2026-07-02T00:00:00Z', 'no_answer'),
        { channel: 'email', direction: 'inbound', occurredAt: '2026-07-26T02:00:00Z' }],
      hasPhone: true,
      hasEmail: true,
      ...over,
    })

  it('能打电话的照样建议打电话，doNotCall=false', () => {
    const r = segmentContact(plain(), NOW)
    expect(r.doNotCall).toBe(false)
    expect(r.suggestedChannel).toBe('phone')
    expect(r.segment).toBe('replied')
  })

  it('没有邮箱 / Messenger 也不会被这条新规则排除', () => {
    const r = segmentContact(plain({ hasEmail: false, hasMessenger: false }), NOW)
    expect(r.segment).not.toBe('excluded')
    expect(r.suggestedChannel).toBe('phone')
  })
})
