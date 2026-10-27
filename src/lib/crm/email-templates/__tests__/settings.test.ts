import { describe, it, expect } from 'vitest'
import {
  parseEmailSettingsStrict,
  serialiseEmailSettings,
} from '@/lib/crm/email-templates/settings'
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
