import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CRM_EMAIL_SEND_ATTEMPTED,
  buildSendAttemptedEvent,
  crmEmailSendEventId,
  emitSendAttempted,
} from '../crm-email-events'
import { cloudFunctions } from '../functions'
import { WORKER_OWNED_EVENTS } from '../client'
import type { SendReceipt } from '@/lib/crm/email-templates/types'

const CLIENT = 'client-1'
const CONTACT = '11111111-1111-4111-8111-111111111111'
const REQUEST = '22222222-2222-4222-8222-222222222222'
const SHA = 'a'.repeat(64)

function receipt(over: Partial<SendReceipt> = {}): SendReceipt {
  return {
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
    blockDetail: 'internal detail that must not leave the receipt',
    mailbox: 'info@cts.example',
    conversationId: 'conv-1',
    providerMessageId: 'AAMk1',
    editedAfterRender: false,
    warnings: ['content_warning:no-call'],
    renderedSha256: SHA,
    finalSha256: SHA,
    ...over,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('event identity', () => {
  it('is named <domain>.<object>.<verb>', () => {
    expect(CRM_EMAIL_SEND_ATTEMPTED).toBe('crm.email_send.attempted')
    expect(CRM_EMAIL_SEND_ATTEMPTED.split('.')).toHaveLength(3)
  })

  it('has a deterministic id per attempt and outcome (so a replay is de-duplicated)', () => {
    expect(crmEmailSendEventId(receipt())).toBe(`crm_email_send:${CLIENT}:${CONTACT}:${REQUEST}:sent:-`)
    expect(crmEmailSendEventId(receipt({ outcome: 'blocked', blockReason: 'frequency_cap' }))).toBe(
      `crm_email_send:${CLIENT}:${CONTACT}:${REQUEST}:blocked:frequency_cap`,
    )
    expect(crmEmailSendEventId(receipt({ outcome: 'blocked', blockReason: 'frequency_cap' }))).not.toBe(
      crmEmailSendEventId(receipt({ outcome: 'blocked', blockReason: 'quota' })),
    )
  })

  it('is not an event the local worker owns, and exactly one cloud function listens to it', () => {
    expect(WORKER_OWNED_EVENTS).not.toContain(CRM_EMAIL_SEND_ATTEMPTED)
    const listeners = cloudFunctions.filter((fn) => {
      const triggers = (fn as unknown as { opts: { triggers?: { event?: string }[] } }).opts.triggers ?? []
      return triggers.some((t) => t.event === CRM_EMAIL_SEND_ATTEMPTED)
    })
    expect(listeners.map((fn) => fn.id())).toEqual(['cloud-crm-email-send-receipt'])
  })
})

describe('event payload', () => {
  const event = buildSendAttemptedEvent(receipt(), '2026-10-28T02:00:00.000Z')

  it('carries exactly the agreed fields', () => {
    expect(Object.keys(event.data).sort()).toEqual(
      [
        'actor_email',
        'auth_basis',
        'call_basis',
        'catalog_version',
        'client_id',
        'contact_id',
        'conversation_id',
        'created_at',
        'edited_after_render',
        'final_sha256',
        'mailbox',
        'outcome',
        'provider_message_id',
        'rendered_sha256',
        'request_id',
        'template_key',
        'template_version',
        'warnings',
        'block_reason',
      ].sort(),
    )
    expect(event.data.auth_basis).toBe('human_click')
    expect(event.data.created_at).toBe('2026-10-28T02:00:00.000Z')
  })

  it('never carries a message body, a guest address or the internal block detail', () => {
    const json = JSON.stringify(event)
    expect(json).not.toContain('internal detail')
    expect(Object.keys(event.data)).not.toEqual(expect.arrayContaining(['body', 'subject', 'to', 'recipient']))
    // the only address in the payload is the staff member who clicked
    const addresses = json.match(/[\w.+-]+@[\w.-]+/g) ?? []
    expect(new Set(addresses)).toEqual(new Set(['lisa@cts.example', 'info@cts.example']))
  })
})

describe('emitSendAttempted', () => {
  const fixedNow = () => new Date('2026-10-28T02:00:00.000Z')

  it('sends once, with a time-limited fetcher, and reports success', async () => {
    const send = vi.fn(async () => ({ event_ids: ['x'] }))
    expect(await emitSendAttempted(receipt(), { send, now: fixedNow })).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
    const [sent, options] = send.mock.calls[0] as unknown as [{ id: string }, { fetcher: typeof fetch }]
    expect(sent.id).toBe(crmEmailSendEventId(receipt()))

    const fetchMock = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    await options.fetcher('https://inn.gs/e/key', { method: 'POST' })
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(init.signal?.aborted).toBe(false)
  })

  it('retries once after a failure', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('INNGEST_EVENT_SEND_FAILED:500'))
      .mockResolvedValueOnce({ event_ids: ['x'] })
    expect(await emitSendAttempted(receipt(), { send, now: fixedNow })).toBe(true)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('gives up quietly after two failures: logs, returns false, never throws', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const send = vi.fn().mockRejectedValue(new Error('network down'))
    await expect(emitSendAttempted(receipt(), { send, now: fixedNow })).resolves.toBe(false)
    expect(send).toHaveBeenCalledTimes(2)
    expect(log).toHaveBeenCalled()
  })

  it('does not retry when the event key is missing (retrying cannot help)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const send = vi.fn().mockRejectedValue(new Error('INNGEST_EVENT_KEY_MISSING'))
    expect(await emitSendAttempted(receipt(), { send, now: fixedNow })).toBe(false)
    expect(send).toHaveBeenCalledTimes(1)
  })
})
