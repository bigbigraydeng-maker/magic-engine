/**
 * The timeline row of one automated send. It is the bridge to the sales path's weekly cap: written at claim time it
 * makes the cap count the mail; cancelled, it stops counting. The last block pins that contract end to end through
 * the real frequency source and the real "machine or person" check.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

import { touchpointItem } from '@/lib/crm/email-templates/frequency-sources-prod'
import { isAutomatedTouch } from '@/lib/crm/automated-touch'
import { createQueryStub, fail, ok } from '@/lib/crm/email-templates/__tests__/query-stub'
import {
  ME_SEND_SOURCE,
  buildSendTouchpointRow,
  cancelSendTouchpoint,
  sendTouchpointMetadata,
  writeSendTouchpoint,
  type SendTouchpointInput,
} from '../send-touchpoint'

const CLIENT = 'c0000000-0000-4000-8000-000000000001'
const CONTACT = 'c0000000-0000-4000-8000-000000000002'
const SEND = 'c0000000-0000-4000-8000-000000000003'

function input(over: Partial<SendTouchpointInput> = {}): SendTouchpointInput {
  return {
    clientId: CLIENT,
    contactId: CONTACT,
    triggeredSendId: SEND,
    triggerKey: 'welcome',
    occurredAt: '2026-11-11T20:01:00Z',
    summary: 'ME 自动发出：欢迎信',
    ...over,
  }
}

describe('the row', () => {
  it('is one outbound e-mail touchpoint of source me_send, keyed by the send, counted, machine-marked', () => {
    expect(buildSendTouchpointRow(input())).toEqual({
      client_id: CLIENT,
      contact_id: CONTACT,
      channel: 'email',
      direction: 'outbound',
      occurred_at: '2026-11-11T20:01:00.000Z',
      summary: 'ME 自动发出：欢迎信',
      raw: null,
      metadata: {
        automated: true,
        transport: 'resend',
        counts_toward_frequency: true,
        subject_label: 'me_send:welcome',
        triggered_send_id: SEND,
        trigger_key: 'welcome',
        send_state: 'claimed',
      },
      source: ME_SEND_SOURCE,
      source_ref: SEND,
    })
  })

  it('holds no address, subject line or body', () => {
    expect(JSON.stringify(buildSendTouchpointRow(input()))).not.toContain('@')
  })

  it('a cancelled row no longer counts', () => {
    expect(sendTouchpointMetadata(SEND, 'welcome', 'cancelled')).toMatchObject({
      automated: true,
      counts_toward_frequency: false,
      send_state: 'cancelled',
    })
  })
})

describe('writeSendTouchpoint', () => {
  it('upserts on the table key and keeps the first row on a replay', async () => {
    const stub = createQueryStub({ contact_touchpoints: ok(null) })
    expect(await writeSendTouchpoint(stub.db, input())).toEqual({ ok: true })
    const upsert = stub.of('contact_touchpoints').find((c) => c.method === 'upsert')
    expect(upsert?.args[1]).toEqual({ onConflict: 'client_id,source,source_ref', ignoreDuplicates: true })
    expect(upsert?.args[0]).toMatchObject({ source: ME_SEND_SOURCE, source_ref: SEND })
  })

  it('reports a failed write instead of throwing', async () => {
    const stub = createQueryStub({ contact_touchpoints: fail('boom') })
    expect(await writeSendTouchpoint(stub.db, input())).toEqual({ ok: false, error: 'touchpoint write: boom' })
  })

  const BAD: Array<[string, Partial<SendTouchpointInput>]> = [
    ['a client id that is not a uuid', { clientId: 'client-a' }],
    ['a contact id that is not a uuid', { contactId: 'x' }],
    ['a send id that is not a uuid', { triggeredSendId: 'x' }],
    ['a malformed trigger key', { triggerKey: 'Welcome!' }],
    ['a time that is not a time', { occurredAt: 'tomorrow' }],
    ['an empty summary', { summary: '  ' }],
    ['a summary that is too long', { summary: 'x'.repeat(201) }],
  ]
  it.each(BAD)('refuses %s without touching the database', async (_label, over) => {
    const stub = createQueryStub({ contact_touchpoints: ok(null) })
    expect((await writeSendTouchpoint(stub.db, input(over))).ok).toBe(false)
    expect(stub.touched('contact_touchpoints')).toBe(false)
  })
})

describe('cancelSendTouchpoint', () => {
  const args = { clientId: CLIENT, triggeredSendId: SEND, triggerKey: 'welcome' }

  it('turns exactly this send row into a no-longer-counted one', async () => {
    const stub = createQueryStub({ contact_touchpoints: ok([{ id: 't1' }]) })
    expect(await cancelSendTouchpoint(stub.db, args)).toEqual({ ok: true, updated: 1 })
    const calls = stub.of('contact_touchpoints')
    expect(calls.find((c) => c.method === 'update')?.args[0]).toEqual({
      metadata: sendTouchpointMetadata(SEND, 'welcome', 'cancelled'),
    })
    expect(calls).toContainEqual({ table: 'contact_touchpoints', method: 'eq', args: ['client_id', CLIENT] })
    expect(calls).toContainEqual({ table: 'contact_touchpoints', method: 'eq', args: ['source', ME_SEND_SOURCE] })
    expect(calls).toContainEqual({ table: 'contact_touchpoints', method: 'eq', args: ['source_ref', SEND] })
  })

  it('no row to cancel is not an error (nothing was counted)', async () => {
    const stub = createQueryStub({ contact_touchpoints: ok([]) })
    expect(await cancelSendTouchpoint(stub.db, args)).toEqual({ ok: true, updated: 0 })
  })

  it('reports a failed update and refuses malformed ids', async () => {
    const failing = createQueryStub({ contact_touchpoints: fail('boom') })
    expect((await cancelSendTouchpoint(failing.db, args)).ok).toBe(false)
    const untouched = createQueryStub({ contact_touchpoints: ok([]) })
    expect((await cancelSendTouchpoint(untouched.db, { ...args, clientId: 'x' })).ok).toBe(false)
    expect(untouched.touched('contact_touchpoints')).toBe(false)
  })
})

describe('the contract with the sales cap and the "person or machine" check', () => {
  const asRead = (metadata: Record<string, unknown>) => ({ source_ref: SEND, occurred_at: '2026-11-11T20:01:00Z', metadata })

  it('a claimed send counts toward the cap, marked as machine mail with a non-empty subject', () => {
    expect(touchpointItem(asRead(sendTouchpointMetadata(SEND, 'welcome', 'claimed')))).toEqual({
      source: 'touchpoint',
      id: SEND,
      at: '2026-11-11T20:01:00Z',
      subject: 'me_send:welcome',
      address: '',
      automated: true,
    })
  })

  it('a cancelled send does not count', () => {
    expect(touchpointItem(asRead(sendTouchpointMetadata(SEND, 'welcome', 'cancelled')))).toBeNull()
  })

  it('is never read as a person following the guest up, by source or by its own mark', () => {
    expect(isAutomatedTouch(ME_SEND_SOURCE, null)).toBe(true)
    expect(isAutomatedTouch('microsoft_mail', sendTouchpointMetadata(SEND, 'welcome', 'claimed'))).toBe(true)
  })
})
