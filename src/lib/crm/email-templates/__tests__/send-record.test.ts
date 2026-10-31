import { afterEach, describe, expect, it, vi } from 'vitest'
import { outcomeOf, receiptFromResult, recordSendAttempt, type RecordDeps } from '@/lib/crm/email-templates/send-record'
import { validateReceipt } from '@/lib/crm/email-templates/receipt-store'
import { emptyMeta, type SendMeta } from '@/lib/crm/email-templates/send-gates'
import type { SendMailNewResult } from '@/lib/microsoft/mail-send-new'

const CLIENT = 'client-1'
const CONTACT = '11111111-1111-4111-8111-111111111111'
const REQUEST = '22222222-2222-4222-8222-222222222222'
const SHA = 'b'.repeat(64)

function meta(over: Partial<SendMeta> = {}): SendMeta {
  return {
    ...emptyMeta(),
    templateKey: 'post-call-single-tour',
    templateVersion: 3,
    catalogVersion: 7,
    callBasis: 'system_call',
    editedAfterRender: true,
    renderedSha256: SHA,
    finalSha256: SHA,
    mailbox: 'info@cts.example',
    ...over,
  }
}

const sent = (over: Partial<Extract<SendMailNewResult, { ok: true }>> = {}): SendMailNewResult => ({
  ok: true,
  messageId: 'AAMk1',
  conversationId: 'conv-1',
  meta: meta(),
  ...over,
})

const refused = (reason: string, over: Record<string, unknown> = {}): SendMailNewResult =>
  ({ ok: false, status: 409, reason, error: 'x', meta: meta(), ...over }) as SendMailNewResult

const args = (result: SendMailNewResult, requestId: unknown = REQUEST) => ({
  clientId: CLIENT,
  contactId: CONTACT,
  requestId,
  actorEmail: 'lisa@cts.example',
  result,
})

afterEach(() => vi.restoreAllMocks())

describe('outcomeOf', () => {
  it.each([
    ['frequency_cap', 'blocked'],
    ['content_blocked', 'blocked'],
    ['recipient_not_allowed', 'blocked'],
    ['quota', 'blocked'],
    ['busy', 'blocked'],
    ['template_outdated', 'blocked'],
    ['config_invalid', 'blocked'],
    ['graph_failed', 'failed'],
    ['audit_failed', 'failed'],
    ['internal_error', 'failed'],
    ['send_unknown', 'unknown'],
  ])('%s -> %s', (reason, outcome) => {
    expect(outcomeOf(refused(reason)).outcome).toBe(outcome)
    expect(outcomeOf(refused(reason)).reason).toBe(reason)
  })

  it('a successful send is sent, with no reason', () => {
    expect(outcomeOf(sent())).toEqual({ outcome: 'sent', reason: null })
  })
})

describe('receiptFromResult', () => {
  it('writes nothing for legacy-config sends (no meta)', () => {
    expect(receiptFromResult(args(sent({ meta: undefined })))).toBeNull()
    expect(receiptFromResult(args({ ok: false, status: 403, reason: 'disabled', error: 'x' }))).toBeNull()
  })

  it('writes nothing for the replay of an already-sent request, or for a malformed request id', () => {
    expect(receiptFromResult(args(sent({ duplicate: true })))).toBeNull()
    expect(receiptFromResult(args(sent(), 'not-a-uuid'))).toBeNull()
    expect(receiptFromResult(args(sent(), null))).toBeNull()
    expect(receiptFromResult(args(sent(), 42))).toBeNull()
  })

  it('maps a sent message', () => {
    expect(receiptFromResult(args(sent()))).toEqual({
      clientId: CLIENT,
      contactId: CONTACT,
      requestId: REQUEST,
      actorEmail: 'lisa@cts.example',
      templateKey: 'post-call-single-tour',
      templateVersion: 3,
      catalogVersion: 7,
      callBasis: 'system_call',
      outcome: 'sent',
      blockReason: null,
      blockDetail: null,
      mailbox: 'info@cts.example',
      conversationId: 'conv-1',
      providerMessageId: 'AAMk1',
      editedAfterRender: true,
      warnings: [],
      renderedSha256: SHA,
      finalSha256: SHA,
    })
  })

  it('maps a refusal: reason and detail kept, no message / conversation ids', () => {
    const receipt = receiptFromResult(args(refused('frequency_cap', { meta: meta({ blockDetail: 'count=2;next=2026-11-02T00:00:00Z' }) })))
    expect(receipt).toMatchObject({
      outcome: 'blocked',
      blockReason: 'frequency_cap',
      blockDetail: 'count=2;next=2026-11-02T00:00:00Z',
      conversationId: null,
      providerMessageId: null,
    })
  })

  it('keeps long warnings and details inside what the receipt table accepts', () => {
    const long = meta({
      warnings: Array.from({ length: 30 }, (_, i) => `content_warning:${'x'.repeat(100)}${i}`),
      blockDetail: 'd'.repeat(500),
    })
    const receipt = receiptFromResult(args(refused('content_blocked', { meta: long })))
    expect(receipt?.warnings).toHaveLength(20)
    expect(receipt?.warnings.every((w) => w.length <= 60)).toBe(true)
    expect(receipt?.blockDetail?.length).toBe(300)
  })

  it.each([
    ['sent', sent()],
    ['blocked', refused('frequency_cap')],
    ['failed', refused('graph_failed', { status: 502 })],
    ['unknown', refused('send_unknown', { status: 502 })],
    ['failed (internal)', refused('internal_error', { status: 503 })],
  ])('a %s attempt always produces a receipt the table accepts', (_name, result) => {
    const receipt = receiptFromResult(args(result))
    expect(receipt).not.toBeNull()
    expect(validateReceipt(receipt!)).toBeNull()
  })
})

describe('recordSendAttempt', () => {
  function deps(over: Partial<RecordDeps> = {}) {
    const insert = vi.fn(async () => ({ ok: true as const, duplicate: false }))
    const emit = vi.fn(async () => true)
    return { insert, emit, value: { insert, emit, ...over } as RecordDeps }
  }

  it('writes the receipt first, then wakes the workflow', async () => {
    const d = deps()
    await recordSendAttempt(d.value, args(sent()))
    expect(d.insert).toHaveBeenCalledTimes(1)
    expect(d.emit).toHaveBeenCalledTimes(1)
    expect(d.insert.mock.invocationCallOrder[0]).toBeLessThan(d.emit.mock.invocationCallOrder[0])
  })

  it('does nothing at all for legacy sends', async () => {
    const d = deps()
    await recordSendAttempt(d.value, args(sent({ meta: undefined })))
    expect(d.insert).not.toHaveBeenCalled()
    expect(d.emit).not.toHaveBeenCalled()
  })

  it('does not wake the workflow again for a result that was already recorded', async () => {
    const d = deps({ insert: vi.fn(async () => ({ ok: true as const, duplicate: true })) })
    await recordSendAttempt(d.value, args(refused('frequency_cap')))
    expect(d.emit).not.toHaveBeenCalled()
  })

  it('still wakes the workflow when the receipt could not be written (and logs it)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const d = deps({ insert: vi.fn(async () => ({ ok: false as const, message: 'table missing' })) })
    await recordSendAttempt(d.value, args(refused('send_unknown', { status: 502 })))
    expect(d.emit).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalled()
  })

  it('never throws, whatever fails underneath', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const boom = deps({
      insert: vi.fn(async () => {
        throw new Error('db exploded')
      }),
    })
    await expect(recordSendAttempt(boom.value, args(sent()))).resolves.toBeUndefined()
    const boomEmit = deps({
      emit: vi.fn(async () => {
        throw new Error('queue exploded')
      }),
    })
    await expect(recordSendAttempt(boomEmit.value, args(sent()))).resolves.toBeUndefined()
  })
})
