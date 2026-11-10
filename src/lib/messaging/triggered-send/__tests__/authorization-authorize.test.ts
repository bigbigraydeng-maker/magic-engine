import { beforeEach, describe, expect, it } from 'vitest'
import { salesCapWarning } from '../authorization-assess'
import {
  AuthorizeCommandSchema,
  CLOCK_MARGIN_MS,
  EXPIRY_MARGIN_MS,
  authorizationWindow,
  authorizeCommand,
  type AuthorizeCommand,
} from '../authorization-authorize'
import type { AuthorizationRecord } from '../authorization-store'
import { ruleSha256 } from '../rule'
import { templateContentSha256 } from '../welcome-template'
import { ACTOR, CLIENT, NOW, OTHER_CLIENT, evidence, fakeWorld, sendableRule, template, type FakeWorld } from './authorization-fakes'

let w: FakeWorld
let proposal: AuthorizationRecord

function command(over: Partial<AuthorizeCommand> = {}): AuthorizeCommand {
  return {
    client_id: CLIENT,
    authorization_id: proposal.id,
    rule_sha256: proposal.ruleSha256,
    template_sha256: proposal.templateSha256 as string,
    backfill_hours: 0,
    expires_in_days: 90,
    confirm: true,
    ...over,
  }
}

function seedLive(): AuthorizationRecord {
  return w.store.seed({ authorizedAt: '2026-11-01T00:00:00.000Z', activatedAt: '2026-11-01T00:00:01.000Z' })
}

function onlyProposal(row: AuthorizationRecord): void {
  w.store.rows = w.store.rows.filter((r) => r.id !== proposal.id || r.id === row.id)
  proposal = row
}

beforeEach(() => {
  w = fakeWorld()
  proposal = w.store.seed()
})

describe('authorize — the window the database will accept', () => {
  it('live_from sits a minute (plus the chosen backfill) before now, expires_at an hour inside the 90-day cap', () => {
    const win = authorizationWindow(NOW, 0, 90)
    expect(Date.parse(win.liveFrom)).toBe(NOW.getTime() - CLOCK_MARGIN_MS)
    expect(Date.parse(win.expiresAt)).toBe(NOW.getTime() + 90 * 86_400_000 - EXPIRY_MARGIN_MS)
    const backfilled = authorizationWindow(NOW, 35, 1)
    expect(NOW.getTime() - Date.parse(backfilled.liveFrom)).toBe(35 * 3_600_000 + CLOCK_MARGIN_MS)
    expect(NOW.getTime() - Date.parse(backfilled.liveFrom)).toBeLessThan(36 * 3_600_000)
    expect(Date.parse(backfilled.expiresAt)).toBeGreaterThan(NOW.getTime())
  })

  it('refuses a backfill beyond 35 hours or an expiry beyond 90 days, and defaults to a preview', () => {
    const base = { client_id: CLIENT, authorization_id: proposal.id, rule_sha256: 'a'.repeat(64), template_sha256: 'b'.repeat(64) }
    expect(AuthorizeCommandSchema.safeParse({ ...base, backfill_hours: 36 }).success).toBe(false)
    expect(AuthorizeCommandSchema.safeParse({ ...base, expires_in_days: 91 }).success).toBe(false)
    expect(AuthorizeCommandSchema.parse(base)).toMatchObject({ confirm: false, backfill_hours: 0, expires_in_days: 90 })
  })
})

describe('authorize — what the PM approves must be what he saw', () => {
  it('a preview writes nothing and shows the window, the rehearsal and the warnings', async () => {
    const res = await authorizeCommand(w.deps, CLIENT, ACTOR, command({ confirm: false, backfill_hours: 24 }))
    expect(res.body).toMatchObject({
      mode: 'PREVIEW',
      authorization: 'NOT_AUTHORIZED',
      preview: { trial: false, trial_recipients: null, backfill_hours: 24, daily_cap: 20, replaces_authorization_id: null, rehearsal: { consecutiveDays: 5 }, warnings: [] },
    })
    expect(proposal.authorizedAt).toBeNull()
    expect(w.events).toHaveLength(0)
  })

  it('🔴 a different rule or template fingerprint than the stored one is refused', async () => {
    expect((await authorizeCommand(w.deps, CLIENT, ACTOR, command({ rule_sha256: 'c'.repeat(64) }))).body.error).toBe('RULE_CHANGED')
    expect((await authorizeCommand(w.deps, CLIENT, ACTOR, command({ template_sha256: 'c'.repeat(64) }))).body.error).toBe('TEMPLATE_MISMATCH')
    expect(proposal.authorizedAt).toBeNull()
  })

  it('🔴 the template edited or disabled since the proposal is refused: propose again', async () => {
    w.set.template({ ok: true, template: template({ version: 4 }) })
    expect(await authorizeCommand(w.deps, CLIENT, ACTOR, command())).toMatchObject({ status: 409, body: { error: 'TEMPLATE_CHANGED' } })
    w.set.template({ ok: true, template: template({ body: 'Hi {{first_name}}, new text.' }) })
    expect((await authorizeCommand(w.deps, CLIENT, ACTOR, command())).body.error).toBe('TEMPLATE_CHANGED')
    w.set.template({ ok: true, template: template({ version: 4, status: 'disabled' }) })
    expect((await authorizeCommand(w.deps, CLIENT, ACTOR, command())).body.error).toBe('TEMPLATE_NOT_SENDABLE')
    expect(proposal.authorizedAt).toBeNull()
  })

  it('🔴 a stored rule whose fingerprint does not match it is refused', async () => {
    onlyProposal(w.store.seed({ rule: { ...sendableRule(), frequency_cap: { max: 5, window_days: 7 } } }))
    expect((await authorizeCommand(w.deps, CLIENT, ACTOR, command())).body).toMatchObject({ error: 'RULE_INVALID' })
  })

  it('🔴 no bound template, revoked, authorized, another client’s, another trigger’s: refused', async () => {
    onlyProposal(w.store.seed({ templateVersion: null, templateSha256: null }))
    expect((await authorizeCommand(w.deps, CLIENT, ACTOR, command({ template_sha256: 'a'.repeat(64) }))).body.error).toBe('PROPOSAL_HAS_NO_TEMPLATE')
    const revoked = w.store.seed({ revokedAt: '2026-11-19T00:00:00.000Z', revokedBy: 'system:SUPERSEDED' })
    expect((await authorizeCommand(w.deps, CLIENT, ACTOR, { ...command(), authorization_id: revoked.id })).body.error).toBe('PROPOSAL_REVOKED')
    const foreign = w.store.seed({ clientId: OTHER_CLIENT })
    expect((await authorizeCommand(w.deps, CLIENT, ACTOR, { ...command(), authorization_id: foreign.id })).status).toBe(404)
    const other = w.store.seed({ triggerKey: 'countdown' })
    expect((await authorizeCommand(w.deps, CLIENT, ACTOR, { ...command(), authorization_id: other.id })).status).toBe(404)
  })

  it('🔴 a trial to a non-internal address, or with no internal domains configured, is refused', async () => {
    const rule = sendableRule({ recipient_allowlist: ['guest@gmail.com'] })
    onlyProposal(w.store.seed({ rule, ruleSha256: ruleSha256(rule) }))
    expect((await authorizeCommand(w.deps, CLIENT, ACTOR, command())).body).toMatchObject({ error: 'TRIAL_RECIPIENT_NOT_INTERNAL' })
    const ok = sendableRule({ recipient_allowlist: ['hello@example.com'] })
    onlyProposal(w.store.seed({ rule: ok, ruleSha256: ruleSha256(ok) }))
    w.set.env({})
    expect((await authorizeCommand(w.deps, CLIENT, ACTOR, command())).body.error).toBe('TRIAL_DOMAINS_NOT_CONFIGURED')
    expect(proposal.authorizedAt).toBeNull()
  })

  it('🔴 a disconnected salesperson mailbox is refused (§5.2 F)', async () => {
    w.set.mailboxes({ ok: false, reason: 'missing', detail: '1 of 1' })
    expect((await authorizeCommand(w.deps, CLIENT, ACTOR, command())).body.error).toBe('REQUIRED_MAILBOXES_NOT_CONNECTED')
  })
})

describe('authorize — the rehearsal gate (§5.4)', () => {
  it('🔴 a rule for real leads needs five consistent days; four is refused, unreadable evidence is refused', async () => {
    w.set.rehearsal({ ok: true, evidence: evidence(4) })
    expect(await authorizeCommand(w.deps, CLIENT, ACTOR, command())).toMatchObject({
      status: 422,
      body: { error: 'REHEARSAL_NOT_READY', consecutive_days: 4, required_days: 5 },
    })
    w.set.rehearsal({ ok: false, code: 'shadow_rows_unreadable' })
    expect((await authorizeCommand(w.deps, CLIENT, ACTOR, command())).status).toBe(503)
    expect(proposal.authorizedAt).toBeNull()
  })

  it('a controlled trial to internal inboxes does not need the rehearsal; the preview lists the addresses', async () => {
    const rule = sendableRule({ recipient_allowlist: ['hello@example.com'] })
    onlyProposal(w.store.seed({ rule, ruleSha256: ruleSha256(rule) }))
    w.set.rehearsal({ ok: true, evidence: evidence(0) })
    const res = await authorizeCommand(w.deps, CLIENT, ACTOR, command())
    expect(res.body).toMatchObject({ mode: 'AUTHORIZED', preview: { trial: true, trial_recipients: ['hello@example.com'], rehearsal: null } })
  })

  it('a gap in the old batch totals is a warning, not a block', async () => {
    w.set.rehearsal({ ok: true, evidence: evidence(5, { batchGap: 3 }) })
    expect((await authorizeCommand(w.deps, CLIENT, ACTOR, command())).body).toMatchObject({ mode: 'AUTHORIZED', preview: { warnings: ['LEGACY_BATCH_GAP'] } })
  })
})

describe('authorize — writing and arming', () => {
  it('writes the approval by the logged-in person, sends the event, then arms', async () => {
    const res = await authorizeCommand(w.deps, CLIENT, ACTOR, command())
    expect(res.body).toMatchObject({ mode: 'AUTHORIZED', no_send: true, authorization: { authorized_by_email: ACTOR.email } })
    expect(w.store.calls.slice(-2)).toEqual(['authorize', 'activate'])
    expect(w.events.map((e) => e.data.change)).toEqual(['authorized'])
    expect(w.events[0].data).toMatchObject({ authorization_id: proposal.id, template_sha256: templateContentSha256(template()), live_from: expect.any(String) })
    expect(proposal.activatedAt).not.toBeNull()
  })

  it('replaces the authorization in force first (SUPERSEDED, naming the new proposal), so two are never in force', async () => {
    const live = seedLive()
    const res = await authorizeCommand(w.deps, CLIENT, ACTOR, command())
    expect(res.body).toMatchObject({ mode: 'AUTHORIZED', preview: { replaces_authorization_id: live.id }, replaced_authorization_revoked: true })
    expect(live).toMatchObject({ revokedBy: 'system:SUPERSEDED', revokedReason: `replaced by proposal ${proposal.id}` })
    expect(w.events.map((e) => e.data.change)).toEqual(['revoked', 'authorized'])
  })

  it('🔴 the proposal is read again before the authorization in force is touched: taken down meanwhile = nothing stopped', async () => {
    const live = seedLive()
    const load = w.store.load.bind(w.store)
    let calls = 0
    w.store.load = async (id) => {
      calls += 1
      if (calls === 2) proposal.revokedAt = '2026-11-19T23:59:00.000Z'
      return load(id)
    }
    expect(await authorizeCommand(w.deps, CLIENT, ACTOR, command())).toMatchObject({ status: 409, body: { error: 'PROPOSAL_NOT_OPEN' } })
    expect(live.revokedAt).toBeNull()
  })

  it('🔴 a write that fails after the old authorization was stopped says so', async () => {
    const live = seedLive()
    w.store.fail.authorize = '23514'
    expect(await authorizeCommand(w.deps, CLIENT, ACTOR, command())).toMatchObject({
      status: 500,
      body: { error: 'AUTHORIZE_WINDOW_REFUSED', replaced_authorization_revoked: true, replaced_authorization_id: live.id },
    })
    expect(live.revokedAt).not.toBeNull()
  })

  it('🔴 events not configured at all: refused (also in the preview) before the authorization in force is touched', async () => {
    const live = seedLive()
    w.set.canEmit(false)
    expect(await authorizeCommand(w.deps, CLIENT, ACTOR, command())).toMatchObject({ status: 503, body: { error: 'EVENTS_NOT_CONFIGURED' } })
    expect(await authorizeCommand(w.deps, CLIENT, ACTOR, command({ confirm: false }))).toMatchObject({ status: 503 })
    expect(live.revokedAt).toBeNull()
    expect(proposal.authorizedAt).toBeNull()
  })

  it('🔴 an event that cannot be sent: the row is revoked again, never armed, and the old one is said to be stopped', async () => {
    seedLive()
    w.set.emitFails('authorized')
    const res = await authorizeCommand(w.deps, CLIENT, ACTOR, command())
    expect(res).toMatchObject({ status: 500, body: { error: 'AUTHORIZATION_EVENT_NOT_SENT', rollback: 'OK', replaced_authorization_revoked: true } })
    expect(proposal).toMatchObject({ activatedAt: null, revokedBy: 'system:AUTHORIZE_FAILED' })
  })

  it('🔴 arming that fails rolls back; a rollback that fails says so', async () => {
    w.store.fail.activate = '08006'
    expect((await authorizeCommand(w.deps, CLIENT, ACTOR, command())).body).toMatchObject({ error: 'AUTHORIZATION_NOT_ACTIVATED', rollback: 'OK' })
    expect(proposal.revokedBy).toBe('system:AUTHORIZE_FAILED')

    const second = w.store.seed()
    w.store.fail.activate = '08006'
    w.store.fail.revoke = '08006'
    const res = await authorizeCommand(w.deps, CLIENT, ACTOR, { ...command(), authorization_id: second.id })
    expect(res.body).toMatchObject({ error: 'AUTHORIZATION_NOT_ACTIVATED', rollback: 'FAILED' })
  })

  it('a row revoked while arming is reported, not re-armed', async () => {
    w.store.fail.activate = 'not_open'
    expect(await authorizeCommand(w.deps, CLIENT, ACTOR, command())).toMatchObject({ status: 409, body: { error: 'REVOKED_DURING_ARMING' } })
  })

  it('a database refusal of the window or of a second authorization is a clear error', async () => {
    w.store.fail.authorize = '23514'
    expect((await authorizeCommand(w.deps, CLIENT, ACTOR, command())).body.error).toBe('AUTHORIZE_WINDOW_REFUSED')
    w.store.fail.authorize = 'not_open'
    expect((await authorizeCommand(w.deps, CLIENT, ACTOR, command())).body.error).toBe('PROPOSAL_NOT_OPEN')
    expect(w.events).toHaveLength(0)
  })
})

describe('authorize — the sales path’s weekly cap (red text, never a block)', () => {
  it('names a cap that is off, wider than the rule, or unknown', () => {
    const rule = sendableRule()
    expect(salesCapWarning({ kind: 'cap', cap: { max: 2, windowDays: 7 } }, rule)).toBeNull()
    expect(salesCapWarning({ kind: 'cap', cap: { max: 1, windowDays: 14 } }, rule)).toBeNull()
    expect(salesCapWarning({ kind: 'cap', cap: { max: 20, windowDays: 7 } }, rule)).toBe('SALES_FREQUENCY_CAP_WIDER')
    expect(salesCapWarning({ kind: 'cap', cap: { max: 2, windowDays: 3 } }, rule)).toBe('SALES_FREQUENCY_CAP_WIDER')
    expect(salesCapWarning({ kind: 'cap', cap: null }, rule)).toBe('SALES_FREQUENCY_CAP_OFF')
    expect(salesCapWarning({ kind: 'unknown' }, rule)).toBe('SALES_FREQUENCY_CAP_UNKNOWN')
  })

  it('a wider sales cap still authorizes, with the warning in the answer', async () => {
    w.set.salesCap({ kind: 'cap', cap: { max: 20, windowDays: 7 } })
    const res = await authorizeCommand(w.deps, CLIENT, ACTOR, command())
    expect(res.body).toMatchObject({ mode: 'AUTHORIZED', preview: { warnings: ['SALES_FREQUENCY_CAP_WIDER'] } })
  })
})
