// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn(() => { throw new Error('no database in these tests') }) } }))

import { CRM_PROVIDER_EVENT_RECEIVED } from '@/lib/messaging/provider-events/events'
import type { LoadedReceipt, ReceiptStore } from '@/lib/messaging/triggered-send/receipt-consumer'
import { cloudFunctions } from '../index'
import {
  IN_FLIGHT_ATTEMPTS,
  IN_FLIGHT_WAIT,
  TRIGGERED_SEND_PROVIDER_EVENT_ID,
  runProviderEventReceipt,
  triggeredSendProviderEvent,
  type ReceiptRunDeps,
  type ReceiptStepTools,
} from '../triggered-send-provider-event'

const DATA = { provider: 'resend', account: 'system', provider_event_id: 'msg_1' }
const LOADED: LoadedReceipt = {
  facts: { type: 'email.delivered', messageId: 'em_1', occurredAt: null, emailCreatedAt: null, bounceKind: null },
  tagSendId: null,
  toFingerprints: ['a'.repeat(64)],
}

function steps() {
  const ran: string[] = []
  const slept: Array<[string, string]> = []
  const tools: ReceiptStepTools = {
    run: async (id, fn) => {
      ran.push(id)
      return fn()
    },
    sleep: async (id, duration) => {
      slept.push([id, duration])
    },
  }
  return { tools, ran, slept }
}

const untouched = async (): Promise<never> => {
  throw new Error('the runner must not use the store itself: applyReceipt (scripted here) does')
}
/** The runner never touches the store directly: apply goes through applyReceipt, which these tests script. */
const NO_STORE: ReceiptStore = {
  findByMessageId: untouched,
  findById: untouched,
  findUnboundByAddress: untouched,
  updateIfUnchanged: untouched,
  recordUnsubscribe: untouched,
}

function deps(load: LoadedReceipt | null): ReceiptRunDeps {
  return { load: async () => load, store: NO_STORE, now: () => new Date('2026-11-10T02:00:00.000Z') }
}

vi.mock('@/lib/messaging/triggered-send/receipt-consumer', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/messaging/triggered-send/receipt-consumer')>()
  return { ...original, applyReceipt: vi.fn() }
})
const consumer = await import('@/lib/messaging/triggered-send/receipt-consumer')
const applyReceipt = vi.mocked(consumer.applyReceipt)

describe('cloud-triggered-send-provider-event', () => {
  it('is registered under the cloud prefix and listens to the receipt wake-up event', () => {
    expect(TRIGGERED_SEND_PROVIDER_EVENT_ID).toBe('cloud-triggered-send-provider-event')
    expect(cloudFunctions).toContain(triggeredSendProviderEvent)
    expect(CRM_PROVIDER_EVENT_RECEIVED).toBe('crm.provider_event.received')
  })

  it('a malformed event is skipped before anything is read', async () => {
    const s = steps()
    const out = await runProviderEventReceipt({ provider: 'resend' }, s.tools, deps(LOADED))
    expect(out).toMatchObject({ outcome: 'skipped' })
    expect(s.ran).toEqual([])
  })

  it('a missing stored receipt or a type the ledger does not follow ends after the read', async () => {
    const missing = steps()
    expect(await runProviderEventReceipt(DATA, missing.tools, deps(null))).toEqual({ outcome: 'event_missing' })
    expect(missing.ran).toEqual(['load-event'])
    const other = steps()
    expect(await runProviderEventReceipt(DATA, other.tools, deps({ ...LOADED, facts: null }))).toEqual({ outcome: 'not_a_receipt' })
    expect(other.ran).toEqual(['load-event'])
  })

  it('one apply step for a receipt that matches (or that is not ours)', async () => {
    applyReceipt.mockReset()
    applyReceipt.mockResolvedValueOnce({ outcome: 'not_ours' })
    const s = steps()
    expect(await runProviderEventReceipt(DATA, s.tools, deps(LOADED))).toEqual({ outcome: 'not_ours' })
    expect(s.ran).toEqual(['load-event', 'apply-1'])
    expect(s.slept).toEqual([])
    expect(applyReceipt.mock.calls[0][2]).toMatchObject({ bindPending: false })
  })

  it('a letter still in flight is waited for, and only the last try may bind it by address', async () => {
    applyReceipt.mockReset()
    for (let i = 0; i < IN_FLIGHT_ATTEMPTS - 1; i++) applyReceipt.mockResolvedValueOnce({ outcome: 'in_flight', sendId: 's1' })
    applyReceipt.mockResolvedValueOnce({ outcome: 'applied', sendId: 's1', status: 'sent' })
    const s = steps()
    expect(await runProviderEventReceipt(DATA, s.tools, deps(LOADED))).toEqual({ outcome: 'applied', sendId: 's1', status: 'sent' })
    expect(s.ran).toEqual(['load-event', 'apply-1', 'apply-2', 'apply-3', 'apply-4'])
    expect(s.slept).toEqual([
      ['wait-1', IN_FLIGHT_WAIT],
      ['wait-2', IN_FLIGHT_WAIT],
      ['wait-3', IN_FLIGHT_WAIT],
    ])
    expect(applyReceipt.mock.calls.map((c) => c[2].bindPending)).toEqual([false, false, false, true])
  })

  it('step results hold no address (they are stored by Inngest)', async () => {
    applyReceipt.mockReset()
    applyReceipt.mockResolvedValueOnce({ outcome: 'applied', sendId: 's1', status: 'delivered' })
    const results: unknown[] = []
    const tools: ReceiptStepTools = {
      run: async (_id, fn) => {
        const r = await fn()
        results.push(r)
        return r
      },
      sleep: async () => undefined,
    }
    await runProviderEventReceipt(DATA, tools, deps(LOADED))
    expect(JSON.stringify(results)).not.toContain('@')
  })
})
