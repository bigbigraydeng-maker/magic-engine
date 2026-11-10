import { describe, expect, it } from 'vitest'
import { parseRule, parseSendRule, ruleSha256, type TriggeredSendRule } from '../rule'
import { fromAddressOf, parseSendBlock, type SendRuleBlock } from '../send-rule'

function rehearsal(): TriggeredSendRule {
  return {
    gate_contract_version: 1,
    audience: { sources: ['meta_lead_form'], max_age_days: 3, min_age: 'previous_local_day' },
    schedule: { timezone: 'Pacific/Auckland' },
    frequency_cap: { max: 2, window_days: 7 },
    consent: { accepted_bases: ['form_disclosure_attested'] },
    legacy: { mailchimp_campaign_title_prefix: 'legacy_batch_', excluded_tags: ['sales_active'] },
    human_mail: { required_mailboxes: ['sales@example.com'] },
    recipient_allowlist: null,
  }
}

function sendBlock(): SendRuleBlock {
  return {
    identity: { from: 'Example Tours <news@news.example.com>', reply_to: 'info@example.com' },
    template: { key: 'auto-welcome' },
    send_window: { start: '08:00', end: '20:00' },
    health_breaker: {
      window_days: 30,
      bounce_min_sent: 50,
      bounce_min_count: 3,
      bounce_rate_pct: 4,
      complaint_max: 2,
      provider_reject_streak: 3,
    },
  }
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

describe('rule.send (the real-send block)', () => {
  it('is optional: a rehearsal rule parses and keeps exactly the fingerprint it had', () => {
    const parsed = parseRule(rehearsal())
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect('send' in parsed.rule).toBe(false)
    expect(ruleSha256(parsed.rule)).toBe(ruleSha256(rehearsal()))
  })

  it('a rule with it parses, and its fingerprint covers it', () => {
    const parsed = parseRule({ ...rehearsal(), send: sendBlock() })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.rule.send).toEqual(sendBlock())
    expect(ruleSha256(parsed.rule)).not.toBe(ruleSha256(rehearsal()))
    const other = parseRule({ ...rehearsal(), send: { ...sendBlock(), send_window: { start: '09:00', end: '20:00' } } })
    expect(other.ok && ruleSha256(other.rule)).not.toBe(ruleSha256(parsed.rule))
  })

  it('only a rule that carries it may be authorized', () => {
    expect(parseSendRule(rehearsal())).toEqual({ ok: false, error: 'send is required for a rule that may be authorized' })
    const ok = parseSendRule({ ...rehearsal(), send: sendBlock() })
    expect(ok.ok).toBe(true)
  })

  it('other unknown top-level keys are still refused', () => {
    const parsed = parseRule({ ...rehearsal(), sends: sendBlock() })
    expect(parsed.ok).toBe(false)
  })

  it('refuses a template that is not an automated (auto-) template', () => {
    expect(parseSendBlock({ ...sendBlock(), template: { key: 'welcome' } })).toEqual({
      ok: false,
      error: 'send.template.key must be an automated (auto-) template',
    })
    expect(parseSendBlock({ ...sendBlock(), template: { key: 'Auto-Welcome' } }).ok).toBe(false)
  })

  it('refuses a bad sender or reply address', () => {
    const bad: Array<Partial<SendRuleBlock['identity']>> = [
      { from: 'News@Example.com' },
      { from: 'Example, Tours <news@example.com>' },
      { from: 'Example <news@example>' },
      { from: ' Example <news@example.com>' },
      { reply_to: 'Info@example.com' },
      { reply_to: 'info@example.com, sales@example.com' },
    ]
    for (const identity of bad) {
      const block = clone(sendBlock())
      Object.assign(block.identity, identity)
      expect(parseSendBlock(block).ok, JSON.stringify(identity)).toBe(false)
    }
    expect(fromAddressOf('Example Tours <news@news.example.com>')).toBe('news@news.example.com')
    expect(fromAddressOf('news@example.com')).toBe('news@example.com')
  })

  it('refuses quiet hours that are not HH:MM or not in order', () => {
    for (const quiet of [{ start: '8:00', end: '20:00' }, { start: '20:00', end: '08:00' }, { start: '08:00', end: '08:00' }, { start: '24:00', end: '25:00' }]) {
      expect(parseSendBlock({ ...sendBlock(), send_window: quiet }).ok, JSON.stringify(quiet)).toBe(false)
    }
  })

  it('refuses stop lines out of range, missing or extra keys', () => {
    const cases: Array<Record<string, unknown>> = [
      { ...sendBlock().health_breaker, window_days: 1 },
      { ...sendBlock().health_breaker, bounce_rate_pct: 0 },
      { ...sendBlock().health_breaker, complaint_max: 11 },
      { ...sendBlock().health_breaker, provider_reject_streak: 0.5 },
      { ...sendBlock().health_breaker, extra: 1 },
    ]
    for (const breaker of cases) {
      expect(parseSendBlock({ ...sendBlock(), health_breaker: breaker }).ok, JSON.stringify(breaker)).toBe(false)
    }
    const { health_breaker: _omitted, ...missing } = sendBlock()
    expect(parseSendBlock(missing).ok).toBe(false)
    expect(parseSendBlock({ ...sendBlock(), extra: true }).ok).toBe(false)
    expect(parseSendBlock(null).ok).toBe(false)
  })
})

describe('a stored rule keeps its fingerprint', () => {
  // The sender revokes an authorization whose rule no longer parses or no longer has its fingerprint (RULE_INVALID).
  // A rule written by the propose command and read back from the database (JSON) must stay the same rule.
  it('parse → JSON round trip (key order lost) → parse gives the same fingerprint', async () => {
    const { parseSendRule, ruleSha256 } = await import('../rule')
    const { sendableRule } = await import('./authorization-fakes')
    const first = parseSendRule(sendableRule({ recipient_allowlist: ['hello@example.com'] }))
    expect(first.ok).toBe(true)
    if (!first.ok) return
    // Every object's keys in reverse order, at every level: what a database may hand back.
    const reverseKeys = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(reverseKeys)
        : v !== null && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverseKeys(x)]))
          : v
    const stored: unknown = JSON.parse(JSON.stringify(first.rule))
    const shuffled = reverseKeys(stored)
    for (const raw of [stored, shuffled]) {
      const again = parseSendRule(raw)
      expect(again.ok).toBe(true)
      if (again.ok) expect(ruleSha256(again.rule)).toBe(ruleSha256(first.rule))
    }
  })
})
