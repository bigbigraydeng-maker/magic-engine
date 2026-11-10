import { beforeEach, describe, expect, it } from 'vitest'
import { authorizeCommand } from '../authorization-authorize'
import { statusQuery } from '../authorization-status'
import type { AuthorizationRecord } from '../authorization-store'
import { ruleSha256 } from '../rule'
import { describeRule } from '../rule-summary'
import { ACTOR, CLIENT, evidence, fakeWorld, sendableRule, template, type FakeWorld } from './authorization-fakes'

let w: FakeWorld
const ADMIN = { canAuthorize: true }

beforeEach(() => {
  w = fakeWorld()
})

async function proposalOf(): Promise<Record<string, unknown>> {
  return (await statusQuery(w.statusDeps, CLIENT, ADMIN)).body.proposal as Record<string, unknown>
}

async function authorizationOf(): Promise<Record<string, unknown>> {
  return (await statusQuery(w.statusDeps, CLIENT, ADMIN)).body.authorization as Record<string, unknown>
}

describe('status — the PM page', () => {
  it('nothing proposed: says so, practice mode, no prerequisites; says whether this viewer may authorize', async () => {
    const res = await statusQuery(w.statusDeps, CLIENT, { canAuthorize: false })
    expect(res.body).toMatchObject({ success: true, can_manage: true, can_authorize: false, mode: 'practice', proposal: null, authorization: null, prerequisites: null })
  })

  it('a rehearsal-only proposal shows its words and its evidence, and why it cannot be authorized', async () => {
    const rule: Record<string, unknown> = { ...sendableRule() }
    delete rule.send
    w.store.seed({ rule, ruleSha256: ruleSha256(rule as never), templateVersion: null, templateSha256: null })
    w.set.rehearsal({ ok: true, evidence: evidence(2) })
    const proposal = await proposalOf()
    expect(proposal).toMatchObject({ problem: 'RULE_HAS_NO_SEND_BLOCK', trial: false, template: null, rehearsal: { consecutiveDays: 2 } })
    expect(proposal.summary).toContain('这份提案没有发信设置：只能彩排，不能授权')
  })

  it('a sendable proposal for real leads names what still blocks it: the rehearsal, a changed template', async () => {
    w.store.seed()
    w.set.rehearsal({ ok: true, evidence: evidence(3) })
    expect(await proposalOf()).toMatchObject({ problem: 'REHEARSAL_NOT_READY', template: { check: 'ok', subject: 'Welcome, {{ first_name }}' } })
    w.set.rehearsal({ ok: true, evidence: evidence(5) })
    expect((await proposalOf()).problem).toBeNull()
    w.set.template({ ok: true, template: template({ version: 4 }) })
    expect((await proposalOf()).problem).toBe('TEMPLATE_CHANGED')
  })

  it('🔴 the page and the authorize command always agree on whether a proposal can be authorized', async () => {
    const setups: Array<() => void> = [
      () => undefined,
      () => w.set.rehearsal({ ok: true, evidence: evidence(4) }),
      () => w.set.template({ ok: true, template: template({ version: 4 }) }),
      () => w.set.template({ ok: false }),
      () => w.set.mailboxes({ ok: false, reason: 'missing', detail: 'x' }),
      () => w.set.canEmit(false),
      () => w.set.env({}),
    ]
    for (const [i, setup] of setups.entries()) {
      w = fakeWorld()
      const rule = i === setups.length - 1 ? sendableRule({ recipient_allowlist: ['hello@example.com'] }) : sendableRule()
      const row: AuthorizationRecord = w.store.seed({ rule, ruleSha256: ruleSha256(rule) })
      setup()
      const shown = (await proposalOf()).problem
      const preview = await authorizeCommand(w.deps, CLIENT, ACTOR, {
        client_id: CLIENT,
        authorization_id: row.id,
        rule_sha256: row.ruleSha256,
        template_sha256: row.templateSha256 as string,
        backfill_hours: 0,
        expires_in_days: 90,
        confirm: false,
      })
      expect(preview.status === 200 ? null : preview.body.error, `setup ${i}`).toBe(shown)
    }
  })

  it('the authorization in force is judged like the sender would; a disabled or edited template voids it, an unreadable one is temporary', async () => {
    const rule = sendableRule({ recipient_allowlist: ['hello@example.com'] })
    w.store.seed({ rule, ruleSha256: ruleSha256(rule), authorizedAt: '2026-11-15T00:00:00.000Z', activatedAt: '2026-11-15T00:00:01.000Z', expiresAt: '2027-02-01T00:00:00.000Z' })
    expect((await authorizationOf()).state).toBe('active')
    w.set.template({ ok: false })
    expect((await authorizationOf()).state).toBe('template_unreadable')
    // 127 disables a template by adding a new, disabled version: the approved version is gone.
    w.set.template({ ok: true, template: template({ version: 4, status: 'disabled' }) })
    expect((await authorizationOf()).state).toBe('template_changed')
  })

  it('🔴 a trial in force whose addresses left the internal domains is shown as "will not be sent"', async () => {
    const rule = sendableRule({ recipient_allowlist: ['hello@example.com'] })
    w.store.seed({ rule, ruleSha256: ruleSha256(rule), authorizedAt: '2026-11-15T00:00:00.000Z', activatedAt: '2026-11-15T00:00:01.000Z', expiresAt: '2027-02-01T00:00:00.000Z' })
    expect((await authorizationOf()).state).toBe('active')
    w.set.env({ TRIGGERED_SEND_TRIAL_DOMAINS: 'magicengine.cloud' })
    expect((await authorizationOf()).state).toBe('trial_recipient_not_internal')
  })

  it('says whether the approver list is set (yes/no only)', async () => {
    w.store.seed()
    expect(((await statusQuery(w.statusDeps, CLIENT, ADMIN)).body.prerequisites as Record<string, unknown>).approvers).toBe(false)
    w.set.env({ TRIGGERED_SEND_APPROVER_EMAILS: 'pm@example.com' })
    const body = (await statusQuery(w.statusDeps, CLIENT, ADMIN)).body
    expect((body.prerequisites as Record<string, unknown>).approvers).toBe(true)
    expect(JSON.stringify(body)).not.toContain('pm@example.com')
  })

  it('an authorized row that was never armed, or has run out, says so', async () => {
    const row = w.store.seed({ authorizedAt: '2026-11-15T00:00:00.000Z', expiresAt: '2027-02-01T00:00:00.000Z' })
    expect((await authorizationOf()).state).toBe('not_activated')
    row.activatedAt = '2026-11-15T00:00:01.000Z'
    row.expiresAt = '2026-11-19T00:00:00.000Z'
    expect((await authorizationOf()).state).toBe('expired')
  })

  it('live only with both switches; prerequisites are yes/no and never show a value', async () => {
    w.store.seed()
    w.set.env({
      TRIGGERED_SEND_LIVE: 'true',
      TRIGGERED_SEND_CLIENTS: CLIENT,
      RESEND_API_KEY_CTS: 're_' + 'x'.repeat(30),
      UNSUBSCRIBE_SIGNING_SECRET: 's'.repeat(40),
      TRIGGERED_SEND_TRIAL_DOMAINS: 'example.com',
    })
    const res = await statusQuery(w.statusDeps, CLIENT, ADMIN)
    expect(res.body).toMatchObject({ mode: 'live', prerequisites: { account: 'cts', account_key: true, unsubscribe_secret: true, events: true, trial_domains: true } })
    expect(JSON.stringify(res.body)).not.toContain('x'.repeat(30))
    expect(JSON.stringify(res.body)).not.toContain('s'.repeat(40))
    w.set.env({ TRIGGERED_SEND_LIVE: 'TRUE', TRIGGERED_SEND_CLIENTS: CLIENT })
    expect((await statusQuery(w.statusDeps, CLIENT, ADMIN)).body).toMatchObject({ mode: 'practice', prerequisites: { trial_domains: false } })
  })

  it('🔴 this version sends trials only: an authorization for the real list in force is shown as "sends nothing"', async () => {
    w.store.seed({ authorizedAt: '2026-11-15T00:00:00.000Z', activatedAt: '2026-11-15T00:00:01.000Z', expiresAt: '2027-02-01T00:00:00.000Z' })
    expect(await authorizationOf()).toMatchObject({ trial: false, state: 'formal_sending_not_enabled' })
    // Not active for another reason first: that reason is what the PM sees.
    w.set.template({ ok: false })
    expect((await authorizationOf()).state).toBe('template_unreadable')
  })

  it('says whether the site address the unsubscribe link needs is usable (https, no path), yes/no only', async () => {
    w.store.seed()
    const appUrl = async (value: string | null) => {
      w.set.env(value === null ? {} : { APP_URL: value })
      return ((await statusQuery(w.statusDeps, CLIENT, ADMIN)).body.prerequisites as Record<string, unknown>).app_url
    }
    expect(await appUrl(null)).toBe(false)
    expect(await appUrl('http://app.example.com')).toBe(false)
    expect(await appUrl('https://app.example.com/some/path')).toBe(false)
    expect(await appUrl('https://app.example.com')).toBe(true)
  })

  it('🔴 shows the live letters as read and how many wait for a person; a failed read is null (the page says so), never an empty list or zero', async () => {
    const rows = [{ id: 's1', status: 'unknown_outcome' }, { id: 's2', status: 'delivered' }]
    w.set.recentSends({ ok: true, rows: rows as never, unknownCount: 1, unknownMore: false })
    expect((await statusQuery(w.statusDeps, CLIENT, ADMIN)).body).toMatchObject({ recent_sends: rows, recent_sends_limit: 20, unknown_sends: { count: 1, more: false } })
    w.set.recentSends({ ok: false, error: 'recent sends: 08006' })
    expect((await statusQuery(w.statusDeps, CLIENT, ADMIN)).body).toMatchObject({ recent_sends: null, unknown_sends: null })
    w.set.recentSends('throw')
    const res = await statusQuery(w.statusDeps, CLIENT, ADMIN)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ recent_sends: null, unknown_sends: null })
  })

  it('a failed read of the table is a 500, never "nothing proposed"', async () => {
    w.store.fail.loadOpen = '08006'
    expect(await statusQuery(w.statusDeps, CLIENT, ADMIN)).toMatchObject({ status: 500, body: { error: 'AUTHORIZATIONS_UNREADABLE' } })
  })
})

describe('describeRule', () => {
  it('a trial names its only recipients and how many; a real rule says everyone who qualifies', () => {
    expect(describeRule(sendableRule({ recipient_allowlist: ['hello@example.com'] }), 5).join('\n')).toContain('只发给这 1 个地址：hello@example.com')
    const words = describeRule(sendableRule(), 20).join('\n')
    expect(words).toContain('所有符合条件的新客人')
    expect(words).toContain('每天最多 20 封')
    expect(words).toContain('7 天内最多收 2 封')
    expect(words).toContain('客户所在时区（Pacific/Auckland）的 08:00–20:00')
  })
})
