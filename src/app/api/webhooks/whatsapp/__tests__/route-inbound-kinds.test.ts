/**
 * Round C4 — dispatch tests for /api/webhooks/whatsapp POST.
 *
 * These tests are about **routing**: given a Meta webhook `field`, which
 * handler does the route call, and which tables does the route itself touch?
 *
 * The three inbound handlers (`storeEcho`, `applyFailedStatus`, and the
 * customer-message path) are mocked here on purpose. The point is not to
 * re-test what those handlers do — it is to prove the route dispatches to the
 * right one, does not dispatch to the wrong one, and does not accidentally
 * write to `conversations` / `conversation_messages` / `contact_touchpoints`
 * on deliveries that are not customer messages.
 *
 * Header mocks/helpers are copied from `__tests__/route.test.ts` so the two
 * files exercise the same wiring (env-secret signing, same supabase fake
 * shape, same `makePost`).
 */

import { createHmac } from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/crm/identity', async (orig) => {
  const actual = await orig<typeof import('@/lib/crm/identity')>()
  return { ...actual, resolveContact: vi.fn() }
})
vi.mock('@/lib/messenger-agent/optout', async (orig) => {
  const actual = await orig<typeof import('@/lib/messenger-agent/optout')>()
  return { ...actual, recordOptOutKeywordTouch: vi.fn() }
})
vi.mock('@/lib/messenger-agent/optout-failures', () => ({ recordOptOutWriteFailure: vi.fn() }))
vi.mock('@/lib/inngest/client', () => ({ inngest: { send: vi.fn() } }))
vi.mock('@/lib/platform-oauth/vocabulary', () => ({
  decryptToken: vi.fn((v: string) => {
    if (v === 'enc:BAD') throw new Error('bad')
    return v.replace(/^enc:/, '')
  }),
}))
vi.mock('@/lib/whatsapp/history-intake', () => ({ storeHistoryChunks: vi.fn() }))
vi.mock('@/lib/whatsapp/unclaimed', () => ({ recordUnclaimedNumber: vi.fn() }))
// The three inbound handlers are spies here: this file tests dispatch, not
// handler internals.
vi.mock('@/lib/whatsapp/inbound-handlers', () => ({
  storeEcho: vi.fn(),
  applyFailedStatus: vi.fn(),
  WHATSAPP_APP_SENDER_NAME: 'x',
}))

import { POST } from '../route'
import { supabaseAdmin } from '@/lib/supabase'
import { resolveContact } from '@/lib/crm/identity'
import { recordOptOutKeywordTouch } from '@/lib/messenger-agent/optout'
import { inngest } from '@/lib/inngest/client'
import { storeEcho, applyFailedStatus } from '@/lib/whatsapp/inbound-handlers'
import { storeHistoryChunks } from '@/lib/whatsapp/history-intake'
import { recordUnclaimedNumber, type UnclaimedKind } from '@/lib/whatsapp/unclaimed'

const mockFrom = vi.mocked(supabaseAdmin.from)
const mockResolveContact = vi.mocked(resolveContact)
const mockRecordOptOutKeywordTouch = vi.mocked(recordOptOutKeywordTouch)
const mockInngestSend = vi.mocked(inngest.send)
const mockStoreEcho = vi.mocked(storeEcho)
const mockApplyFailedStatus = vi.mocked(applyFailedStatus)
const mockStoreHistoryChunks = vi.mocked(storeHistoryChunks)
const mockRecordUnclaimedNumber = vi.mocked(recordUnclaimedNumber)

const SECRET = 'test-app-secret'
const PHONE_NUMBER_ID = '999888777'
const DISPLAY_NUMBER = '64210000000'
const CLIENT_ID = 'client-1'
const CONTACT_ID = 'contact-uuid'
const WA_ID = '64211234567'

function sign(body: string): string {
  return 'sha256=' + createHmac('sha256', SECRET).update(body, 'utf8').digest('hex')
}

function makePost(payload: object, opts: { signature?: string | null; rawBody?: string } = {}) {
  const raw = opts.rawBody ?? JSON.stringify(payload)
  const sig = opts.signature !== undefined ? opts.signature : sign(raw)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (sig !== null) headers['x-hub-signature-256'] = sig
  return new NextRequest('https://me.example.com/api/webhooks/whatsapp', {
    method: 'POST',
    headers,
    body: raw,
  })
}

/** Wrap a single `{ field, value }` change in Meta's envelope. */
function change(field: string | undefined, value: Record<string, unknown>) {
  const withMeta = {
    metadata: { phone_number_id: PHONE_NUMBER_ID, display_phone_number: DISPLAY_NUMBER },
    ...value,
  }
  const changeObj: Record<string, unknown> = { value: withMeta }
  if (field !== undefined) changeObj.field = field
  return { object: 'whatsapp_business_account', entry: [{ id: 'waba', changes: [changeObj] }] }
}

/** Wrap several changes in one delivery. */
function delivery(changes: Record<string, unknown>[]) {
  return { object: 'whatsapp_business_account', entry: [{ id: 'waba', changes }] }
}

function changeObj(field: string | undefined, value: Record<string, unknown>) {
  const withMeta = {
    metadata: { phone_number_id: PHONE_NUMBER_ID, display_phone_number: DISPLAY_NUMBER },
    ...value,
  }
  const obj: Record<string, unknown> = { value: withMeta }
  if (field !== undefined) obj.field = field
  return obj
}

function textMessage(over: Partial<{ id: string; from: string; body: string; timestamp: string }> = {}) {
  return {
    id: over.id ?? 'wamid.CUST',
    from: over.from ?? WA_ID,
    timestamp: over.timestamp ?? '1788336000',
    type: 'text',
    text: { body: over.body ?? '你好' },
  }
}

function echoMessage(over: Partial<{ id: string; from: string; body: string; timestamp: string }> = {}) {
  return {
    id: over.id ?? 'wamid.ECHO',
    from: over.from ?? '64219999999',
    timestamp: over.timestamp ?? '1788336000',
    type: 'text',
    text: { body: over.body ?? 'staff reply' },
  }
}

interface Captured {
  touchedTables: string[]
  filters: Record<string, Record<string, unknown>>
}

/**
 * Minimal per-table fake. `clients` and `whatsapp_app_credentials` return
 * configured results; every other table records that it was touched so a test
 * can assert the route did NOT write to conversations/messages/touchpoints on
 * non-customer deliveries.
 */
function stubDb(
  opts: {
    clientMapped?: boolean
    clientLookupFails?: boolean
  } = {},
): Captured {
  const captured: Captured = { touchedTables: [], filters: {} }

  mockResolveContact.mockResolvedValue({ contactId: CONTACT_ID, created: true, matchedIdentities: 0 })

  mockFrom.mockImplementation((table: string) => {
    captured.touchedTables.push(table)
    let result: unknown = { data: null, error: null }
    const f = (captured.filters[table] ??= {})

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        f[col] = val
        return chain
      },
      lt: (col: string, val: unknown) => {
        f[`__lt_${col}`] = val
        return chain
      },
      is: (col: string, val: unknown) => {
        f[`__is_${col}`] = val
        return chain
      },
      in: (col: string, vals: unknown) => {
        f[`__in_${col}`] = vals
        return chain
      },
      single: async () => result,
      maybeSingle: async () => result,
      update: () => chain,
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
      upsert: () => {
        if (table === 'conversations') {
          result = { data: { id: 'convo-id' }, error: null }
        } else {
          result = { data: null, error: null }
        }
        return chain
      },
    }

    if (table === 'whatsapp_app_credentials') {
      result = { data: [], error: null }
    }

    if (table === 'clients') {
      result = opts.clientLookupFails
        ? { data: null, error: { message: 'column "whatsapp_phone_number_id" does not exist' } }
        : { data: opts.clientMapped === false ? null : { id: CLIENT_ID }, error: null }
    }

    return chain as never
  })

  return captured
}

/** Tables the route must never touch on a non-customer delivery. */
const CUSTOMER_TABLES = ['conversations', 'conversation_messages', 'contact_touchpoints']

function expectNoCustomerTables(captured: Captured) {
  for (const t of CUSTOMER_TABLES) {
    expect(captured.touchedTables).not.toContain(t)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.META_APP_SECRET = SECRET
  process.env.META_VERIFY_TOKEN = 'test-verify-token'
  mockRecordOptOutKeywordTouch.mockResolvedValue({ touchpointId: 'tp-1' })
  mockInngestSend.mockResolvedValue({ ids: ['evt-1'] } as never)
  mockStoreEcho.mockResolvedValue('stored')
  mockApplyFailedStatus.mockResolvedValue('updated')
  mockStoreHistoryChunks.mockResolvedValue({ stored: 1, skipped: 0 })
  mockRecordUnclaimedNumber.mockResolvedValue(undefined)
})

describe('POST — echo dispatch (smb_message_echoes)', () => {
  it('echo → 200, storeEcho called once with the right args, no customer-path side effects', async () => {
    const captured = stubDb()
    const echo = echoMessage()
    const res = await POST(makePost(change('smb_message_echoes', { message_echoes: [echo] })))

    expect(res.status).toBe(200)
    expect(mockStoreEcho).toHaveBeenCalledTimes(1)
    expect(mockStoreEcho).toHaveBeenCalledWith(
      CLIENT_ID,
      { phoneNumberId: PHONE_NUMBER_ID, displayNumber: DISPLAY_NUMBER },
      echo,
    )
    // The route itself must not run the customer-message path for an echo.
    expect(mockInngestSend).not.toHaveBeenCalled()
    expect(mockRecordOptOutKeywordTouch).not.toHaveBeenCalled()
    expect(mockResolveContact).not.toHaveBeenCalled()
    expectNoCustomerTables(captured)
  })

  it('echo handler throws → 503 {received:false}, fixed log text, echo body not logged', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockStoreEcho.mockRejectedValue(new Error('echo blew up'))
    stubDb()

    const echo = echoMessage({ body: 'SECRET-ECHO-BODY' })
    const res = await POST(makePost(change('smb_message_echoes', { message_echoes: [echo] })))

    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ received: false })
    const logged = errorSpy.mock.calls.flat().map(String).join('\n')
    expect(logged).toContain('echo store failed')
    expect(logged).not.toContain('SECRET-ECHO-BODY')

    errorSpy.mockRestore()
  })
})

describe('POST — failed status dispatch (messages/statuses)', () => {
  it('failed status → 200, applyFailedStatus called once with the status', async () => {
    stubDb()
    const status = {
      id: 'wamid.STATUS',
      status: 'failed',
      recipient_id: WA_ID,
      errors: [{ code: 131026, title: 'Message undeliverable' }],
    }
    const res = await POST(makePost(change('messages', { statuses: [status] })))

    expect(res.status).toBe(200)
    expect(mockApplyFailedStatus).toHaveBeenCalledTimes(1)
    expect(mockApplyFailedStatus).toHaveBeenCalledWith(CLIENT_ID, status)
    // No customer-message side effects.
    expect(mockInngestSend).not.toHaveBeenCalled()
  })

  it('status handler throws → 503', async () => {
    mockApplyFailedStatus.mockRejectedValue(new Error('status blew up'))
    stubDb()
    const status = { id: 'wamid.STATUS', status: 'failed', recipient_id: WA_ID }
    const res = await POST(makePost(change('messages', { statuses: [status] })))
    expect(res.status).toBe(503)
  })

  it('messages and statuses in the SAME value → both processed independently', async () => {
    stubDb()
    const msg = textMessage({ id: 'wamid.BOTH' })
    const status = { id: 'wamid.STATUS', status: 'failed', recipient_id: WA_ID }
    const res = await POST(makePost(change('messages', { messages: [msg], statuses: [status] })))

    expect(res.status).toBe(200)
    // The message went through the normal customer path.
    expect(mockInngestSend).toHaveBeenCalledTimes(1)
    // The status was handled too.
    expect(mockApplyFailedStatus).toHaveBeenCalledTimes(1)
  })
})

describe('POST — receipts and declined history', () => {
  it('sent/delivered/read receipts cost no client lookup and no handler call', async () => {
    const captured = stubDb()
    const res = await POST(
      makePost(
        change('messages', {
          statuses: [
            { id: 'wamid.S1', status: 'delivered', recipient_id: WA_ID },
            { id: 'wamid.S2', status: 'read', recipient_id: WA_ID },
          ],
        }),
      ),
    )
    expect(res.status).toBe(200)
    expect(mockApplyFailedStatus).not.toHaveBeenCalled()
    expect(captured.touchedTables).not.toContain('clients')
  })

  it('declined history sharing (errors only, no threads) → 200, there is no data to lose', async () => {
    stubDb()
    const res = await POST(
      makePost(change('history', { history: [{ errors: [{ code: 2593109, title: 'History sync is turned off' }] }] })),
    )
    expect(res.status).toBe(200)
    expect(mockStoreEcho).not.toHaveBeenCalled()
    expect(mockStoreHistoryChunks).not.toHaveBeenCalled()
  })
})

describe('POST — history dispatch', () => {
  it('history with a threads chunk and a mapped client → 200, storeHistoryChunks called once, no customer-path side effects', async () => {
    const captured = stubDb()
    const chunk = { metadata: { phase: 0, chunk_order: 0, progress: 10 }, threads: [] }
    const res = await POST(makePost(change('history', { history: [chunk] })))

    expect(res.status).toBe(200)
    expect(mockStoreHistoryChunks).toHaveBeenCalledTimes(1)
    expect(mockStoreHistoryChunks).toHaveBeenCalledWith(
      CLIENT_ID,
      { phoneNumberId: PHONE_NUMBER_ID, displayNumber: DISPLAY_NUMBER },
      [chunk],
    )
    expect(mockInngestSend).not.toHaveBeenCalled()
    expect(mockRecordOptOutKeywordTouch).not.toHaveBeenCalled()
    expect(mockResolveContact).not.toHaveBeenCalled()
    expectNoCustomerTables(captured)
  })

  it('history intake throws → 503', async () => {
    mockStoreHistoryChunks.mockRejectedValue(new Error('intake blew up'))
    stubDb()
    const chunk = { metadata: { phase: 0, chunk_order: 0, progress: 10 }, threads: [] }
    const res = await POST(makePost(change('history', { history: [chunk] })))
    expect(res.status).toBe(503)
  })

  it('history for an unmapped number → 503, recordUnclaimedNumber called with (number, "history"), intake NOT called', async () => {
    stubDb({ clientMapped: false })
    const chunk = { metadata: { phase: 0, chunk_order: 0, progress: 10 }, threads: [] }
    const res = await POST(makePost(change('history', { history: [chunk] })))

    expect(res.status).toBe(503)
    expect(mockRecordUnclaimedNumber).toHaveBeenCalledWith(PHONE_NUMBER_ID, 'history')
    expect(mockStoreHistoryChunks).not.toHaveBeenCalled()
  })

  it('chunk with no threads and no errors → 503, intake not called', async () => {
    stubDb()
    const res = await POST(makePost(change('history', { history: [{ metadata: { phase: 0 } }] })))

    expect(res.status).toBe(503)
    expect(mockStoreHistoryChunks).not.toHaveBeenCalled()
  })

  it('history media follow-up only (messages[] under field history) → 200, intake not called, no inngest, no opt-out', async () => {
    const captured = stubDb()
    const res = await POST(
      makePost(change('history', { messages: [textMessage({ id: 'wamid.HIST' })] })),
    )

    expect(res.status).toBe(200)
    expect(mockStoreHistoryChunks).not.toHaveBeenCalled()
    expect(mockInngestSend).not.toHaveBeenCalled()
    expect(mockRecordOptOutKeywordTouch).not.toHaveBeenCalled()
    expectNoCustomerTables(captured)
  })

  it('a delivery mixing a valid chunk and an unrecognised chunk → 503 but intake still called for the valid chunk', async () => {
    stubDb()
    const valid = { metadata: { phase: 0, chunk_order: 0, progress: 10 }, threads: [] }
    const unrecognised = { metadata: { phase: 0 } }
    const res = await POST(makePost(change('history', { history: [valid, unrecognised] })))

    expect(res.status).toBe(503)
    expect(mockStoreHistoryChunks).toHaveBeenCalledTimes(1)
    expect(mockStoreHistoryChunks).toHaveBeenCalledWith(
      CLIENT_ID,
      { phoneNumberId: PHONE_NUMBER_ID, displayNumber: DISPLAY_NUMBER },
      [valid],
    )
  })
})

describe('POST — malformed / mismatched field shapes', () => {
  it('smb_message_echoes carrying messages[] → 200, nothing stored, malformed logged', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    stubDb()
    const res = await POST(
      makePost(change('smb_message_echoes', { messages: [textMessage({ id: 'wamid.MISMATCH' })] })),
    )

    expect(res.status).toBe(200)
    expect(mockInngestSend).not.toHaveBeenCalled()
    expect(mockStoreEcho).not.toHaveBeenCalled()
    const logged = errorSpy.mock.calls.flat().map(String).join('\n')
    expect(logged).toContain('malformed change ignored')

    errorSpy.mockRestore()
  })

  it('messages carrying message_echoes[] → 200, storeEcho NOT called', async () => {
    stubDb()
    const res = await POST(
      makePost(change('messages', { message_echoes: [echoMessage({ id: 'wamid.WRONG' })] })),
    )

    expect(res.status).toBe(200)
    expect(mockStoreEcho).not.toHaveBeenCalled()
  })

  it('one malformed change + one valid customer message → 200, valid message IS stored', async () => {
    stubDb()
    const malformed = changeObj('smb_message_echoes', { messages: [textMessage({ id: 'wamid.BAD' })] })
    const valid = changeObj('messages', { messages: [textMessage({ id: 'wamid.GOOD' })] })
    const res = await POST(makePost(delivery([malformed, valid])))

    expect(res.status).toBe(200)
    expect(mockInngestSend).toHaveBeenCalledTimes(1)
    const sent = mockInngestSend.mock.calls[0][0] as { data?: { message_id?: string } }
    expect(sent.data?.message_id).toBe('wamid.GOOD')
  })
})

describe('POST — ignored / legacy shapes', () => {
  it('smb_app_state_sync → 200, nothing called', async () => {
    const captured = stubDb()
    const res = await POST(makePost(change('smb_app_state_sync', { state_sync: [] })))

    expect(res.status).toBe(200)
    expect(mockStoreEcho).not.toHaveBeenCalled()
    expect(mockApplyFailedStatus).not.toHaveBeenCalled()
    expect(mockInngestSend).not.toHaveBeenCalled()
    expectNoCustomerTables(captured)
  })

  it('legacy payload with no field key and messages[] → processed as a customer message', async () => {
    stubDb()
    const res = await POST(makePost(change(undefined, { messages: [textMessage({ id: 'wamid.LEGACY' })] })))

    expect(res.status).toBe(200)
    expect(mockInngestSend).toHaveBeenCalledTimes(1)
    const sent = mockInngestSend.mock.calls[0][0] as { data?: { message_id?: string } }
    expect(sent.data?.message_id).toBe('wamid.LEGACY')
  })
})

describe('POST — client resolution for non-customer deliveries', () => {
  it('unmapped number for an echo → 200, storeEcho not called, "no client mapped" logged', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    stubDb({ clientMapped: false })
    const res = await POST(makePost(change('smb_message_echoes', { message_echoes: [echoMessage()] })))

    expect(res.status).toBe(200)
    expect(mockStoreEcho).not.toHaveBeenCalled()
    const logged = errorSpy.mock.calls.flat().map(String).join('\n')
    expect(logged).toContain('no client mapped')

    errorSpy.mockRestore()
  })

  it('client lookup error for an echo → 503, storeEcho not called', async () => {
    stubDb({ clientLookupFails: true })
    const res = await POST(makePost(change('smb_message_echoes', { message_echoes: [echoMessage()] })))

    expect(res.status).toBe(503)
    expect(mockStoreEcho).not.toHaveBeenCalled()
  })
})

describe('POST — unclaimed-number registry', () => {
  it('unmapped echo → recordUnclaimedNumber(number, "echoes"), still 200', async () => {
    stubDb({ clientMapped: false })
    const res = await POST(makePost(change('smb_message_echoes', { message_echoes: [echoMessage()] })))

    expect(res.status).toBe(200)
    expect(mockRecordUnclaimedNumber).toHaveBeenCalledWith(PHONE_NUMBER_ID, 'echoes')
  })

  it('unmapped customer message → recordUnclaimedNumber(number, "customer_messages"), still 200', async () => {
    stubDb({ clientMapped: false })
    const res = await POST(makePost(change('messages', { messages: [textMessage()] })))

    expect(res.status).toBe(200)
    expect(mockRecordUnclaimedNumber).toHaveBeenCalledWith(PHONE_NUMBER_ID, 'customer_messages')
  })

  it('unmapped failed status → recordUnclaimedNumber(number, "statuses"), still 200', async () => {
    stubDb({ clientMapped: false })
    const status = { id: 'wamid.STATUS', status: 'failed', recipient_id: WA_ID }
    const res = await POST(makePost(change('messages', { statuses: [status] })))

    expect(res.status).toBe(200)
    expect(mockRecordUnclaimedNumber).toHaveBeenCalledWith(PHONE_NUMBER_ID, 'statuses')
  })

  it('client lookup failure does NOT call recordUnclaimedNumber', async () => {
    stubDb({ clientLookupFails: true })
    const res = await POST(makePost(change('messages', { messages: [textMessage()] })))

    expect(res.status).toBe(503)
    expect(mockRecordUnclaimedNumber).not.toHaveBeenCalled()
  })
})

describe('POST — mixed delivery', () => {
  it('echo + customer message in two changes → both handled, 200, stored === 2', async () => {
    stubDb()
    const echoChange = changeObj('smb_message_echoes', { message_echoes: [echoMessage({ id: 'wamid.E1' })] })
    const msgChange = changeObj('messages', { messages: [textMessage({ id: 'wamid.M1' })] })
    const res = await POST(makePost(delivery([echoChange, msgChange])))

    expect(res.status).toBe(200)
    expect(mockStoreEcho).toHaveBeenCalledTimes(1)
    expect(mockInngestSend).toHaveBeenCalledTimes(1)
    expect(await res.json()).toMatchObject({ received: true, stored: 2 })
  })
})
