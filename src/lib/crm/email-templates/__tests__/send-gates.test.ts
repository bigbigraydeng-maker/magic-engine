import { describe, expect, it, vi } from 'vitest'
import {
  GATE_MESSAGES,
  computeCallWhen,
  createSendGates,
  decideCallBasis,
  emptyMeta,
  todayInZone,
  type GateReason,
  type GateState,
  type InLockArgs,
  type PreLockArgs,
  type SendGateData,
  type SendMeta,
  type TemplateRequest,
} from '@/lib/crm/email-templates/send-gates'
import { effectiveFromSettings, type EffectiveEmailConfig } from '@/lib/crm/email-templates/effective-config'
import type { EmailSettings, EmailTemplateVersion, StoredReceipt } from '@/lib/crm/email-templates/types'
import type { PublishedTourFact } from '@/lib/crm/email-templates/facts/types'
import type { FrequencySources, OutboundItem } from '@/lib/crm/email-templates/gates/types'
import { renderTemplate } from '@/lib/crm/email-templates/render'
import { getProvider } from '@/lib/crm/email-templates/facts/registry'

// ---- fixtures -------------------------------------------------------------

function tour(over: Partial<PublishedTourFact> = {}): PublishedTourFact {
  return {
    id: 't1',
    slug: 'essentials',
    destination: 'china',
    tier: 'discovery',
    name: 'China Discovery — Best of China',
    title: null,
    durationText: '15 Days',
    displayPriceText: 'From NZD $4,080 per person',
    highlights: ['Great Wall', 'Terracotta Warriors'],
    inclusions: ['4-star hotels'],
    exclusions: [],
    singleSupplement: null,
    soldOut: false,
    managesDepartures: true,
    isActive: true,
    departures: [
      { departOn: '2027-03-11', displayDate: '11 March 2027', status: 'open', priceTextOverride: null },
    ],
    ...over,
  }
}

function settingsObj(over: Partial<EmailSettings> = {}): EmailSettings {
  return {
    enabled: true,
    sendMailbox: 'info@example.com',
    allowUnsolicited: false,
    footer: null,
    limits: { perUserPerHour: 30, perUserPerDay: 100, perMailboxPerDay: 200 },
    frequencyCap: { max: 2, windowDays: 7 },
    recipientAllowlist: null,
    sameTemplateCooldownHours: 24,
    callPromptHours: 24,
    guardrails: {
      allowedLinkHosts: ['www.example.com', 'example.com'],
      rules: [
        { id: 'no-visa-free', phrases: ['visa-free'], message: 'no visa-free', severity: 'block' },
        { id: 'no-call', phrases: ['give me a call'], message: 'no calls', severity: 'warn' },
      ],
    },
    providers: {
      publishedTours: {
        urlPattern: 'https://www.example.com/tours/{destination}/{tier}/{slug}',
        allToursUrl: 'https://www.example.com/tours',
      },
    },
    ...over,
  }
}

function config(over: Partial<EmailSettings> = {}): EffectiveEmailConfig {
  return effectiveFromSettings(settingsObj(over), 1)
}

function template(over: Partial<EmailTemplateVersion> = {}): EmailTemplateVersion {
  return {
    id: 'tpl-1',
    clientId: 'client-a',
    templateKey: 'post-call-single-tour',
    version: 3,
    name: 'Post-call single tour',
    subject: '{{tour_name}}: your itinerary',
    body:
      'Kia ora {{first_name}},\n\nHere are the details of {{tour_name}} ({{tour_duration}}), departing {{departure_date}}.\n\n{{tour_price}}\n\n{{tour_url}}\n\nWarm regards,\n{{sender_name}}',
    factSource: 'published_tours',
    pickMode: 'one',
    pickFilter: {},
    status: 'active',
    changeNote: null,
    createdBy: 'lisa@client.co.nz',
    createdAt: '2026-10-01T00:00:00Z',
    ...over,
  }
}

function templateReq(over: Partial<TemplateRequest> = {}): TemplateRequest {
  return {
    key: 'post-call-single-tour',
    version: 3,
    catalogVersion: 7,
    picks: [{ tourId: 't1', departOn: '2027-03-11' }],
    inputs: {},
    callBasis: 'none',
    ...over,
  }
}

function emptySources(): FrequencySources {
  const empty = async () => ({ ok: true as const, items: [] as OutboundItem[] })
  return {
    sentItems: vi.fn(empty),
    audit: vi.fn(empty),
    touchpoints: vi.fn(empty),
    mailchimp: vi.fn(empty),
  }
}

function makeData(over: Partial<SendGateData> = {}): SendGateData {
  return {
    loadTemplate: vi.fn(async () => template()),
    loadFacts: vi.fn(async () => ({ ok: true as const, version: 7, tours: [tour()] })),
    loadContactView: vi.fn(async () => ({
      displayName: 'Amy Lee',
      addresses: ['amy@gmail.com', 'amy.lee@work.com'],
      callEvidenceAt: null,
    })),
    loadSenderName: vi.fn(async () => 'Lisa Zhang'),
    sentTemplateReceiptsSince: vi.fn(async () => [] as StoredReceipt[]),
    frequencySources: emptySources(),
    ...over,
  }
}

// Render the template with the real provider so the final body matches what the staff would see.
function renderedText(tpl: EmailTemplateVersion, tours: PublishedTourFact[] = [tour()]): { subject: string; body: string } {
  const provider = getProvider('published_tours')
  if (provider === null) throw new Error('published_tours provider missing')
  const resolved = provider.resolvePicks(tours, [{ tourId: 't1', departOn: '2027-03-11' }], {}, 'one')
  if (!resolved.ok) throw new Error(`resolvePicks failed: ${resolved.reason}`)
  const out = renderTemplate(tpl, {
    contactName: 'Amy Lee',
    senderDisplayName: 'Lisa Zhang',
    callWhen: null,
    inputs: {},
    facts: {
      tours,
      picks: resolved.picks,
      settings: settingsObj().providers.publishedTours ?? null,
    },
    provider,
  })
  return { subject: out.subject, body: out.body }
}

function preArgs(over: Partial<PreLockArgs> = {}): PreLockArgs {
  const tpl = template()
  const rendered = renderedText(tpl)
  return {
    clientId: 'client-a',
    contactId: 'contact-1',
    sentByEmail: 'lisa@client.co.nz',
    config: config(),
    subject: rendered.subject,
    body: rendered.body,
    footer: null,
    template: templateReq(),
    to: 'amy@gmail.com',
    now: new Date('2026-10-28T02:00:00Z'),
    ...over,
  }
}

function receipt(over: Partial<StoredReceipt> = {}): StoredReceipt {
  return {
    id: 'r1',
    clientId: 'client-a',
    contactId: 'contact-1',
    requestId: 'req-1',
    actorEmail: 'lisa@client.co.nz',
    templateKey: 'other-template',
    templateVersion: 1,
    catalogVersion: 7,
    callBasis: 'system_call',
    outcome: 'sent',
    blockReason: null,
    blockDetail: null,
    mailbox: 'info@example.com',
    conversationId: null,
    providerMessageId: 'msg-1',
    editedAfterRender: false,
    warnings: [],
    renderedSha256: null,
    finalSha256: null,
    authBasis: 'human_click',
    createdAt: '2026-10-28T01:00:00Z',
    ...over,
  }
}

function outboundItem(over: Partial<OutboundItem> = {}): OutboundItem {
  return {
    source: 'sent_items',
    id: 'm1',
    at: '2026-10-27T00:00:00Z',
    subject: 'hi',
    address: 'amy@gmail.com',
    ...over,
  }
}

// Build a state/meta pair by running a successful preLock.
async function successfulPreLock(
  data: SendGateData,
  over: Partial<PreLockArgs> = {},
): Promise<{ state: GateState; meta: SendMeta }> {
  const gates = createSendGates(data)
  const result = await gates.preLock(preArgs(over))
  if (!result.ok) throw new Error(`preLock failed: ${result.reason}`)
  return { state: result.state, meta: result.meta }
}

function inArgs(state: GateState, meta: SendMeta, over: Partial<InLockArgs> = {}): InLockArgs {
  return {
    clientId: 'client-a',
    contactId: 'contact-1',
    config: config(),
    state,
    meta,
    now: new Date('2026-10-28T02:00:00Z'),
    ...over,
  }
}

// ---- preLock --------------------------------------------------------------

describe('preLock', () => {
  it('free compose with a clean body succeeds', async () => {
    const data = makeData()
    const gates = createSendGates(data)
    const result = await gates.preLock(
      preArgs({
        template: null,
        subject: 'Hello',
        body: 'Just checking in.',
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.meta.templateKey).toBeNull()
    expect(result.meta.callBasis).toBe('none')
    expect(result.meta.finalSha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('template send with unedited rendered text succeeds', async () => {
    const data = makeData()
    const gates = createSendGates(data)
    const result = await gates.preLock(preArgs())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.meta.templateKey).toBe('post-call-single-tour')
    expect(result.meta.templateVersion).toBe(3)
    expect(result.meta.catalogVersion).toBe(7)
    expect(result.meta.editedAfterRender).toBe(false)
    expect(result.meta.renderedSha256).toBe(result.meta.finalSha256)
  })

  it('edited body sets editedAfterRender true', async () => {
    const args = preArgs()
    const gates = createSendGates(makeData())
    const result = await gates.preLock({ ...args, body: `${args.body}\n\nP.S. see you soon.` })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.meta.editedAfterRender).toBe(true)
    expect(result.meta.renderedSha256).not.toBe(result.meta.finalSha256)
  })

  it('render gap leaves edit flag unknown', async () => {
    const data = makeData({
      loadContactView: vi.fn(async () => ({
        displayName: 'Guest',
        addresses: ['amy@gmail.com'],
        callEvidenceAt: null,
      })),
    })
    const gates = createSendGates(data)
    const args = preArgs()
    const result = await gates.preLock({ ...args, body: `Kia ora Amy,\n\n${args.body}` })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.meta.editedAfterRender).toBeNull()
    expect(result.meta.renderedSha256).toBeNull()
  })

  it('template version mismatch is template_outdated', async () => {
    const gates = createSendGates(makeData())
    const result = await gates.preLock(preArgs({ template: templateReq({ version: 2 }) }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(409)
    expect(result.reason).toBe('template_outdated')
  })

  it('disabled template is template_unavailable', async () => {
    const data = makeData({ loadTemplate: vi.fn(async () => template({ status: 'disabled' })) })
    const gates = createSendGates(data)
    const result = await gates.preLock(preArgs())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(409)
    expect(result.reason).toBe('template_unavailable')
  })

  it('missing template is template_unavailable', async () => {
    const data = makeData({ loadTemplate: vi.fn(async () => null) })
    const gates = createSendGates(data)
    const result = await gates.preLock(preArgs())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(409)
    expect(result.reason).toBe('template_unavailable')
  })

  it('catalog version mismatch is catalog_outdated', async () => {
    const gates = createSendGates(makeData())
    const result = await gates.preLock(preArgs({ template: templateReq({ catalogVersion: 6 }) }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(409)
    expect(result.reason).toBe('catalog_outdated')
  })

  it('unreadable catalog is catalog_unreadable', async () => {
    const data = makeData({ loadFacts: vi.fn(async () => ({ ok: false as const, error: 'boom' })) })
    const gates = createSendGates(data)
    const result = await gates.preLock(preArgs())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(503)
    expect(result.reason).toBe('catalog_unreadable')
  })

  it('sold-out tour is tour_unavailable', async () => {
    const data = makeData({
      loadFacts: vi.fn(async () => ({ ok: true as const, version: 7, tours: [tour({ soldOut: true })] })),
    })
    const gates = createSendGates(data)
    const result = await gates.preLock(preArgs())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(409)
    expect(result.reason).toBe('tour_unavailable')
  })

  it('unknown tour id is invalid_pick', async () => {
    const gates = createSendGates(makeData())
    const result = await gates.preLock(
      preArgs({ template: templateReq({ picks: [{ tourId: 'nope', departOn: null }] }) }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(409)
    expect(result.reason).toBe('invalid_pick')
  })

  it('departure not on sale is tour_unavailable', async () => {
    const gates = createSendGates(makeData())
    const result = await gates.preLock(
      preArgs({ template: templateReq({ picks: [{ tourId: 't1', departOn: '2027-04-01' }] }) }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(409)
    expect(result.reason).toBe('tour_unavailable')
  })

  it('blocked phrase is content_blocked with rule id in blockDetail', async () => {
    const args = preArgs()
    const gates = createSendGates(makeData())
    const result = await gates.preLock({ ...args, body: `${args.body}\n\nIt is visa-free.` })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(409)
    expect(result.reason).toBe('content_blocked')
    expect(result.meta.blockDetail).toContain('no-visa-free')
  })

  it('disallowed link host is link_host_not_allowed', async () => {
    const args = preArgs()
    const gates = createSendGates(makeData())
    const result = await gates.preLock({ ...args, body: `${args.body}\n\nhttps://evil.com/x` })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(409)
    expect(result.reason).toBe('link_host_not_allowed')
  })

  it('leftover placeholder is placeholder_left', async () => {
    const args = preArgs()
    const gates = createSendGates(makeData())
    const result = await gates.preLock({ ...args, body: `${args.body}\n\n{{x}}` })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(409)
    expect(result.reason).toBe('placeholder_left')
  })

  it('link to a sold-out tour page is tour_page_not_on_sale', async () => {
    const data = makeData({
      loadFacts: vi.fn(async () => ({ ok: true as const, version: 7, tours: [tour({ soldOut: true })] })),
    })
    const gates = createSendGates(data)
    const result = await gates.preLock(
      preArgs({
        template: null,
        subject: 'Hello',
        body: 'See https://www.example.com/tours/china/discovery/essentials for details.',
      }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(409)
    expect(result.reason).toBe('tour_page_not_on_sale')
  })

  it('warn-only phrase succeeds and records a warning', async () => {
    const args = preArgs()
    const gates = createSendGates(makeData())
    const result = await gates.preLock({ ...args, body: `${args.body}\n\nGive me a call anytime.` })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.meta.warnings).toContain('content_warning:no-call')
  })

  it('system call evidence overrides a none claim', async () => {
    const data = makeData({
      loadContactView: vi.fn(async () => ({
        displayName: 'Amy Lee',
        addresses: ['amy@gmail.com'],
        callEvidenceAt: '2026-10-28T00:00:00Z',
      })),
    })
    const gates = createSendGates(data)
    const result = await gates.preLock(preArgs({ template: templateReq({ callBasis: 'none' }) }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.meta.callBasis).toBe('system_call')
  })

  it('staff_attested claim without evidence stays staff_attested', async () => {
    const gates = createSendGates(makeData())
    const result = await gates.preLock(preArgs({ template: templateReq({ callBasis: 'staff_attested' }) }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.meta.callBasis).toBe('staff_attested')
  })

  it('system_call claim without evidence becomes none', async () => {
    const gates = createSendGates(makeData())
    const result = await gates.preLock(preArgs({ template: templateReq({ callBasis: 'system_call' }) }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.meta.callBasis).toBe('none')
  })

  it('missing contact view is internal_error', async () => {
    const data = makeData({ loadContactView: vi.fn(async () => null) })
    const gates = createSendGates(data)
    const result = await gates.preLock(preArgs())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(503)
    expect(result.reason).toBe('internal_error')
  })

  it('throwing contact view is internal_error and does not reject', async () => {
    const data = makeData({
      loadContactView: vi.fn(async () => {
        throw new Error('db down')
      }),
    })
    const gates = createSendGates(data)
    const result = await gates.preLock(preArgs())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(503)
    expect(result.reason).toBe('internal_error')
  })

  it('free compose link to unknown tour page is tour_page_not_on_sale', async () => {
    const gates = createSendGates(makeData())
    const result = await gates.preLock(
      preArgs({
        template: null,
        subject: 'Hello',
        body: 'See https://www.example.com/tours/china/discovery/unknown for details.',
      }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(409)
    expect(result.reason).toBe('tour_page_not_on_sale')
  })

  it('free compose with unreadable catalog is catalog_unreadable', async () => {
    const data = makeData({ loadFacts: vi.fn(async () => ({ ok: false as const, error: 'boom' })) })
    const gates = createSendGates(data)
    const result = await gates.preLock(
      preArgs({ template: null, subject: 'Hello', body: 'Just checking in.' }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(503)
    expect(result.reason).toBe('catalog_unreadable')
  })

  it('free compose without publishedTours provider does not load facts', async () => {
    const data = makeData()
    const gates = createSendGates(data)
    const result = await gates.preLock(
      preArgs({
        template: null,
        subject: 'Hello',
        body: 'Just checking in.',
        config: config({ providers: {} }),
      }),
    )
    expect(result.ok).toBe(true)
    expect(data.loadFacts).not.toHaveBeenCalled()
  })
})

// ---- inLock ---------------------------------------------------------------

describe('inLock', () => {
  it('no frequency cap skips the frequency sources', async () => {
    const data = makeData()
    const { state, meta } = await successfulPreLock(data)
    const gates = createSendGates(data)
    const result = await gates.inLock(inArgs(state, meta, { config: config({ frequencyCap: null }) }))
    expect(result.ok).toBe(true)
    expect(data.frequencySources.sentItems).not.toHaveBeenCalled()
    expect(data.frequencySources.audit).not.toHaveBeenCalled()
    expect(data.frequencySources.touchpoints).not.toHaveBeenCalled()
    expect(data.frequencySources.mailchimp).not.toHaveBeenCalled()
  })

  it('follow-up after a call is already_followed_up', async () => {
    const data = makeData({
      sentTemplateReceiptsSince: vi.fn(async () => [receipt({ createdAt: '2026-10-28T01:00:00Z' })]),
    })
    const { state, meta } = await successfulPreLock(data)
    const gates = createSendGates(data)
    const result = await gates.inLock(
      inArgs({ ...state, callEvidenceAt: '2026-10-28T00:00:00Z' }, meta),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(409)
    expect(result.reason).toBe('already_followed_up')
  })

  it('same template within cooldown is duplicate_template', async () => {
    const data = makeData({
      sentTemplateReceiptsSince: vi.fn(async () => [
        receipt({ templateKey: 'post-call-single-tour', createdAt: '2026-10-27T23:00:00Z' }),
      ]),
    })
    const { state, meta } = await successfulPreLock(data)
    const gates = createSendGates(data)
    const result = await gates.inLock(inArgs(state, meta))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(409)
    expect(result.reason).toBe('duplicate_template')
  })

  it('free compose never checks sent template receipts', async () => {
    const data = makeData()
    const { state, meta } = await successfulPreLock(data, {
      template: null,
      subject: 'Hello',
      body: 'Just checking in.',
    })
    const gates = createSendGates(data)
    const result = await gates.inLock(inArgs(state, meta))
    expect(result.ok).toBe(true)
    expect(data.sentTemplateReceiptsSince).not.toHaveBeenCalled()
  })

  it('two items in the window hit the frequency cap', async () => {
    const sources = emptySources()
    sources.sentItems = vi.fn(async () => ({
      ok: true as const,
      items: [
        outboundItem({ id: 'a', at: '2026-10-27T00:00:00Z' }),
        outboundItem({ id: 'b', at: '2026-10-26T00:00:00Z' }),
      ],
    }))
    const data = makeData({ frequencySources: sources })
    const { state, meta } = await successfulPreLock(data)
    const gates = createSendGates(data)
    const result = await gates.inLock(inArgs(state, meta))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(409)
    expect(result.reason).toBe('frequency_cap')
    expect(result.error).toContain('上限 2')
    expect(result.meta.blockDetail?.startsWith('count=2;next=')).toBe(true)
  })

  it('one item in the window passes', async () => {
    const sources = emptySources()
    sources.sentItems = vi.fn(async () => ({
      ok: true as const,
      items: [outboundItem({ id: 'a', at: '2026-10-27T00:00:00Z' })],
    }))
    const data = makeData({ frequencySources: sources })
    const { state, meta } = await successfulPreLock(data)
    const gates = createSendGates(data)
    const result = await gates.inLock(inArgs(state, meta))
    expect(result.ok).toBe(true)
  })

  it('a failing source is frequency_unverifiable', async () => {
    const sources = emptySources()
    sources.audit = vi.fn(async () => ({ ok: false as const, error: 'audit down' }))
    const data = makeData({ frequencySources: sources })
    const { state, meta } = await successfulPreLock(data)
    const gates = createSendGates(data)
    const result = await gates.inLock(inArgs(state, meta))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(503)
    expect(result.reason).toBe('frequency_unverifiable')
  })

  it('frequency sources receive the de-duplicated lower-cased addresses', async () => {
    const sources = emptySources()
    const data = makeData({ frequencySources: sources })
    const { state, meta } = await successfulPreLock(data)
    const gates = createSendGates(data)
    await gates.inLock(inArgs(state, meta))
    const expected = ['amy@gmail.com', 'amy.lee@work.com']
    expect(sources.sentItems).toHaveBeenCalledWith(expected, expect.any(String))
    expect(sources.mailchimp).toHaveBeenCalledWith(expected, expect.any(String))
  })

  it('throwing receipts lookup is internal_error', async () => {
    const data = makeData({
      sentTemplateReceiptsSince: vi.fn(async () => {
        throw new Error('db down')
      }),
    })
    const { state, meta } = await successfulPreLock(data)
    const gates = createSendGates(data)
    const result = await gates.inLock(inArgs(state, meta))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(503)
    expect(result.reason).toBe('internal_error')
  })

  it('success returns the meta passed in', async () => {
    const data = makeData()
    const { state, meta } = await successfulPreLock(data)
    const gates = createSendGates(data)
    const result = await gates.inLock(inArgs(state, meta, { config: config({ frequencyCap: null }) }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.meta).toBe(meta)
  })
})

// ---- helpers --------------------------------------------------------------

describe('decideCallBasis', () => {
  it('evidence beats any claim', () => {
    expect(decideCallBasis('none', '2026-10-28T00:00:00Z')).toBe('system_call')
    expect(decideCallBasis('staff_attested', '2026-10-28T00:00:00Z')).toBe('system_call')
  })

  it('staff_attested without evidence stays', () => {
    expect(decideCallBasis('staff_attested', null)).toBe('staff_attested')
  })

  it('other claims without evidence become none', () => {
    expect(decideCallBasis('none', null)).toBe('none')
    expect(decideCallBasis('system_call', null)).toBe('none')
  })
})

describe('computeCallWhen', () => {
  const now = new Date('2026-10-28T02:00:00Z')
  const tz = 'Pacific/Auckland'

  it('same day is today', () => {
    expect(computeCallWhen('system_call', '2026-10-28T00:00:00Z', now, tz)).toBe('today')
  })

  it('previous day is yesterday', () => {
    expect(computeCallWhen('system_call', '2026-10-27T05:00:00Z', now, tz)).toBe('yesterday')
  })

  it('older is recently', () => {
    expect(computeCallWhen('system_call', '2026-10-20T00:00:00Z', now, tz)).toBe('recently')
  })

  it('staff_attested is today', () => {
    expect(computeCallWhen('staff_attested', null, now, tz)).toBe('today')
  })

  it('none is null', () => {
    expect(computeCallWhen('none', null, now, tz)).toBeNull()
  })
})

describe('todayInZone', () => {
  it('rolls over at Auckland midnight', () => {
    expect(todayInZone(new Date('2026-10-27T12:30:00Z'), 'Pacific/Auckland')).toBe('2026-10-28')
  })
})

describe('GATE_MESSAGES', () => {
  it('every reason has a non-empty message', () => {
    const values = Object.values(GATE_MESSAGES)
    expect(values.length).toBeGreaterThan(15)
    for (const message of values) {
      expect(message.length).toBeGreaterThan(0)
    }
  })

  it('emptyMeta has no template or hashes', () => {
    const meta = emptyMeta()
    expect(meta.templateKey).toBeNull()
    expect(meta.renderedSha256).toBeNull()
    expect(meta.finalSha256).toBeNull()
    expect(meta.warnings).toEqual([])
  })
})

// Keep the GateReason import used so the type stays referenced.
const _reasons: readonly GateReason[] = Object.keys(GATE_MESSAGES) as GateReason[]
void _reasons
