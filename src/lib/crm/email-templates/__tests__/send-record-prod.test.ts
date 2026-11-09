import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  inserted: [] as Array<{ table: string; row: Record<string, unknown> }>,
  emitted: [] as unknown[],
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          state.inserted.push({ table, row })
          return Promise.resolve({ error: null })
        },
      }
    },
  },
}))
vi.mock('@/lib/inngest/crm-email-events', () => ({
  emitSendAttempted: vi.fn(async (receipt: unknown) => {
    state.emitted.push(receipt)
    return true
  }),
}))

import { recordSendAttemptProd } from '@/lib/crm/email-templates/send-record-prod'
import { emptyMeta } from '@/lib/crm/email-templates/send-gates'

const CONTACT = '11111111-1111-4111-8111-111111111111'
const REQUEST = '22222222-2222-4222-8222-222222222222'

beforeEach(() => {
  state.inserted = []
  state.emitted = []
})

describe('recordSendAttemptProd', () => {
  it('writes the receipt row into the receipts table, then wakes the workflow with the same receipt', async () => {
    await recordSendAttemptProd({
      clientId: 'client-1',
      contactId: CONTACT,
      requestId: REQUEST,
      actorEmail: 'lisa@cts.example',
      result: { ok: false, status: 409, reason: 'frequency_cap', error: 'cap', meta: { ...emptyMeta(), mailbox: 'info@cts.example' } },
    })
    expect(state.inserted).toHaveLength(1)
    expect(state.inserted[0].table).toBe('crm_email_send_receipts')
    expect(state.inserted[0].row).toMatchObject({
      client_id: 'client-1',
      contact_id: CONTACT,
      request_id: REQUEST,
      actor_email: 'lisa@cts.example',
      outcome: 'blocked',
      block_reason: 'frequency_cap',
      mailbox: 'info@cts.example',
    })
    expect(state.emitted).toHaveLength(1)
  })

  it('does nothing for a legacy-config result', async () => {
    await recordSendAttemptProd({
      clientId: 'client-1',
      contactId: CONTACT,
      requestId: REQUEST,
      actorEmail: 'lisa@cts.example',
      result: { ok: true, messageId: 'm', conversationId: 'c' },
    })
    expect(state.inserted).toHaveLength(0)
    expect(state.emitted).toHaveLength(0)
  })
})
