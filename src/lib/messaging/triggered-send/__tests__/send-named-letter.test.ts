import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ResendEmailRequest, ResendSendOutcome } from '@/lib/messaging/adapters/resend-email'
import type { SendTouchpointInput } from '../send-touchpoint'
import { letterStatuses, sendNamedLetter } from '../send-named-letter'
import { sendOne } from '../send-one'
import { addressSha256 } from '../shadow-store'
import { authorizedRecord, plan } from './send-fakes'
import { CATALOGUE_URL, CONTACT, entryFor, followupTemplate, letterRecord, letterRule, letterTemplate, letterWorld, sharedLocks, type LetterWorld } from './letter-fakes'

const REF = 'ai-followup:run-1:guest-1'
let w: LetterWorld
let touchpoints: SendTouchpointInput[]

beforeEach(() => {
  w = letterWorld()
  touchpoints = []
  w.deps.writeTouchpoint = async (input) => {
    touchpoints.push(input)
    return { ok: true }
  }
})

const send = (letterKey = 'catalogue_2027', requestRef = REF) => sendNamedLetter({ clientId: w.base.deps.env('TRIGGERED_SEND_CLIENTS') as string, contactId: CONTACT, letterKey, requestRef }, w.deps)
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
const staff = (id: string) => ({ source: 'sent_items' as const, id, at: '2026-11-19T20:00:00.000Z', subject: 'Re: your trip', address: 'lead@example.org' })
const evidenceOf = (items: ReturnType<typeof staff>[]) => ({ ok: true as const, items, legacy: { welcomed: false, batchSeen: false, campaignIds: [] } })

describe('sendNamedLetter — sent', () => {
  it('🔴 sends the named letter once: its own scope and template, the frozen catalogue link with a tracking token, the timeline line, the receipt', async () => {
    const r = await send()
    expect(r).toMatchObject({ outcome: 'sent', providerImpact: 'PROVIDER_ACCEPTED', stopRun: false })
    expect(w.ledger.claims).toHaveLength(1)
    expect(w.ledger.claims[0]).toMatchObject({ letterKey: 'catalogue_2027', templateKey: 'auto-ai-catalogue', templateVersion: 2, toAddressSha256: addressSha256('lead@example.org') })
    expect(w.base.sent).toHaveLength(1)
    const req = w.base.sent[0]
    expect(req).toMatchObject({ to: 'lead@example.org', subject: 'Our 2027 tours, Jane', idempotencyKey: 'triggered-send:crm_ai_followup:key-1', attempt: 'first' })
    expect(req.text).toContain(`${CATALOGUE_URL}?me=Tok000000001`)
    expect(req.tags).toEqual([{ name: 'triggered_send_id', value: r.sendId }])
    expect(touchpoints).toEqual([expect.objectContaining({ triggeredSendId: r.sendId, triggerKey: 'crm_ai_followup', summary: 'ME 自动发出：AI 跟进信 · catalogue_2027' })])
    const row = w.ledger.rows.get(r.sendId as string)
    expect(row).toMatchObject({ status: 'sent', letterKey: 'catalogue_2027', providerMessageId: 'msg-1' })
    expect(row?.annotations).toMatchObject({ request_ref: REF, link_tracking: { tagged: 1, tokens: ['Tok000000001'], warning: null } })
    const bodyBeforeUnsubscribe = req.text.slice(0, req.text.indexOf('\n\n—\n'))
    expect((row?.annotations.link_tracking as { final_text_sha256: string }).final_text_sha256).toBe(sha(bodyBeforeUnsubscribe))
    expect(w.base.locks).toMatchObject({ taken: 1, released: 1 })
  })

  it('🔴 P2-2: every letter\'s template of the list is read before sending (this one first)', async () => {
    await send()
    expect(w.templateReads).toEqual(['auto-ai-catalogue', 'auto-ai-d7'])
  })

  it('🔴 another letter of the list to the same guest is its own row; the same letter again is already done, with its real status', async () => {
    const first = await send('catalogue_2027')
    const second = await send('followup_d7')
    expect(second).toMatchObject({ outcome: 'sent' })
    expect(second.sendId).not.toBe(first.sendId)
    expect(w.ledger.of(CONTACT, 'followup_d7')?.status).toBe('sent')
    const again = await send('catalogue_2027')
    expect(again).toMatchObject({ outcome: 'already_done', rowStatus: 'sent', sendId: first.sendId })
    expect(w.base.sent).toHaveLength(2)
  })

  it('a letter without a link goes untracked, and says so on the row', async () => {
    const r = await send('followup_d7')
    expect(w.ledger.rows.get(r.sendId as string)?.annotations).toMatchObject({ link_tracking: { tagged: 0, tokens: [] } })
  })

  it('🔴 tracking that fails never holds the letter: the original text goes out and the row says why', async () => {
    w.tracking.fail = true
    const r = await send()
    expect(r.outcome).toBe('sent')
    expect(w.base.sent[0].text).toContain(`${CATALOGUE_URL}\n`)
    expect(w.ledger.rows.get(r.sendId as string)?.annotations).toMatchObject({ link_tracking: { tagged: 0, warning: 'link_tracking_failed' } })
  })

  it('🔴 the row cannot record what goes out: nothing is sent (a replay could not rebuild it)', async () => {
    w.ledger.annotateFails = true
    expect(await send()).toMatchObject({ outcome: 'write_failed', reason: 'annotations_failed' })
    expect(w.base.sent).toHaveLength(0)
    expect(w.ledger.of(CONTACT, 'catalogue_2027')?.status).toBe('pending')
  })

  it('every decision row carries the caller\'s reference', async () => {
    w.base.set.ports({ dnc: async () => ({ ok: true, blocked: true }) })
    await send()
    expect(w.ledger.decisions[0]).toMatchObject({ status: 'skipped', reasonCode: 'dnc', annotations: { request_ref: REF } })
  })
})

describe('sendNamedLetter — stopped (nothing for anyone today)', () => {
  it('🔴 a guest who is not on the trial list: stopped, NO row written (not marked off for good)', async () => {
    w.base.set.contact({ contactId: CONTACT, createdAt: '2026-11-01T00:00:00.000Z', primaryEmail: 'real.guest@gmail.com', addresses: ['real.guest@gmail.com'], displayName: 'Real Guest' })
    expect(await send()).toMatchObject({ outcome: 'stopped', reason: 'not_in_allowlist', stopRun: false })
    expect(w.ledger.rows.size).toBe(0)
    expect(w.ledger.decisions).toHaveLength(0)
    expect(w.base.sent).toHaveLength(0)
  })

  it('🔴 no trial list = real guests: formal sending is not enabled in this cut, nobody gets a letter', async () => {
    w.set.rule(letterRule({ allowlist: null }))
    expect(await send()).toMatchObject({ outcome: 'stopped', reason: 'formal_sending_not_enabled', stopRun: true })
    expect(w.base.sent).toHaveLength(0)
  })

  it('🔴 a letter the authorization does not list, a malformed key or reference: stopped before anything is read', async () => {
    expect(await send('followup_d99')).toMatchObject({ outcome: 'stopped', reason: 'letter_not_authorized' , stopRun: false })
    expect(await send('Bad-Key')).toMatchObject({ outcome: 'stopped', reason: 'letter_not_authorized' , stopRun: false })
    expect(await send('catalogue_2027', 'lead@example.org')).toMatchObject({ outcome: 'stopped', reason: 'request_ref_invalid' , stopRun: false })
    expect(await send('catalogue_2027', 'x'.repeat(121))).toMatchObject({ outcome: 'stopped', reason: 'request_ref_invalid' , stopRun: false })
    expect(w.ledger.claims).toHaveLength(0)
  })

  it('🔴 this letter\'s template changed: the WHOLE authorization revokes itself', async () => {
    w.set.template('auto-ai-catalogue', letterTemplate({ version: 3, body: 'Hi {{first_name}}, new text {{catalogue_url}}' }))
    expect(await send()).toMatchObject({ outcome: 'stopped', reason: 'authorization_self_revoked' })
    expect(w.base.revokes).toEqual(['TEMPLATE_CHANGED'])
  })

  it('a template that cannot be read only holds this letter back (nothing revoked)', async () => {
    w.set.template('auto-ai-catalogue', 'unreadable')
    expect(await send()).toMatchObject({ outcome: 'stopped', reason: 'template_unreadable' })
    expect(w.base.revokes).toEqual([])
  })

  it('🔴 a one-letter authorization (a template, not a list) is never used for a named letter', async () => {
    w.set.record(authorizedRecord())
    expect(await send()).toMatchObject({ outcome: 'stopped', reason: 'authorization_inactive' })
  })

  it('outside the send window, or the switches off: stopped', async () => {
    w.clock.now = new Date('2026-11-19T09:00:00.000Z') // 22:00 in Auckland
    expect(await send()).toMatchObject({ outcome: 'stopped', reason: 'outside_send_window', stopRun: true })
    w.clock.now = new Date('2026-11-19T21:00:00.000Z')
    w.base.env.TRIGGERED_SEND_LIVE = 'false'
    expect(await send()).toMatchObject({ outcome: 'stopped', reason: 'not_armed' })
  })

  it('🔴 P2-5: the claim function says the letter is no longer listed: only this call stops (stopRun false)', async () => {
    w.ledger.forced = ['letter_not_authorized']
    expect(await send()).toMatchObject({ outcome: 'stopped', reason: 'letter_not_authorized', stopRun: false })
    expect(w.base.sent).toHaveLength(0)
  })

  it('🔴 P2-2: ANOTHER letter\'s template changed: the whole authorization revokes itself, nothing is sent', async () => {
    w.set.template('auto-ai-d7', followupTemplate({ version: 2, body: 'Hi {{first_name}}, edited' }))
    expect(await send('catalogue_2027')).toMatchObject({ outcome: 'stopped', reason: 'authorization_self_revoked', stopRun: true })
    expect(w.base.revokes).toEqual(['TEMPLATE_CHANGED'])
    expect(w.base.sent).toHaveLength(0)
  })

  it('P2-2: another letter\'s template disabled also revokes; one that cannot be read only holds this call back', async () => {
    w.set.template('auto-ai-d7', followupTemplate({ status: 'disabled' }))
    expect(await send('catalogue_2027')).toMatchObject({ outcome: 'stopped', reason: 'authorization_self_revoked' })
    w = letterWorld()
    w.set.template('auto-ai-d7', 'unreadable')
    expect(await send('catalogue_2027')).toMatchObject({ outcome: 'stopped', reason: 'template_unreadable' })
    expect(w.base.revokes).toEqual([])
  })
})

describe('sendNamedLetter — skipped (final for this letter) and blocked (try again)', () => {
  it('🔴 do not contact is final: skipped, and the next call says already done (skipped)', async () => {
    w.base.set.ports({ dnc: async () => ({ ok: true, blocked: true }) })
    expect(await send()).toMatchObject({ outcome: 'skipped', reason: 'dnc' })
    expect(await send()).toMatchObject({ outcome: 'already_done', rowStatus: 'skipped' })
    expect(w.base.sent).toHaveLength(0)
  })

  it('🔴 the 7-day cap full is a WAIT (blocked), and the letter goes once there is room', async () => {
    w.base.set.evidence(evidenceOf([staff('a'), staff('b')]))
    expect(await send()).toMatchObject({ outcome: 'blocked', reason: 'frequency_full' })
    expect(w.ledger.of(CONTACT, 'catalogue_2027')?.status).toBe('blocked')
    w.base.set.evidence(evidenceOf([]))
    expect(await send()).toMatchObject({ outcome: 'sent' })
  })

  it('🔴 a salesperson\'s e-mail does not stop a follow-up letter (gates.sales_email off), but it counts toward the cap', async () => {
    w.base.set.evidence(evidenceOf([staff('a')]))
    expect(await send()).toMatchObject({ outcome: 'sent' })
    w.base.set.evidence(evidenceOf([staff('a'), staff('b')]))
    expect(await send('followup_d7')).toMatchObject({ outcome: 'blocked', reason: 'frequency_full' })
  })

  it('🔴 the old batch having welcomed the guest does not stop a follow-up letter (gates.legacy_welcomed off)', async () => {
    w.base.set.evidence({ ok: true, items: [], legacy: { welcomed: true, batchSeen: true, campaignIds: ['c1'] } })
    expect(await send()).toMatchObject({ outcome: 'sent' })
  })

  it('🔴 the catalogue link frozen in the authorization is past its last day: blocked (catalogue_expired)', async () => {
    w.set.rule(letterRule({ letters: [entryFor('catalogue_2027', letterTemplate(), { catalogue_url: CATALOGUE_URL, catalogue_valid_until: '2026-11-19' })] }))
    expect(await send()).toMatchObject({ outcome: 'blocked', reason: 'catalogue_expired' })
    expect(w.base.sent).toHaveLength(0)
  })

  it('a template that needs the catalogue link while the letter has none: blocked (render_failed)', async () => {
    w.set.rule(letterRule({ letters: [entryFor('catalogue_2027', letterTemplate())] }))
    expect(await send()).toMatchObject({ outcome: 'blocked', reason: 'render_failed' })
  })

  it('busy locks, a full day, another guest with the same address: blocked / blocked + stop / skipped', async () => {
    w.base.locks.busy = true
    expect(await send()).toMatchObject({ outcome: 'blocked', reason: 'lock_busy' })
    w.base.locks.busy = false
    w.ledger.forced = ['cap_reached']
    expect(await send()).toMatchObject({ outcome: 'blocked', reason: 'cap_reached', stopRun: true })
    w.ledger.forced = ['address_duplicate']
    expect(await send()).toMatchObject({ outcome: 'skipped', reason: 'address_duplicate' })
  })

  it('a provider answer that is not clear: unknown outcome, and the next run replays (never a second letter)', async () => {
    w.base.answers.push({ kind: 'unknown', code: 'timeout', status: null } satisfies ResendSendOutcome)
    expect(await send()).toMatchObject({ outcome: 'unknown_outcome', providerImpact: 'PROVIDER_UNKNOWN' })
    expect(w.ledger.of(CONTACT, 'catalogue_2027')?.status).toBe('pending')
  })
})

describe('sendNamedLetter — in flight and replays', () => {
  it('🔴 a replay the next day sends byte-for-byte the same request: same day for the catalogue, same tokens, same key', async () => {
    // First attempt late on 20 Nov (Auckland); the catalogue's last day is 20 Nov.
    w.set.rule(letterRule({ letters: [entryFor('catalogue_2027', letterTemplate(), { catalogue_url: CATALOGUE_URL, catalogue_valid_until: '2026-11-20' })] }))
    w.clock.now = new Date('2026-11-20T06:00:00.000Z') // 19:00 on 20 Nov
    w.base.answers.push({ kind: 'unknown', code: 'timeout', status: null } satisfies ResendSendOutcome)
    expect(await send()).toMatchObject({ outcome: 'unknown_outcome' })
    // 13.5 hours later: 08:30 on 21 Nov (a fresh render would find the catalogue expired).
    w.clock.now = new Date('2026-11-20T19:30:00.000Z')
    const r = await send()
    expect(r).toMatchObject({ outcome: 'sent' })
    expect(w.base.sent).toHaveLength(2)
    const [a, b] = w.base.sent as [ResendEmailRequest, ResendEmailRequest]
    expect(b).toEqual({ ...a, attempt: 'replay' })
    expect(w.tracking).toMatchObject({ tags: 1, retags: 1 })
  })

  it('🔴 a pending letter of this guest older than 20 hours is handed to the claim function on the way in', async () => {
    const t = followupTemplate()
    w.ledger.seed({
      letterKey: 'followup_d7', status: 'pending', idempotencyKey: 'triggered-send:crm_ai_followup:old', renderedSha256: 'a'.repeat(64), toAddressSha256: addressSha256('lead@example.org'),
      templateKey: t.templateKey, templateVersion: t.version, templateSha256: entryFor('followup_d7', t).template_sha256, firstAttemptAt: '2026-11-18T20:00:00.000Z', attempts: 1,
    })
    const r = await send('catalogue_2027')
    expect(r.outcome).toBe('sent')
    expect(w.ledger.claims[0]).toMatchObject({ letterKey: 'followup_d7', idempotencyKey: 'triggered-send:crm_ai_followup:old', renderedSha256: '0'.repeat(64) })
    expect(w.ledger.of(CONTACT, 'followup_d7')?.status).toBe('unknown_outcome')
  })

  it('🔴 P2-3: the 20-hour hand-over happens even when the authorization is gone or the guest is not on the trial list', async () => {
    const seedOld = () =>
      w.ledger.seed({
        letterKey: 'followup_d7', status: 'pending', idempotencyKey: 'old', renderedSha256: 'a'.repeat(64), toAddressSha256: 'b'.repeat(64),
        templateKey: 'auto-ai-d7', templateVersion: 1, templateSha256: 'c'.repeat(64), firstAttemptAt: '2026-11-18T20:00:00.000Z', attempts: 1,
      })
    seedOld()
    w.set.record(null)
    expect(await send()).toMatchObject({ outcome: 'stopped', reason: 'no_active_authorization' })
    expect(w.ledger.of(CONTACT, 'followup_d7')?.status).toBe('unknown_outcome')
    w = letterWorld()
    seedOld()
    w.base.set.contact({ contactId: CONTACT, createdAt: '2026-11-01T00:00:00.000Z', primaryEmail: 'real.guest@gmail.com', addresses: ['real.guest@gmail.com'], displayName: 'Real Guest' })
    expect(await send()).toMatchObject({ outcome: 'stopped', reason: 'not_in_allowlist' })
    expect(w.ledger.of(CONTACT, 'followup_d7')?.status).toBe('unknown_outcome')
  })

  it('🔴 P2-4: when the database says the row is not 20 hours old yet, the all-zero fingerprint makes it answer in_flight and change nothing', async () => {
    // Our clock says 20 h 10 min; the fake database's clock is 2 hours behind (18 h 10 min): its step 6 does not fire.
    const row = w.ledger.seed({
      letterKey: 'followup_d7', status: 'pending', idempotencyKey: 'old', renderedSha256: 'a'.repeat(64), toAddressSha256: 'b'.repeat(64),
      templateKey: 'auto-ai-d7', templateVersion: 1, templateSha256: entryFor('followup_d7', followupTemplate()).template_sha256, firstAttemptAt: '2026-11-19T00:50:00.000Z', attempts: 1,
    })
    w.ledger.dbClockOffsetMs = -2 * 3_600_000
    const before = { ...row }
    await send('catalogue_2027')
    expect(w.ledger.claims[0]).toMatchObject({ letterKey: 'followup_d7', renderedSha256: '0'.repeat(64) })
    expect(w.ledger.answers[0]).toBe('in_flight')
    expect(w.ledger.of(CONTACT, 'followup_d7')).toMatchObject({ status: 'pending', attempts: before.attempts, updatedAt: before.updatedAt })
  })

  it('a pending letter younger than 20 hours is left alone (not handed to the claim function)', async () => {
    w.ledger.seed({ letterKey: 'followup_d7', status: 'pending', idempotencyKey: 'k', renderedSha256: 'a'.repeat(64), toAddressSha256: 'b'.repeat(64), templateKey: 'auto-ai-d7', templateVersion: 1, templateSha256: 'c'.repeat(64), firstAttemptAt: '2026-11-19T10:00:00.000Z' })
    await send('catalogue_2027')
    expect(w.ledger.claims.map((c) => c.letterKey)).toEqual(['catalogue_2027'])
  })

  it('🔴 a replay whose tracked text cannot be rebuilt is never sent again (content_changed)', async () => {
    w.base.answers.push({ kind: 'unknown', code: 'timeout', status: null } satisfies ResendSendOutcome)
    await send()
    const row = w.ledger.of(CONTACT, 'catalogue_2027')
    if (row !== undefined) row.annotations = { ...row.annotations, link_tracking: { tagged: 1, tokens: ['Tok000000001'], final_text_sha256: 'f'.repeat(64), warning: null } }
    w.clock.now = new Date('2026-11-19T23:00:00.000Z')
    expect(await send()).toMatchObject({ outcome: 'in_flight', reason: 'content_changed' })
    expect(w.base.sent).toHaveLength(1)
  })
})

describe('the welcome letter and a follow-up letter to the same guest at the same time', () => {
  it('🔴 one guest, one letter at a time: the second one finds the guest locked and waits (blocked lock_busy)', async () => {
    const locks = sharedLocks()
    const welcome = w.base
    welcome.deps.createLocks = locks.create
    w.deps.createLocks = locks.create
    let release: () => void = () => undefined
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    welcome.deps.resend = {
      send: async (request) => {
        welcome.sent.push(request)
        await hold
        return { kind: 'sent', messageId: 'msg-welcome' }
      },
    }
    const welcomeRun = sendOne({ plan: plan(), contactId: CONTACT, deps: welcome.deps })
    for (let i = 0; i < 50 && locks.held.size === 0; i += 1) await new Promise((r) => setTimeout(r, 0))
    expect(locks.held.has(CONTACT)).toBe(true)
    const followup = await send()
    expect(followup).toMatchObject({ outcome: 'blocked', reason: 'lock_busy' })
    release()
    expect(await welcomeRun).toMatchObject({ outcome: 'sent' })
    expect(welcome.sent).toHaveLength(1)
    expect(w.ledger.claims).toHaveLength(0)
  })
})

describe('letterStatuses', () => {
  it('lists every letter of the guest that has a row, by key, with status, sent time and id', async () => {
    await send('followup_d7')
    w.base.set.ports({ dnc: async () => ({ ok: true, blocked: true }) })
    await send('catalogue_2027')
    const read = await letterStatuses('c', CONTACT, w.deps)
    expect(read).toEqual({
      ok: true,
      letters: [
        { letterKey: 'catalogue_2027', status: 'skipped', sentAt: null, sendId: expect.any(String) },
        { letterKey: 'followup_d7', status: 'sent', sentAt: expect.any(String), sendId: expect.any(String) },
      ],
    })
  })

  it('a read that fails is a failure, never "nothing sent"', async () => {
    expect(await letterStatuses('c', CONTACT, { letterRows: async () => ({ ok: false, error: 'down' }) })).toEqual({ ok: false, error: 'down' })
    expect(await letterStatuses('c', CONTACT, { letterRows: async () => { throw new Error('x') } })).toMatchObject({ ok: false })
  })
})

describe('the authorization record of a letter list', () => {
  it('binds version 1 and the list fingerprint (what the claim function and the judge expect)', () => {
    const r = letterRecord()
    expect(r.templateVersion).toBe(1)
    expect(r.templateSha256).toMatch(/^[0-9a-f]{64}$/)
  })
})
