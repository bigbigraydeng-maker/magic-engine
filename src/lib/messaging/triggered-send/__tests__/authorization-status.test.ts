import { beforeEach, describe, expect, it } from 'vitest'
import { statusQuery, type StatusDeps } from '../authorization-status'
import { ruleSha256 } from '../rule'
import { describeRule } from '../rule-summary'
import { CLIENT, evidence, fakeWorld, sendableRule, template, type FakeWorld } from './authorization-fakes'

let w: FakeWorld
let env: Record<string, string>

function deps(): StatusDeps {
  return { ...w.deps, env: (name) => env[name] }
}

beforeEach(() => {
  w = fakeWorld()
  env = {}
})

describe('status — the PM page', () => {
  it('nothing proposed: says so, practice mode, no prerequisites', async () => {
    const res = await statusQuery(deps(), CLIENT)
    expect(res.body).toMatchObject({ success: true, can_manage: true, mode: 'practice', proposal: null, authorization: null, prerequisites: null })
  })

  it('a rehearsal-only proposal shows its words and its evidence, and why it cannot be authorized', async () => {
    const rule: Record<string, unknown> = { ...sendableRule() }
    delete rule.send
    w.store.seed({ rule, ruleSha256: ruleSha256(rule as never), templateVersion: null, templateSha256: null })
    w.set.rehearsal({ ok: true, evidence: evidence(2) })
    const res = await statusQuery(deps(), CLIENT)
    const proposal = res.body.proposal as Record<string, unknown>
    expect(proposal).toMatchObject({ problem: 'RULE_HAS_NO_SEND_BLOCK', trial: false, template: null, rehearsal: { consecutiveDays: 2 } })
    expect(proposal.summary).toContain('这份提案没有发信设置：只能彩排，不能授权')
  })

  it('a sendable proposal for real leads names what still blocks it: the rehearsal, a changed template', async () => {
    w.store.seed()
    w.set.rehearsal({ ok: true, evidence: evidence(3) })
    let proposal = (await statusQuery(deps(), CLIENT)).body.proposal as Record<string, unknown>
    expect(proposal).toMatchObject({ problem: 'REHEARSAL_NOT_READY', template: { check: 'ok', subject: 'Welcome, {{ first_name }}' } })

    w.set.rehearsal({ ok: true, evidence: evidence(5) })
    proposal = (await statusQuery(deps(), CLIENT)).body.proposal as Record<string, unknown>
    expect(proposal.problem).toBeNull()

    w.set.template({ ok: true, template: template({ version: 4 }) })
    proposal = (await statusQuery(deps(), CLIENT)).body.proposal as Record<string, unknown>
    expect(proposal.problem).toBe('TEMPLATE_CHANGED')
  })

  it('the authorization in force is judged like the sender would; a template that cannot be read is named', async () => {
    w.store.seed({ authorizedAt: '2026-11-15T00:00:00.000Z', activatedAt: '2026-11-15T00:00:01.000Z', expiresAt: '2027-02-01T00:00:00.000Z' })
    let auth = (await statusQuery(deps(), CLIENT)).body.authorization as Record<string, unknown>
    expect(auth.state).toBe('active')
    w.set.template({ ok: false })
    auth = (await statusQuery(deps(), CLIENT)).body.authorization as Record<string, unknown>
    expect(auth.state).toBe('template_unreadable')
    w.set.template({ ok: true, template: template({ status: 'disabled' }) })
    auth = (await statusQuery(deps(), CLIENT)).body.authorization as Record<string, unknown>
    expect(auth.state).toBe('template_not_sendable')
  })

  it('an authorized row that was never armed, or has run out, says so', async () => {
    const row = w.store.seed({ authorizedAt: '2026-11-15T00:00:00.000Z', expiresAt: '2027-02-01T00:00:00.000Z' })
    expect(((await statusQuery(deps(), CLIENT)).body.authorization as Record<string, unknown>).state).toBe('not_activated')
    row.activatedAt = '2026-11-15T00:00:01.000Z'
    row.expiresAt = '2026-11-19T00:00:00.000Z'
    expect(((await statusQuery(deps(), CLIENT)).body.authorization as Record<string, unknown>).state).toBe('expired')
  })

  it('live only with both switches; prerequisites are yes/no and never show a value', async () => {
    w.store.seed()
    env = {
      TRIGGERED_SEND_LIVE: 'true',
      TRIGGERED_SEND_CLIENTS: CLIENT,
      RESEND_API_KEY_CTS: 're_' + 'x'.repeat(30),
      UNSUBSCRIBE_SIGNING_SECRET: 's'.repeat(40),
    }
    const res = await statusQuery(deps(), CLIENT)
    expect(res.body).toMatchObject({ mode: 'live', prerequisites: { account: 'cts', account_key: true, unsubscribe_secret: true } })
    // Which webhook receives an account's receipts is not knowable here: the status does not pretend to know.
    expect(Object.keys(res.body.prerequisites as object).sort()).toEqual(['account', 'account_key', 'unsubscribe_secret'])
    expect(JSON.stringify(res.body)).not.toContain('x'.repeat(30))
    expect(JSON.stringify(res.body)).not.toContain('s'.repeat(40))
    env.TRIGGERED_SEND_LIVE = 'TRUE'
    expect((await statusQuery(deps(), CLIENT)).body.mode).toBe('practice')
  })

  it('a failed read of the table is a 500, never "nothing proposed"', async () => {
    w.store.fail.loadOpen = '08006'
    expect(await statusQuery(deps(), CLIENT)).toMatchObject({ status: 500, body: { error: 'AUTHORIZATIONS_UNREADABLE' } })
  })
})

describe('describeRule', () => {
  it('a trial names its only recipients; a real rule says everyone who qualifies', () => {
    expect(describeRule(sendableRule({ recipient_allowlist: ['hello@example.com'] }), 5).join('\n')).toContain('只发给 hello@example.com')
    const words = describeRule(sendableRule(), 20).join('\n')
    expect(words).toContain('所有符合条件的新客人')
    expect(words).toContain('每天最多 20 封')
    expect(words).toContain('7 天内最多收 2 封')
  })
})
