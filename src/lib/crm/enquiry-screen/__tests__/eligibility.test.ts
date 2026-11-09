import { describe, it, expect } from 'vitest'

import { checkEligibility, type EligibilityInput } from '../eligibility'
import { ENQUIRY_SCREEN_ACTOR, STAGE_INFER_ACTOR } from '@/lib/crm/actors'
import { NOT_ENQUIRY_STAGE_KEY, type ScreenStageEvent, type ScreenTouch } from '../types'

const NOW = new Date('2026-10-21T00:00:00Z')
const DAY = 86_400_000

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * DAY).toISOString()
}

function touch(over: Partial<ScreenTouch> = {}): ScreenTouch {
  return {
    channel: 'email',
    source: 'microsoft_mail',
    direction: 'inbound',
    occurredAt: daysAgo(10),
    createdAt: daysAgo(10),
    subject: 'Enquiry',
    preview: 'Hi, I would like to book a tour.',
    ...over,
  }
}

function event(over: Partial<ScreenStageEvent> = {}): ScreenStageEvent {
  return {
    fromStage: null,
    toStage: 'new',
    changedBy: STAGE_INFER_ACTOR,
    createdAt: daysAgo(9),
    ...over,
  }
}

function base(): EligibilityInput {
  return {
    contact: {
      id: 'c1',
      stage: null,
      doNotContact: false,
      emails: ['a@b.co'],
      hasPhone: false,
    },
    touches: [touch()],
    events: [],
    contactKind: 'retail',
    hasNotEnquiryStage: true,
    config: { enabled: true, minAgeDays: 2, confidenceThreshold: 0.9 },
    now: NOW,
  }
}

describe('checkEligibility', () => {
  it('base input is eligible', () => {
    expect(checkEligibility(base())).toEqual({ eligible: true })
  })

  it('disabled', () => {
    const input = base()
    input.config = { ...input.config, enabled: false }
    expect(checkEligibility(input)).toEqual({ eligible: false, why: 'disabled' })
  })

  it('no_stage_configured', () => {
    const input = base()
    input.hasNotEnquiryStage = false
    expect(checkEligibility(input)).toEqual({ eligible: false, why: 'no_stage_configured' })
  })

  it('do_not_contact', () => {
    const input = base()
    input.contact = { ...input.contact, doNotContact: true }
    expect(checkEligibility(input)).toEqual({ eligible: false, why: 'do_not_contact' })
  })

  it('trade_or_staff', () => {
    const input = base()
    input.contactKind = 'trade'
    expect(checkEligibility(input)).toEqual({ eligible: false, why: 'trade_or_staff' })
  })

  it('no_touches', () => {
    const input = base()
    input.touches = []
    expect(checkEligibility(input)).toEqual({ eligible: false, why: 'no_touches' })
  })

  it('has_outbound', () => {
    const input = base()
    input.touches = [touch(), touch({ direction: 'outbound', createdAt: daysAgo(9) })]
    expect(checkEligibility(input)).toEqual({ eligible: false, why: 'has_outbound' })
  })

  it('has_phone', () => {
    const input = base()
    input.contact = { ...input.contact, hasPhone: true }
    expect(checkEligibility(input)).toEqual({ eligible: false, why: 'has_phone' })
  })

  it('non_screenable_touch', () => {
    const input = base()
    input.touches = [touch({ channel: 'form', source: 'website' })]
    expect(checkEligibility(input)).toEqual({ eligible: false, why: 'non_screenable_touch' })
  })

  it('human_stage_change', () => {
    const input = base()
    input.events = [event({ changedBy: 'info@ctstours.co.nz' })]
    expect(checkEligibility(input)).toEqual({ eligible: false, why: 'human_stage_change' })
  })

  it('no_machine_event (stage new, zero events)', () => {
    const input = base()
    input.contact = { ...input.contact, stage: 'new' }
    input.events = []
    expect(checkEligibility(input)).toEqual({ eligible: false, why: 'no_machine_event' })
  })

  it('stage_mismatch (stage new, latest event to deferred)', () => {
    const input = base()
    input.contact = { ...input.contact, stage: 'new' }
    input.events = [event({ toStage: 'deferred' })]
    expect(checkEligibility(input)).toEqual({ eligible: false, why: 'stage_mismatch' })
  })

  it('stage_not_allowed', () => {
    const input = base()
    input.contact = { ...input.contact, stage: 'booked' }
    input.events = [event({ toStage: 'booked' })]
    expect(checkEligibility(input)).toEqual({ eligible: false, why: 'stage_not_allowed' })
  })

  it('not_revived (not_enquiry, lastScreen, no newer touch)', () => {
    const input = base()
    input.contact = { ...input.contact, stage: NOT_ENQUIRY_STAGE_KEY }
    input.touches = [touch({ createdAt: daysAgo(10) })]
    input.events = [
      event({
        toStage: NOT_ENQUIRY_STAGE_KEY,
        changedBy: ENQUIRY_SCREEN_ACTOR,
        createdAt: daysAgo(5),
      }),
    ]
    expect(checkEligibility(input)).toEqual({ eligible: false, why: 'not_revived' })
  })

  it('too_recent', () => {
    const input = base()
    input.touches = [touch({ createdAt: daysAgo(1) })]
    expect(checkEligibility(input)).toEqual({ eligible: false, why: 'too_recent' })
  })

  // ---- 白名单 / 来源 ----

  it('whatsapp/whatsapp inbound is eligible', () => {
    const input = base()
    input.touches = [touch({ channel: 'whatsapp', source: 'whatsapp' })]
    expect(checkEligibility(input)).toEqual({ eligible: true })
  })

  it('mailchimp inbound -> non_screenable_touch', () => {
    const input = base()
    input.touches = [touch({ channel: 'email', source: 'mailchimp' })]
    expect(checkEligibility(input)).toEqual({ eligible: false, why: 'non_screenable_touch' })
  })

  it('email/email_conversation -> non_screenable_touch', () => {
    const input = base()
    input.touches = [touch({ channel: 'email', source: 'email_conversation' })]
    expect(checkEligibility(input)).toEqual({ eligible: false, why: 'non_screenable_touch' })
  })

  // ---- 阶段规则 ----

  it('stage new with one ai:conversation-read event to new -> eligible', () => {
    const input = base()
    input.contact = { ...input.contact, stage: 'new' }
    input.events = [event({ toStage: 'new', changedBy: STAGE_INFER_ACTOR })]
    expect(checkEligibility(input)).toEqual({ eligible: true })
  })

  it('event changedBy null -> human_stage_change', () => {
    const input = base()
    input.events = [event({ changedBy: null })]
    expect(checkEligibility(input)).toEqual({ eligible: false, why: 'human_stage_change' })
  })

  it('event changedBy someone@x.co.nz -> human_stage_change', () => {
    const input = base()
    input.events = [event({ changedBy: 'someone@x.co.nz' })]
    expect(checkEligibility(input)).toEqual({ eligible: false, why: 'human_stage_change' })
  })

  it('not_enquiry with a touch created AFTER lastScreen -> eligible', () => {
    const input = base()
    input.contact = { ...input.contact, stage: NOT_ENQUIRY_STAGE_KEY }
    input.touches = [touch({ createdAt: daysAgo(3) })]
    input.events = [
      event({
        toStage: NOT_ENQUIRY_STAGE_KEY,
        changedBy: ENQUIRY_SCREEN_ACTOR,
        createdAt: daysAgo(5),
      }),
    ]
    expect(checkEligibility(input)).toEqual({ eligible: true })
  })

  it('not_enquiry: touch occurred after but created before lastScreen -> not_revived', () => {
    const input = base()
    input.contact = { ...input.contact, stage: NOT_ENQUIRY_STAGE_KEY }
    input.touches = [
      touch({
        occurredAt: daysAgo(3), // 发出时间晚于 lastScreen
        createdAt: daysAgo(6), // 但入库时间早于 lastScreen —— 判走之后没有新入站
      }),
    ]
    input.events = [
      event({
        toStage: NOT_ENQUIRY_STAGE_KEY,
        changedBy: ENQUIRY_SCREEN_ACTOR,
        createdAt: daysAgo(5),
      }),
    ]
    expect(checkEligibility(input)).toEqual({ eligible: false, why: 'not_revived' })
  })

  // ---- minAgeDays 边界 ----

  it('newest touch exactly 2 days old -> eligible', () => {
    const input = base()
    input.touches = [touch({ createdAt: daysAgo(2) })]
    expect(checkEligibility(input)).toEqual({ eligible: true })
  })

  it('newest touch 1 day 23h old -> too_recent', () => {
    const input = base()
    input.touches = [touch({ createdAt: new Date(NOW.getTime() - (DAY + 23 * 3_600_000)).toISOString() })]
    expect(checkEligibility(input)).toEqual({ eligible: false, why: 'too_recent' })
  })
})
