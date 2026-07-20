import { describe, it, expect } from 'vitest'
import {
  normalizeE164, isValidE164, parseCalledNumber, parseCallerNumber, resolveRoute,
  canTransition, assertTransition, isTerminal, leadUpsertKeyForCall,
} from '../domain'
import type { RouteLike } from '../domain'

describe('normalizeE164', () => {
  it('keeps already-E.164', () => expect(normalizeE164('+6421123456')).toBe('+6421123456'))
  it('strips formatting', () => expect(normalizeE164('+64 21 123-456')).toBe('+6421123456'))
  it('NZ national leading 0', () => expect(normalizeE164('021 123 456', 'NZ')).toBe('+6421123456'))
  it('AU national leading 0', () => expect(normalizeE164('03 9000 0002', 'AU')).toBe('+61390000002'))
  it('00 intl prefix', () => expect(normalizeE164('006421123456')).toBe('+6421123456'))
  it('already has country code', () => expect(normalizeE164('6421123456', 'NZ')).toBe('+6421123456'))
  it('tel: scheme + params', () => expect(normalizeE164('tel:+6493000000;foo=bar')).toBe('+6493000000'))
  it('null/empty', () => {
    expect(normalizeE164('')).toBeNull()
    expect(normalizeE164(null)).toBeNull()
    expect(normalizeE164('abc')).toBeNull()
  })
})

describe('isValidE164', () => {
  it('valid', () => expect(isValidE164('+6421123456')).toBe(true))
  it('invalid', () => {
    expect(isValidE164('6421123456')).toBe(false)
    expect(isValidE164('+0123')).toBe(false)
    expect(isValidE164(null)).toBe(false)
  })
})

describe('SIP header parsing', () => {
  it('parses To in priority order', () => {
    const h = { From: '<sip:+6421111111@x>', To: '<sip:+6493000001@x>' }
    expect(parseCalledNumber(h)).toBe('+6493000001')
    expect(parseCallerNumber(h)).toBe('+6421111111')
  })
  it('P-Called-Party-ID wins over To', () => {
    const h = { 'P-Called-Party-ID': 'tel:+6493000005', To: '<sip:+6493000001@x>' }
    expect(parseCalledNumber(h)).toBe('+6493000005')
  })
  it('returns null when unparseable', () => {
    expect(parseCalledNumber({ To: 'garbage' })).toBeNull()
  })
})

describe('resolveRoute', () => {
  const routes: RouteLike[] = [
    { id: 'a', tenant_id: 't1', agent_id: 'ag1', provider: 'twilio', phone_number_e164: '+6493000001', status: 'active', priority: 100 },
    { id: 'b', tenant_id: 't2', agent_id: 'ag2', provider: 'twilio', phone_number_e164: '+6493000001', status: 'active', priority: 10 },
    { id: 'c', tenant_id: 't3', agent_id: 'ag3', provider: 'twilio', phone_number_e164: '+6493000001', status: 'disabled', priority: 1 },
  ]
  it('picks lowest-priority active match', () => {
    expect(resolveRoute(routes, '+6493000001')?.id).toBe('b')
  })
  it('ignores disabled', () => {
    const only = routes.filter((r) => r.id === 'c')
    expect(resolveRoute(only, '+6493000001')).toBeNull()
  })
  it('null called number', () => expect(resolveRoute(routes, null)).toBeNull())
  it('no match', () => expect(resolveRoute(routes, '+6499999999')).toBeNull())
})

describe('call state machine', () => {
  it('valid path', () => {
    expect(canTransition('created', 'ringing')).toBe(true)
    expect(canTransition('ringing', 'accepted')).toBe(true)
    expect(canTransition('accepted', 'in_progress')).toBe(true)
    expect(canTransition('in_progress', 'transferring')).toBe(true)
    expect(canTransition('transferring', 'transferred')).toBe(true)
  })
  it('same-state is idempotent', () => expect(canTransition('in_progress', 'in_progress')).toBe(true))
  it('illegal transition', () => {
    expect(canTransition('completed', 'in_progress')).toBe(false)
    expect(() => assertTransition('completed', 'ringing')).toThrow()
  })
  it('terminal states', () => {
    expect(isTerminal('completed')).toBe(true)
    expect(isTerminal('failed')).toBe(true)
    expect(isTerminal('in_progress')).toBe(false)
  })
})

describe('idempotency keys', () => {
  it('lead key is per-call stable', () => {
    expect(leadUpsertKeyForCall('c1')).toBe(leadUpsertKeyForCall('c1'))
    expect(leadUpsertKeyForCall('c1')).not.toBe(leadUpsertKeyForCall('c2'))
  })
})
