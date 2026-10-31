/**
 * 「客人到底开没开口」在 CRM 读侧的用法（WP-1a）。
 *
 * 钉死三件事：
 *   ① 只有分析确认 'yes' 才算聊过；没分析 / 失败 / 被人否掉 → 未知（null），不声称聊过；
 *   ② 分析确认 'no'（语音信箱 / 没出声）的外呼，当「没人接」处理，不算我们最后一次出站、不算聊过；
 *   ③ 未知的通话**不会把人藏起来**（仍按原规则留在名单里）。
 */

import { describe, expect, it } from 'vitest'
import { callProvesCustomerSpoke, customerSpokeOf, isVoicemailOrSilentCall } from '../customer-spoke'
import { isUnansweredCall, segmentContact, type ContactLike } from '../segments'
import { buildTouchpointLike } from '../contact-model'

const NOW = new Date('2026-10-29T00:00:00Z')

function contact(touchpoints: ContactLike['touchpoints']): ContactLike {
  return { id: 'c1', displayName: 'Kam', doNotContact: false, touchpoints }
}

const form = { channel: 'meta_lead_form', direction: 'inbound' as const, occurredAt: '2026-10-28T20:00:00Z' }

function twilioCall(extra: Record<string, unknown>) {
  return buildTouchpointLike({
    contact_id: 'c1',
    channel: 'phone',
    direction: 'outbound',
    occurred_at: '2026-10-28T22:30:00Z',
    source: 'twilio',
    raw: null,
    metadata: { outcome: 'spoke', reached: true, answered: true, talk_seconds: 36, ...extra },
  })
}

describe('customerSpokeOf', () => {
  it('reads yes / no / unclear and treats everything else as unknown', () => {
    expect(customerSpokeOf({ customer_spoke: 'yes' })).toBe('yes')
    expect(customerSpokeOf({ customer_spoke: 'no' })).toBe('no')
    expect(customerSpokeOf({ customer_spoke: 'unclear' })).toBe('unclear')
    expect(customerSpokeOf({ customer_spoke: 'maybe' })).toBeNull()
    expect(customerSpokeOf({ customer_spoke: true })).toBeNull()
    expect(customerSpokeOf({})).toBeNull()
    expect(customerSpokeOf(null)).toBeNull()
    expect(customerSpokeOf(undefined)).toBeNull()
  })

  it('ignores the verdict when a human rejected the analysis', () => {
    expect(customerSpokeOf({ customer_spoke: 'yes', call_analysis_review: 'rejected' })).toBeNull()
    expect(customerSpokeOf({ customer_spoke: 'no', call_analysis_review: 'rejected' })).toBeNull()
    expect(customerSpokeOf({ customer_spoke: 'yes', call_analysis_review: 'confirmed' })).toBe('yes')
  })

  it('only yes proves a conversation; only no marks a voicemail/silent call', () => {
    expect(callProvesCustomerSpoke({ customer_spoke: 'yes' })).toBe(true)
    expect(callProvesCustomerSpoke({ customer_spoke: 'unclear' })).toBe(false)
    expect(callProvesCustomerSpoke({})).toBe(false)
    expect(isVoicemailOrSilentCall({ customer_spoke: 'no' })).toBe(true)
    expect(isVoicemailOrSilentCall({ customer_spoke: 'unclear' })).toBe(false)
    expect(isVoicemailOrSilentCall({})).toBe(false)
  })
})

describe('isUnansweredCall', () => {
  it('keeps the old rule (answered=false) and adds the voicemail verdict', () => {
    expect(isUnansweredCall({ answered: false })).toBe(true)
    expect(isUnansweredCall({ answered: true, customer_spoke: 'no' })).toBe(true)
    expect(isUnansweredCall({ answered: true, customer_spoke: 'yes' })).toBe(false)
    // 未知 / 说不清：不当成没人接，也不当成聊过 —— 按原规则
    expect(isUnansweredCall({ answered: true })).toBe(false)
    expect(isUnansweredCall({ answered: true, customer_spoke: 'unclear' })).toBe(false)
  })
})

describe('segmentContact · 语音信箱不算聊过', () => {
  it('buildTouchpointLike flags a voicemail call as unanswered', () => {
    expect(twilioCall({ customer_spoke: 'no' }).unansweredCall).toBe(true)
    expect(twilioCall({ customer_spoke: 'yes' }).unansweredCall).toBe(false)
    expect(twilioCall({}).unansweredCall).toBe(false)
  })

  it('a voicemail call does not become "刚通完电话" and the lead stays untouched (still in the list)', () => {
    const r = segmentContact(contact([form, twilioCall({ customer_spoke: 'no' })]), NOW)
    expect(r.afterCall).toBeUndefined()
    expect(r.reason).not.toContain('刚通完电话')
    expect(r.segment).toBe('new_untouched')
  })

  it('a confirmed conversation still produces the after-call reminder', () => {
    const r = segmentContact(contact([form, twilioCall({ customer_spoke: 'yes' })]), NOW)
    expect(r.segment).toBe('callback_due')
    expect(r.afterCall).toBe(true)
  })

  it('an unanalysed call is never hidden: the person stays in the list with the old reminder', () => {
    const r = segmentContact(contact([form, twilioCall({})]), NOW)
    expect(r.segment).toBe('callback_due')
    expect(r.afterCall).toBe(true)
  })
})
