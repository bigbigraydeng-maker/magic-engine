import { describe, expect, it, vi } from 'vitest'
import type { EmailSettings } from '@/lib/crm/email-templates/types'
import type { LoadSettingsResult } from '@/lib/crm/email-templates/settings-store'
import type {
  GateFailure,
  InLockResult,
  MailNewGates,
  PreLockResult,
  SendMeta,
} from '@/lib/crm/email-templates/send-gates'
import type { TemplateRequest } from '@/lib/crm/email-templates/send-gates'
import { sendMailNew } from '../mail-send-new'
import { baseInput, makeFakes, ENABLED, REQUEST_ID } from './mail-send-new-fakes'

type Fakes = ReturnType<typeof makeFakes>

function settings(over: Partial<EmailSettings> = {}): EmailSettings {
  return {
    enabled: true,
    sendMailbox: null,
    allowUnsolicited: false,
    footer: null,
    limits: { perUserPerHour: 30, perUserPerDay: 100, perMailboxPerDay: 200 },
    frequencyCap: null,
    recipientAllowlist: null,
    sameTemplateCooldownHours: 24,
    callPromptHours: 24,
    guardrails: { allowedLinkHosts: [], rules: [] },
    providers: {},
    ...over,
  }
}

function okSettings(over: Partial<EmailSettings> = {}): LoadSettingsResult {
  return { kind: 'ok', version: 1, settings: settings(over) }
}

function withSettings(f: Fakes, result: LoadSettingsResult | (() => Promise<LoadSettingsResult>)): Fakes {
  f.store.loadSettings = vi.fn(typeof result === 'function' ? result : async () => result)
  return f
}

function baseMeta(): SendMeta {
  return {
    templateKey: null,
    templateVersion: null,
    catalogVersion: null,
    callBasis: 'none',
    editedAfterRender: null,
    renderedSha256: null,
    finalSha256: 'f'.repeat(64),
    warnings: [],
    blockDetail: null,
  }
}

function baseState() {
  return { templateKey: null, callEvidenceAt: null, addresses: ['amy@gmail.com'] }
}

interface StubOver {
  preLock?: PreLockResult
  inLock?: InLockResult
}

function stubGates(f: Fakes, over: StubOver = {}): MailNewGates {
  const meta = baseMeta()
  const state = baseState()
  const preLock = vi.fn(async (): Promise<PreLockResult> => {
    f.calls.push('preLock')
    return over.preLock ?? { ok: true, meta, state }
  })
  const inLock = vi.fn(async (a: { meta: SendMeta }): Promise<InLockResult> => {
    f.calls.push('inLock')
    return over.inLock ?? { ok: true, meta: a.meta }
  })
  return { preLock, inLock }
}

function indexOf(f: Fakes, name: string): number {
  return f.calls.indexOf(name)
}

function templateRequest(over: Partial<TemplateRequest> = {}): TemplateRequest {
  return {
    key: 'first-reply',
    version: 1,
    catalogVersion: null,
    picks: [],
    inputs: {},
    callBasis: 'none',
    ...over,
  }
}

describe('sendMailNew gate wiring', () => {
  it('legacy config: gates present but never called, send succeeds', async () => {
    const f = makeFakes({ leadsConfig: ENABLED })
    f.deps.gates = stubGates(f)
    const result = await sendMailNew(baseInput(), f.deps)
    expect(result.ok).toBe(true)
    expect(indexOf(f, 'preLock')).toBe(-1)
    expect(indexOf(f, 'inLock')).toBe(-1)
    expect(indexOf(f, 'sendDraft')).toBeGreaterThanOrEqual(0)
  })

  it('settings kind none: falls back to loadLeadsConfig, gates never called', async () => {
    const f = makeFakes({ leadsConfig: ENABLED })
    withSettings(f, { kind: 'none' })
    f.deps.gates = stubGates(f)
    const result = await sendMailNew(baseInput(), f.deps)
    expect(result.ok).toBe(true)
    expect(f.store.loadLeadsConfig).toHaveBeenCalled()
    expect(indexOf(f, 'preLock')).toBe(-1)
    expect(indexOf(f, 'inLock')).toBe(-1)
  })

  it('settings invalid: 503 config_invalid, no fallback, no Graph', async () => {
    const f = makeFakes({ leadsConfig: ENABLED })
    withSettings(f, { kind: 'invalid', version: 2, errors: ['x'] })
    f.deps.gates = stubGates(f)
    const result = await sendMailNew(baseInput(), f.deps)
    expect(result).toMatchObject({ ok: false, status: 503, reason: 'config_invalid' })
    expect(f.store.loadLeadsConfig).not.toHaveBeenCalled()
    expect(f.graph.createDraft).not.toHaveBeenCalled()
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
    expect(f.graph.whoAmI).not.toHaveBeenCalled()
  })

  it('settings load throws: 503 config_unreadable', async () => {
    const f = makeFakes({ leadsConfig: ENABLED })
    withSettings(f, async () => {
      throw new Error('db down')
    })
    f.deps.gates = stubGates(f)
    const result = await sendMailNew(baseInput(), f.deps)
    expect(result).toMatchObject({ ok: false, status: 503, reason: 'config_unreadable' })
  })

  it('settings disabled: 403 disabled, gates not called', async () => {
    const f = makeFakes()
    withSettings(f, okSettings({ enabled: false }))
    f.deps.gates = stubGates(f)
    const result = await sendMailNew(baseInput(), f.deps)
    expect(result).toMatchObject({ ok: false, status: 403, reason: 'disabled' })
    expect(indexOf(f, 'preLock')).toBe(-1)
    expect(indexOf(f, 'inLock')).toBe(-1)
  })

  it('allowlist excludes recipient: 403 recipient_not_allowed before mailbox/Graph/DNC', async () => {
    const f = makeFakes()
    withSettings(f, okSettings({ recipientAllowlist: ['someone.else@x.com'] }))
    f.deps.gates = stubGates(f)
    const result = await sendMailNew(baseInput(), f.deps)
    expect(result).toMatchObject({ ok: false, status: 403, reason: 'recipient_not_allowed' })
    expect(f.graph.whoAmI).not.toHaveBeenCalled()
    expect(f.store.listActiveMailboxes).not.toHaveBeenCalled()
    expect(f.store.checkDnc).not.toHaveBeenCalled()
    expect(indexOf(f, 'preLock')).toBe(-1)
    expect(indexOf(f, 'inLock')).toBe(-1)
  })

  it('allowlist includes recipient: proceeds and succeeds', async () => {
    const f = makeFakes()
    withSettings(f, okSettings({ recipientAllowlist: ['amy@gmail.com'] }))
    f.deps.gates = stubGates(f)
    const result = await sendMailNew(baseInput(), f.deps)
    expect(result.ok).toBe(true)
    expect(indexOf(f, 'preLock')).toBeGreaterThanOrEqual(0)
    expect(indexOf(f, 'inLock')).toBeGreaterThanOrEqual(0)
  })

  it('order: preLock before lock, inLock after lock and before claim/audit/draft/send', async () => {
    const f = makeFakes()
    withSettings(f, okSettings())
    f.deps.gates = stubGates(f)
    const result = await sendMailNew(baseInput(), f.deps)
    expect(result.ok).toBe(true)
    const pre = indexOf(f, 'preLock')
    const lock = indexOf(f, 'acquireLock')
    const inl = indexOf(f, 'inLock')
    const claim = indexOf(f, 'claim')
    const audit = indexOf(f, 'insertAudit')
    const draft = indexOf(f, 'createDraft')
    const send = indexOf(f, 'sendDraft')
    expect(pre).toBeGreaterThanOrEqual(0)
    expect(lock).toBeGreaterThan(pre)
    expect(inl).toBeGreaterThan(lock)
    expect(claim).toBeGreaterThan(inl)
    expect(audit).toBeGreaterThan(inl)
    expect(draft).toBeGreaterThan(inl)
    expect(send).toBeGreaterThan(inl)
  })

  it('preLock failure: returns its status/reason/error/meta, no lock/claim/audit/draft', async () => {
    const f = makeFakes()
    withSettings(f, okSettings())
    const meta = baseMeta()
    const failure: GateFailure = { ok: false, status: 409, reason: 'content_blocked', error: 'x', meta }
    f.deps.gates = stubGates(f, { preLock: failure })
    const result = await sendMailNew(baseInput(), f.deps)
    expect(result).toMatchObject({ ok: false, status: 409, reason: 'content_blocked', error: 'x' })
    if (!result.ok) expect(result.meta).toBe(meta)
    expect(f.store.acquireContactLock).not.toHaveBeenCalled()
    expect(f.store.claimConversation).not.toHaveBeenCalled()
    expect(f.store.insertAudit).not.toHaveBeenCalled()
    expect(f.graph.createDraft).not.toHaveBeenCalled()
  })

  it('inLock failure: returns its status/reason/error/meta, lock acquired then released, no claim/audit/draft/send', async () => {
    const f = makeFakes()
    withSettings(f, okSettings())
    const meta = baseMeta()
    const failure: GateFailure = { ok: false, status: 409, reason: 'frequency_cap', error: 'y', meta }
    f.deps.gates = stubGates(f, { inLock: failure })
    const result = await sendMailNew(baseInput(), f.deps)
    expect(result).toMatchObject({ ok: false, status: 409, reason: 'frequency_cap', error: 'y' })
    if (!result.ok) expect(result.meta).toBe(meta)
    expect(indexOf(f, 'acquireLock')).toBeGreaterThanOrEqual(0)
    expect(indexOf(f, 'releaseLock')).toBeGreaterThanOrEqual(0)
    expect(f.store.claimConversation).not.toHaveBeenCalled()
    expect(f.store.insertAudit).not.toHaveBeenCalled()
    expect(f.graph.createDraft).not.toHaveBeenCalled()
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
  })

  it('success attaches the meta returned by inLock', async () => {
    const f = makeFakes()
    withSettings(f, okSettings())
    const meta = baseMeta()
    const gates: MailNewGates = {
      preLock: vi.fn(async (): Promise<PreLockResult> => {
        f.calls.push('preLock')
        return { ok: true, meta, state: baseState() }
      }),
      inLock: vi.fn(async (): Promise<InLockResult> => {
        f.calls.push('inLock')
        return { ok: true, meta }
      }),
    }
    f.deps.gates = gates
    const result = await sendMailNew(baseInput(), f.deps)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.meta).toBe(meta)
  })

  it('preLock receives footer separately; createDraft body ends with footer', async () => {
    const f = makeFakes()
    withSettings(f, okSettings({ footer: 'Warm regards, CTS' }))
    const gates = stubGates(f)
    f.deps.gates = gates
    const result = await sendMailNew(baseInput(), f.deps)
    expect(result.ok).toBe(true)
    const preArgs = (gates.preLock as unknown as { mock: { calls: Array<[Record<string, unknown>]> } }).mock.calls[0][0]
    expect(preArgs).toMatchObject({
      clientId: 'client-a',
      contactId: 'contact-1',
      sentByEmail: 'sales@client.co.nz',
      subject: 'Your China trip enquiry',
      footer: 'Warm regards, CTS',
      template: null,
      to: 'amy@gmail.com',
    })
    expect(String(preArgs.body)).not.toContain('Warm regards, CTS')
    const draftArgs = (f.graph.createDraft as unknown as { mock: { calls: Array<[string, { body: string }]> } }).mock.calls[0][1]
    expect(draftArgs.body.endsWith('Warm regards, CTS')).toBe(true)
  })

  it('input.template is forwarded to preLock unchanged; absent becomes null', async () => {
    const f = makeFakes()
    withSettings(f, okSettings())
    const gates = stubGates(f)
    f.deps.gates = gates
    const tpl = templateRequest()
    const result = await sendMailNew(baseInput({ template: tpl }), f.deps)
    expect(result.ok).toBe(true)
    const preArgs = (gates.preLock as unknown as { mock: { calls: Array<[Record<string, unknown>]> } }).mock.calls[0][0]
    expect(preArgs.template).toBe(tpl)

    const f2 = makeFakes()
    withSettings(f2, okSettings())
    const gates2 = stubGates(f2)
    f2.deps.gates = gates2
    const result2 = await sendMailNew(baseInput(), f2.deps)
    expect(result2.ok).toBe(true)
    const preArgs2 = (gates2.preLock as unknown as { mock: { calls: Array<[Record<string, unknown>]> } }).mock.calls[0][0]
    expect(preArgs2.template).toBeNull()
  })

  it('duplicate request returns earlier success without calling gates', async () => {
    const f = makeFakes({
      prior: { auditId: 'audit-0', status: 'sent', messageId: 'msg-0', conversationId: 'conv-0' },
    })
    withSettings(f, okSettings())
    f.deps.gates = stubGates(f)
    const result = await sendMailNew(baseInput({ requestId: REQUEST_ID }), f.deps)
    expect(result).toMatchObject({ ok: true, messageId: 'msg-0', conversationId: 'conv-0', duplicate: true })
    expect(indexOf(f, 'preLock')).toBe(-1)
    expect(indexOf(f, 'inLock')).toBe(-1)
  })

  it('lock unavailable: 409 busy, preLock ran, inLock did not', async () => {
    const f = makeFakes({ lockAvailable: false })
    withSettings(f, okSettings())
    f.deps.gates = stubGates(f)
    const result = await sendMailNew(baseInput(), f.deps)
    expect(result).toMatchObject({ ok: false, status: 409, reason: 'busy' })
    expect(indexOf(f, 'preLock')).toBeGreaterThanOrEqual(0)
    expect(indexOf(f, 'inLock')).toBe(-1)
  })

  it('settings-source client with no gates object still succeeds (production always supplies gates)', async () => {
    const f = makeFakes()
    withSettings(f, okSettings())
    // deps.gates intentionally left undefined
    const result = await sendMailNew(baseInput(), f.deps)
    expect(result.ok).toBe(true)
    expect(indexOf(f, 'sendDraft')).toBeGreaterThanOrEqual(0)
  })
})
