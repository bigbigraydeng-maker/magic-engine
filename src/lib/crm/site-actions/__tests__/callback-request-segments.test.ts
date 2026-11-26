/**
 * The call-back row as staff's list reads it (子牙 P1-1, 魏征 P1-3): built by buildCallbackTouch, read back through the
 * same row mapper the list uses, then through segmentContact.
 */
import { describe, expect, it } from 'vitest'
import { buildCallbackTouch, parseCallbackReport } from '../callback-request'
import { buildTouchpointLike } from '../../contact-model'
import { segmentContact, type ContactLike, type TouchpointLike } from '../../segments'
import type { TokenInfo } from '../../email-templates/link-tracking/record-click'

const NOW = new Date('2026-11-16T20:00:00.000Z')
const info: TokenInfo = { token: 'AAAAAAAAAAAA', clientId: 'c1', contactId: 'k1', requestId: 'r1', kind: 'catalogue', tour: null, createdAt: '2026-11-10T00:00:00.000Z' }

function callbackTouch(): TouchpointLike {
  const parsed = parseCallbackReport({ token: 'AAAAAAAAAAAA', date: '2026-11-25', window: 'evening', tourPath: null, ua: 'Mozilla/5.0 Chrome/130.0', quiz: null })
  if (!parsed.ok) throw new Error('fixture does not parse')
  const row = buildCallbackTouch(parsed.report, info, { now: NOW, timeZone: 'Pacific/Auckland', names: new Map() })
  return buildTouchpointLike({ ...row, id: 't9' })
}

function guest(touchpoints: TouchpointLike[]): ContactLike {
  return { id: 'k1', displayName: 'Ann', doNotContact: false, hasPhone: true, hasEmail: true, touchpoints }
}

const form: TouchpointLike = { channel: 'meta_lead_form', direction: 'inbound', occurredAt: '2026-11-01T00:00:00.000Z' }
const staffCall: TouchpointLike = { channel: 'phone', direction: 'outbound', occurredAt: '2026-11-02T00:00:00.000Z', outcome: 'spoke' }

describe('a guest who asked for a call on the client site', () => {
  it('goes to the top of the list with the time they chose, not "the customer wrote"', () => {
    const r = segmentContact(guest([form, staffCall, callbackTouch()]), NOW)
    expect(r).toMatchObject({ segment: 'replied', priority: 0.5, dueAt: '2026-11-25T05:00:00.000Z' })
    expect(r.reason).toBe('客人在官网自己约了回电时间，按他选的时间打')
  })

  it('also when nobody on staff had contacted them before (only system mail)', () => {
    const r = segmentContact(guest([form, callbackTouch()]), NOW)
    expect(r).toMatchObject({ segment: 'replied', priority: 0.5, dueAt: '2026-11-25T05:00:00.000Z' })
  })

  it('a guest marked do-not-contact is still kept off the list', () => {
    const r = segmentContact({ ...guest([form, callbackTouch()]), doNotContact: true }, NOW)
    expect(r.segment).toBe('excluded')
  })
})
