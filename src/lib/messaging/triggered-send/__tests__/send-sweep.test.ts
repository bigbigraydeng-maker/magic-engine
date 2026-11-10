import { beforeEach, describe, expect, it } from 'vitest'
import { verifyUnsubscribeToken } from '../unsubscribe-token'
import { buildLetterRequest, publicOriginOf, renderWelcomeLetter } from '../send-letter'
import { isWithinSendWindow } from '../send-arming'
import { finalizeSend, prepareSend, recordStale } from '../send-sweep'
import { sendableRule, template } from './authorization-fakes'
import { authorizedRecord, CLIENT, CONTACT, guest, LIVE_ENV, plan, SEND_NOW, sendWorld, type SendWorld } from './send-fakes'

let w: SendWorld
beforeEach(() => {
  w = sendWorld()
})

describe('the letter itself', () => {
  it('renders the first name only; the fingerprint is the subject and body, without the link', () => {
    const a = renderWelcomeLetter(template(), 'Jane Lee', '2026-11-20')
    expect(a).toMatchObject({ ok: true, letter: { subject: 'Welcome, Jane', text: 'Hi Jane,\nThanks for your enquiry.' } })
    const b = renderWelcomeLetter(template(), 'Jane Lee', '2026-11-21')
    expect(a.ok && b.ok && a.letter.renderedSha256 === b.letter.renderedSha256).toBe(true)
    expect(renderWelcomeLetter(template(), null, '2026-11-20')).toMatchObject({ ok: false, reason: 'missing_first_name' })
  })

  it('🔴 the request is the same byte for byte for the same row (a replay must carry the same payload), and the link verifies', () => {
    const rendered = renderWelcomeLetter(template(), 'Jane Lee', '2026-11-20')
    if (!rendered.ok) throw new Error('render')
    const env = (n: string) => LIVE_ENV[n]
    const addressing = { account: 'cts', rule: sendableRule(), clientId: CLIENT, to: 'lead@example.org', idempotencyKey: 'k', sendId: 'e0000000-0000-4000-8000-000000000001', firstAttemptAt: '2026-11-19T20:00:00.000Z', attempt: 'first' as const }
    const one = buildLetterRequest(rendered.letter, addressing, env)
    const two = buildLetterRequest(rendered.letter, addressing, env)
    expect(JSON.stringify(one)).toBe(JSON.stringify(two))
    if (!one.ok) throw new Error('build')
    const token = one.request.headers['List-Unsubscribe'].match(/\/api\/u\/([^>]+)>$/)?.[1] ?? ''
    expect(verifyUnsubscribeToken(token, env)).toMatchObject({ ok: true, payload: { sendId: addressing.sendId, clientId: CLIENT, issuedAt: Math.floor(Date.parse(addressing.firstAttemptAt) / 1000) } })
  })

  it('ME’s public origin must be plain https with nothing after the host', () => {
    expect(publicOriginOf((n) => ({ APP_URL: 'https://app.example.com/' })[n])).toBe('https://app.example.com')
    for (const bad of ['http://app.example.com', 'https://app.example.com/x', 'https://u:p@app.example.com', 'nonsense', '']) {
      expect(publicOriginOf((n) => ({ APP_URL: bad })[n]), bad).toBeNull()
    }
  })

  it('the send window is the rule’s, in the rule’s time zone, end exclusive', () => {
    const rule = sendableRule()
    expect(isWithinSendWindow(rule, new Date('2026-11-19T19:00:00.000Z'))).toBe(true) // 08:00 Auckland
    expect(isWithinSendWindow(rule, new Date('2026-11-19T18:59:00.000Z'))).toBe(false) // 07:59
    expect(isWithinSendWindow(rule, new Date('2026-11-20T07:00:00.000Z'))).toBe(false) // 20:00
  })
})

describe('prepareSend', () => {
  it('🔴 a dry run, or switches that are not both on, sends nothing and asks nothing of the database', async () => {
    expect(await prepareSend({ clientId: CLIENT, dryRun: true, deps: w.deps })).toMatchObject({ kind: 'stop', receipt: { status: 'dry_run' } })
    w.env.TRIGGERED_SEND_CLIENTS = 'someone-else'
    expect(await prepareSend({ clientId: CLIENT, dryRun: false, deps: w.deps })).toMatchObject({ kind: 'stop', receipt: { status: 'not_armed' } })
  })

  it('🔴 a trial finds its guests by the allow-listed addresses alone; letters in flight first; age and start do not matter, only "not today"', async () => {
    const fresh = guest()
    const flying = guest({ contactId: 'b0000000-0000-4000-8000-000000000003' })
    const old = guest({ contactId: 'b0000000-0000-4000-8000-000000000002', createdAt: '2026-08-16T01:00:00.000Z' })
    const today = guest({ contactId: 'b0000000-0000-4000-8000-000000000005', createdAt: '2026-11-19T20:00:00.000Z' })
    w.extraContacts = [flying, old, today]
    w.ledger.seed({ contactId: flying.contactId, status: 'pending' })
    // An internal inbox that has been a contact since August still gets its one trial letter; one made today waits.
    w.set.record(authorizedRecord(undefined, template(), { liveFrom: '2026-11-19T12:00:00.000Z' }))
    const prepared = await prepareSend({ clientId: CLIENT, dryRun: false, deps: w.deps })
    expect(prepared).toMatchObject({ kind: 'plan', plan: { contactIds: [flying.contactId, fresh.contactId, old.contactId], staleIds: [], found: 4, sweepDay: '2026-11-20' } })
    expect(w.lookups).toEqual([['lead@example.org']])
  })

  it('🔴 a contact found by an internal identity but with another primary address is never planned (nothing is written to it)', async () => {
    w.extraContacts = [guest({ contactId: 'b0000000-0000-4000-8000-000000000006', primaryEmail: 'guest@gmail.com', addresses: ['guest@gmail.com', 'lead@example.org'] })]
    const prepared = await prepareSend({ clientId: CLIENT, dryRun: false, deps: w.deps })
    expect(prepared.kind === 'plan' && prepared.plan.contactIds).toEqual([CONTACT])
    expect(w.ledger.decisions).toEqual([])
  })

  it('🔴 an authorization for real guests plans nothing in this version', async () => {
    w.set.record(authorizedRecord(sendableRule()))
    expect(await prepareSend({ clientId: CLIENT, dryRun: false, deps: w.deps })).toMatchObject({ kind: 'stop', receipt: { status: 'formal_sending_not_enabled' } })
    expect(w.lookups).toEqual([])
  })

  it('unreadable sales mailboxes hold the whole batch back; outside the window nothing is planned', async () => {
    w.deps.checkMailboxes = async () => ({ ok: false, reason: 'unreadable', detail: 'x' })
    expect(await prepareSend({ clientId: CLIENT, dryRun: false, deps: w.deps })).toMatchObject({ kind: 'stop', receipt: { status: 'mailbox_unreadable' } })
    w = sendWorld()
    w.deps.now = () => new Date('2026-11-19T10:00:00.000Z') // 23:00 Auckland
    expect(await prepareSend({ clientId: CLIENT, dryRun: false, deps: w.deps })).toMatchObject({ kind: 'stop', receipt: { status: 'outside_send_window' } })
  })

  it('no authorized row at all = nothing to send', async () => {
    w.set.record(null)
    expect(await prepareSend({ clientId: CLIENT, dryRun: false, deps: w.deps })).toMatchObject({ kind: 'stop', receipt: { status: 'no_active_authorization' } })
  })
})

describe('recordStale and finalizeSend', () => {
  it('a stale guest gets a final skipped:stale row; one that already holds a final row is left alone', async () => {
    w.ledger.seed({ contactId: 'b0000000-0000-4000-8000-000000000009', status: 'sent' })
    const out = await recordStale({ plan: plan({ staleIds: [CONTACT, 'b0000000-0000-4000-8000-000000000009'] }), deps: w.deps })
    expect(out.map((r) => r.outcome)).toEqual(['skipped', 'already_done'])
    expect(w.ledger.decisions).toEqual([{ contactId: CONTACT, status: 'skipped', reasonCode: 'stale' }])
  })

  it('the receipt counts outcomes and reasons, keeps the strongest provider impact and the first stop', () => {
    const receipt = finalizeSend(plan(), [
      { outcome: 'sent', reason: null, sendId: 'a', stopRun: false, providerImpact: 'PROVIDER_ACCEPTED' },
      { outcome: 'unknown_outcome', reason: 'timeout', sendId: 'b', stopRun: false, providerImpact: 'PROVIDER_UNKNOWN' },
      { outcome: 'account_error', reason: 'provider_account_error', sendId: 'c', stopRun: true, providerImpact: 'NONE' },
    ])
    expect(receipt).toMatchObject({
      status: 'sent_run', tried: 3, provider_impact: 'PROVIDER_ACCEPTED', stopped: 'account_error:provider_account_error',
      by_outcome: { sent: 1, unknown_outcome: 1, account_error: 1 },
    })
    expect(JSON.stringify(receipt)).not.toMatch(/@/)
  })

  it('the authorization the plan was made for is the one every letter re-checks', async () => {
    w.set.record(authorizedRecord(undefined, template(), { id: 'a0000000-0000-4000-8000-0000000000aa' }))
    const prepared = await prepareSend({ clientId: CLIENT, dryRun: false, deps: w.deps })
    expect(prepared.kind === 'plan' && prepared.plan.authorizationId).toBe('a0000000-0000-4000-8000-0000000000aa')
    expect(SEND_NOW.toISOString()).toBe('2026-11-19T21:00:00.000Z')
    expect(CONTACT).toMatch(/^b0/)
  })
})
