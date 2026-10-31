import { afterEach, describe, expect, it, vi } from 'vitest'
import { canEditSettings, parseSettingsWrite, unrestrictedNeedsConfirmation } from '@/lib/crm/email-templates/settings-input'
import { serialiseEmailSettings } from '@/lib/crm/email-templates/settings'
import { settingsObj } from './fixtures'

const stored = serialiseEmailSettings(settingsObj({ recipientAllowlist: ['hello@magicengine.cloud'] }))

afterEach(() => vi.unstubAllEnvs())

describe('canEditSettings', () => {
  it('is only for an exact ADMIN_EMAILS match that is not scoped to one client', () => {
    vi.stubEnv('ADMIN_EMAILS', 'boss@magiclab.example, other@magiclab.example')
    expect(canEditSettings('Boss@MagicLab.example', null)).toBe(true)
    expect(canEditSettings(' other@magiclab.example ', null)).toBe(true)
    expect(canEditSettings('boss@magiclab.example', 'client-a')).toBe(false)
    expect(canEditSettings('staff@cts.example', null)).toBe(false)
    expect(canEditSettings('boss@magiclab.example.evil.com', null)).toBe(false)
    expect(canEditSettings(null, null)).toBe(false)
    expect(canEditSettings(undefined, null)).toBe(false)
    expect(canEditSettings('', null)).toBe(false)
  })

  it('nobody is a global admin when the list is not configured', () => {
    vi.stubEnv('ADMIN_EMAILS', '')
    expect(canEditSettings('boss@magiclab.example', null)).toBe(false)
  })
})

describe('parseSettingsWrite', () => {
  it('accepts the stored shape with its base version', () => {
    const res = parseSettingsWrite({ settings: stored, baseVersion: 3, changeNote: 'trial list', confirmUnrestricted: false })
    expect(res.ok && res.baseVersion).toBe(3)
    expect(res.ok && res.changeNote).toBe('trial list')
    expect(res.ok && res.settings.recipientAllowlist).toEqual(['hello@magicengine.cloud'])
  })

  it('the first settings have a null base version, and everything optional defaults to "no"', () => {
    const res = parseSettingsWrite({ settings: stored, baseVersion: null })
    expect(res.ok && res.baseVersion).toBeNull()
    expect(res.ok && res.changeNote).toBeNull()
    expect(res.ok && res.confirmUnrestricted).toBe(false)
  })

  it.each([
    ['not an object', 'x'],
    ['an unknown field', { settings: stored, baseVersion: 1, extra: true }],
    ['no base version at all', { settings: stored }],
    ['base version 0', { settings: stored, baseVersion: 0 }],
    ['a fractional base version', { settings: stored, baseVersion: 1.5 }],
    ['a numeric note', { settings: stored, baseVersion: 1, changeNote: 5 }],
    ['a too-long note', { settings: stored, baseVersion: 1, changeNote: 'x'.repeat(301) }],
    ['a non-boolean confirmation', { settings: stored, baseVersion: 1, confirmUnrestricted: 'yes' }],
    ['no settings', { baseVersion: 1 }],
    ['settings with an unknown key', { settings: { ...stored, extra: 1 }, baseVersion: 1 }],
    ['a cap of zero', { settings: { ...stored, frequency_cap: { max: 0, window_days: 7 } }, baseVersion: 1 }],
    ['a missing required key', { settings: { ...stored, frequency_cap: undefined }, baseVersion: 1 }],
  ])('rejects %s', (_name, input) => {
    const res = parseSettingsWrite(input)
    expect(res.ok).toBe(false)
    expect(!res.ok && res.error.length).toBeGreaterThan(0)
  })

  it('lists what is wrong with the settings, not just that something is', () => {
    const res = parseSettingsWrite({ settings: { ...stored, frequency_cap: { max: 0, window_days: 7 } }, baseVersion: 1 })
    expect(!res.ok && res.errors.length).toBeGreaterThan(0)
  })
})

describe('unrestrictedNeedsConfirmation', () => {
  it('is needed exactly when the feature is on and the trial list is empty and nobody confirmed', () => {
    const open = settingsObj({ enabled: true, recipientAllowlist: null })
    expect(unrestrictedNeedsConfirmation(open, false)).toBe(true)
    expect(unrestrictedNeedsConfirmation(open, true)).toBe(false)
    expect(unrestrictedNeedsConfirmation(settingsObj({ enabled: false, recipientAllowlist: null }), false)).toBe(false)
    expect(unrestrictedNeedsConfirmation(settingsObj({ enabled: true, recipientAllowlist: ['a@b.co'] }), false)).toBe(false)
  })
})
