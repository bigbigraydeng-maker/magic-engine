import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// In-memory table-modelling fake for supabaseAdmin.
//
// Behaviour is keyed on the TABLE and the recorded filters, never on call
// order, so a test that reorders queries still passes. Every `.eq`/`.lt`
// filter is recorded so isolation (client_id scoping) can be asserted.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>

interface TableStore {
  rows: Row[]
}

const tables: Record<string, TableStore> = {}

function resetTables(): void {
  for (const key of Object.keys(tables)) delete tables[key]
}

function table(name: string): TableStore {
  if (!tables[name]) tables[name] = { rows: [] }
  return tables[name]
}

/** Recorded filters for the most recent query, for assertions. */
interface QueryRecord {
  table: string
  filters: Array<{ op: 'eq' | 'lt'; column: string; value: unknown }>
  upsert?: { onConflict?: string; ignoreDuplicates?: boolean; rows: Row[] }
  update?: Row
}

let lastQuery: QueryRecord | null = null
const allQueries: QueryRecord[] = []

function matches(row: Row, filters: QueryRecord['filters']): boolean {
  return filters.every((f) => {
    if (f.op === 'eq') return row[f.column] === f.value
    // lt
    return String(row[f.column]) < String(f.value)
  })
}

/** Table whose single-row selects should fail (set per test, reset in afterEach below). */
let failSelectOn: string | null = null

function makeQuery(tableName: string) {
  const store = table(tableName)
  const record: QueryRecord = { table: tableName, filters: [] }
  lastQuery = record
  allQueries.push(record)

  let mode: 'select' | 'update' | 'upsert' = 'select'
  let updatePatch: Row | null = null
  let upsertRows: Row[] = []
  let upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {}
  let orderCol: string | null = null
  let orderAsc = true
  let limitN: number | null = null

  const api = {
    select(_cols?: string) {
      return api
    },
    eq(column: string, value: unknown) {
      record.filters.push({ op: 'eq', column, value })
      return api
    },
    lt(column: string, value: unknown) {
      record.filters.push({ op: 'lt', column, value })
      return api
    },
    order(column: string, opts?: { ascending?: boolean }) {
      orderCol = column
      orderAsc = opts?.ascending ?? true
      return api
    },
    limit(n: number) {
      limitN = n
      return api
    },
    update(patch: Row) {
      mode = 'update'
      updatePatch = patch
      record.update = patch
      return api
    },
    upsert(rows: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
      mode = 'upsert'
      upsertRows = Array.isArray(rows) ? rows : [rows]
      upsertOpts = opts ?? {}
      record.upsert = {
        onConflict: opts?.onConflict,
        ignoreDuplicates: opts?.ignoreDuplicates,
        rows: upsertRows,
      }
      return api
    },
    async maybeSingle() {
      return resolveSingle()
    },
    async single() {
      return resolveSingle()
    },
    // Thenable so `await query` works for update/upsert without a terminal call.
    then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
      return Promise.resolve(execute()).then(resolve, reject)
    },
  }

  function applyOrderLimit(rows: Row[]): Row[] {
    let out = rows
    if (orderCol) {
      const col = orderCol
      out = [...out].sort((a, b) => {
        const av = String(a[col])
        const bv = String(b[col])
        if (av < bv) return orderAsc ? -1 : 1
        if (av > bv) return orderAsc ? 1 : -1
        return 0
      })
    }
    if (limitN != null) out = out.slice(0, limitN)
    return out
  }

  function execute(): { data: unknown; error: unknown } {
    if (mode === 'update') {
      const patch = updatePatch ?? {}
      for (const row of store.rows) {
        if (matches(row, record.filters)) Object.assign(row, patch)
      }
      return { data: null, error: null }
    }
    if (mode === 'upsert') {
      const conflictCols = (upsertOpts.onConflict ?? '')
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean)
      for (const incoming of upsertRows) {
        const existing = conflictCols.length
          ? store.rows.find((r) => conflictCols.every((c) => r[c] === incoming[c]))
          : undefined
        if (existing) {
          if (!upsertOpts.ignoreDuplicates) Object.assign(existing, incoming)
        } else {
          // Real tables assign `id` by default; the handler re-selects it after an ignoreDuplicates upsert.
          store.rows.push({ id: `${tableName}-${store.rows.length + 1}`, ...incoming })
        }
      }
      return { data: null, error: null }
    }
    // select
    const filtered = store.rows.filter((r) => matches(r, record.filters))
    return { data: applyOrderLimit(filtered), error: null }
  }

  function resolveSingle(): { data: unknown; error: unknown } {
    if (failSelectOn === tableName) return { data: null, error: { message: 'boom' } }
    const { data, error } = execute()
    if (error) return { data: null, error }
    const rows = data as Row[]
    return { data: rows[0] ?? null, error: null }
  }

  return api
}

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (name: string) => makeQuery(name),
  },
}))

// ---------------------------------------------------------------------------
// Identity mock — resolveContact is a spy; buildIdentities stays real.
// ---------------------------------------------------------------------------

vi.mock('@/lib/crm/identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/crm/identity')>()
  return {
    ...actual,
    resolveContact: vi.fn(async () => ({
      contactId: 'contact-1',
      created: true,
      matchedIdentities: 0,
    })),
  }
})

// Inngest must never be called from this module.
vi.mock('@/lib/inngest/client', () => ({
  inngest: {
    send: vi.fn(() => {
      throw new Error('inngest.send must not be called from inbound-handlers')
    }),
  },
}))

import { supabaseAdmin } from '@/lib/supabase'
import { resolveContact } from '@/lib/crm/identity'
import { inngest } from '@/lib/inngest/client'
import {
  storeEcho,
  applyFailedStatus,
  WHATSAPP_APP_SENDER_NAME,
  type OurNumber,
} from '../inbound-handlers'
import type { WhatsAppEcho, WhatsAppStatus } from '../inbound-classify'

const OURS: OurNumber = { phoneNumberId: '111222333', displayNumber: '+64 21 000 0000' }
const CUSTOMER = '64210000001'

function echo(overrides: Partial<WhatsAppEcho> = {}): WhatsAppEcho {
  return {
    id: 'echo-1',
    from: '111222333',
    to: CUSTOMER,
    timestamp: '1700000000',
    type: 'text',
    text: { body: 'hello from the app' },
    ...overrides,
  } as WhatsAppEcho
}

function status(overrides: Partial<WhatsAppStatus> = {}): WhatsAppStatus {
  return {
    id: 'meta-1',
    status: 'failed',
    recipient_id: CUSTOMER,
    ...overrides,
  } as WhatsAppStatus
}

function conversationRows(): Row[] {
  return table('conversations').rows
}
function messageRows(): Row[] {
  return table('conversation_messages').rows
}
function touchpointRows(): Row[] {
  return table('contact_touchpoints').rows
}
function outboundLogRows(): Row[] {
  return table('conversation_outbound_log').rows
}

beforeEach(() => {
  resetTables()
  allQueries.length = 0
  lastQuery = null
  vi.clearAllMocks()
  ;(resolveContact as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    contactId: 'contact-1',
    created: true,
    matchedIdentities: 0,
  })
})

/** An existing WhatsApp thread for CUSTOMER (the customer wrote in earlier). */
function seedConversation(over: Record<string, unknown> = {}): void {
  table('conversations').rows.push({
    id: 'convo-1',
    client_id: 'client-1',
    channel: 'whatsapp',
    conversation_id: CUSTOMER,
    participant_psid: CUSTOMER,
    contact_id: 'contact-1',
    last_message_at: '2000-01-01T00:00:00.000Z',
    last_message_from: 'customer',
    ...over,
  })
}

describe('storeEcho', () => {
  it('stores the echo as an outbound message on the existing conversation', async () => {
    seedConversation()
    const result = await storeEcho('client-1', OURS, echo())
    expect(result).toBe('stored')

    expect(conversationRows()).toHaveLength(1)
    const convo = conversationRows()[0]
    expect(convo.last_message_from).toBe('page')
    expect(convo.last_message_at).toBe(new Date(1700000000 * 1000).toISOString())

    expect(messageRows()).toHaveLength(1)
    const msg = messageRows()[0]
    expect(msg.direction).toBe('outbound')
    expect(msg.sender_name).toBe(WHATSAPP_APP_SENDER_NAME)
    expect(msg.sender_id).toBe(OURS.phoneNumberId)
    expect(msg.body).toBe('hello from the app')

    expect(touchpointRows()).toHaveLength(1)
    expect(touchpointRows()[0].direction).toBe('outbound')
    expect(touchpointRows()[0].metadata).toMatchObject({ origin: 'whatsapp_business_app_echo' })
    expect(resolveContact).not.toHaveBeenCalled()
  })

  it('a number with no existing conversation is skipped — no contact, no conversation, no message', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await storeEcho('client-1', OURS, echo())
    expect(result).toBe('skipped')
    expect(conversationRows()).toHaveLength(0)
    expect(messageRows()).toHaveLength(0)
    expect(touchpointRows()).toHaveLength(0)
    expect(resolveContact).not.toHaveBeenCalled()
    const logged = errSpy.mock.calls.flat().map(String).join(' ')
    expect(logged).toContain('no_existing_conversation')
    expect(logged).not.toContain(CUSTOMER)
    errSpy.mockRestore()
  })

  it('every skip logs a fixed reason and never the number or body', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await storeEcho('client-1', OURS, echo({ from: '999999999' }))
    await storeEcho('client-1', OURS, echo({ type: 'revoke' }))
    const logged = errSpy.mock.calls.flat().map(String).join(' ')
    expect(logged).toContain('sender_not_our_number')
    expect(logged).toContain('revoke_or_edit')
    expect(logged).not.toContain(CUSTOMER)
    expect(logged).not.toContain('999999999')
    errSpy.mockRestore()
  })

  it('a redelivery of a message ME sent through the API never overwrites that row (ignoreDuplicates)', async () => {
    seedConversation()
    table('conversation_messages').rows.push({
      id: 'm-1', conversation_id: 'convo-1', message_id: 'wamid.ECHO1', direction: 'outbound',
      sender_id: OURS.phoneNumberId, sender_name: 'staff@example.com', body: 'sent via ME',
    })
    await storeEcho('client-1', OURS, echo({ id: 'wamid.ECHO1' }))
    const rows = messageRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].sender_name).toBe('staff@example.com')
  })

  it('is idempotent when the same echo is delivered twice', async () => {
    seedConversation()
    await storeEcho('client-1', OURS, echo())
    const second = await storeEcho('client-1', OURS, echo())
    expect(second).toBe('stored')
    expect(messageRows()).toHaveLength(1)
  })

  it('does not move the clock backwards when the echo is older than the customer message', async () => {
    table('conversations').rows.push({
      id: 'convo-1',
      client_id: 'client-1',
      channel: 'whatsapp',
      conversation_id: CUSTOMER,
      participant_psid: CUSTOMER,
      contact_id: 'contact-1',
      last_message_at: '2030-01-01T00:00:00.000Z',
      last_message_from: 'customer',
    })

    await storeEcho('client-1', OURS, echo())

    const convo = conversationRows()[0]
    expect(convo.last_message_at).toBe('2030-01-01T00:00:00.000Z')
    expect(convo.last_message_from).toBe('customer')
    // The message row is still stored.
    expect(messageRows()).toHaveLength(1)
  })

  it('moves the clock forward when the echo is later than the customer message', async () => {
    table('conversations').rows.push({
      id: 'convo-1',
      client_id: 'client-1',
      channel: 'whatsapp',
      conversation_id: CUSTOMER,
      participant_psid: CUSTOMER,
      contact_id: 'contact-1',
      last_message_at: '2020-01-01T00:00:00.000Z',
      last_message_from: 'customer',
    })

    await storeEcho('client-1', OURS, echo())

    const convo = conversationRows()[0]
    expect(convo.last_message_from).toBe('page')
    expect(convo.last_message_at).toBe(new Date(1700000000 * 1000).toISOString())
  })

  it('never upserts an existing conversation and never sets it to customer', async () => {
    table('conversations').rows.push({
      id: 'convo-1',
      client_id: 'client-1',
      channel: 'whatsapp',
      conversation_id: CUSTOMER,
      participant_psid: CUSTOMER,
      contact_id: 'contact-1',
      last_message_at: '2020-01-01T00:00:00.000Z',
      last_message_from: 'customer',
    })

    await storeEcho('client-1', OURS, echo())

    const upserts = allQueries.filter(
      (q) => q.table === 'conversations' && q.upsert,
    )
    expect(upserts).toHaveLength(0)
    expect(conversationRows()[0].last_message_from).not.toBe('customer')
  })

  it('writes no inbound touchpoint and never calls inngest', async () => {
    await storeEcho('client-1', OURS, echo())
    expect(touchpointRows().every((t) => t.direction === 'outbound')).toBe(true)
    expect(inngest.send).not.toHaveBeenCalled()
  })

  it('skips a missing id', async () => {
    expect(await storeEcho('client-1', OURS, echo({ id: '' }))).toBe('skipped')
    expect(messageRows()).toHaveLength(0)
  })

  it('skips when `to` is not digits', async () => {
    expect(await storeEcho('client-1', OURS, echo({ to: '+64 21 000 0001' }))).toBe('skipped')
  })

  it('skips when `to` equals our number', async () => {
    expect(await storeEcho('client-1', OURS, echo({ to: '111222333' }))).toBe('skipped')
  })

  it('skips when `from` is not ours', async () => {
    expect(await storeEcho('client-1', OURS, echo({ from: '999999999' }))).toBe('skipped')
  })

  it('skips type revoke', async () => {
    expect(await storeEcho('client-1', OURS, echo({ type: 'revoke' }))).toBe('skipped')
  })

  it('skips type edit', async () => {
    expect(await storeEcho('client-1', OURS, echo({ type: 'edit' }))).toBe('skipped')
  })

  it('stores when `from` equals our displayNumber with formatting', async () => {
    seedConversation()
    const result = await storeEcho('client-1', OURS, echo({ from: '+64 21 000 0000' }))
    expect(result).toBe('stored')
    expect(messageRows()).toHaveLength(1)
  })

  it('throws on a database error during the message upsert', async () => {
    seedConversation()
    const spy = vi.spyOn(supabaseAdmin, 'from').mockImplementation((name: string) => {
      const q = makeQuery(name)
      if (name === 'conversation_messages') {
        return {
          ...q,
          upsert: () => ({
            then: (resolve: (v: unknown) => void) =>
              Promise.resolve({ data: null, error: { message: 'boom' } }).then(resolve),
          }),
        } as unknown as ReturnType<typeof supabaseAdmin.from>
      }
      return q as unknown as ReturnType<typeof supabaseAdmin.from>
    })

    await expect(storeEcho('client-1', OURS, echo())).rejects.toThrow()
    spy.mockRestore()
  })

  it('does not throw when the touchpoint write fails', async () => {
    seedConversation()
    const spy = vi.spyOn(supabaseAdmin, 'from').mockImplementation((name: string) => {
      const q = makeQuery(name)
      if (name === 'contact_touchpoints') {
        return {
          ...q,
          upsert: () => ({
            then: (_resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
              Promise.reject(new Error('touch boom')).then(undefined, reject),
          }),
        } as unknown as ReturnType<typeof supabaseAdmin.from>
      }
      return q as unknown as ReturnType<typeof supabaseAdmin.from>
    })

    await expect(storeEcho('client-1', OURS, echo())).resolves.toBe('stored')
    spy.mockRestore()
  })

  it('never logs the customer number or body', async () => {
    seedConversation()
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await storeEcho('client-1', OURS, echo())
    for (const call of logSpy.mock.calls) {
      const text = call.map((c) => String(c)).join(' ')
      expect(text).not.toContain(CUSTOMER)
      expect(text).not.toContain('hello from the app')
    }
    logSpy.mockRestore()
  })
})

describe('applyFailedStatus', () => {
  function seedSentRow(overrides: Row = {}): void {
    outboundLogRows().push({
      id: 'log-1',
      client_id: 'client-1',
      conversation_id: 'convo-1',
      meta_message_id: 'meta-1',
      status: 'sent',
      created_at: '2024-01-01T00:00:00.000Z',
      ...overrides,
    })
    conversationRows().push({
      id: 'convo-1',
      client_id: 'client-1',
      channel: 'whatsapp',
      conversation_id: CUSTOMER,
      participant_psid: CUSTOMER,
    })
  }

  it('marks a matching sent row as failed with code and title', async () => {
    seedSentRow()
    const result = await applyFailedStatus('client-1', status({
      errors: [{ code: 131047, title: 'Re-engagement message' }],
    }))
    expect(result).toBe('updated')
    const row = outboundLogRows()[0]
    expect(row.status).toBe('failed')
    expect(String(row.error_message)).toContain('131047')
    expect(String(row.error_message)).toContain('Re-engagement message')
    expect(String(row.error_message)).not.toContain(CUSTOMER)
  })

  it('skips a delivered status', async () => {
    seedSentRow()
    expect(await applyFailedStatus('client-1', status({ status: 'delivered' }))).toBe('skipped')
    expect(outboundLogRows()[0].status).toBe('sent')
  })

  it('skips a read status', async () => {
    seedSentRow()
    expect(await applyFailedStatus('client-1', status({ status: 'read' }))).toBe('skipped')
  })

  it('skips a sent status', async () => {
    seedSentRow()
    expect(await applyFailedStatus('client-1', status({ status: 'sent' }))).toBe('skipped')
  })

  it('skips a row already failed', async () => {
    seedSentRow({ status: 'failed' })
    expect(await applyFailedStatus('client-1', status())).toBe('skipped')
  })

  it('skips an unknown message id', async () => {
    seedSentRow()
    expect(await applyFailedStatus('client-1', status({ id: 'nope' }))).toBe('skipped')
  })

  it('skips and does not update on a recipient mismatch', async () => {
    seedSentRow()
    const result = await applyFailedStatus('client-1', status({ recipient_id: '999999999' }))
    expect(result).toBe('skipped')
    expect(outboundLogRows()[0].status).toBe('sent')
  })

  it('scopes both selects by client_id and the update by status=sent', async () => {
    seedSentRow()
    await applyFailedStatus('client-1', status())

    const logSelect = allQueries.find(
      (q) => q.table === 'conversation_outbound_log' && !q.update,
    )
    expect(logSelect?.filters).toContainEqual({
      op: 'eq',
      column: 'client_id',
      value: 'client-1',
    })

    const convoSelect = allQueries.find((q) => q.table === 'conversations')
    expect(convoSelect?.filters).toContainEqual({
      op: 'eq',
      column: 'client_id',
      value: 'client-1',
    })

    const logUpdate = allQueries.find(
      (q) => q.table === 'conversation_outbound_log' && q.update,
    )
    expect(logUpdate?.filters).toContainEqual({
      op: 'eq',
      column: 'status',
      value: 'sent',
    })
  })

  it('throws on a database error', async () => {
    failSelectOn = 'conversation_outbound_log'
    try {
      await expect(applyFailedStatus('client-1', status())).rejects.toThrow()
    } finally {
      failSelectOn = null
    }
  })
})
