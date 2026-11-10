import { beforeEach, describe, expect, it } from 'vitest'
import { sendOne } from '../send-one'
import { addressSha256 } from '../shadow-store'
import { renderWelcomeLetter } from '../send-letter'
import { sendableRule, template } from './authorization-fakes'
import { AUTH_ID, authorizedRecord, CONTACT, guest, NOT_WELCOMED, plan, sendWorld, type SendWorld } from './send-fakes'

let w: SendWorld
beforeEach(() => {
  w = sendWorld()
})

const run = () => sendOne({ plan: plan(), contactId: CONTACT, deps: w.deps })

describe('sendOne — a new letter', () => {
  it('🔴 sends exactly one letter: claim, timeline, request with the signed link and tag, sent + message id, receipts replayed, locks released', async () => {
    const r = await run()
    expect(r).toMatchObject({ outcome: 'sent', providerImpact: 'PROVIDER_ACCEPTED', stopRun: false })
    expect(w.ledger.claims).toHaveLength(1)
    expect(w.sent).toHaveLength(1)
    const req = w.sent[0]
    expect(req).toMatchObject({ account: 'cts', to: 'lead@example.org', subject: 'Welcome, Jane', attempt: 'first', idempotencyKey: 'triggered-send:welcome:key-1' })
    expect(req.tags).toEqual([{ name: 'triggered_send_id', value: r.sendId }])
    expect(req.headers['List-Unsubscribe']).toMatch(/^<https:\/\/app\.example\.com\/api\/u\/[^>]+>$/)
    expect(req.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    expect(req.text).toContain(req.headers['List-Unsubscribe'].slice(1, -1))
    expect(w.ledger.rows.get(r.sendId as string)).toMatchObject({ status: 'sent', providerMessageId: 'msg-1' })
    expect(w.timeline.writes).toEqual([r.sendId])
    expect(w.replays).toEqual(['msg-1'])
    expect(w.locks).toMatchObject({ taken: 1, released: 1 })
  })

  it('🔴 the claim binds the authorized template and the address fingerprint; the rendered fingerprint leaves the link out', async () => {
    await run()
    const claim = w.ledger.claims[0]
    const rendered = renderWelcomeLetter(template(), 'Jane Lee', '2026-11-20')
    expect(claim).toMatchObject({ authorizationId: AUTH_ID, templateKey: 'auto-welcome', templateVersion: 3, toAddressSha256: addressSha256('lead@example.org'), consentBasis: 'form_disclosure_attested', sourceRef: 'lead-1' })
    expect(rendered.ok && claim.renderedSha256).toBe(rendered.ok ? rendered.letter.renderedSha256 : null)
  })

  it('🔴 a gate that says no writes the reason and sends nothing; the old batch is a final skip when really sending', async () => {
    w.set.evidence({ ok: true, items: [], legacy: { welcomed: true, batchSeen: true, campaignIds: ['c1'] } })
    expect(await run()).toMatchObject({ outcome: 'skipped', reason: 'legacy_welcomed' })
    expect(w.ledger.decisions).toEqual([{ contactId: CONTACT, status: 'skipped', reasonCode: 'legacy_welcomed' }])
    expect(w.ledger.claims).toHaveLength(0)
    expect(w.sent).toHaveLength(0)
  })

  it('🔴 a read that fails sets the guest aside (blocked, retried), never "fine"', async () => {
    w.set.ports({ dnc: async () => ({ ok: false, error: 'down' }) })
    expect(await run()).toMatchObject({ outcome: 'blocked', reason: 'dnc_unverifiable' })
    expect(w.sent).toHaveLength(0)
  })

  it('🔴 a person who wrote while we were deciding is caught INSIDE the locks: no claim, no letter', async () => {
    const human = { source: 'sent_items' as const, id: 'h1', at: '2026-11-19T20:00:00.000Z', subject: 'Re: your trip', address: 'lead@example.org' }
    w.set.evidence(NOT_WELCOMED, { ok: true, items: [human], legacy: NOT_WELCOMED.ok ? NOT_WELCOMED.legacy : { welcomed: false, batchSeen: true, campaignIds: [] } })
    expect(await run()).toMatchObject({ outcome: 'skipped', reason: 'sales_email_exists' })
    expect(w.ledger.claims).toHaveLength(0)
    expect(w.locks).toMatchObject({ taken: 1, released: 1 })
  })

  it('🔴 busy or unreadable locks claim nothing (retried next run)', async () => {
    w.locks.busy = true
    expect(await run()).toMatchObject({ outcome: 'blocked', reason: 'lock_busy' })
    w = sendWorld()
    w.locks.throws = true
    expect(await run()).toMatchObject({ outcome: 'blocked', reason: 'lock_unreadable' })
    expect(w.ledger.claims).toHaveLength(0)
  })

  it('a guest without a usable first name is a final skip (the template greets by name); a broken render waits', async () => {
    w.set.contact(guest({ displayName: 'Guest' }))
    expect(await run()).toMatchObject({ outcome: 'skipped', reason: 'missing_first_name' })
    expect(w.ledger.claims).toHaveLength(0)
  })

  it('🔴 no timeline record = no letter (the sales side would not see it); the row stays pending for the next run', async () => {
    w.timeline.failWrite = true
    expect(await run()).toMatchObject({ outcome: 'write_failed', reason: 'timeline_failed' })
    expect(w.sent).toHaveLength(0)
    expect(w.ledger.byContact(CONTACT)?.status).toBe('pending')
  })

  it('🔴 the day’s cap stops the whole run; a dead authorization inside the claim stops it too', async () => {
    w.ledger.forced = ['cap_reached']
    expect(await run()).toMatchObject({ outcome: 'blocked', reason: 'cap_reached', stopRun: true })
    w = sendWorld()
    w.ledger.forced = ['auth_inactive']
    expect(await run()).toMatchObject({ outcome: 'stopped', reason: 'auth_inactive', stopRun: true })
    expect(w.sent).toHaveLength(0)
  })

  it('another contact already got this address: a final skip, nothing sent', async () => {
    w.ledger.forced = ['address_duplicate']
    expect(await run()).toMatchObject({ outcome: 'skipped', reason: 'address_duplicate' })
    expect(w.sent).toHaveLength(0)
  })
})

describe('sendOne — what the provider says', () => {
  it('🔴 refused on the first attempt: failed for certain, the timeline record no longer counts', async () => {
    w.answers = [{ kind: 'rejected', code: 'validation_error', status: 422 }]
    const r = await run()
    expect(r).toMatchObject({ outcome: 'rejected', reason: 'provider_rejected', stopRun: false })
    expect(w.ledger.rows.get(r.sendId as string)).toMatchObject({ status: 'failed', reasonCode: 'provider_rejected' })
    expect(w.timeline.cancels).toEqual([r.sendId])
  })

  it('🔴 our own account is wrong: failed (not sent), and NOBODY else is tried this run', async () => {
    w.answers = [{ kind: 'account_error', code: 'invalid_api_key', status: 403 }]
    const r = await run()
    expect(r).toMatchObject({ outcome: 'account_error', stopRun: true })
    expect(w.ledger.rows.get(r.sendId as string)?.status).toBe('failed')
  })

  it('🔴 an unclear answer leaves the letter pending (it may have gone out); never a second letter', async () => {
    w.answers = [{ kind: 'unknown', code: 'timeout', status: null }]
    const r = await run()
    expect(r).toMatchObject({ outcome: 'unknown_outcome', providerImpact: 'PROVIDER_UNKNOWN' })
    expect(w.ledger.rows.get(r.sendId as string)?.status).toBe('pending')
    expect(w.timeline.cancels).toHaveLength(0)
  })

  it('🔴 a receipt that was faster with the SAME message id is a success; another id is a conflict, never overwritten', async () => {
    w.deps.resend.send = async (req) => {
      const row = w.ledger.byContact(CONTACT)
      if (row) Object.assign(row, { status: 'delivered', providerMessageId: 'msg-x', updatedAt: 'later' })
      w.sent.push(req)
      return { kind: 'sent', messageId: 'msg-x' }
    }
    expect(await run()).toMatchObject({ outcome: 'sent' })
    w = sendWorld()
    w.deps.resend.send = async () => {
      const row = w.ledger.byContact(CONTACT)
      if (row) Object.assign(row, { status: 'delivered', providerMessageId: 'msg-other', updatedAt: 'later' })
      return { kind: 'sent', messageId: 'msg-x' }
    }
    expect(await run()).toMatchObject({ outcome: 'conflict', reason: 'message_id_conflict' })
    expect(w.ledger.byContact(CONTACT)?.providerMessageId).toBe('msg-other')
  })
})

describe('sendOne — re-checks before every letter', () => {
  it('🔴 switches off, another authorization, or a revoked one: stop, nothing claimed', async () => {
    w.env.TRIGGERED_SEND_LIVE = 'TRUE'
    expect(await run()).toMatchObject({ outcome: 'stopped', reason: 'not_armed', stopRun: true })
    w = sendWorld()
    w.set.record(authorizedRecord(sendableRule(), template(), { id: 'a0000000-0000-4000-8000-000000000009' }))
    expect(await run()).toMatchObject({ outcome: 'stopped', reason: 'authorization_changed' })
    w = sendWorld()
    w.set.record(authorizedRecord(sendableRule(), template(), { revokedAt: '2026-11-19T00:00:00.000Z' }))
    expect(await run()).toMatchObject({ outcome: 'stopped', reason: 'authorization_inactive' })
    expect(w.ledger.claims).toHaveLength(0)
  })

  it('🔴 an edited template revokes the authorization; an unreadable one only waits', async () => {
    w.set.template(template({ version: 4, body: 'Hi {{first_name}}, new text.' }))
    expect(await run()).toMatchObject({ outcome: 'stopped', reason: 'authorization_self_revoked' })
    expect(w.revokes).toEqual(['TEMPLATE_CHANGED'])
    w = sendWorld()
    w.set.template('unreadable')
    expect(await run()).toMatchObject({ outcome: 'stopped', reason: 'template_unreadable' })
    expect(w.revokes).toEqual([])
  })

  it('🔴 a trial whose address is no longer internal, a missing key, secret or origin: stop before anything', async () => {
    const trial = sendableRule({ recipient_allowlist: ['hello@example.com'] })
    w.set.record(authorizedRecord(trial))
    w.env.TRIGGERED_SEND_TRIAL_DOMAINS = 'magicengine.cloud'
    expect(await run()).toMatchObject({ outcome: 'stopped', reason: 'trial_recipient_not_internal' })
    for (const [name, reason] of [['RESEND_API_KEY_CTS', 'no_account_key'], ['UNSUBSCRIBE_SIGNING_SECRET', 'no_unsubscribe_secret'], ['APP_URL', 'no_app_url']] as const) {
      w = sendWorld()
      delete w.env[name]
      expect(await run(), name).toMatchObject({ outcome: 'stopped', reason, stopRun: true })
      expect(w.ledger.claims).toHaveLength(0)
    }
  })

  it('outside the send window nothing goes out', async () => {
    w.deps.now = () => new Date('2026-11-19T08:00:00.000Z') // 21:00 in Auckland
    expect(await run()).toMatchObject({ outcome: 'stopped', reason: 'outside_send_window' })
  })
})

describe('sendOne — a letter in flight (taken over by a later run)', () => {
  function inFlight() {
    const first = renderWelcomeLetter(template(), 'Jane Lee', '2026-11-20')
    return w.ledger.seed({
      status: 'pending', idempotencyKey: 'triggered-send:welcome:first-key', renderedSha256: first.ok ? first.letter.renderedSha256 : 'x',
      toAddressSha256: addressSha256('lead@example.org'), firstAttemptAt: '2026-11-19T20:00:00.000Z',
    })
  }

  it('🔴 replays the very same request (same key, same link) as attempt "replay", exempting its own row from the cap', async () => {
    const row = inFlight()
    const r = await run()
    expect(r).toMatchObject({ outcome: 'sent', sendId: row.id })
    expect(w.sent[0]).toMatchObject({ attempt: 'replay', idempotencyKey: 'triggered-send:welcome:first-key' })
    expect(w.exemptSeen).toEqual([row.id])
    // The link's issue time is the FIRST attempt, so it is the same link as the first try carried.
    const again = sendWorld()
    again.ledger.rows = new Map([[row.id, { ...row, status: 'pending', updatedAt: 'x' }]])
    await sendOne({ plan: plan(), contactId: CONTACT, deps: again.deps })
    expect(again.sent[0].headers['List-Unsubscribe']).toBe(w.sent[0].headers['List-Unsubscribe'])
  })

  it('🔴 changed content, another address or another authorization: never resent (left to the 20-hour rule)', async () => {
    inFlight()
    w.set.contact(guest({ displayName: 'Maria Lopez' }))
    expect(await run()).toMatchObject({ outcome: 'in_flight', reason: 'content_changed' })
    w = sendWorld()
    inFlight()
    w.set.contact(guest({ primaryEmail: 'new@example.org', addresses: ['new@example.org'] }))
    expect(await run()).toMatchObject({ outcome: 'in_flight', reason: 'address_changed' })
    w = sendWorld()
    const row = inFlight()
    w.ledger.rows.set(row.id, { ...row, authorizationId: 'a0000000-0000-4000-8000-000000000007' })
    expect(await run()).toMatchObject({ outcome: 'in_flight', reason: 'not_replayable' })
    expect(w.sent).toHaveLength(0)
  })

  it('🔴 a replay is never concluded "not sent", whatever the provider says', async () => {
    const row = inFlight()
    w.answers = [{ kind: 'rejected', code: 'validation_error', status: 422 }]
    expect(await run()).toMatchObject({ outcome: 'unknown_outcome' })
    expect(w.ledger.rows.get(row.id)?.status).toBe('pending')
    w = sendWorld()
    const row2 = inFlight()
    delete w.env.APP_URL
    // Origin gone between runs: the run stops at the re-check, the row stays pending.
    expect(await run()).toMatchObject({ outcome: 'stopped', reason: 'no_app_url' })
    expect(w.ledger.rows.get(row2.id)?.status).toBe('pending')
  })

  it('a full cap on takeover only notes the reason; the row stays pending', async () => {
    const row = inFlight()
    const two = [1, 2].map((i) => ({ source: 'touchpoint' as const, id: `t${i}`, at: '2026-11-18T00:00:00.000Z', subject: 'x', address: 'lead@example.org', automated: true as const }))
    w.set.evidence({ ok: true, items: two, legacy: { welcomed: false, batchSeen: true, campaignIds: [] } })
    expect(await run()).toMatchObject({ outcome: 'blocked', reason: 'frequency_full' })
    expect(w.ledger.notes).toEqual([{ id: row.id, reasonCode: 'frequency_full' }])
    expect(w.ledger.rows.get(row.id)?.status).toBe('pending')
  })

  it('a final row is never touched again', async () => {
    w.ledger.seed({ status: 'sent' })
    expect(await run()).toMatchObject({ outcome: 'already_done', reason: 'sent' })
    expect(w.ledger.claims).toHaveLength(0)
  })
})
