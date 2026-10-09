/**
 * Static render checks for the pre-call card: red "overdue" badge, reply badges,
 * "ask on the call" line, and read-failure message. Fixture values are fictional.
 */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PrecallBriefCard } from '../PrecallBriefCard'
import type { PrecallCard } from '@/lib/crm/precall-card'

const TRIP = {
  tour_interest: 'Test Tour',
  travel_window: null,
  party_size: 2,
  departure_city: null,
  first_time_to_china: null,
  budget_signal: null,
}

function card(over: Partial<PrecallCard['lead']> = {}, askMissing: string[] = []): PrecallCard {
  return {
    briefReadFailed: false,
    lead: {
      isFormLead: true,
      formSubmittedAt: '2026-10-05T01:00:00.000Z',
      dueAt: '2026-10-06T11:00:00.000Z',
      overdue: false,
      guestReplied: false,
      ...over,
    },
    brief: {
      summary: 'Wants a tour',
      intentLevel: 'high',
      nextAction: 'Call today',
      promisesMade: ['Call within a business day'],
      riskFlags: [],
      trip: TRIP,
      phone: '021 000 0000',
      email: null,
      askMissing,
      generatedAt: null,
    },
  }
}

describe('PrecallBriefCard', () => {
  it('shows the red overdue badge only when overdue', () => {
    expect(renderToStaticMarkup(<PrecallBriefCard card={card({ overdue: true })} />)).toContain('已超过承诺时间')
    expect(renderToStaticMarkup(<PrecallBriefCard card={card()} />)).not.toContain('已超过承诺时间')
  })

  it('shows replied / not replied status for form leads', () => {
    expect(renderToStaticMarkup(<PrecallBriefCard card={card({ guestReplied: true })} />)).toContain('客人已回复')
    expect(renderToStaticMarkup(<PrecallBriefCard card={card({ guestReplied: false })} />)).toContain('客人还没回复')
  })

  it('shows no status badges for a non-form conversation', () => {
    const html = renderToStaticMarkup(
      <PrecallBriefCard card={card({ isFormLead: false, guestReplied: null })} />,
    )
    expect(html).not.toContain('客人已回复')
    expect(html).not.toContain('客人还没回复')
  })

  it('lists what to ask on the call, phone and trip chips', () => {
    const html = renderToStaticMarkup(
      <PrecallBriefCard card={card({}, ['想什么时候出行', '从哪个城市出发'])} />,
    )
    expect(html).toContain('电话里要问：想什么时候出行、从哪个城市出发')
    expect(html).toContain('电话：021 000 0000')
    expect(html).toContain('想去：Test Tour')
    expect(html).toContain('2 人')
  })

  it('says so when the stored brief could not be read', () => {
    const failed: PrecallCard = {
      briefReadFailed: true,
      brief: null,
      lead: { isFormLead: false, formSubmittedAt: null, dueAt: null, overdue: false, guestReplied: null },
    }
    expect(renderToStaticMarkup(<PrecallBriefCard card={failed} />)).toContain('需求卡没读出来')
  })
})
