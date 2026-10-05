import { describe, expect, it } from 'vitest'
import { summariseFormFunnel, type FormFunnelRaw } from '../form-funnel'

const raw = (over: Partial<FormFunnelRaw> = {}): FormFunnelRaw => ({
  periodStart: '2026-09-07', periodEnd: '2026-10-05',
  events: { form_start: { events: 120, users: 100 }, generate_lead: { events: 341, users: 90 } },
  startByPath: [{ path: '/contact', events: 80, users: 70 }],
  thankYouByPath: [{ path: '/thank-you', events: 30, users: 28 }, { path: '/thank-you-newsletter', events: 4, users: 4 }],
  // de-duplicated by GA4: one person saw both pages, so 31 — NOT the 32 you get by adding the rows
  thankYouTotal: { events: 34, users: 31 },
  ...over,
})

describe('summariseFormFunnel', () => {
  it('uses the DE-DUPLICATED thank-you people (never the per-path sum), and the first thing shown is a plain sentence', () => {
    const s = summariseFormFunnel(raw())
    expect(s.thankYou).toEqual({ events: 34, users: 31 })
    expect(s.startedNotReachedThankYou).toBe(69)
    expect(s.roughAbandonShare_ROUGH_ONLY).toBeCloseTo(0.69, 5)
    expect(Object.keys(s)[0]).toBe('plain')
    expect(s.plain).toContain('粗估')
    expect(s.plain).toContain('不是精确放弃率')
    expect(s.generateLeadUntrusted.events).toBe(341)
  })

  it('the note says the bias runs BOTH ways (not just "optimistic") and asks to check the matched paths', () => {
    const joined = summariseFormFunnel(raw()).notes.join(' ')
    expect(joined).toContain('方向不确定')
    expect(joined).toContain('抬高估算')
    expect(joined).toContain('压低估算')
    expect(joined).toContain('核对下面列出的每个感谢页路径')
  })

  it('no form_start rows → not comparable (null), with a note that it is NOT "nobody abandoned"', () => {
    const s = summariseFormFunnel(raw({ events: {} }))
    expect(s.roughAbandonShare_ROUGH_ONLY).toBeNull()
    expect(s.startedNotReachedThankYou).toBeNull()
    expect(s.notes.join(' ')).toContain('不能当作"没人放弃"')
    expect(s.plain).toContain('无法给出')
  })

  it('more thank-you people than form-start people → not comparable, never a negative number', () => {
    const s = summariseFormFunnel(raw({ thankYouTotal: { events: 200, users: 150 } }))
    expect(s.roughAbandonShare_ROUGH_ONLY).toBeNull()
    expect(s.notes.join(' ')).toContain('不能直接相减')
  })

  it('shown paths are clipped: no query string, at most 80 chars', () => {
    const long = '/thank-you?email=a@b.com&' + 'x'.repeat(200)
    const s = summariseFormFunnel(raw({ thankYouByPath: [{ path: long, events: 1, users: 1 }], startByPath: [{ path: '/p'.repeat(60), events: 1, users: 1 }] }))
    expect(s.thankYouByPath[0].path).toBe('/thank-you')
    expect(s.startByPath[0].path.length).toBeLessThanOrEqual(80)
  })
})
