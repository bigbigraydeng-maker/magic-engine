import { describe, expect, it, vi } from 'vitest'
import { loadPostCallState, summariseTemplates } from '@/lib/crm/email-templates/post-call-state'
import type { StoredReceipt } from '@/lib/crm/email-templates/types'
import { makeData, template } from './fixtures'

const NOW = new Date('2026-10-28T02:00:00.000Z')
const base = { clientId: 'client-a', contactId: 'contact-1', callPromptHours: 24, now: NOW }
const CALL_AT = '2026-10-28T00:30:00Z'

const withCall = (over: Record<string, unknown> = {}) =>
  makeData({
    loadContactView: vi.fn(async () => ({ displayName: 'Amy Lee', addresses: ['amy@gmail.com'], callEvidenceAt: CALL_AT })),
    ...over,
  })

describe('summariseTemplates', () => {
  it('keeps only the active templates, sorted by name, without their text', () => {
    const list = summariseTemplates([
      template({ templateKey: 'b-key', name: 'Bravo' }),
      template({ templateKey: 'a-key', name: 'Alpha' }),
      template({ templateKey: 'off-key', name: 'Off', status: 'disabled' }),
    ])
    expect(list.map((t) => t.key)).toEqual(['a-key', 'b-key'])
    expect(Object.keys(list[0]).sort()).toEqual(['factSource', 'key', 'name', 'pickMode', 'version'])
  })
})

describe('loadPostCallState', () => {
  it.each(['disabled', 'invalid', 'unconfigured', 'unreadable'] as const)('when the feature is %s it reveals nothing and reads nothing', async (featureState) => {
    const data = makeData()
    const res = await loadPostCallState({ ...base, featureState, templates: [template()] }, data)
    expect(res).toEqual({ ok: true, state: { featureState, templates: [], callEvidenceAt: null, emailedSinceCall: false } })
    expect(data.loadContactView).not.toHaveBeenCalled()
  })

  it('404 when the contact is not in this client', async () => {
    const data = makeData({ loadContactView: vi.fn(async () => null) })
    expect(await loadPostCallState({ ...base, featureState: 'ready', templates: [] }, data)).toMatchObject({ ok: false, status: 404 })
  })

  it('no system call: templates are offered, no call evidence, nothing else is asked', async () => {
    const data = makeData()
    const res = await loadPostCallState({ ...base, featureState: 'ready', templates: [template()] }, data)
    expect(res.ok && res.state).toMatchObject({ featureState: 'ready', callEvidenceAt: null, emailedSinceCall: false })
    expect(res.ok && res.state.templates).toHaveLength(1)
    expect(data.sentTemplateReceiptsSince).not.toHaveBeenCalled()
    expect(data.frequencySources.touchpoints).not.toHaveBeenCalled()
  })

  it('a system call with no email since: the prompt is on', async () => {
    const data = withCall()
    const res = await loadPostCallState({ ...base, featureState: 'ready', templates: [template()] }, data)
    expect(res.ok && res.state).toMatchObject({ callEvidenceAt: CALL_AT, emailedSinceCall: false })
    expect(data.sentTemplateReceiptsSince).toHaveBeenCalledWith('client-a', 'contact-1', CALL_AT)
    expect(data.frequencySources.touchpoints).toHaveBeenCalledWith('contact-1', CALL_AT)
  })

  it('a template email sent after the call switches the prompt off', async () => {
    const data = withCall({ sentTemplateReceiptsSince: vi.fn(async () => [{ id: 'r1' } as StoredReceipt]) })
    const res = await loadPostCallState({ ...base, featureState: 'ready', templates: [template()] }, data)
    expect(res.ok && res.state.emailedSinceCall).toBe(true)
  })

  it('any outbound email touchpoint after the call switches the prompt off too', async () => {
    const data = withCall()
    vi.mocked(data.frequencySources.touchpoints).mockResolvedValueOnce({
      ok: true,
      items: [{ source: 'touchpoint', id: 'm1', at: '2026-10-28T01:00:00Z', subject: null, address: '' }],
    })
    const res = await loadPostCallState({ ...base, featureState: 'ready', templates: [template()] }, data)
    expect(res.ok && res.state.emailedSinceCall).toBe(true)
  })

  it('a touchpoint source that cannot answer does not hide the prompt', async () => {
    const data = withCall()
    vi.mocked(data.frequencySources.touchpoints).mockResolvedValueOnce({ ok: false, error: 'db down' })
    const res = await loadPostCallState({ ...base, featureState: 'ready', templates: [template()] }, data)
    expect(res.ok && res.state.emailedSinceCall).toBe(false)
  })
})
