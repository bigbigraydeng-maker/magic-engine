import { describe, expect, it } from 'vitest'
import { MAX_TRIAL_RECIPIENTS, parseRule } from '../rule'
import { TRIAL_DOMAINS_ENV, checkTrialRecipients, readTrialDomains } from '../trial-recipients'
import { sendableRule } from './authorization-fakes'

const env = (value: string | undefined) => (name: string) => (name === TRIAL_DOMAINS_ENV ? value : undefined)

describe('trial recipients', () => {
  it('a rule for real leads is not a trial: nothing to check', () => {
    expect(checkTrialRecipients(sendableRule(), env(undefined))).toEqual({ ok: true })
  })

  it('🔴 not configured = no trial at all (never "whatever the proposal says is internal")', () => {
    for (const value of [undefined, '', ' , ']) {
      expect(checkTrialRecipients(sendableRule({ recipient_allowlist: ['hello@example.com'] }), env(value))).toEqual({
        ok: false,
        reason: 'trial_domains_not_configured',
      })
    }
  })

  it('🔴 every address must be on a listed domain, exactly (no sub-domains, no look-alikes)', () => {
    const domains = env(' Example.com ,magicengine.cloud')
    expect(checkTrialRecipients(sendableRule({ recipient_allowlist: ['hello@example.com', 'pm@magicengine.cloud'] }), domains)).toEqual({ ok: true })
    expect(checkTrialRecipients(sendableRule({ recipient_allowlist: ['hello@example.com', 'a@mail.example.com'] }), domains)).toEqual({
      ok: false,
      reason: 'trial_recipient_not_internal',
      outside: 1,
    })
    expect(checkTrialRecipients(sendableRule({ recipient_allowlist: ['x@example.com.evil.test'] }), domains)).toMatchObject({ ok: false })
    expect([...readTrialDomains(domains)]).toEqual(['example.com', 'magicengine.cloud'])
  })

  it(`🔴 an allow-list has at most ${MAX_TRIAL_RECIPIENTS} addresses (a trial, never a list of guests)`, () => {
    const many = ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com']
    expect(parseRule(sendableRule({ recipient_allowlist: many.slice(0, MAX_TRIAL_RECIPIENTS) })).ok).toBe(true)
    expect(parseRule(sendableRule({ recipient_allowlist: many }))).toMatchObject({ ok: false })
  })
})
