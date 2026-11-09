import { describe, expect, it, vi } from 'vitest'
import type { EmailSettings } from '@/lib/crm/email-templates/types'
import type { PreviewResult } from '@/lib/crm/email-templates/template-preview'
import type { SendCrash } from '@/lib/crm/email-templates/send-template-email'
import type { SendMailNewResult } from '@/lib/microsoft/mail-send-new'
import {
  sendCatalogueEmail,
  type CatalogueDeps,
  type SendCatalogueArgs,
  type SendCatalogueResult,
} from '@/lib/crm/catalogue-line/send-catalogue'
import { sendCatalogueAndTakeOver, takeOverManually, CATALOGUE_HALF_MESSAGE, CATALOGUE_UNKNOWN_MESSAGE } from '../actions'
import { takeoverState } from '../state'
import { fakeStore } from './fake-store'

const ARGS: SendCatalogueArgs = {
  clientId: 'client-a',
  contactId: '11111111-1111-4111-8111-111111111111',
  actorEmail: 'lisa@client.co.nz',
  requestId: '22222222-2222-4222-8222-222222222222',
  expectedRecipient: 'amy@gmail.com',
}

const OK: SendCatalogueResult = {
  ok: true, messageId: 'm1', conversationId: 'c1', duplicate: false,
  templateKey: 'catalogue-send', templateVersion: 4, versionLabel: 'v9', settingsVersion: 12,
}

const refused = (over: Partial<Extract<SendCatalogueResult, { ok: false }>> = {}): SendCatalogueResult => ({
  ok: false, status: 409, reason: 'frequency_cap', message: '他这周已经收了 2 封邮件。', mayHaveSent: false, ...over,
})

describe('sendCatalogueAndTakeOver', () => {
  it('confirmed send → one takeover_on event, then the mirror; the actor is the signed-in staff member', async () => {
    const s = fakeStore()
    const r = await sendCatalogueAndTakeOver(ARGS, { sendCatalogue: async () => OK, store: s.deps })
    expect(r).toMatchObject({ status: 200, body: { ok: true, sent: true, versionLabel: 'v9' } })
    expect(s.events).toEqual([expect.objectContaining({
      kind: 'ai_takeover_on', actor: 'lisa@client.co.nz', catalogVersion: 'v9', sourceRef: `catalogue:${ARGS.requestId}`,
    })])
    expect(s.calls).toEqual(['load', 'insert', 'load', 'mirror'])
    expect(s.mirror.get(`${ARGS.clientId}/${ARGS.contactId}`)).toBe(s.events[0].createdAt)
  })

  it('refused send → nothing written, the refusal said plainly', async () => {
    const s = fakeStore()
    const r = await sendCatalogueAndTakeOver(ARGS, { sendCatalogue: async () => refused(), store: s.deps })
    expect(r).toEqual({ status: 409, body: { ok: false, sent: false, reason: 'frequency_cap', message: '他这周已经收了 2 封邮件。' } })
    expect(s.calls).toEqual(['load'])
  })

  it('outcome unknown (mayHaveSent) → nothing written, "先别重发"', async () => {
    const s = fakeStore()
    const r = await sendCatalogueAndTakeOver(ARGS, {
      sendCatalogue: async () => refused({ status: 503, reason: 'send_unknown', mayHaveSent: true }),
      store: s.deps,
    })
    expect(r.body).toEqual({ ok: false, sent: 'unknown', reason: 'send_unknown', message: CATALOGUE_UNKNOWN_MESSAGE })
    expect(s.calls).toEqual(['load'])
  })

  it('a stale page cannot send again for a guest already in takeover (no mail, no new event)', async () => {
    const s = fakeStore()
    await sendCatalogueAndTakeOver(ARGS, { sendCatalogue: async () => OK, store: s.deps })
    const send = vi.fn(async () => OK)
    const r = await sendCatalogueAndTakeOver({ ...ARGS, requestId: '33333333-3333-4333-8333-333333333333' }, { sendCatalogue: send, store: s.deps })
    expect(r).toMatchObject({ status: 409, body: { ok: false, sent: false, reason: 'already_in_takeover' } })
    expect(send).not.toHaveBeenCalled()
    expect(s.events).toHaveLength(1)
  })

  it('an unreadable takeover log means no send at all', async () => {
    const s = fakeStore()
    s.deps.loadEvents = async () => { throw new Error('db down') }
    const send = vi.fn(async () => OK)
    const r = await sendCatalogueAndTakeOver(ARGS, { sendCatalogue: send, store: s.deps })
    expect(r.status).toBe(503)
    expect(send).not.toHaveBeenCalled()
  })

  it('double click with the same requestId → one event (the replay comes back duplicate: true)', async () => {
    const s = fakeStore()
    const send = vi.fn<() => Promise<SendCatalogueResult>>()
      .mockResolvedValueOnce(OK)
      .mockResolvedValueOnce({ ...OK, duplicate: true })
    await sendCatalogueAndTakeOver(ARGS, { sendCatalogue: send, store: s.deps })
    const second = await sendCatalogueAndTakeOver(ARGS, { sendCatalogue: send, store: s.deps })
    expect(second).toMatchObject({ status: 200, body: { duplicate: true } })
    expect(s.events).toHaveLength(1)
  })

  it('sent but the mirror did not update → says so; clicking again (same requestId) repairs it without a second event', async () => {
    const s = fakeStore({ failMirror: true })
    const first = await sendCatalogueAndTakeOver(ARGS, { sendCatalogue: async () => OK, store: s.deps })
    expect(first).toEqual({ status: 500, body: { ok: false, sent: true, reason: 'half_written', message: CATALOGUE_HALF_MESSAGE } })
    s.setFailMirror(false)
    const again = await sendCatalogueAndTakeOver(ARGS, { sendCatalogue: async () => ({ ...OK, duplicate: true }), store: s.deps })
    expect(again.status).toBe(200)
    expect(s.events).toHaveLength(1)
    expect(s.mirror.get(`${ARGS.clientId}/${ARGS.contactId}`)).not.toBeNull()
  })
})

// With the real sendCatalogueEmail (127's B0 lib) and fake data: the do-not-contact rule and the do-not-call split.
function catalogueDeps(contact: { doNotContact: boolean }): CatalogueDeps & { sent: () => number } {
  const url = 'https://www.example.com/b.pdf'
  const settings: EmailSettings = {
    enabled: true, sendMailbox: null, allowUnsolicited: false, footer: null,
    limits: { perUserPerHour: 30, perUserPerDay: 100, perMailboxPerDay: 200 },
    frequencyCap: { max: 2, windowDays: 7 }, capExemptTemplateKeys: [], recipientAllowlist: null,
    sameTemplateCooldownHours: 24, callPromptHours: 24,
    guardrails: { allowedLinkHosts: ['www.example.com'], rules: [] },
    providers: { catalogue: { templateKey: 'catalogue-send', versionLabel: 'v9', url, validUntil: '2026-12-31' } },
  }
  const preview: PreviewResult = {
    ok: true, template: { key: 'catalogue-send', version: 4, name: 'Catalogue', pickMode: 'none', factSource: 'none' },
    catalogVersion: null, options: [], pickProblem: null,
    rendered: { subject: 'Brochure', body: `Kia ora,\n${url}`, missing: [], problems: [] },
    footer: null, blocks: [], warnings: [], callBasis: 'none', callEvidenceAt: null,
    frequency: { state: 'ok', count: 0, max: 2, windowDays: 7, nextAllowedAt: null, items: [], error: null },
  }
  const send = vi.fn(async (): Promise<SendMailNewResult | SendCrash> => ({ ok: true, messageId: 'm1', conversationId: 'c1' }))
  return {
    loadSettings: async () => ({ kind: 'ok' as const, version: 12, settings }),
    loadTimeZone: async () => 'Pacific/Auckland',
    eligibility: { loadContact: async () => ({ ...contact, stage: null, snoozeUntil: null }), loadStages: async () => [] },
    preview: async () => preview,
    send,
    now: () => new Date('2026-11-10T02:00:00Z'),
    sent: () => send.mock.calls.length,
  }
}

describe('with the real catalogue send', () => {
  it('a do-not-contact guest never enters takeover (no mail, no event)', async () => {
    const s = fakeStore()
    const d = catalogueDeps({ doNotContact: true })
    const r = await sendCatalogueAndTakeOver(ARGS, { sendCatalogue: (a) => sendCatalogueEmail(a, d), store: s.deps })
    expect(r.body).toMatchObject({ ok: false, sent: false, reason: 'do_not_contact' })
    expect(d.sent()).toBe(0)
    expect(s.events).toHaveLength(0)
  })

  it('a guest who only said "don\'t call me" can still get the catalogue by email and enters takeover', async () => {
    // do_not_call never sets contacts.do_not_contact (lib/crm/dnc split, PM 2026-11-09).
    const s = fakeStore()
    const d = catalogueDeps({ doNotContact: false })
    const r = await sendCatalogueAndTakeOver(ARGS, { sendCatalogue: (a) => sendCatalogueEmail(a, d), store: s.deps })
    expect(r.status).toBe(200)
    expect(d.sent()).toBe(1)
    expect(takeoverState(await s.deps.loadEvents(ARGS.clientId, ARGS.contactId)).on).toBe(true)
  })
})

describe('takeOverManually (收回人工)', () => {
  const OFF = { clientId: ARGS.clientId, contactId: ARGS.contactId, actorEmail: 'lisa@client.co.nz', clientRef: 'r-off' }

  async function inTakeover() {
    const s = fakeStore()
    await sendCatalogueAndTakeOver(ARGS, { sendCatalogue: async () => OK, store: s.deps })
    return s
  }

  it('a staff click writes takeover_off and clears the mirror', async () => {
    const s = await inTakeover()
    expect(await takeOverManually(OFF, s.deps)).toEqual({ status: 200, body: { ok: true, alreadyOff: false } })
    expect(s.events.map((e) => e.kind)).toEqual(['ai_takeover_on', 'ai_takeover_off'])
    expect(s.mirror.get(`${ARGS.clientId}/${ARGS.contactId}`)).toBeNull()
  })

  it('only a staff member: a system actor is refused and nothing is written', async () => {
    const s = await inTakeover()
    const r = await takeOverManually({ ...OFF, actorEmail: 'system:customer-came-back' }, s.deps)
    expect(r).toMatchObject({ status: 403, body: { reason: 'staff_only' } })
    expect(s.events).toHaveLength(1)
  })

  it('a replayed off key that inserts nothing while the log still says on is not reported as success', async () => {
    const s = fakeStore()
    await sendCatalogueAndTakeOver(ARGS, { sendCatalogue: async () => OK, store: s.deps })
    const off = { clientId: ARGS.clientId, contactId: ARGS.contactId, actorEmail: 'lisa@client.co.nz', clientRef: 'r1' }
    expect((await takeOverManually(off, s.deps)).status).toBe(200)
    s.events.push({ ...s.events[0], kind: 'ai_takeover_on', sourceRef: 'catalogue:later', createdAt: '2026-11-10T05:00:00.000Z' })
    const r = await takeOverManually(off, s.deps)
    expect(r).toMatchObject({ status: 409, body: { ok: false, reason: 'not_taken_back' } })
  })

  it('double click → one off event', async () => {
    const s = await inTakeover()
    await takeOverManually(OFF, s.deps)
    await takeOverManually(OFF, s.deps)
    expect(s.events.filter((e) => e.kind === 'ai_takeover_off')).toHaveLength(1)
  })

  it('half written → "再点一下"; the retry fixes the mirror without a second event', async () => {
    const s = await inTakeover()
    s.setFailMirror(true)
    expect(await takeOverManually(OFF, s.deps)).toMatchObject({ status: 500, body: { reason: 'half_written' } })
    s.setFailMirror(false)
    expect(await takeOverManually(OFF, s.deps)).toEqual({ status: 200, body: { ok: true, alreadyOff: true } })
    expect(s.events.filter((e) => e.kind === 'ai_takeover_off')).toHaveLength(1)
    expect(s.mirror.get(`${ARGS.clientId}/${ARGS.contactId}`)).toBeNull()
  })
})
