import { describe, expect, it, vi } from 'vitest'
import type { EmailSettings } from '@/lib/crm/email-templates/types'
import type { PreviewResult } from '@/lib/crm/email-templates/template-preview'
import type { SendMailNewResult } from '@/lib/microsoft/mail-send-new'
import type { SendCrash } from '@/lib/crm/email-templates/send-template-email'
import { sendCatalogueEmail, type CatalogueDeps, type SendCatalogueArgs } from '../send-catalogue'

// Design §5 rows 9, 14-18 and the order of §3.5.

const URL = 'https://www.example.com/b.pdf'
const NOW = new Date('2026-11-09T02:00:00Z') // 9 Nov in Auckland

function settings(over: Partial<EmailSettings> = {}): EmailSettings {
  return {
    enabled: true,
    sendMailbox: null,
    allowUnsolicited: false,
    footer: null,
    limits: { perUserPerHour: 30, perUserPerDay: 100, perMailboxPerDay: 200 },
    frequencyCap: { max: 2, windowDays: 7 },
    capExemptTemplateKeys: [],
    recipientAllowlist: null,
    sameTemplateCooldownHours: 24,
    callPromptHours: 24,
    guardrails: { allowedLinkHosts: ['www.example.com'], rules: [] },
    providers: { catalogue: { templateKey: 'catalogue-send', versionLabel: 'v9', url: URL, validUntil: '2026-12-31' } },
    ...over,
  }
}

function preview(over: Partial<Extract<PreviewResult, { ok: true }>> = {}): PreviewResult {
  return {
    ok: true,
    template: { key: 'catalogue-send', version: 4, name: 'Catalogue', pickMode: 'none', factSource: 'none' },
    catalogVersion: null,
    options: [],
    pickProblem: null,
    rendered: { subject: 'Our 2027 brochure', body: `Kia ora Amy,\n\n${URL}`, missing: [], problems: [] },
    footer: null,
    blocks: [],
    warnings: [],
    callBasis: 'none',
    callEvidenceAt: null,
    frequency: { state: 'ok', count: 0, max: 2, windowDays: 7, nextAllowedAt: null, items: [], error: null },
    ...over,
  }
}

const SENT: SendMailNewResult = { ok: true, messageId: 'm1', conversationId: 'c1' }

function deps(over: Partial<CatalogueDeps> = {}): CatalogueDeps {
  return {
    loadSettings: vi.fn(async () => ({ kind: 'ok' as const, version: 12, settings: settings() })),
    loadTimeZone: vi.fn(async () => 'Pacific/Auckland'),
    eligibility: {
      loadContact: vi.fn(async () => ({ doNotContact: false, stage: null, snoozeUntil: null })),
      loadStages: vi.fn(async () => []),
    },
    preview: vi.fn(async () => preview()),
    send: vi.fn(async (): Promise<SendMailNewResult | SendCrash> => SENT),
    now: () => NOW,
    ...over,
  }
}

const ARGS: SendCatalogueArgs = {
  clientId: 'client-a',
  contactId: '11111111-1111-4111-8111-111111111111',
  actorEmail: 'lisa@client.co.nz',
  requestId: '22222222-2222-4222-8222-222222222222',
  expectedRecipient: 'amy@gmail.com',
}

describe('sendCatalogueEmail', () => {
  it('sends the server-rendered catalogue mail through the shared send, and reports what went out', async () => {
    const d = deps()
    const result = await sendCatalogueEmail(ARGS, d)
    expect(result).toEqual({
      ok: true,
      messageId: 'm1',
      conversationId: 'c1',
      duplicate: false,
      templateKey: 'catalogue-send',
      templateVersion: 4,
      versionLabel: 'v9',
      settingsVersion: 12,
    })
    expect(d.send).toHaveBeenCalledWith({
      clientId: 'client-a',
      contactId: ARGS.contactId,
      actorEmail: 'lisa@client.co.nz',
      requestId: ARGS.requestId,
      subject: 'Our 2027 brochure',
      body: `Kia ora Amy,\n\n${URL}`,
      expectedRecipient: 'amy@gmail.com',
      template: { key: 'catalogue-send', version: 4, catalogVersion: null, picks: [], inputs: {}, callBasis: 'none' },
    })
    expect(d.preview).toHaveBeenCalledWith(expect.objectContaining({ request: { key: 'catalogue-send', picks: [], inputs: {}, callBasis: 'none' } }))
  })

  it('a double click with the same request id: the shared send replays it, nothing new goes out', async () => {
    const d = deps({ send: vi.fn(async () => ({ ...SENT, duplicate: true })) })
    expect(await sendCatalogueEmail(ARGS, d)).toMatchObject({ ok: true, duplicate: true })
  })

  it('no versioned settings, or settings that do not parse: refused before anything else is read', async () => {
    const d = deps({ loadSettings: vi.fn(async () => ({ kind: 'none' as const })) })
    expect(await sendCatalogueEmail(ARGS, d)).toMatchObject({ ok: false, reason: 'settings_unavailable' })
    expect(d.preview).not.toHaveBeenCalled()
    expect(d.send).not.toHaveBeenCalled()
  })

  it('no catalogue configured', async () => {
    const d = deps({ loadSettings: vi.fn(async () => ({ kind: 'ok' as const, version: 1, settings: settings({ providers: {} }) })) })
    expect(await sendCatalogueEmail(ARGS, d)).toMatchObject({ ok: false, reason: 'catalogue_not_configured' })
    expect(d.send).not.toHaveBeenCalled()
  })

  it('an expired catalogue (by the client\'s day), with the date in the message; the last day still sends', async () => {
    const expired = settings({ providers: { catalogue: { templateKey: 'catalogue-send', versionLabel: 'v9', url: URL, validUntil: '2026-11-08' } } })
    const d = deps({ loadSettings: vi.fn(async () => ({ kind: 'ok' as const, version: 1, settings: expired })) })
    const result = await sendCatalogueEmail(ARGS, d)
    expect(result).toMatchObject({ ok: false, reason: 'catalogue_expired' })
    if (!result.ok) expect(result.message).toContain('2026-11-08')
    expect(d.send).not.toHaveBeenCalled()
    const lastDay = settings({ providers: { catalogue: { templateKey: 'catalogue-send', versionLabel: 'v9', url: URL, validUntil: '2026-11-09' } } })
    expect(await sendCatalogueEmail(ARGS, deps({ loadSettings: vi.fn(async () => ({ kind: 'ok' as const, version: 1, settings: lastDay })) }))).toMatchObject({ ok: true })
  })

  it('a guest the catalogue line may not reach is refused before the template is even rendered', async () => {
    const d = deps()
    d.eligibility.loadContact = vi.fn(async () => ({ doNotContact: true, stage: null, snoozeUntil: null }))
    expect(await sendCatalogueEmail(ARGS, d)).toMatchObject({ ok: false, reason: 'do_not_contact', mayHaveSent: false })
    expect(d.preview).not.toHaveBeenCalled()
  })

  it.each([
    ['a tour pick', { template: { key: 'catalogue-send', version: 4, name: 'x', pickMode: 'one' as const, factSource: 'none' as const } }],
    ['a content source', { template: { key: 'catalogue-send', version: 4, name: 'x', pickMode: 'none' as const, factSource: 'published_tours' as const } }],
    ['a staff-typed box', { rendered: { subject: 'S', body: 'B', missing: ['input.note'], problems: [] } }],
  ])('a catalogue template with %s is refused: its text must be fixed', async (_label, over) => {
    const d = deps({ preview: vi.fn(async () => preview(over)) })
    expect(await sendCatalogueEmail(ARGS, d)).toMatchObject({ ok: false, reason: 'catalogue_template_invalid' })
    expect(d.send).not.toHaveBeenCalled()
  })

  it('a template the preview cannot use (switched off, gone) is refused', async () => {
    const d = deps({ preview: vi.fn(async (): Promise<PreviewResult> => ({ ok: false, status: 409, reason: 'template_unavailable', error: 'x' })) })
    expect(await sendCatalogueEmail(ARGS, d)).toMatchObject({ ok: false, reason: 'catalogue_template_invalid' })
  })

  it('a render with a gap (no first name on file) or a blocked line does not go out', async () => {
    const gap = deps({ preview: vi.fn(async () => preview({ rendered: { subject: 'S', body: 'B', missing: ['first_name'], problems: [] } })) })
    const result = await sendCatalogueEmail(ARGS, gap)
    expect(result).toMatchObject({ ok: false, reason: 'catalogue_render_failed' })
    if (!result.ok) expect(result.message).toContain('first_name')
    const blocked = deps({ preview: vi.fn(async () => preview({ blocks: [{ code: 'content_blocked', detail: 'x' }] })) })
    expect(await sendCatalogueEmail(ARGS, blocked)).toMatchObject({ ok: false, reason: 'catalogue_render_failed' })
    expect(gap.send).not.toHaveBeenCalled()
    expect(blocked.send).not.toHaveBeenCalled()
  })

  it('a refusal by the send gates is passed on as it is (cap reached, address changed…)', async () => {
    const d = deps({ send: vi.fn(async (): Promise<SendMailNewResult> => ({ ok: false, status: 409, reason: 'frequency_cap', error: '他最近收到的邮件已达上限。' })) })
    expect(await sendCatalogueEmail(ARGS, d)).toEqual({ ok: false, status: 409, reason: 'frequency_cap', message: '他最近收到的邮件已达上限。', mayHaveSent: false })
    const moved = deps({ send: vi.fn(async (): Promise<SendMailNewResult> => ({ ok: false, status: 409, reason: 'recipient_mismatch', error: 'x' })) })
    expect(await sendCatalogueEmail(ARGS, moved)).toMatchObject({ ok: false, reason: 'recipient_mismatch' })
  })

  it('a crash after the send started is never reported as "not sent"', async () => {
    const d = deps({ send: vi.fn(async (): Promise<SendCrash> => ({ crashed: true, mayHaveSent: true, message: '不确定' })) })
    expect(await sendCatalogueEmail(ARGS, d)).toMatchObject({ ok: false, status: 503, mayHaveSent: true })
    const unknown = deps({ send: vi.fn(async (): Promise<SendMailNewResult> => ({ ok: false, status: 502, reason: 'send_unknown', error: 'x' })) })
    expect(await sendCatalogueEmail(ARGS, unknown)).toMatchObject({ ok: false, mayHaveSent: true })
  })
})
