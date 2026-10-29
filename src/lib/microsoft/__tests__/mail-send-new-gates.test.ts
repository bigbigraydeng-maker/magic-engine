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
import { emptyMeta } from '@/lib/crm/email-templates/send-gates'
import { SendStartedError, metaIdFor, reconcileSendRequest, requestIdFromMeta, sendMailNew } from '../mail-send-new'
import { baseInput, makeFakes, ENABLED, REQUEST_ID } from './mail-send-new-fakes'

type Fakes = ReturnType<typeof makeFakes>

// the mailbox the fakes connect by default
const MAILBOX = 'info@client.co.nz'

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
    mailbox: null,
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
    if (!result.ok) expect(result.meta).toEqual({ ...meta, mailbox: MAILBOX })
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
    if (!result.ok) expect(result.meta).toEqual({ ...meta, mailbox: MAILBOX })
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
    if (result.ok) expect(result.meta).toEqual({ ...meta, mailbox: MAILBOX })
  })

  it('settings era: a refusal before the gates still carries meta (so it gets a receipt), without a mailbox yet', async () => {
    const f = makeFakes()
    withSettings(f, okSettings({ recipientAllowlist: ['someone-else@example.com'] }))
    f.deps.gates = stubGates(f)
    const result = await sendMailNew(baseInput(), f.deps)
    expect(result).toMatchObject({ ok: false, status: 403, reason: 'recipient_not_allowed' })
    expect(result.meta).toEqual(emptyMeta())
  })

  it('settings era: invalid settings are refused WITH meta, so the refusal is recorded', async () => {
    const f = makeFakes()
    withSettings(f, { kind: 'invalid', version: 2, errors: ['x'] })
    const result = await sendMailNew(baseInput(), f.deps)
    expect(result).toMatchObject({ ok: false, reason: 'config_invalid' })
    expect(result.meta).toEqual(emptyMeta())
  })

  it('settings era: a refusal after the pre-lock gates carries THEIR meta plus the mailbox', async () => {
    const f = makeFakes({ lockAvailable: false })
    withSettings(f, okSettings())
    const meta = { ...baseMeta(), templateKey: 'post-call', templateVersion: 3, catalogVersion: 7 }
    f.deps.gates = stubGates(f, { preLock: { ok: true, meta, state: baseState() } })
    const result = await sendMailNew(baseInput(), f.deps)
    expect(result).toMatchObject({ ok: false, status: 409, reason: 'busy' })
    expect(result.meta).toEqual({ ...meta, mailbox: MAILBOX })
  })

  it('legacy config: results never carry meta (no receipt, behaviour unchanged)', async () => {
    const f = makeFakes({ leadsConfig: ENABLED })
    const sent = await sendMailNew(baseInput(), f.deps)
    expect(sent.ok).toBe(true)
    expect('meta' in sent).toBe(false)
    const refused = await sendMailNew(baseInput({ expectedRecipient: 'other@example.com' }), makeFakes({ leadsConfig: ENABLED }).deps)
    expect(refused.ok).toBe(false)
    expect('meta' in refused).toBe(false)
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

  it('settings-source client with NO gates wired is refused — the new gates are never silently skipped', async () => {
    const f = makeFakes()
    withSettings(f, okSettings())
    // deps.gates intentionally left undefined
    const result = await sendMailNew(baseInput(), f.deps)
    expect(result).toMatchObject({ ok: false, status: 503, reason: 'internal_error' })
    expect(result.meta).toEqual({ ...emptyMeta(), mailbox: MAILBOX }) // still gets a receipt
    expect(f.store.acquireContactLock).not.toHaveBeenCalled()
    expect(f.store.claimConversation).not.toHaveBeenCalled()
    expect(f.graph.createDraft).not.toHaveBeenCalled()
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
  })

  it('legacy-config client with no gates object carries on exactly as before', async () => {
    const f = makeFakes({ leadsConfig: ENABLED })
    const result = await sendMailNew(baseInput(), f.deps)
    expect(result.ok).toBe(true)
    expect(indexOf(f, 'sendDraft')).toBeGreaterThanOrEqual(0)
  })
})

describe('an exception before the send starts is a refusal; once it has started it is not', () => {
  const dbDown = async (): Promise<never> => {
    throw new Error('db down')
  }

  it('a store read that throws before anything can leave: 503 internal_error, nothing touched, and a meta so the attempt gets a receipt', async () => {
    const f = makeFakes()
    withSettings(f, okSettings())
    f.deps.gates = stubGates(f)
    f.store.findPriorSend = vi.fn(dbDown)
    const result = await sendMailNew(baseInput(), f.deps)
    expect(result).toMatchObject({ ok: false, status: 503, reason: 'internal_error' })
    expect(result.meta).toBeDefined()
    expect(f.store.claimConversation).not.toHaveBeenCalled()
    expect(f.store.insertAudit).not.toHaveBeenCalled()
    expect(f.graph.createDraft).not.toHaveBeenCalled()
  })

  it('a legacy-config client gets the same refusal, without a meta (so still no receipt, as before)', async () => {
    const f = makeFakes({ leadsConfig: ENABLED })
    f.store.findPriorSend = vi.fn(dbDown)
    const result = await sendMailNew(baseInput(), f.deps)
    expect(result).toMatchObject({ ok: false, status: 503, reason: 'internal_error' })
    expect(result.meta).toBeUndefined()
  })

  it('a gate that throws inside the lock is a refusal too, and the lock is released', async () => {
    const f = makeFakes()
    withSettings(f, okSettings())
    const gates = stubGates(f)
    gates.inLock = vi.fn(dbDown)
    f.deps.gates = gates
    const result = await sendMailNew(baseInput(), f.deps)
    expect(result).toMatchObject({ ok: false, status: 503, reason: 'internal_error' })
    expect(f.store.releaseContactLock).toHaveBeenCalled()
    expect(f.graph.createDraft).not.toHaveBeenCalled()
  })

  it('once the send has started an exception still propagates: the caller must record "unknown", not "failed"', async () => {
    const f = makeFakes()
    withSettings(f, okSettings())
    f.deps.gates = stubGates(f)
    f.graph.createDraft = vi.fn(async () => {
      throw new Error('graph exploded')
    })
    await expect(sendMailNew(baseInput(), f.deps)).rejects.toThrow('graph exploded')
    expect(f.store.releaseContactLock).toHaveBeenCalled()
  })

  it('that exception arrives as a SendStartedError carrying the original error and the meta of the attempt (with the mailbox)', async () => {
    const f = makeFakes()
    withSettings(f, okSettings())
    f.deps.gates = stubGates(f)
    const boom = new Error('graph exploded')
    f.graph.createDraft = vi.fn(async () => {
      throw boom
    })
    const caught = await sendMailNew(baseInput(), f.deps).catch((e: unknown) => e)
    expect(caught).toBeInstanceOf(SendStartedError)
    const err = caught as SendStartedError
    expect(err.original).toBe(boom)
    expect(err.meta).toMatchObject({ finalSha256: 'f'.repeat(64), mailbox: MAILBOX })
  })

  it('a legacy-config client gets the same error with no meta (no receipts for them, as before)', async () => {
    const f = makeFakes({ leadsConfig: ENABLED })
    f.graph.createDraft = vi.fn(async () => {
      throw new Error('graph exploded')
    })
    const caught = await sendMailNew(baseInput(), f.deps).catch((e: unknown) => e)
    expect(caught).toBeInstanceOf(SendStartedError)
    expect((caught as SendStartedError).meta).toBeNull()
  })
})

describe('a twin of the same request that finished while this one was still on its way to the lock', () => {
  const sent = { auditId: 'audit-0', status: 'sent' as const, messageId: 'msg-0', conversationId: 'conv-0' }

  // First look (before the lock): nothing yet. Second look (inside the lock): the twin is there.
  function twinAppears(f: Fakes, second: unknown): void {
    let looks = 0
    f.store.findPriorSend = vi.fn(async () => {
      f.calls.push('findPriorSend')
      looks += 1
      if (looks === 1) return null
      if (second instanceof Error) throw second
      return second as typeof sent | null
    })
  }

  it('answers with the twin\'s result and sends nothing again', async () => {
    const f = makeFakes()
    withSettings(f, okSettings())
    f.deps.gates = stubGates(f)
    twinAppears(f, sent)
    const result = await sendMailNew(baseInput(), f.deps)
    expect(result).toMatchObject({ ok: true, messageId: 'msg-0', conversationId: 'conv-0', duplicate: true })
    expect(indexOf(f, 'inLock')).toBe(-1)
    expect(f.store.claimConversation).not.toHaveBeenCalled()
    expect(f.store.insertAudit).not.toHaveBeenCalled()
    expect(f.graph.createDraft).not.toHaveBeenCalled()
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
  })

  it('looks a second time only once it holds both locks, and before the in-lock gates and the claim', async () => {
    const f = makeFakes()
    withSettings(f, okSettings())
    f.deps.gates = stubGates(f)
    twinAppears(f, null)
    await sendMailNew(baseInput(), f.deps)
    const looks = f.calls.map((c, i) => (c === 'findPriorSend' ? i : -1)).filter((i) => i >= 0)
    expect(looks).toHaveLength(2)
    expect(looks[0]).toBeLessThan(indexOf(f, 'acquireLock'))
    expect(looks[1]).toBeGreaterThan(indexOf(f, 'acquireRecipientLock'))
    expect(looks[1]).toBeLessThan(indexOf(f, 'inLock'))
    expect(looks[1]).toBeLessThan(indexOf(f, 'claim'))
    expect(f.store.findPriorSend).toHaveBeenNthCalledWith(2, 'client-a', REQUEST_ID, 'contact-1')
  })

  it('a twin that is still unfinished (pending) is refused, not sent over', async () => {
    const f = makeFakes()
    withSettings(f, okSettings())
    f.deps.gates = stubGates(f)
    twinAppears(f, { ...sent, status: 'pending', messageId: null })
    const result = await sendMailNew(baseInput(), f.deps)
    expect(result).toMatchObject({ ok: false, status: 409, reason: 'duplicate_unfinished' })
    expect(f.graph.createDraft).not.toHaveBeenCalled()
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
  })

  it('a second look that cannot be answered is a refusal (nothing left), and both locks are given back', async () => {
    const f = makeFakes()
    withSettings(f, okSettings())
    f.deps.gates = stubGates(f)
    twinAppears(f, new Error('db down'))
    const result = await sendMailNew(baseInput(), f.deps)
    expect(result).toMatchObject({ ok: false, status: 503, reason: 'internal_error' })
    expect(f.graph.createDraft).not.toHaveBeenCalled()
    expect(f.store.releaseRecipientLock).toHaveBeenCalled()
    expect(f.store.releaseContactLock).toHaveBeenCalled()
  })

  it('a replay of an already sent request is answered as a replay even when the same-template cooldown would now refuse it', async () => {
    const f = makeFakes()
    withSettings(f, okSettings())
    const gates = stubGates(f, { inLock: { ok: false, status: 409, reason: 'duplicate_template', error: 'cooldown', meta: baseMeta() } })
    f.deps.gates = gates
    twinAppears(f, sent)
    const result = await sendMailNew(baseInput(), f.deps)
    expect(result).toMatchObject({ ok: true, duplicate: true })
    expect(gates.inLock).not.toHaveBeenCalled()
  })
})

describe('one send to an address at a time (two contact records can share an address)', () => {
  it('takes the address lock after the contact lock with the chosen address and mailbox, and gives them back in reverse', async () => {
    const f = makeFakes()
    withSettings(f, okSettings())
    f.deps.gates = stubGates(f)
    const result = await sendMailNew(baseInput(), f.deps)
    expect(result.ok).toBe(true)
    expect(f.store.acquireRecipientLock).toHaveBeenCalledWith('client-a', 'amy@gmail.com', MAILBOX)
    expect(f.store.releaseRecipientLock).toHaveBeenCalledWith('client-a', 'amy@gmail.com')
    const order = f.calls.filter((c) => ['acquireLock', 'acquireRecipientLock', 'sendDraft', 'releaseRecipientLock', 'releaseLock'].includes(c))
    expect(order).toEqual(['acquireLock', 'acquireRecipientLock', 'sendDraft', 'releaseRecipientLock', 'releaseLock'])
  })

  it('the address is busy: 409 busy, the contact lock is given back, nothing is checked or sent', async () => {
    const f = makeFakes({ recipientLockAvailable: false })
    withSettings(f, okSettings())
    const gates = stubGates(f)
    f.deps.gates = gates
    const result = await sendMailNew(baseInput(), f.deps)
    expect(result).toMatchObject({ ok: false, status: 409, reason: 'busy' })
    expect(f.store.releaseContactLock).toHaveBeenCalled()
    expect(f.store.releaseRecipientLock).not.toHaveBeenCalled() // it never held that one
    expect(gates.inLock).not.toHaveBeenCalled()
    expect(f.store.claimConversation).not.toHaveBeenCalled()
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
  })

  it('the contact is busy: the address lock is never even asked for', async () => {
    const f = makeFakes({ lockAvailable: false })
    withSettings(f, okSettings())
    f.deps.gates = stubGates(f)
    const result = await sendMailNew(baseInput(), f.deps)
    expect(result).toMatchObject({ ok: false, reason: 'busy' })
    expect(f.store.acquireRecipientLock).not.toHaveBeenCalled()
  })

  it('a failed send gives the address lock back as well', async () => {
    const f = makeFakes({ sendOutcome: 'rejected' })
    withSettings(f, okSettings())
    f.deps.gates = stubGates(f)
    const result = await sendMailNew(baseInput(), f.deps)
    expect(result).toMatchObject({ ok: false, reason: 'graph_failed' })
    expect(f.store.releaseRecipientLock).toHaveBeenCalledTimes(1)
    expect(f.store.releaseContactLock).toHaveBeenCalledTimes(1)
  })

  it('a send whose outcome is unknown still gives both locks back', async () => {
    const f = makeFakes({ sendOutcome: 'unknown' })
    withSettings(f, okSettings())
    f.deps.gates = stubGates(f)
    const result = await sendMailNew(baseInput(), f.deps)
    expect(result).toMatchObject({ ok: false, reason: 'send_unknown' })
    expect(f.store.releaseRecipientLock).toHaveBeenCalledTimes(1)
    expect(f.store.releaseContactLock).toHaveBeenCalledTimes(1)
  })

  it('an address lock that cannot be asked for is a refusal (nothing left) and the contact lock is given back', async () => {
    const f = makeFakes()
    withSettings(f, okSettings())
    f.deps.gates = stubGates(f)
    f.store.acquireRecipientLock = vi.fn(async () => {
      throw new Error('db down')
    })
    const result = await sendMailNew(baseInput(), f.deps)
    expect(result).toMatchObject({ ok: false, status: 503, reason: 'internal_error' })
    expect(f.store.releaseContactLock).toHaveBeenCalledTimes(1)
    expect(f.graph.createDraft).not.toHaveBeenCalled()
  })

  it('legacy-config clients are covered too', async () => {
    const f = makeFakes({ leadsConfig: ENABLED, recipientLockAvailable: false })
    const result = await sendMailNew(baseInput(), f.deps)
    expect(result).toMatchObject({ ok: false, status: 409, reason: 'busy' })
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
  })
})

describe('requestIdFromMeta', () => {
  it('reads the request id out of every audit meta shape, and nothing else', () => {
    expect(requestIdFromMeta(`req:${REQUEST_ID}`)).toBe(REQUEST_ID)
    expect(requestIdFromMeta(`req:${REQUEST_ID}|draft:AAMk1`)).toBe(REQUEST_ID)
    expect(requestIdFromMeta(`req:${REQUEST_ID}|msg:AAMk1`)).toBe(REQUEST_ID)
    expect(requestIdFromMeta(metaIdFor(REQUEST_ID, 'msg', 'AAMk1'))).toBe(REQUEST_ID)
    expect(requestIdFromMeta(null)).toBeNull()
    expect(requestIdFromMeta('')).toBeNull()
    expect(requestIdFromMeta('draft:AAMk1')).toBeNull()
    expect(requestIdFromMeta('req:not-a-uuid|draft:AAMk1')).toBeNull()
    expect(requestIdFromMeta(` req:${REQUEST_ID}`)).toBeNull()
  })
})

describe('reconcileSendRequest', () => {
  const args = { clientId: 'client-a', contactId: 'contact-1', requestId: REQUEST_ID }
  const PRIOR_SENT = { auditId: 'a1', status: 'sent' as const, messageId: 'AAMk1', conversationId: 'conv-1' }

  it('reports a request that turned out to be sent', async () => {
    const f = makeFakes({ prior: PRIOR_SENT })
    withSettings(f, okSettings())
    expect(await reconcileSendRequest(args, f.deps)).toEqual({ status: 'sent', messageId: 'AAMk1', conversationId: 'conv-1' })
    expect(f.store.findPriorSend).toHaveBeenCalledWith('client-a', REQUEST_ID, 'contact-1')
  })

  it('reports a request that failed', async () => {
    const f = makeFakes({ prior: { ...PRIOR_SENT, status: 'failed', messageId: null } })
    withSettings(f, okSettings())
    expect(await reconcileSendRequest(args, f.deps)).toEqual({ status: 'failed' })
  })

  it('stays unresolved while the audit row is still pending', async () => {
    const f = makeFakes({ prior: { ...PRIOR_SENT, status: 'pending', messageId: null } })
    withSettings(f, okSettings())
    expect(await reconcileSendRequest(args, f.deps)).toEqual({ status: 'unresolved' })
  })

  it('stays unresolved when there is no audit row for the request (never guesses)', async () => {
    const f = makeFakes({ prior: null })
    withSettings(f, okSettings())
    expect(await reconcileSendRequest(args, f.deps)).toEqual({ status: 'unresolved' })
  })

  it('reconciles the contact\'s pending drafts first, so a draft that has left Drafts becomes sent', async () => {
    const f = makeFakes({
      prior: { ...PRIOR_SENT, status: 'pending', messageId: null },
      pending: [{ auditId: 'a1', draftId: 'draft-1', createdAt: '2026-10-20T00:00:00Z' }],
      isStillDraft: { 'draft-1': false },
    })
    withSettings(f, okSettings())
    await reconcileSendRequest(args, f.deps)
    expect(f.store.patchAudit).toHaveBeenCalledWith('a1', { status: 'sent' })
  })

  it('writes the message id into the audit row when a pending draft turns out to have been sent', async () => {
    const f = makeFakes({
      prior: { ...PRIOR_SENT, status: 'pending', messageId: null },
      pending: [{ auditId: 'a1', draftId: 'draft-1', createdAt: '2026-10-20T00:00:00Z', requestId: REQUEST_ID }],
      isStillDraft: { 'draft-1': false },
    })
    withSettings(f, okSettings())
    await reconcileSendRequest(args, f.deps)
    expect(f.store.patchAudit).toHaveBeenCalledWith('a1', { status: 'sent', metaMessageId: `req:${REQUEST_ID}|msg:draft-1` })
  })

  it('a timed-out send that really went out settles as sent with its message id, and a retry still sees it', async () => {
    const f = makeFakes({ isStillDraft: { 'draft-1': false } })
    withSettings(f, okSettings())
    // One audit row, exactly as finishSend leaves it after an `unknown` outcome (still pending, draft id only).
    const row = { id: 'a1', status: 'pending' as 'pending' | 'sent' | 'failed', meta: `req:${REQUEST_ID}|draft:draft-1`, createdAt: '2026-10-20T00:00:00Z' }
    f.store.listPendingDrafts = vi.fn(async () =>
      row.status === 'pending' ? [{ auditId: row.id, draftId: 'draft-1', createdAt: row.createdAt, requestId: requestIdFromMeta(row.meta) }] : [],
    )
    f.store.patchAudit = vi.fn(async (_id, patch) => {
      if (patch.status) row.status = patch.status
      if (patch.metaMessageId) row.meta = patch.metaMessageId
    })
    // Same reading as the production store: the message id is whatever follows `|msg:`.
    f.store.findPriorSend = vi.fn(async () => ({
      auditId: row.id,
      status: row.status,
      messageId: /\|msg:(.+)$/.exec(row.meta)?.[1] ?? null,
      conversationId: 'conv-1',
    }))
    const settled = { status: 'sent', messageId: 'draft-1', conversationId: 'conv-1' }
    expect(await reconcileSendRequest(args, f.deps)).toEqual(settled)
    // The retry: the row is no longer pending, so nothing is reconciled again, and the answer must not change.
    expect(await reconcileSendRequest(args, f.deps)).toEqual(settled)
  })

  it('is unresolved (and touches no draft) when the settings or the mailbox cannot be resolved', async () => {
    const noBox = makeFakes({ mailboxes: [] })
    withSettings(noBox, okSettings())
    expect(await reconcileSendRequest(args, noBox.deps)).toEqual({ status: 'unresolved' })
    const bad = makeFakes()
    withSettings(bad, { kind: 'invalid', version: 1, errors: ['x'] })
    expect(await reconcileSendRequest(args, bad.deps)).toEqual({ status: 'unresolved' })
    expect(bad.graph.isStillDraft).not.toHaveBeenCalled()
  })
})
