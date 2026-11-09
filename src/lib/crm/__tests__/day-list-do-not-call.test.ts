/**
 * 今天刚记下「不要电话」的人，冻结名单当天就得认：卡片不许整天挂着拨号。
 * 同「号码今天刚标坏」那条（day-list.test.ts），「能不能打」是渠道事实，不进冻结。
 */

import { describe, expect, it } from 'vitest'
import { dayRow } from '../day-list'
import type { ContactLike, TouchpointLike } from '../segments'

const NOW = new Date('2026-08-05T04:00:00.000Z')
const DAY_START = new Date('2026-08-04T12:00:00.000Z').getTime()

const lead: TouchpointLike = { channel: 'email', direction: 'inbound', occurredAt: '2026-08-04T02:00:00.000Z' }
const noCallToday: TouchpointLike = {
  channel: 'phone', direction: 'outbound', occurredAt: '2026-08-05T03:00:00.000Z', outcome: 'do_not_call', source: 'me_manual',
}

const person = (touchpoints: TouchpointLike[]): ContactLike => ({
  id: 'c1', displayName: 'Susan', doNotContact: false, hasPhone: true, hasEmail: true, touchpoints,
})

const row = (c: ContactLike) => dayRow(c, NOW, { dayStartMs: DAY_START, touchedToday: true })

describe('今天刚说不要电话', () => {
  it('当天就标 doNotCall，建议渠道降到邮件，号码不算坏号', () => {
    const r = row(person([lead, noCallToday]))
    expect(r.seg.doNotCall).toBe(true)
    expect(r.seg.suggestedChannel).toBe('email')
    expect(r.seg.phoneUnusable).toBe(false)
  })

  it('人还留在原来那一批（位置照冻结版）', () => {
    expect(row(person([lead, noCallToday])).seg.segment).toBe('new_untouched')
  })

  it('没说过的人不受影响', () => {
    const r = row(person([lead]))
    expect(r.seg.doNotCall).toBe(false)
    expect(r.seg.suggestedChannel).toBe('phone')
  })
})
