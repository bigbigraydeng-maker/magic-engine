import { describe, expect, it } from 'vitest'
import {
  sanitizeLead,
  extractClientIp,
  PROJECT_TYPES,
  TIMELINES,
} from '../sanitize'

const valid = {
  name:  'Sarah Hopkins',
  phone: '0412 345 678',
}

describe('sanitizeLead — required fields', () => {
  it('passes a minimal valid payload through', () => {
    const r = sanitizeLead(valid)
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('unreachable')
    expect(r.lead.name).toBe('Sarah Hopkins')
    expect(r.lead.phone).toBe('0412 345 678')
    expect(r.lead.email).toBeNull()
  })

  it.each([undefined, null, '', '   ', 42 as unknown as string])('rejects name=%p', async (name) => {
    const r = sanitizeLead({ ...valid, name })
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.code).toBe('INVALID_INPUT')
    expect(r.reason).toMatch(/name/i)
  })

  it.each([undefined, null, '', '   ', 0 as unknown as string])('rejects phone=%p', async (phone) => {
    const r = sanitizeLead({ ...valid, phone })
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.code).toBe('INVALID_INPUT')
    expect(r.reason).toMatch(/phone/i)
  })

  it('rejects phone with letters', () => {
    const r = sanitizeLead({ ...valid, phone: 'call-me-04xx' })
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.reason).toMatch(/phone format/i)
  })

  it('accepts intl + spaces + parens + dashes in phone', () => {
    expect(sanitizeLead({ ...valid, phone: '+61 (0)4 1234 5678' }).ok).toBe(true)
    expect(sanitizeLead({ ...valid, phone: '07-3xxx-xxxx'.replace(/x/g, '0') }).ok).toBe(true)
  })

  it('rejects overflows on required fields', () => {
    expect(sanitizeLead({ ...valid, name:  'x'.repeat(121) }).ok).toBe(false)
    expect(sanitizeLead({ ...valid, phone: '0'.repeat(33)  }).ok).toBe(false)
  })
})

describe('sanitizeLead — honeypot', () => {
  it('reports HONEYPOT (the route turns this into a quiet 200)', () => {
    const r = sanitizeLead({ ...valid, company_hp: 'http://spam.example/' })
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.code).toBe('HONEYPOT')
  })

  it('ignores an empty honeypot field (humans never type in it)', () => {
    expect(sanitizeLead({ ...valid, company_hp: '' }).ok).toBe(true)
    expect(sanitizeLead({ ...valid, company_hp: '   ' }).ok).toBe(true)
  })
})

describe('sanitizeLead — email handling', () => {
  it('accepts a valid email', () => {
    const r = sanitizeLead({ ...valid, email: 'sarah@example.com' })
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('unreachable')
    expect(r.lead.email).toBe('sarah@example.com')
  })

  it.each(['notvalid', 'sarah@', '@example.com', 'sarah@example', 'sarah example.com'])(
    'rejects malformed email %p',
    (email) => {
      const r = sanitizeLead({ ...valid, email })
      expect(r.ok).toBe(false)
      if (r.ok) throw new Error('unreachable')
      expect(r.reason).toMatch(/email/i)
    },
  )

  it('treats empty / missing email as null (NOT an error)', () => {
    expect(sanitizeLead({ ...valid, email: '' }).ok).toBe(true)
    expect(sanitizeLead({ ...valid, email: null as unknown as string }).ok).toBe(true)
    expect(sanitizeLead({ ...valid }).ok).toBe(true)
  })
})

describe('sanitizeLead — enum fields', () => {
  it.each(PROJECT_TYPES.map(v => [v]))('accepts project_type=%p', (val) => {
    const r = sanitizeLead({ ...valid, project_type: val })
    if (!r.ok) throw new Error('expected ok')
    expect(r.lead.project_type).toBe(val)
  })

  it('drops unknown project_type to null (silent — LP is allowed to evolve)', () => {
    const r = sanitizeLead({ ...valid, project_type: 'shutters' })
    if (!r.ok) throw new Error('expected ok')
    expect(r.lead.project_type).toBeNull()
  })

  it.each(TIMELINES.map(v => [v]))('accepts timeline=%p', (val) => {
    const r = sanitizeLead({ ...valid, timeline: val })
    if (!r.ok) throw new Error('expected ok')
    expect(r.lead.timeline).toBe(val)
  })

  it('drops unknown timeline to null', () => {
    const r = sanitizeLead({ ...valid, timeline: 'next-decade' })
    if (!r.ok) throw new Error('expected ok')
    expect(r.lead.timeline).toBeNull()
  })
})

describe('sanitizeLead — overflow guards on optional fields', () => {
  it('rejects oversized suburb / message / utm_* to null (silent drop)', () => {
    const r = sanitizeLead({
      ...valid,
      suburb:       'x'.repeat(200),
      message:      'x'.repeat(3000),
      utm_campaign: 'x'.repeat(500),
    })
    if (!r.ok) throw new Error('expected ok — optional overflow drops to null, not error')
    expect(r.lead.suburb).toBeNull()
    expect(r.lead.message).toBeNull()
    expect(r.lead.utm_campaign).toBeNull()
  })

  it('preserves reasonable lengths', () => {
    const r = sanitizeLead({
      ...valid,
      suburb:  'Slacks Creek 4127',
      message: 'Bathroom reno, ~12 m² tiles + new vanity. Budget around $8k.',
    })
    if (!r.ok) throw new Error('expected ok')
    expect(r.lead.suburb).toBe('Slacks Creek 4127')
    expect(r.lead.message).toMatch(/Bathroom reno/)
  })
})

describe('sanitizeLead — submitted_at ISO validation (魏征 P1.5)', () => {
  it('accepts a well-formed ISO timestamp and round-trips through toISOString', () => {
    const r = sanitizeLead({ ...valid, submitted_at: '2026-06-13T05:00:00.000Z' })
    if (!r.ok) throw new Error('expected ok')
    expect(r.lead.submitted_at).toBe('2026-06-13T05:00:00.000Z')
  })

  it('normalises non-canonical (but parseable) inputs to canonical ISO', () => {
    const r = sanitizeLead({ ...valid, submitted_at: '2026-06-13T05:00:00' })
    if (!r.ok) throw new Error('expected ok')
    expect(r.lead.submitted_at).toMatch(/^2026-06-13T\d{2}:00:00\.000Z$/)
  })

  it.each(['abc', 'not-a-date', '2026-13-99', '', '   '])(
    'drops unparseable submitted_at %p to null (does NOT 22007-error the insert)',
    (val) => {
      const r = sanitizeLead({ ...valid, submitted_at: val })
      if (!r.ok) throw new Error('expected ok')
      expect(r.lead.submitted_at).toBeNull()
    },
  )

  it('rejects oversized submitted_at strings (> 40 chars) to null', () => {
    const r = sanitizeLead({ ...valid, submitted_at: '2026-06-13T05:00:00.000Z' + 'x'.repeat(30) })
    if (!r.ok) throw new Error('expected ok')
    expect(r.lead.submitted_at).toBeNull()
  })

  it('drops non-string submitted_at to null', () => {
    const r = sanitizeLead({ ...valid, submitted_at: 1718254800000 as unknown as string })
    if (!r.ok) throw new Error('expected ok')
    expect(r.lead.submitted_at).toBeNull()
  })
})

describe('sanitizeLead — strict typing on attribution', () => {
  it('drops attribution fields when they are non-strings', () => {
    const r = sanitizeLead({
      ...valid,
      source_url: { url: 'https://x' } as unknown as string,
      referrer:    42                  as unknown as string,
      utm_source:  null                as unknown as string,
    })
    if (!r.ok) throw new Error('expected ok')
    expect(r.lead.source_url).toBeNull()
    expect(r.lead.referrer).toBeNull()
    expect(r.lead.utm_source).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// extractClientIp
// ═══════════════════════════════════════════════════════════════════════════════

describe('extractClientIp', () => {
  function h(map: Record<string, string>): Headers {
    const x = new Headers()
    for (const [k, v] of Object.entries(map)) x.set(k, v)
    return x
  }

  it('returns the first X-Forwarded-For hop', () => {
    expect(extractClientIp(h({ 'x-forwarded-for': '203.0.113.10, 10.0.0.1' }))).toBe('203.0.113.10')
  })

  it('falls back to X-Real-IP when XFF is absent', () => {
    expect(extractClientIp(h({ 'x-real-ip': '203.0.113.11' }))).toBe('203.0.113.11')
  })

  it('returns the literal "unknown" when no proxy header is set', () => {
    expect(extractClientIp(h({}))).toBe('unknown')
  })

  it('caps the IP at 64 chars (defensive)', () => {
    expect(extractClientIp(h({ 'x-forwarded-for': 'x'.repeat(120) })).length).toBeLessThanOrEqual(64)
  })
})
