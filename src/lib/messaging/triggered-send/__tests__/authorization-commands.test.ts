import { beforeEach, describe, expect, it } from 'vitest'
import { CRM_TRIGGERED_SEND_AUTHORIZATION_CHANGED } from '@/lib/inngest/triggered-send-events'
import { ProposeCommandSchema, proposeCommand, revokeCommand, type ProposeCommand } from '../authorization-commands'
import { ruleSha256 } from '../rule'
import { templateContentSha256 } from '../welcome-template'
import { ACTOR, CLIENT, OTHER_CLIENT, fakeWorld, sendableRule, template, type FakeWorld } from './authorization-fakes'

function propose(over: Partial<ProposeCommand> = {}): ProposeCommand {
  return { client_id: CLIENT, account: 'cts', daily_cap: 20, rule: sendableRule(), confirm: true, ...over }
}

let w: FakeWorld
beforeEach(() => {
  w = fakeWorld()
})

describe('propose — what may be proposed', () => {
  it('a preview writes nothing and shows exactly what would be bound', async () => {
    const res = await proposeCommand(w.deps, CLIENT, ACTOR, propose({ confirm: false }))
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      mode: 'PREVIEW',
      no_send: true,
      proposal: {
        rule_sha256: ruleSha256(sendableRule()),
        template_key: 'auto-welcome',
        template_version: 3,
        template_sha256: templateContentSha256(template()),
        daily_cap: 20,
        replaces_proposal_id: null,
      },
    })
    expect(w.store.rows).toHaveLength(0)
    expect(w.events).toHaveLength(0)
  })

  it('confirm defaults to false: a body without it is a preview', () => {
    const parsed = ProposeCommandSchema.parse({ client_id: CLIENT, account: 'cts', daily_cap: 1, rule: {} })
    expect(parsed.confirm).toBe(false)
  })

  it('🔴 refuses a rule without its send block (a rehearsal-only rule can never be authorized)', async () => {
    const rule: Record<string, unknown> = { ...sendableRule() }
    delete rule.send
    const res = await proposeCommand(w.deps, CLIENT, ACTOR, propose({ rule }))
    expect(res).toMatchObject({ status: 422, body: { error: 'RULE_HAS_NO_SEND_BLOCK' } })
    expect(w.store.rows).toHaveLength(0)
  })

  it('🔴 refuses a rule of another gate version, a malformed or system account, and a template that may not be sent', async () => {
    expect((await proposeCommand(w.deps, CLIENT, ACTOR, propose({ rule: sendableRule({ gate_contract_version: 2 }) }))).body.error).toBe(
      'GATE_VERSION_MISMATCH',
    )
    expect((await proposeCommand(w.deps, CLIENT, ACTOR, propose({ account: 'system' }))).body.error).toBe('ACCOUNT_INVALID')
    w.set.template({ ok: true, template: template({ status: 'disabled' }) })
    expect((await proposeCommand(w.deps, CLIENT, ACTOR, propose())).body).toMatchObject({ error: 'TEMPLATE_NOT_SENDABLE', reason: 'template_disabled' })
    w.set.template({ ok: true, template: null })
    expect((await proposeCommand(w.deps, CLIENT, ACTOR, propose())).body).toMatchObject({ error: 'TEMPLATE_NOT_SENDABLE', reason: 'template_missing' })
    w.set.template({ ok: false })
    expect(await proposeCommand(w.deps, CLIENT, ACTOR, propose())).toMatchObject({ status: 503, body: { error: 'TEMPLATE_UNREADABLE' } })
    expect(w.store.rows).toHaveLength(0)
  })

  it('🔴 a trial goes only to internal domains configured on the deploy, and to at most 3 addresses', async () => {
    const trial = (list: string[]) => propose({ rule: sendableRule({ recipient_allowlist: list }) })
    expect((await proposeCommand(w.deps, CLIENT, ACTOR, trial(['hello@example.com']))).body.mode).toBe('PROPOSED')
    expect((await proposeCommand(w.deps, CLIENT, ACTOR, trial(['guest@gmail.com']))).body).toMatchObject({ error: 'TRIAL_RECIPIENT_NOT_INTERNAL', outside: 1 })
    expect((await proposeCommand(w.deps, CLIENT, ACTOR, trial(['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com']))).body.error).toBe('RULE_INVALID')
    w.set.env({})
    expect((await proposeCommand(w.deps, CLIENT, ACTOR, trial(['hello@example.com']))).body.error).toBe('TRIAL_DOMAINS_NOT_CONFIGURED')
    // A rule for real leads is not a trial: the trial domains do not matter for it.
    expect((await proposeCommand(w.deps, CLIENT, ACTOR, propose())).body.mode).toBe('PROPOSED')
  })

  it('🔴 the salespeople\'s mailboxes must be connected (§5.2 F); a failed read is not "connected"', async () => {
    w.set.mailboxes({ ok: false, reason: 'missing', detail: '1 of 1' })
    expect(await proposeCommand(w.deps, CLIENT, ACTOR, propose())).toMatchObject({ status: 422, body: { error: 'REQUIRED_MAILBOXES_NOT_CONNECTED' } })
    w.set.mailboxes({ ok: false, reason: 'unreadable', detail: 'x' })
    expect(await proposeCommand(w.deps, CLIENT, ACTOR, propose())).toMatchObject({ status: 503, body: { error: 'REQUIRED_MAILBOXES_UNREADABLE' } })
    expect(w.store.rows).toHaveLength(0)
  })

  it('writes the proposal bound to the current template, by the logged-in person, and emits its receipt', async () => {
    const res = await proposeCommand(w.deps, CLIENT, ACTOR, propose())
    expect(res.body).toMatchObject({ mode: 'PROPOSED', event_status: 'sent' })
    const [row] = w.store.rows
    expect(row).toMatchObject({ clientId: CLIENT, account: 'cts', proposedByEmail: ACTOR.email, templateVersion: 3, authorizedAt: null })
    expect(row.ruleSha256).toBe(ruleSha256(sendableRule()))
    expect(w.events).toHaveLength(1)
    expect(w.events[0]).toMatchObject({
      name: CRM_TRIGGERED_SEND_AUTHORIZATION_CHANGED,
      id: `triggered_send_authorization:${row.id}:proposed`,
      data: { change: 'proposed', actor: 'person', authorization_id: row.id, no_send: true, provider_impact: 'NONE' },
    })
    expect(JSON.stringify(w.events[0])).not.toContain('@')
  })

  it('replaces the open proposal (SUPERSEDED) but leaves the authorization in force alone', async () => {
    const live = w.store.seed({ authorizedAt: '2026-11-15T00:00:00.000Z', activatedAt: '2026-11-15T00:00:01.000Z', authorizedByEmail: 'pm@example.com' })
    const old = w.store.seed()
    const res = await proposeCommand(w.deps, CLIENT, ACTOR, propose())
    expect(res.body).toMatchObject({ mode: 'PROPOSED', proposal: { replaces_proposal_id: old.id } })
    expect(w.store.rows.find((r) => r.id === old.id)).toMatchObject({ revokedBy: 'system:SUPERSEDED' })
    expect(w.store.rows.find((r) => r.id === live.id)?.revokedAt).toBeNull()
    expect(w.events.map((e) => e.data.change)).toEqual(['revoked', 'proposed'])
  })

  it('a proposal written in between, or a failed write, is reported (and says the old one is already gone)', async () => {
    w.store.seed()
    w.store.fail.insertProposal = 'proposal_conflict'
    expect(await proposeCommand(w.deps, CLIENT, ACTOR, propose())).toMatchObject({
      status: 409,
      body: { error: 'PROPOSAL_CONFLICT', replaced_proposal_revoked: true },
    })
    w.store.fail.insertProposal = '08006'
    expect(await proposeCommand(w.deps, CLIENT, ACTOR, propose())).toMatchObject({
      status: 500,
      body: { error: 'PROPOSAL_NOT_WRITTEN', replaced_proposal_revoked: false },
    })
  })

  it('an event that cannot be sent does not undo the proposal (a proposal arms nothing)', async () => {
    w.set.emitFails()
    const res = await proposeCommand(w.deps, CLIENT, ACTOR, propose())
    expect(res.body).toMatchObject({ mode: 'PROPOSED', event_status: 'failed' })
    expect(w.store.rows).toHaveLength(1)
  })
})

describe('revoke — the brake', () => {
  it('revokes an open authorization by the logged-in person, whatever its template or rule', async () => {
    const live = w.store.seed({ rule: { broken: true }, authorizedAt: '2026-11-15T00:00:00.000Z', activatedAt: '2026-11-15T00:00:01.000Z' })
    w.set.template({ ok: false })
    w.set.mailboxes({ ok: false, reason: 'unreadable', detail: 'x' })
    const res = await revokeCommand(w.deps, CLIENT, ACTOR, { client_id: CLIENT, authorization_id: live.id, reason: 'stop now' })
    expect(res.body).toMatchObject({ mode: 'REVOKED', event_status: 'sent', authorization: { revoked_by: ACTOR.email, revoked_reason: 'stop now' } })
    expect(w.events[0].data).toMatchObject({ change: 'revoked', actor: 'person' })
  })

  it('an event that cannot be sent never undoes the revocation', async () => {
    const live = w.store.seed({ authorizedAt: '2026-11-15T00:00:00.000Z' })
    w.set.emitFails()
    const res = await revokeCommand(w.deps, CLIENT, ACTOR, { client_id: CLIENT, authorization_id: live.id, reason: 'stop' })
    expect(res.body).toMatchObject({ mode: 'REVOKED', event_status: 'failed' })
    expect(w.store.rows[0].revokedAt).not.toBeNull()
  })

  it('🔴 a brake pressed on a stale page (a row already replaced) names the authorization that is really in force', async () => {
    const trial = w.store.seed({ authorizedAt: '2026-11-10T00:00:00.000Z', revokedAt: '2026-11-15T00:00:00.000Z', revokedBy: 'system:SUPERSEDED' })
    const real = w.store.seed({ authorizedAt: '2026-11-15T00:00:00.000Z', activatedAt: '2026-11-15T00:00:01.000Z' })
    const res = await revokeCommand(w.deps, CLIENT, ACTOR, { client_id: CLIENT, authorization_id: trial.id, reason: 'stop' })
    expect(res).toMatchObject({ status: 409, body: { error: 'ALREADY_REVOKED', current_authorization: { id: real.id } } })
    expect(real.revokedAt).toBeNull()
  })

  it("🔴 another client's row, or a row of another trigger, is not found here; a revoked row is never written again", async () => {
    const foreign = w.store.seed({ clientId: OTHER_CLIENT })
    expect(await revokeCommand(w.deps, CLIENT, ACTOR, { client_id: CLIENT, authorization_id: foreign.id, reason: 'x' })).toMatchObject({
      status: 404,
      body: { error: 'AUTHORIZATION_NOT_FOUND' },
    })
    const other = w.store.seed({ triggerKey: 'countdown' })
    expect((await revokeCommand(w.deps, CLIENT, ACTOR, { client_id: CLIENT, authorization_id: other.id, reason: 'x' })).status).toBe(404)
    expect(foreign.revokedAt).toBeNull()
    expect(other.revokedAt).toBeNull()
    const gone = w.store.seed({ revokedAt: '2026-11-18T00:00:00.000Z', revokedBy: 'system:SUPERSEDED' })
    expect((await revokeCommand(w.deps, CLIENT, ACTOR, { client_id: CLIENT, authorization_id: gone.id, reason: 'x' })).status).toBe(409)
    expect(gone.revokedBy).toBe('system:SUPERSEDED')
  })

  it('a failed read or write is a 500, not a pretend success', async () => {
    const live = w.store.seed()
    w.store.fail.load = '08006'
    expect((await revokeCommand(w.deps, CLIENT, ACTOR, { client_id: CLIENT, authorization_id: live.id, reason: 'x' })).status).toBe(500)
    w.store.fail.revoke = '08006'
    expect(await revokeCommand(w.deps, CLIENT, ACTOR, { client_id: CLIENT, authorization_id: live.id, reason: 'x' })).toMatchObject({
      status: 500,
      body: { error: 'REVOKE_FAILED' },
    })
  })
})
