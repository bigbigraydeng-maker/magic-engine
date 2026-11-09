import { describe, expect, it } from 'vitest'
import { parseEmailSettingsStrict, serialiseEmailSettings } from '@/lib/crm/email-templates/settings'
import { isRealYmd } from '@/lib/crm/email-templates/catalogue-settings'

// Design §5 rows 11, 12, 13, 20: each test fails if its check is removed from the parser.

function catalogue(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    template_key: 'catalogue-send',
    version_label: 'v9',
    url: 'https://www.example.com/brochures/Brochure-2027.pdf',
    valid_until: '2026-12-31',
    ...over,
  }
}

function raw(cat: unknown, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    enabled: true,
    send_mailbox: 'info@example.com',
    allow_unsolicited: false,
    footer: null,
    limits: { per_user_per_hour: 30, per_user_per_day: 100, per_mailbox_per_day: 200 },
    frequency_cap: { max: 2, window_days: 7 },
    recipient_allowlist: null,
    same_template_cooldown_hours: 24,
    call_prompt_hours: 24,
    guardrails: { allowed_link_hosts: ['www.example.com'], rules: [] },
    providers: cat === undefined ? {} : { catalogue: cat },
    ...over,
  }
}

function errorsOf(input: unknown): string[] {
  const result = parseEmailSettingsStrict(input)
  return result.ok ? [] : result.errors
}

describe('providers.catalogue', () => {
  it('parses a valid block', () => {
    const result = parseEmailSettingsStrict(raw(catalogue()))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.settings.providers.catalogue).toEqual({
      templateKey: 'catalogue-send',
      versionLabel: 'v9',
      url: 'https://www.example.com/brochures/Brochure-2027.pdf',
      validUntil: '2026-12-31',
    })
  })

  it('a version without it still parses, and is written back without the key (old code can read it)', () => {
    const result = parseEmailSettingsStrict(raw(undefined))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.settings.providers.catalogue).toBeUndefined()
    expect(serialiseEmailSettings(result.settings).providers).toEqual({})
  })

  it('round-trips: serialise(parse(x)) parses to the same settings', () => {
    const first = parseEmailSettingsStrict(raw(catalogue()))
    if (!first.ok) throw new Error(first.errors.join('; '))
    const again = parseEmailSettingsStrict(serialiseEmailSettings(first.settings))
    expect(again).toEqual(first)
  })

  it('every key is required and no other key is allowed', () => {
    for (const key of ['template_key', 'version_label', 'url', 'valid_until']) {
      const c = catalogue()
      delete c[key]
      expect(errorsOf(raw(c))).toContain(`providers.catalogue.${key}: is required`)
    }
    expect(errorsOf(raw(catalogue({ extra: 1 })))).toContain('providers.catalogue.extra: unknown key')
    expect(errorsOf(raw('nope'))).toContain('providers.catalogue: must be an object')
  })

  it.each([
    ['http://www.example.com/a.pdf', 'must start with https://'],
    ['https://user@www.example.com/a.pdf', 'must not contain credentials'],
    ['https://user:pw@www.example.com/a.pdf', 'must not contain credentials'],
    ['https://www.ex%61mple.com/a.pdf', 'host must be a bare hostname (no encoding or port)'],
    ['https://www.example.com:8443/a.pdf', 'host must be a bare hostname (no encoding or port)'],
    ['https://www.example.com/a b.pdf', 'must not contain whitespace'],
    [`https://www.example.com/${'a'.repeat(500)}`, 'must be at most 500 characters'],
  ])('refuses the url %s', (url, message) => {
    expect(errorsOf(raw(catalogue({ url })))).toContain(`providers.catalogue.url: ${message}`)
  })

  it('refuses a url whose host is not an allowed link host (it could never pass the link check)', () => {
    const errors = errorsOf(raw(catalogue({ url: 'https://cdn.other.com/a.pdf' })))
    expect(errors).toContain('providers.catalogue.url: host cdn.other.com must be in guardrails.allowed_link_hosts')
  })

  it('refuses to make the catalogue template cap-exempt: a catalogue mail always counts', () => {
    const errors = errorsOf(raw(catalogue(), { cap_exempt_template_keys: ['catalogue-send'] }))
    expect(errors.some((e) => e.startsWith('cap_exempt_template_keys: must not contain the catalogue template'))).toBe(true)
    // another template in the list is fine
    expect(errorsOf(raw(catalogue(), { cap_exempt_template_keys: ['brochure-request-reply'] }))).toEqual([])
  })

  it.each(['2026-02-30', '2026-13-01', '26-12-31', '2026-12-31T00:00', ''])('refuses the date %s', (valid_until) => {
    expect(errorsOf(raw(catalogue({ valid_until })))).toContain('providers.catalogue.valid_until: must be a real date written YYYY-MM-DD')
  })

  it.each(['', ' v9', 'v9!', 'x'.repeat(21)])('refuses the version label "%s"', (version_label) => {
    expect(errorsOf(raw(catalogue({ version_label })))).toContain(
      'providers.catalogue.version_label: must be 1-20 letters, digits, dots, hyphens or spaces',
    )
  })

  it('refuses a template key that is not a template key', () => {
    expect(errorsOf(raw(catalogue({ template_key: 'Catalogue Send' })))[0]).toMatch(/^providers\.catalogue\.template_key:/)
  })

  it('isRealYmd', () => {
    expect(isRealYmd('2028-02-29')).toBe(true)
    expect(isRealYmd('2027-02-29')).toBe(false)
  })
})
