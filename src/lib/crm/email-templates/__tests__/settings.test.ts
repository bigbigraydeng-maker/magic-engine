import { describe, it, expect } from 'vitest'
import {
  parseEmailSettingsStrict,
  serialiseEmailSettings,
} from '@/lib/crm/email-templates/settings'
import { effectiveFromSettings } from '@/lib/crm/email-templates/effective-config'
import type { EmailSettings } from '@/lib/crm/email-templates/types'

function validRaw(): Record<string, unknown> {
  return {
    enabled: true,
    send_mailbox: 'info@example.com',
    allow_unsolicited: false,
    footer: null,
    limits: {
      per_user_per_hour: 30,
      per_user_per_day: 100,
      per_mailbox_per_day: 200,
    },
    frequency_cap: { max: 2, window_days: 7 },
    recipient_allowlist: ['test@example.com'],
    same_template_cooldown_hours: 24,
    call_prompt_hours: 24,
    guardrails: {
      allowed_link_hosts: ['example.com', 'www.example.com'],
      rules: [
        {
          id: 'no-guarantee',
          phrases: ['guaranteed', 'guarantee'],
          message: 'Do not promise guarantees',
          severity: 'block',
        },
        {
          id: 'soft-urgency',
          phrases: ['act now'],
          message: 'Avoid pressure language',
          severity: 'warn',
        },
      ],
    },
    providers: {
      published_tours: {
        url_pattern: 'https://www.example.com/tours/{destination}/{tier}/{slug}',
        all_tours_url: 'https://www.example.com/tours',
      },
    },
  }
}

function parseOk(raw: unknown): EmailSettings {
  const result = parseEmailSettingsStrict(raw)
  if (!result.ok) {
    throw new Error(`expected ok, got errors: ${result.errors.join('; ')}`)
  }
  return result.settings
}

describe('parseEmailSettingsStrict', () => {
  it('parses a fully valid raw object with expected values', () => {
    const settings = parseOk(validRaw())
    expect(settings.enabled).toBe(true)
    expect(settings.sendMailbox).toBe('info@example.com')
    expect(settings.allowUnsolicited).toBe(false)
    expect(settings.footer).toBeNull()
    expect(settings.limits).toEqual({
      perUserPerHour: 30,
      perUserPerDay: 100,
      perMailboxPerDay: 200,
    })
    expect(settings.frequencyCap).toEqual({ max: 2, windowDays: 7 })
    expect(settings.recipientAllowlist).toEqual(['test@example.com'])
    expect(settings.sameTemplateCooldownHours).toBe(24)
    expect(settings.callPromptHours).toBe(24)
    expect(settings.guardrails.allowedLinkHosts).toEqual([
      'example.com',
      'www.example.com',
    ])
    expect(settings.guardrails.rules).toHaveLength(2)
    expect(settings.guardrails.rules[0]).toEqual({
      id: 'no-guarantee',
      phrases: ['guaranteed', 'guarantee'],
      message: 'Do not promise guarantees',
      severity: 'block',
    })
    expect(settings.guardrails.rules[1]).toEqual({
      id: 'soft-urgency',
      phrases: ['act now'],
      message: 'Avoid pressure language',
      severity: 'warn',
    })
    expect(settings.providers.publishedTours).toEqual({
      urlPattern: 'https://www.example.com/tours/{destination}/{tier}/{slug}',
      allToursUrl: 'https://www.example.com/tours',
    })
  })

  it('normalises the send mailbox', () => {
    const raw = validRaw()
    raw.send_mailbox = '  Info@Example.COM  '
    const settings = parseOk(raw)
    expect(settings.sendMailbox).toBe('info@example.com')
  })

  it('lowercases allowed link hosts', () => {
    const raw = validRaw()
    raw.guardrails = {
      allowed_link_hosts: ['Example.COM', 'WWW.Example.com'],
      rules: [],
    }
    const settings = parseOk(raw)
    expect(settings.guardrails.allowedLinkHosts).toEqual([
      'example.com',
      'www.example.com',
    ])
  })

  const requiredKeys = [
    'enabled',
    'send_mailbox',
    'allow_unsolicited',
    'footer',
    'limits',
    'frequency_cap',
    'recipient_allowlist',
    'same_template_cooldown_hours',
    'call_prompt_hours',
    'guardrails',
    'providers',
  ] as const

  it.each(requiredKeys)(
    'rejects when required top-level key %s is missing',
    (key) => {
      const raw = validRaw()
      delete raw[key]
      const result = parseEmailSettingsStrict(raw)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errors.some((e) => e.includes(key))).toBe(true)
      }
    },
  )

  it('rejects recipient_allowlist given as a string', () => {
    const raw = validRaw()
    raw.recipient_allowlist = 'test@example.com'
    const result = parseEmailSettingsStrict(raw)
    expect(result.ok).toBe(false)
  })

  it('accepts recipient_allowlist null', () => {
    const raw = validRaw()
    raw.recipient_allowlist = null
    const settings = parseOk(raw)
    expect(settings.recipientAllowlist).toBeNull()
  })

  it('accepts recipient_allowlist empty array', () => {
    const raw = validRaw()
    raw.recipient_allowlist = []
    const settings = parseOk(raw)
    expect(settings.recipientAllowlist).toEqual([])
  })

  it('rejects recipient_allowlist containing an invalid email', () => {
    const raw = validRaw()
    raw.recipient_allowlist = ['not-an-email']
    const result = parseEmailSettingsStrict(raw)
    expect(result.ok).toBe(false)
  })

  it('accepts frequency_cap null', () => {
    const raw = validRaw()
    raw.frequency_cap = null
    const settings = parseOk(raw)
    expect(settings.frequencyCap).toBeNull()
  })

  it('rejects frequency_cap with max 0', () => {
    const raw = validRaw()
    raw.frequency_cap = { max: 0, window_days: 7 }
    const result = parseEmailSettingsStrict(raw)
    expect(result.ok).toBe(false)
  })

  it('rejects frequency_cap with an extra key', () => {
    const raw = validRaw()
    raw.frequency_cap = { max: 2, window_days: 7, extra: 1 }
    const result = parseEmailSettingsStrict(raw)
    expect(result.ok).toBe(false)
  })

  it('rejects frequency_cap with max as a string', () => {
    const raw = validRaw()
    raw.frequency_cap = { max: '2', window_days: 7 }
    const result = parseEmailSettingsStrict(raw)
    expect(result.ok).toBe(false)
  })

  it('rejects an unknown top-level key and names it', () => {
    const raw = validRaw()
    raw.recipient_allowlst = []
    const result = parseEmailSettingsStrict(raw)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('recipient_allowlst'))).toBe(
        true,
      )
    }
  })

  it('rejects enabled given as a string', () => {
    const raw = validRaw()
    raw.enabled = 'true'
    const result = parseEmailSettingsStrict(raw)
    expect(result.ok).toBe(false)
  })

  it('rejects an allowed link host with a scheme', () => {
    const raw = validRaw()
    raw.guardrails = {
      allowed_link_hosts: ['https://example.com'],
      rules: [],
    }
    const result = parseEmailSettingsStrict(raw)
    expect(result.ok).toBe(false)
  })

  it('rejects an allowed link host with a path', () => {
    const raw = validRaw()
    raw.guardrails = {
      allowed_link_hosts: ['example.com/x'],
      rules: [],
    }
    const result = parseEmailSettingsStrict(raw)
    expect(result.ok).toBe(false)
  })

  it('accepts and lowercases an uppercase allowed link host', () => {
    const raw = validRaw()
    raw.guardrails = {
      allowed_link_hosts: ['Example.COM'],
      rules: [],
    }
    const settings = parseOk(raw)
    expect(settings.guardrails.allowedLinkHosts).toEqual(['example.com'])
  })

  it('rejects duplicate rule ids', () => {
    const raw = validRaw()
    raw.guardrails = {
      allowed_link_hosts: ['example.com'],
      rules: [
        {
          id: 'dup',
          phrases: ['one'],
          message: 'first',
          severity: 'block',
        },
        {
          id: 'dup',
          phrases: ['two'],
          message: 'second',
          severity: 'warn',
        },
      ],
    }
    const result = parseEmailSettingsStrict(raw)
    expect(result.ok).toBe(false)
  })

  it('rejects an invalid rule severity', () => {
    const raw = validRaw()
    raw.guardrails = {
      allowed_link_hosts: ['example.com'],
      rules: [
        {
          id: 'bad-sev',
          phrases: ['something'],
          message: 'msg',
          severity: 'maybe',
        },
      ],
    }
    const result = parseEmailSettingsStrict(raw)
    expect(result.ok).toBe(false)
  })

  it('rejects an empty phrases array', () => {
    const raw = validRaw()
    raw.guardrails = {
      allowed_link_hosts: ['example.com'],
      rules: [
        {
          id: 'empty-phrases',
          phrases: [],
          message: 'msg',
          severity: 'block',
        },
      ],
    }
    const result = parseEmailSettingsStrict(raw)
    expect(result.ok).toBe(false)
  })

  it('rejects an unknown provider key', () => {
    const raw = validRaw()
    raw.providers = {
      published_tours: {
        url_pattern: 'https://www.example.com/tours/{destination}/{tier}/{slug}',
        all_tours_url: 'https://www.example.com/tours',
      },
      other_provider: {},
    }
    const result = parseEmailSettingsStrict(raw)
    expect(result.ok).toBe(false)
  })

  it('rejects url_pattern missing {slug}', () => {
    const raw = validRaw()
    raw.providers = {
      published_tours: {
        url_pattern: 'https://www.example.com/tours/{destination}/{tier}',
        all_tours_url: 'https://www.example.com/tours',
      },
    }
    const result = parseEmailSettingsStrict(raw)
    expect(result.ok).toBe(false)
  })

  it('rejects url_pattern starting with http://', () => {
    const raw = validRaw()
    raw.providers = {
      published_tours: {
        url_pattern: 'http://www.example.com/tours/{destination}/{tier}/{slug}',
        all_tours_url: 'https://www.example.com/tours',
      },
    }
    const result = parseEmailSettingsStrict(raw)
    expect(result.ok).toBe(false)
  })

  it('rejects all_tours_url that is not https', () => {
    const raw = validRaw()
    raw.providers = {
      published_tours: {
        url_pattern: 'https://www.example.com/tours/{destination}/{tier}/{slug}',
        all_tours_url: 'http://www.example.com/tours',
      },
    }
    const result = parseEmailSettingsStrict(raw)
    expect(result.ok).toBe(false)
  })

  it('accepts providers as an empty object', () => {
    const raw = validRaw()
    raw.providers = {}
    const settings = parseOk(raw)
    expect(settings.providers).toEqual({})
  })

  it.each([null, [], 'x', 42])(
    'rejects non-object raw input %p',
    (raw) => {
      const result = parseEmailSettingsStrict(raw)
      expect(result.ok).toBe(false)
    },
  )

  it('round trips through serialiseEmailSettings', () => {
    const parsed = parseEmailSettingsStrict(validRaw())
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const serialised = serialiseEmailSettings(parsed.settings)
    const reparsed = parseEmailSettingsStrict(serialised)
    expect(reparsed.ok).toBe(true)
    if (!reparsed.ok) return
    expect(reparsed.settings).toEqual(parsed.settings)
  })

  it('caps errors at 30', () => {
    const raw: Record<string, unknown> = {}
    for (let i = 0; i < 100; i += 1) {
      raw[`bad_key_${i}`] = i
    }
    const result = parseEmailSettingsStrict(raw)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.length).toBeLessThanOrEqual(30)
    }
  })

  it('MUTATION GUARD: wrong-typed recipient_allowlist never yields ok with []', () => {
    const wrongTypes: unknown[] = [
      'test@example.com',
      42,
      true,
      { 0: 'test@example.com' },
    ]
    for (const value of wrongTypes) {
      const raw = validRaw()
      raw.recipient_allowlist = value
      const result = parseEmailSettingsStrict(raw)
      expect(result.ok).toBe(false)
    }
  })
})

describe('cap_exempt_template_keys', () => {
  it('a version stored before the key existed still parses, with an empty list', () => {
    const raw = validRaw()
    expect('cap_exempt_template_keys' in raw).toBe(false)
    const settings = parseOk(raw)
    expect(settings.capExemptTemplateKeys).toEqual([])
  })

  it('a list of template keys parses in order', () => {
    const raw = validRaw()
    raw.cap_exempt_template_keys = [
      'tour-enquiry-reply',
      'catalogue-request-reply',
    ]
    const settings = parseOk(raw)
    expect(settings.capExemptTemplateKeys).toEqual([
      'tour-enquiry-reply',
      'catalogue-request-reply',
    ])
  })

  it('duplicates collapse, first one kept', () => {
    const raw = validRaw()
    raw.cap_exempt_template_keys = [
      'tour-enquiry-reply',
      'catalogue-request-reply',
      'tour-enquiry-reply',
    ]
    const settings = parseOk(raw)
    expect(settings.capExemptTemplateKeys).toEqual([
      'tour-enquiry-reply',
      'catalogue-request-reply',
    ])
  })

  it.each(['tour-enquiry-reply', null, {}])(
    'refuses a value that is not an array %p',
    (value) => {
      const raw = validRaw()
      raw.cap_exempt_template_keys = value
      const result = parseEmailSettingsStrict(raw)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(
          result.errors.some((e) =>
            e.includes(
              'cap_exempt_template_keys: must be an array of template keys',
            ),
          ),
        ).toBe(true)
      }
    },
  )

  it.each([[5], ['Tour Enquiry'], ['a'], ['-x'], [''], [null]])(
    'refuses entries that are not template keys %p',
    (value) => {
      const raw = validRaw()
      raw.cap_exempt_template_keys = [value]
      const result = parseEmailSettingsStrict(raw)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(
          result.errors.some((e) =>
            e.includes(
              'cap_exempt_template_keys[0]: must be a template key',
            ),
          ),
        ).toBe(true)
      }
    },
  )

  it('reports the index of a bad key after a good one', () => {
    const raw = validRaw()
    raw.cap_exempt_template_keys = ['tour-enquiry-reply', 'Tour Enquiry']
    const result = parseEmailSettingsStrict(raw)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(
        result.errors.some((e) =>
          e.includes('cap_exempt_template_keys[1]: must be a template key'),
        ),
      ).toBe(true)
    }
  })

  it('refuses more than 20 keys', () => {
    const raw = validRaw()
    raw.cap_exempt_template_keys = Array.from(
      { length: 21 },
      (_, i) => `key-${String(i + 1).padStart(2, '0')}`,
    )
    const result = parseEmailSettingsStrict(raw)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(
        result.errors.some((e) => e.includes('must have at most 20 entries')),
      ).toBe(true)
    }
  })

  it('accepts exactly 20 keys', () => {
    const raw = validRaw()
    raw.cap_exempt_template_keys = Array.from(
      { length: 20 },
      (_, i) => `key-${String(i + 1).padStart(2, '0')}`,
    )
    const settings = parseOk(raw)
    expect(settings.capExemptTemplateKeys).toHaveLength(20)
  })

  it('still refuses an unknown top-level key and a missing required key', () => {
    const withBogus = validRaw()
    withBogus.bogus = 1
    const bogusResult = parseEmailSettingsStrict(withBogus)
    expect(bogusResult.ok).toBe(false)
    if (!bogusResult.ok) {
      expect(
        bogusResult.errors.some((e) => e.includes('root.bogus: unknown key')),
      ).toBe(true)
    }

    const missingFooter = validRaw()
    delete missingFooter.footer
    const missingResult = parseEmailSettingsStrict(missingFooter)
    expect(missingResult.ok).toBe(false)
    if (!missingResult.ok) {
      expect(
        missingResult.errors.some((e) =>
          e.includes('root.footer: is required'),
        ),
      ).toBe(true)
    }
  })

  it('serialise writes the key, right after frequency_cap, when there are exempt keys, and the result parses back to the same settings', () => {
    const raw = validRaw()
    raw.cap_exempt_template_keys = [
      'tour-enquiry-reply',
      'catalogue-request-reply',
    ]
    const settings = parseOk(raw)
    const serialised = serialiseEmailSettings(settings)
    expect(serialised.cap_exempt_template_keys).toEqual([
      'tour-enquiry-reply',
      'catalogue-request-reply',
    ])
    const keys = Object.keys(serialised)
    expect(keys.indexOf('cap_exempt_template_keys')).toBe(
      keys.indexOf('frequency_cap') + 1,
    )

    const reparsed = parseEmailSettingsStrict(serialised)
    expect(reparsed.ok).toBe(true)
    if (!reparsed.ok) return
    expect(reparsed.settings).toEqual(settings)
  })

  it('serialise leaves the key out when there are no exempt keys, and that still parses to an empty list', () => {
    const settings = parseOk(validRaw())
    const serialised = serialiseEmailSettings(settings)
    expect(serialised).not.toHaveProperty('cap_exempt_template_keys')
    const reparsed = parseEmailSettingsStrict(serialised)
    expect(reparsed.ok).toBe(true)
    if (!reparsed.ok) return
    expect(reparsed.settings.capExemptTemplateKeys).toEqual([])
  })

  it('a stored empty list still parses', () => {
    const raw = validRaw()
    raw.cap_exempt_template_keys = []
    const settings = parseOk(raw)
    expect(settings.capExemptTemplateKeys).toEqual([])
  })

  it('effectiveFromSettings copies the list', () => {
    const raw = validRaw()
    raw.cap_exempt_template_keys = [
      'tour-enquiry-reply',
      'catalogue-request-reply',
    ]
    const settings = parseOk(raw)
    const eff = effectiveFromSettings(settings, 3)
    expect(eff.capExemptTemplateKeys).toEqual([
      'tour-enquiry-reply',
      'catalogue-request-reply',
    ])
    expect(eff.capExemptTemplateKeys).not.toBe(settings.capExemptTemplateKeys)
  })
})
