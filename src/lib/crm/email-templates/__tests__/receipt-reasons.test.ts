import { describe, expect, it } from 'vitest'
import { validateReceipt } from '@/lib/crm/email-templates/receipt-store'
import type { SendReceipt } from '@/lib/crm/email-templates/types'

function base(overrides: Partial<SendReceipt> = {}): SendReceipt {
  return {
    clientId: 'client-a',
    contactId: '00000000-0000-4000-8000-0000000000a1',
    requestId: '00000000-0000-4000-8000-0000000000b1',
    actorEmail: 'lisa@example.com',
    templateKey: null,
    templateVersion: null,
    catalogVersion: null,
    callBasis: 'none',
    outcome: 'sent',
    blockReason: null,
    blockDetail: null,
    mailbox: null,
    conversationId: null,
    providerMessageId: null,
    editedAfterRender: null,
    warnings: [],
    renderedSha256: null,
    finalSha256: null,
    ...overrides,
  }
}

describe('validateReceipt block_reason rules (match the database check)', () => {
  it('failed may carry a short reason code such as internal_error', () => {
    expect(validateReceipt(base({ outcome: 'failed', blockReason: 'internal_error' }))).toBeNull()
  })

  it('unknown may carry a reason code too', () => {
    expect(validateReceipt(base({ outcome: 'unknown', blockReason: 'send_unknown' }))).toBeNull()
  })

  it('sent must not carry a reason', () => {
    expect(validateReceipt(base({ outcome: 'sent', blockReason: 'oops' }))).not.toBeNull()
  })

  it('blocked must carry a reason', () => {
    expect(validateReceipt(base({ outcome: 'blocked', blockReason: null }))).not.toBeNull()
  })

  it('a reason longer than 60 characters is rejected for failed', () => {
    expect(validateReceipt(base({ outcome: 'failed', blockReason: 'x'.repeat(61) }))).not.toBeNull()
  })
})
