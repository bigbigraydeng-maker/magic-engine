import { describe, expect, it } from 'vitest'
import { ruleSha256, type TriggeredSendRule } from '../rule'
import {
  SELF_REVOKING_REASONS,
  judgeStandingAuthorization,
  type StandingAuthorizationNow,
  type StandingAuthorizationRow,
} from '../standing-authorization'

const NOW = new Date('2026-11-20T00:00:00.000Z')
const TEMPLATE_SHA = 'a'.repeat(64)

function rule(over: Partial<TriggeredSendRule> = {}): TriggeredSendRule {
  return {
    gate_contract_version: 2,
    audience: { sources: ['meta_lead_form'], max_age_days: 3, min_age: 'previous_local_day' },
    schedule: { timezone: 'Pacific/Auckland' },
    frequency_cap: { max: 2, window_days: 7 },
    consent: { accepted_bases: ['form_disclosure_attested'] },
    legacy: { mailchimp_campaign_title_prefix: 'legacy_batch_', excluded_tags: [] },
    human_mail: { required_mailboxes: ['sales@example.com'] },
    recipient_allowlist: null,
    send: {
      identity: { from: 'Example <news@news.example.com>', reply_to: 'info@example.com' },
      template: { key: 'auto-welcome' },
      send_window: { start: '08:00', end: '20:00' },
      health_breaker: { window_days: 30, bounce_min_sent: 50, bounce_min_count: 3, bounce_rate_pct: 4, complaint_max: 2, provider_reject_streak: 3 },
    },
    ...over,
  }
}

function row(over: Partial<StandingAuthorizationRow> = {}): StandingAuthorizationRow {
  const r = rule()
  return {
    id: 'b1111111-1111-4111-8111-111111111111',
    clientId: 'c0000000-0000-0000-0000-000000000000',
    ruleRaw: r,
    ruleSha256: ruleSha256(r),
    templateVersion: 3,
    templateSha256: TEMPLATE_SHA,
    authorizedAt: '2026-11-15T00:00:00.000Z',
    expiresAt: '2027-02-10T00:00:00.000Z',
    activatedAt: '2026-11-15T00:00:05.000Z',
    revokedAt: null,
    ...over,
  }
}

const CURRENT: StandingAuthorizationNow = { now: NOW, gateContractVersion: 2, templateVersion: 3, templateSha256: TEMPLATE_SHA }

describe('judgeStandingAuthorization', () => {
  it('is in force when authorized, armed, unexpired, unchanged', () => {
    const verdict = judgeStandingAuthorization(row(), CURRENT)
    expect(verdict.active).toBe(true)
    if (verdict.active) expect(verdict.rule.send.template.key).toBe('auto-welcome')
  })

  it('checks in the fixed order, failing closed', () => {
    const everythingWrong = row({ revokedAt: NOW.toISOString(), authorizedAt: null, activatedAt: null, expiresAt: null })
    expect(judgeStandingAuthorization(everythingWrong, CURRENT)).toEqual({ active: false, reason: 'REVOKED' })
    expect(judgeStandingAuthorization(row({ authorizedAt: null, activatedAt: null }), CURRENT)).toEqual({ active: false, reason: 'NOT_AUTHORIZED' })
    expect(judgeStandingAuthorization(row({ activatedAt: null }), CURRENT)).toEqual({ active: false, reason: 'NOT_ACTIVATED' })
    expect(judgeStandingAuthorization(row({ expiresAt: '2026-11-19T00:00:00.000Z' }), CURRENT)).toEqual({ active: false, reason: 'EXPIRED' })
  })

  it('an expiry that is missing, unreadable or exactly now counts as expired', () => {
    for (const expiresAt of [null, 'soon', NOW.toISOString()]) {
      expect(judgeStandingAuthorization(row({ expiresAt }), CURRENT), String(expiresAt)).toEqual({ active: false, reason: 'EXPIRED' })
    }
  })

  it('a rule that does not parse as sendable, or whose fingerprint does not match, is invalid', () => {
    const rehearsalOnly = rule({ send: undefined })
    delete (rehearsalOnly as { send?: unknown }).send
    expect(judgeStandingAuthorization(row({ ruleRaw: rehearsalOnly, ruleSha256: ruleSha256(rehearsalOnly) }), CURRENT)).toEqual({ active: false, reason: 'RULE_INVALID' })
    expect(judgeStandingAuthorization(row({ ruleSha256: 'b'.repeat(64) }), CURRENT)).toEqual({ active: false, reason: 'RULE_INVALID' })
    expect(judgeStandingAuthorization(row({ ruleRaw: { nonsense: true } }), CURRENT)).toEqual({ active: false, reason: 'RULE_INVALID' })
  })

  it('a moved gate contract or a changed template ends it', () => {
    expect(judgeStandingAuthorization(row(), { ...CURRENT, gateContractVersion: 3 })).toEqual({ active: false, reason: 'GATE_CHANGED' })
    expect(judgeStandingAuthorization(row(), { ...CURRENT, templateVersion: 4 })).toEqual({ active: false, reason: 'TEMPLATE_CHANGED' })
    expect(judgeStandingAuthorization(row(), { ...CURRENT, templateSha256: 'c'.repeat(64) })).toEqual({ active: false, reason: 'TEMPLATE_CHANGED' })
    expect(judgeStandingAuthorization(row({ templateVersion: null }), CURRENT)).toEqual({ active: false, reason: 'TEMPLATE_CHANGED' })
  })

  it('only the "what the PM approved is gone" reasons revoke by themselves', () => {
    expect([...SELF_REVOKING_REASONS].sort()).toEqual(['GATE_CHANGED', 'RULE_INVALID', 'TEMPLATE_CHANGED'])
  })
})
