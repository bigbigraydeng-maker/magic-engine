import { describe, expect, it, vi } from 'vitest'
import {
  settleUnknownSend,
  unknownIdsFromEvent,
  type SettleDeps,
  type UnknownSendIds,
} from '@/lib/crm/email-templates/settle-unknown'
import type { StoredReceipt } from '@/lib/crm/email-templates/types'

const CLIENT = 'client-1'
const CONTACT = '11111111-1111-4111-8111-111111111111'
const REQUEST = '22222222-2222-4222-8222-222222222222'
const ids: UnknownSendIds = { clientId: CLIENT, contactId: CONTACT, requestId: REQUEST }

const stored: StoredReceipt = {
  id: 'row-1',
  authBasis: 'human_click',
  createdAt: '2026-10-28T02:00:00Z',
  clientId: CLIENT,
  contactId: CONTACT,
  requestId: REQUEST,
  actorEmail: 'lisa@cts.example',
  templateKey: 'post-call-single-tour',
  templateVersion: 3,
  catalogVersion: 7,
  callBasis: 'system_call',
  outcome: 'unknown',
  blockReason: 'send_unknown',
  blockDetail: 'timed out',
  mailbox: 'info@cts.example',
  conversationId: null,
  providerMessageId: null,
  editedAfterRender: true,
  warnings: ['content_warning:no-call'],
  renderedSha256: 'c'.repeat(64),
  finalSha256: 'd'.repeat(64),
}

function deps(over: Partial<SettleDeps> = {}) {
  const findUnknown = vi.fn(async () => stored as StoredReceipt | null)
  const reconcile = vi.fn(async () => ({ status: 'unresolved' }) as Awaited<ReturnType<SettleDeps['reconcile']>>)
  const insert = vi.fn(async () => ({ ok: true as const, duplicate: false }))
  return { findUnknown, reconcile, insert, value: { findUnknown, reconcile, insert, ...over } as SettleDeps }
}

describe('unknownIdsFromEvent', () => {
  const data = { outcome: 'unknown', client_id: CLIENT, contact_id: CONTACT, request_id: REQUEST }

  it('reads the three ids of an unknown send', () => {
    expect(unknownIdsFromEvent(data)).toEqual(ids)
  })

  it.each([
    ['another outcome', { ...data, outcome: 'sent' }],
    ['no outcome', { ...data, outcome: undefined }],
    ['bad contact id', { ...data, contact_id: 'nope' }],
    ['bad request id', { ...data, request_id: 'nope' }],
    ['empty client id', { ...data, client_id: '' }],
    ['huge client id', { ...data, client_id: 'x'.repeat(100) }],
    ['non-string client id', { ...data, client_id: 5 }],
    ['not an object', 'unknown'],
    ['null', null],
  ])('ignores an event with %s', (_name, input) => {
    expect(unknownIdsFromEvent(input)).toBeNull()
  })
})

describe('settleUnknownSend', () => {
  it('has nothing to settle when no unknown receipt is stored (a forged event changes nothing)', async () => {
    const d = deps({ findUnknown: vi.fn(async () => null) })
    expect(await settleUnknownSend(ids, d.value)).toEqual({ status: 'skipped' })
    expect(d.reconcile).not.toHaveBeenCalled()
    expect(d.insert).not.toHaveBeenCalled()
  })

  it('appends a sent receipt built from the STORED unknown one plus the reconcile result', async () => {
    const d = deps({ reconcile: vi.fn(async () => ({ status: 'sent' as const, messageId: 'AAMk9', conversationId: 'conv-9' })) })
    expect(await settleUnknownSend(ids, d.value)).toEqual({ status: 'sent' })
    expect(d.insert).toHaveBeenCalledTimes(1)
    const written = (d.insert.mock.calls[0] as unknown as [Record<string, unknown>])[0]
    expect(written).toEqual({
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
      conversationId: 'conv-9',
      providerMessageId: 'AAMk9',
      editedAfterRender: true,
      warnings: ['content_warning:no-call'],
      renderedSha256: 'c'.repeat(64),
      finalSha256: 'd'.repeat(64),
    })
    expect(Object.keys(written)).not.toEqual(expect.arrayContaining(['id', 'createdAt', 'authBasis']))
  })

  it('appends a failed receipt when the send turned out not to have happened', async () => {
    const d = deps({ reconcile: vi.fn(async () => ({ status: 'failed' as const })) })
    expect(await settleUnknownSend(ids, d.value)).toEqual({ status: 'failed' })
    expect(d.insert).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed', blockReason: 'reconcile_failed', providerMessageId: null }))
  })

  it('writes nothing while the send is still unresolved', async () => {
    const d = deps()
    expect(await settleUnknownSend(ids, d.value)).toEqual({ status: 'unresolved' })
    expect(d.insert).not.toHaveBeenCalled()
  })

  it('throws (so the workflow retries) when the follow-up receipt cannot be written', async () => {
    const d = deps({
      reconcile: vi.fn(async () => ({ status: 'failed' as const })),
      insert: vi.fn(async () => ({ ok: false as const, message: 'db down' })),
    })
    await expect(settleUnknownSend(ids, d.value)).rejects.toThrow('db down')
  })

  it('treats an already-written follow-up as done', async () => {
    const d = deps({
      reconcile: vi.fn(async () => ({ status: 'failed' as const })),
      insert: vi.fn(async () => ({ ok: true as const, duplicate: true })),
    })
    expect(await settleUnknownSend(ids, d.value)).toEqual({ status: 'failed' })
  })
})
