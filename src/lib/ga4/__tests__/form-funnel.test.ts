import { describe, expect, it } from 'vitest'
import { summariseFormFunnel, type FormFunnelRaw } from '../form-funnel'

const raw = (over: Partial<FormFunnelRaw> = {}): FormFunnelRaw => ({
  periodStart: '2026-09-07', periodEnd: '2026-10-05',
  events: { form_start: { events: 120, users: 100 }, generate_lead: { events: 341, users: 90 } },
  startByPath: [{ path: '/contact', events: 80, users: 70 }],
  thankYouByPath: [{ path: '/thank-you', events: 30, users: 28 }, { path: '/thank-you-newsletter', events: 4, users: 4 }],
  ...over,
})

describe('summariseFormFunnel', () => {
  it('proxy = form-start people minus thank-you people, as a rate; generate_lead is listed but never used', () => {
    const s = summariseFormFunnel(raw())
    expect(s.thankYou).toEqual({ events: 34, users: 32 })
    expect(s.startedNotReachedThankYou).toBe(68)
    expect(s.proxyAbandonRate).toBeCloseTo(0.68, 5)
    expect(s.generateLeadUntrusted.events).toBe(341)
    expect(s.notes.join(' ')).toContain('代理估算')
  })

  it('no form_start rows → not comparable (null), with a note that it is NOT "nobody abandoned"', () => {
    const s = summariseFormFunnel(raw({ events: {} }))
    expect(s.proxyAbandonRate).toBeNull()
    expect(s.startedNotReachedThankYou).toBeNull()
    expect(s.notes.join(' ')).toContain('不能当作"没人放弃"')
  })

  it('more thank-you people than form-start people → not comparable, never a negative number', () => {
    const s = summariseFormFunnel(raw({ thankYouByPath: [{ path: '/thank-you', events: 200, users: 150 }] }))
    expect(s.proxyAbandonRate).toBeNull()
    expect(s.notes.join(' ')).toContain('不能直接相减')
  })
})
