import { describe, expect, it } from 'vitest'
import { parseEmailSettingsStrict, serialiseEmailSettings } from '@/lib/crm/email-templates/settings'

// Design 2026-11-10 §4.1 / §8 row 12: each test fails if its check is removed.

function raw(tracking: unknown): Record<string, unknown> {
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
    guardrails: { allowed_link_hosts: ['www.example.com', 'example.com'], rules: [] },
    providers: tracking === undefined ? {} : { link_tracking: tracking },
  }
}

function errorsOf(input: unknown): string[] {
  const result = parseEmailSettingsStrict(input)
  return result.ok ? [] : result.errors
}

describe('providers.link_tracking', () => {
  it('parses, lower-cases and de-duplicates the hosts', () => {
    const result = parseEmailSettingsStrict(raw({ hosts: ['WWW.example.com', 'www.example.com', 'example.com'] }))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.settings.providers.linkTracking).toEqual({ hosts: ['www.example.com', 'example.com'] })
  })

  it('a version without it parses and is written back without the key', () => {
    const result = parseEmailSettingsStrict(raw(undefined))
    if (!result.ok) throw new Error(result.errors.join('; '))
    expect(result.settings.providers.linkTracking).toBeUndefined()
    expect(serialiseEmailSettings(result.settings).providers).toEqual({})
  })

  it('round-trips', () => {
    const first = parseEmailSettingsStrict(raw({ hosts: ['www.example.com'] }))
    if (!first.ok) throw new Error(first.errors.join('; '))
    expect(parseEmailSettingsStrict(serialiseEmailSettings(first.settings))).toEqual(first)
  })

  it('refuses a host links may not point at', () => {
    expect(errorsOf(raw({ hosts: ['tracker.other.com'] }))).toContain(
      'providers.link_tracking.hosts: host tracker.other.com must be in guardrails.allowed_link_hosts',
    )
  })

  it.each([
    [{}, 'providers.link_tracking.hosts: is required'],
    [{ hosts: [] }, 'providers.link_tracking.hosts: must be an array of 1-10 hostnames'],
    [{ hosts: 'www.example.com' }, 'providers.link_tracking.hosts: must be an array of 1-10 hostnames'],
    [{ hosts: ['https://www.example.com'] }, 'providers.link_tracking.hosts[0]: must be a bare hostname'],
    [{ hosts: ['www.example.com'], param: 'x' }, 'providers.link_tracking.param: unknown key'],
    ['yes', 'providers.link_tracking: must be an object'],
  ])('refuses %j', (value, message) => {
    expect(errorsOf(raw(value))).toContain(message)
  })
})
