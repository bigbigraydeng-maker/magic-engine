import { beforeEach, describe, expect, it, vi } from 'vitest'

// Spies that call through: they prove the preview and the real send path use the very same functions.
vi.mock('@/lib/crm/email-templates/gates/content-gates', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/crm/email-templates/gates/content-gates')>()
  return { ...original, evaluateContentGates: vi.fn(original.evaluateContentGates) }
})
vi.mock('@/lib/crm/email-templates/gates/frequency', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/crm/email-templates/gates/frequency')>()
  return { ...original, evaluateFrequency: vi.fn(original.evaluateFrequency) }
})
vi.mock('@/lib/crm/email-templates/render', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/crm/email-templates/render')>()
  return { ...original, renderTemplate: vi.fn(original.renderTemplate) }
})

import { evaluateContentGates } from '@/lib/crm/email-templates/gates/content-gates'
import { evaluateFrequency } from '@/lib/crm/email-templates/gates/frequency'
import { renderTemplate } from '@/lib/crm/email-templates/render'
import { createSendGates } from '@/lib/crm/email-templates/send-gates'
import {
  clearPreviewCache,
  previewTemplate,
  type PreviewArgs,
  type PreviewRequest,
} from '@/lib/crm/email-templates/template-preview'
import type { OutboundItem } from '@/lib/crm/email-templates/gates/types'
import { config, makeData, template, tour } from './fixtures'

const NOW = new Date('2026-10-28T02:00:00.000Z')

function request(over: Partial<PreviewRequest> = {}): PreviewRequest {
  return { key: 'post-call-single-tour', picks: [{ tourId: 't1', departOn: '2027-03-11' }], inputs: {}, callBasis: 'none', ...over }
}

function args(over: Partial<PreviewArgs> = {}): PreviewArgs {
  return {
    clientId: 'client-a',
    contactId: 'contact-1',
    sentByEmail: 'lisa@client.co.nz',
    config: config(),
    request: request(),
    now: NOW,
    ...over,
  }
}

const item = (id: string, at: string): OutboundItem => ({ source: 'sent_items', id, at, subject: `Subject ${id}`, address: 'amy@gmail.com' })

beforeEach(() => {
  clearPreviewCache()
  vi.mocked(evaluateContentGates).mockClear()
  vi.mocked(evaluateFrequency).mockClear()
  vi.mocked(renderTemplate).mockClear()
})

describe('previewTemplate: refusals', () => {
  it.each([
    ['a missing template', null],
    ['a disabled template', template({ status: 'disabled' })],
  ])('409 for %s', async (_name, tpl) => {
    const data = makeData({ loadTemplate: vi.fn(async () => tpl) })
    expect(await previewTemplate(args(), data)).toMatchObject({ ok: false, status: 409, reason: 'template_unavailable' })
  })

  it('404 when the contact is not found', async () => {
    const data = makeData({ loadContactView: vi.fn(async () => null) })
    expect(await previewTemplate(args(), data)).toMatchObject({ ok: false, status: 404 })
  })

  it('503 when the catalog cannot be read (never an empty catalog)', async () => {
    const data = makeData({ loadFacts: vi.fn(async () => ({ ok: false as const, error: 'down' })) })
    expect(await previewTemplate(args(), data)).toMatchObject({ ok: false, status: 503, reason: 'catalog_unreadable' })
  })
})

describe('previewTemplate: rendering and picks', () => {
  it('lists what can be picked before anything is picked, and says what is still missing', async () => {
    const res = await previewTemplate(args({ request: request({ picks: [] }) }), makeData())
    expect(res.ok && res.options.map((o) => o.tourId)).toEqual(['t1'])
    expect(res.ok && res.pickProblem).toBeNull()
    expect(res.ok && res.rendered.missing.length).toBeGreaterThan(0)
  })

  it('renders the picked tour, with the catalog version the panel must send back', async () => {
    const res = await previewTemplate(args({ request: request({ callBasis: 'staff_attested' }) }), makeData())
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.catalogVersion).toBe(7)
    expect(res.template).toMatchObject({ key: 'post-call-single-tour', version: 3, pickMode: 'one' })
    expect(res.rendered.subject).toContain('China Discovery')
    expect(res.rendered.body).toContain('Kia ora Amy')
    expect(res.rendered.body).toContain('Warm regards,\nLisa')
    expect(res.rendered.missing).toEqual([])
    expect(res.blocks).toEqual([])
    expect(res.callBasis).toBe('staff_attested')
  })

  it('hands back the footer the server appends on every send, so the preview is the whole mail', async () => {
    const footer = 'CTS Tours, Auckland\nTo stop hearing from us, reply STOP.'
    const res = await previewTemplate(args({ config: config({ footer }) }), makeData())
    expect(res.ok && res.footer).toBe(footer)
  })

  it('has no footer when none is configured', async () => {
    const res = await previewTemplate(args(), makeData())
    expect(res.ok && res.footer).toBeNull()
  })

  it('runs the red lines on the footer too, as the real send does (a link in the footer to a site that is not allowed)', async () => {
    const res = await previewTemplate(args({ config: config({ footer: 'Unsubscribe: https://evil.com/stop' }) }), makeData())
    expect(res.ok && res.blocks.some((b) => b.code === 'link_host_not_allowed' && b.detail === 'evil.com')).toBe(true)
  })

  it('explains a pick that cannot be used and does not render it', async () => {
    const data = makeData({ loadFacts: vi.fn(async () => ({ ok: true as const, version: 7, tours: [tour({ soldOut: true })] })) })
    const res = await previewTemplate(args(), data)
    expect(res.ok && res.pickProblem).toBeTruthy()
    expect(res.ok && res.rendered.missing.length).toBeGreaterThan(0)
  })
})

describe('previewTemplate: checks', () => {
  it('runs the red lines on the staff member\'s EDITED text, not on the fresh render', async () => {
    const res = await previewTemplate(args({ request: request({ body: 'This tour is visa-free for you.' }) }), makeData())
    expect(res.ok && res.blocks.map((b) => b.ruleId)).toContain('no-visa-free')
    expect(res.ok && res.rendered.body).not.toContain('visa-free')
  })

  it('reports warn-only phrases as warnings, not blocks', async () => {
    const res = await previewTemplate(args({ request: request({ body: 'Please give me a call. Thanks!' }) }), makeData())
    expect(res.ok && res.blocks.some((b) => b.ruleId === 'no-call')).toBe(false)
    expect(res.ok && res.warnings.some((w) => w.ruleId === 'no-call')).toBe(true)
  })

  it('a system call is believed over the browser\'s claim, and fills {{call_when}}', async () => {
    const withCall = makeData({
      loadContactView: vi.fn(async () => ({ displayName: 'Amy Lee', addresses: ['amy@gmail.com'], callEvidenceAt: '2026-10-28T01:00:00Z' })),
    })
    const res = await previewTemplate(args({ request: request({ callBasis: 'none' }) }), withCall)
    expect(res.ok && res.callBasis).toBe('system_call')
    expect(res.ok && res.callEvidenceAt).toBe('2026-10-28T01:00:00Z')
    expect(res.ok && res.rendered.missing).not.toContain('call_when')
    const without = await previewTemplate(args({ request: request({ callBasis: 'none' }) }), makeData())
    expect(without.ok && without.rendered.missing).toContain('call_when')
  })
})

describe('previewTemplate: frequency (read-only)', () => {
  it('is off, and asks no source, when the client has no cap', async () => {
    const data = makeData()
    const res = await previewTemplate(args({ config: config({ frequencyCap: null }) }), data)
    expect(res.ok && res.frequency.state).toBe('off')
    expect(data.frequencySources.sentItems).not.toHaveBeenCalled()
  })

  it('shows the count and the evidence under the cap', async () => {
    const data = makeData()
    vi.mocked(data.frequencySources.sentItems).mockResolvedValueOnce({ ok: true, items: [item('m1', '2026-10-27T01:00:00Z')] })
    const res = await previewTemplate(args(), data)
    expect(res.ok && res.frequency).toMatchObject({ state: 'ok', count: 1, max: 2, windowDays: 7 })
    expect(res.ok && res.frequency.items).toEqual([{ source: 'sent_items', at: '2026-10-27T01:00:00Z', subject: 'Subject m1' }])
  })

  it('shows the cap being reached, with the earliest time he can be written to again', async () => {
    const data = makeData()
    vi.mocked(data.frequencySources.sentItems).mockResolvedValueOnce({
      ok: true,
      items: [item('m1', '2026-10-27T01:00:00Z'), item('m2', '2026-10-27T05:00:00Z')],
    })
    const res = await previewTemplate(args(), data)
    expect(res.ok && res.frequency).toMatchObject({ state: 'capped', count: 2, nextAllowedAt: '2026-11-03T01:00:00.000Z' })
  })

  it('says "cannot count" when a source fails, instead of showing zero', async () => {
    const data = makeData()
    vi.mocked(data.frequencySources.sentItems).mockResolvedValueOnce({ ok: false, error: 'graph down' })
    const res = await previewTemplate(args(), data)
    expect(res.ok && res.frequency).toMatchObject({ state: 'unverifiable', count: null, error: 'graph down' })
  })

  it('counts once per minute per guest: the display is cached for 60 seconds', async () => {
    const data = makeData()
    await previewTemplate(args(), data)
    await previewTemplate(args({ now: new Date(NOW.getTime() + 30_000) }), data)
    expect(data.frequencySources.sentItems).toHaveBeenCalledTimes(1)
    await previewTemplate(args({ now: new Date(NOW.getTime() + 61_000) }), data)
    expect(data.frequencySources.sentItems).toHaveBeenCalledTimes(2)
  })

  it('the cache is per guest, never shared between two guests', async () => {
    const data = makeData()
    await previewTemplate(args({ contactId: 'contact-1' }), data)
    await previewTemplate(args({ contactId: 'contact-2' }), data)
    expect(data.frequencySources.sentItems).toHaveBeenCalledTimes(2)
  })
})

describe('preview and send use the same functions', () => {
  it('both reach the same render, red-line and frequency functions', async () => {
    const data = makeData()
    await previewTemplate(args(), data)
    const afterPreview = {
      render: vi.mocked(renderTemplate).mock.calls.length,
      gates: vi.mocked(evaluateContentGates).mock.calls.length,
      frequency: vi.mocked(evaluateFrequency).mock.calls.length,
    }
    expect(afterPreview).toEqual({ render: 1, gates: 1, frequency: 1 })

    const gates = createSendGates(data)
    const cfg = config()
    const pre = await gates.preLock({
      clientId: 'client-a',
      contactId: 'contact-1',
      sentByEmail: 'lisa@client.co.nz',
      config: cfg,
      subject: 'China Discovery — Best of China: your itinerary',
      body: 'Kia ora Amy,\n\nHere.',
      footer: null,
      template: { key: 'post-call-single-tour', version: 3, catalogVersion: 7, picks: [{ tourId: 't1', departOn: '2027-03-11' }], inputs: {}, callBasis: 'none' },
      to: 'amy@gmail.com',
      now: NOW,
    })
    expect(vi.mocked(renderTemplate).mock.calls.length).toBeGreaterThan(afterPreview.render)
    expect(vi.mocked(evaluateContentGates).mock.calls.length).toBeGreaterThan(afterPreview.gates)
    if (pre.ok) {
      await gates.inLock({ clientId: 'client-a', contactId: 'contact-1', config: cfg, state: pre.state, meta: pre.meta, now: NOW })
      expect(vi.mocked(evaluateFrequency).mock.calls.length).toBeGreaterThan(afterPreview.frequency)
    }
  })
})
