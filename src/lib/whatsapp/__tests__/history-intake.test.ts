import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Table-modelling fake of `@/lib/supabase`.
 *
 * It keeps an in-memory row store per table and implements `upsert` with
 * `onConflict` + `ignoreDuplicates`, recording every batch so tests can assert
 * batching. `failNext` forces the next upsert to return an error.
 */
const fake = vi.hoisted(() => {
  interface Batch {
    table: string
    rows: Record<string, unknown>[]
  }
  interface State {
    rows: Map<string, Record<string, unknown>[]>
    batches: Batch[]
    failNext: boolean
    reset: () => void
  }
  const state: State = {
    rows: new Map(),
    batches: [],
    failNext: false,
    reset() {
      state.rows = new Map()
      state.batches = []
      state.failNext = false
    },
  }
  function keyFor(row: Record<string, unknown>, cols: string[]): string {
    return cols.map((c) => String(row[c])).join('\u0000')
  }
  const supabaseAdmin = {
    from(table: string) {
      return {
        upsert(
          batch: Record<string, unknown>[],
          opts: { onConflict: string; ignoreDuplicates?: boolean },
        ): Promise<{ error: { message: string } | null }> {
          if (state.failNext) {
            state.failNext = false
            return Promise.resolve({ error: { message: 'boom' } })
          }
          state.batches.push({ table, rows: batch })
          const cols = opts.onConflict.split(',').map((s) => s.trim())
          const existing = state.rows.get(table) ?? []
          const seen = new Set(existing.map((r) => keyFor(r, cols)))
          for (const row of batch) {
            const k = keyFor(row, cols)
            if (opts.ignoreDuplicates && seen.has(k)) continue
            existing.push(row)
            seen.add(k)
          }
          state.rows.set(table, existing)
          return Promise.resolve({ error: null })
        },
      }
    },
  }
  return { state, supabaseAdmin }
})

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: fake.supabaseAdmin }))

import { storeHistoryChunks, HISTORY_INSERT_BATCH } from '../history-intake'

const OUR_PNID = '1234567890'
const OUR_DISPLAY = '+64 21 000 0000'
const CUSTOMER = '64211111111'
const OTHER = '64222222222'

const TABLE = 'whatsapp_history_inbox'

function rows(): Record<string, unknown>[] {
  return fake.state.rows.get(TABLE) ?? []
}

beforeEach(() => {
  fake.state.reset()
})

describe('storeHistoryChunks', () => {
  it('stores customer and business messages with correct directions and only allowed keys', async () => {
    const chunks = [
      {
        metadata: { phase: 1, chunk_order: 2 },
        threads: [
          {
            id: CUSTOMER,
            messages: [
              { id: 'wamid.c1', from: CUSTOMER, timestamp: '1700000000', type: 'text' },
              { id: 'wamid.b1', from: OUR_PNID, timestamp: '1700000001', type: 'image' },
            ],
          },
        ],
      },
    ]
    const res = await storeHistoryChunks(
      'client-1',
      { phoneNumberId: OUR_PNID, displayNumber: OUR_DISPLAY },
      chunks,
    )
    expect(res).toEqual({ stored: 2, skipped: 0 })

    const stored = rows()
    expect(stored).toHaveLength(2)

    const allowed = [
      'client_id',
      'phone_number_id',
      'customer_wa_id',
      'message_id',
      'direction',
      'msg_type',
      'sent_at',
      'history_status',
      'phase',
      'chunk_order',
    ]
    for (const row of stored) {
      expect(Object.keys(row).sort()).toEqual([...allowed].sort())
    }

    const byId = new Map(stored.map((r) => [r.message_id, r]))
    expect(byId.get('wamid.c1')!.direction).toBe('customer')
    expect(byId.get('wamid.b1')!.direction).toBe('business')
  })

  it('treats a formatted display number as business', async () => {
    const chunks = [
      {
        threads: [
          {
            id: CUSTOMER,
            messages: [{ id: 'wamid.x', from: '+64 21 000 0000', timestamp: '1700000000' }],
          },
        ],
      },
    ]
    const res = await storeHistoryChunks(
      'client-1',
      { phoneNumberId: OUR_PNID, displayNumber: OUR_DISPLAY },
      chunks,
    )
    expect(res.stored).toBe(1)
    expect(rows()[0].direction).toBe('business')
  })

  it('skips a message with an unknown from and never defaults to customer', async () => {
    const chunks = [
      {
        threads: [
          {
            id: CUSTOMER,
            messages: [{ id: 'wamid.u', from: OTHER, timestamp: '1700000000' }],
          },
        ],
      },
    ]
    // Nothing storable in a delivery that did contain messages -> refuse (503) so Meta redelivers.
    await expect(storeHistoryChunks('client-1', { phoneNumberId: OUR_PNID }, chunks)).rejects.toThrow('none could be stored')
    expect(rows()).toHaveLength(0)
  })

  it('skips a message with NO `from` at all and never defaults to customer', async () => {
    const chunks = [{ threads: [{ id: CUSTOMER, messages: [{ id: 'wamid.nofrom', timestamp: '1700000000' }] }] }]
    // Nothing storable in a delivery that did contain messages -> refuse (503) so Meta redelivers.
    await expect(storeHistoryChunks('client-1', { phoneNumberId: OUR_PNID }, chunks)).rejects.toThrow('none could be stored')
    expect(rows()).toHaveLength(0)
  })

  it('skips a thread whose id is our own number', async () => {
    const chunks = [
      {
        threads: [
          {
            id: OUR_PNID,
            messages: [{ id: 'wamid.a', from: CUSTOMER, timestamp: '1700000000' }],
          },
        ],
      },
    ]
    // Nothing storable in a delivery that did contain messages -> refuse (503) so Meta redelivers.
    await expect(storeHistoryChunks('client-1', { phoneNumberId: OUR_PNID }, chunks)).rejects.toThrow('none could be stored')
  })

  it('skips a thread with a bad id', async () => {
    const chunks = [
      {
        threads: [
          {
            id: 'abc',
            messages: [{ id: 'wamid.a', from: CUSTOMER, timestamp: '1700000000' }],
          },
        ],
      },
    ]
    // Nothing storable in a delivery that did contain messages -> refuse (503) so Meta redelivers.
    await expect(storeHistoryChunks('client-1', { phoneNumberId: OUR_PNID }, chunks)).rejects.toThrow('none could be stored')
  })

  it('skips a message with no id', async () => {
    const chunks = [
      {
        threads: [
          {
            id: CUSTOMER,
            messages: [{ from: CUSTOMER, timestamp: '1700000000' }],
          },
        ],
      },
    ]
    // Nothing storable in a delivery that did contain messages -> refuse (503) so Meta redelivers.
    await expect(storeHistoryChunks('client-1', { phoneNumberId: OUR_PNID }, chunks)).rejects.toThrow('none could be stored')
  })

  it('de-duplicates the same wamid within one call and across calls', async () => {
    const chunks = [
      {
        threads: [
          {
            id: CUSTOMER,
            messages: [
              { id: 'wamid.dup', from: CUSTOMER, timestamp: '1700000000' },
              { id: 'wamid.dup', from: CUSTOMER, timestamp: '1700000000' },
            ],
          },
        ],
      },
    ]
    const res = await storeHistoryChunks('client-1', { phoneNumberId: OUR_PNID }, chunks)
    expect(res).toEqual({ stored: 1, skipped: 0 })
    expect(rows()).toHaveLength(1)

    const res2 = await storeHistoryChunks('client-1', { phoneNumberId: OUR_PNID }, chunks)
    expect(res2).toEqual({ stored: 1, skipped: 0 })
    expect(rows()).toHaveLength(1)
  })

  it('inserts in batches of HISTORY_INSERT_BATCH', async () => {
    const messages = Array.from({ length: 1201 }, (_, i) => ({
      id: `wamid.${i}`,
      from: CUSTOMER,
      timestamp: '1700000000',
    }))
    const chunks = [{ threads: [{ id: CUSTOMER, messages }] }]
    const res = await storeHistoryChunks('client-1', { phoneNumberId: OUR_PNID }, chunks)
    expect(res.stored).toBe(1201)
    expect(HISTORY_INSERT_BATCH).toBe(500)
    const sizes = fake.state.batches.map((b) => b.rows.length)
    expect(sizes).toEqual([500, 500, 201])
  })

  it('parses phase and chunk_order from numbers, numeric strings, and garbage', async () => {
    const chunks = [
      {
        metadata: { phase: 3, chunk_order: '7' },
        threads: [
          {
            id: CUSTOMER,
            messages: [{ id: 'wamid.p1', from: CUSTOMER, timestamp: '1700000000' }],
          },
        ],
      },
      {
        metadata: { phase: 'nope', chunk_order: 'garbage' },
        threads: [
          {
            id: CUSTOMER,
            messages: [{ id: 'wamid.p2', from: CUSTOMER, timestamp: '1700000000' }],
          },
        ],
      },
    ]
    await storeHistoryChunks('client-1', { phoneNumberId: OUR_PNID }, chunks)
    const byId = new Map(rows().map((r) => [r.message_id, r]))
    expect(byId.get('wamid.p1')!.phase).toBe(3)
    expect(byId.get('wamid.p1')!.chunk_order).toBe(7)
    expect(byId.get('wamid.p2')!.phase).toBeNull()
    expect(byId.get('wamid.p2')!.chunk_order).toBeNull()
  })

  it('sets sent_at to null for a bad timestamp', async () => {
    const chunks = [
      {
        threads: [
          {
            id: CUSTOMER,
            messages: [{ id: 'wamid.t', from: CUSTOMER, timestamp: 'not-a-number' }],
          },
        ],
      },
    ]
    await storeHistoryChunks('client-1', { phoneNumberId: OUR_PNID }, chunks)
    expect(rows()[0].sent_at).toBeNull()
  })

  it('does not touch the database for empty input', async () => {
    const res = await storeHistoryChunks('client-1', { phoneNumberId: OUR_PNID }, [])
    expect(res).toEqual({ stored: 0, skipped: 0 })
    expect(fake.state.batches).toHaveLength(0)
  })

  it('throws a fixed-text error on a database error without leaking ids', async () => {
    fake.state.failNext = true
    const chunks = [
      {
        threads: [
          {
            id: CUSTOMER,
            messages: [{ id: 'wamid.secret', from: CUSTOMER, timestamp: '1700000000' }],
          },
        ],
      },
    ]
    let caught: Error | null = null
    try {
      await storeHistoryChunks('client-1', { phoneNumberId: OUR_PNID }, chunks)
    } catch (e) {
      caught = e as Error
    }
    expect(caught).not.toBeNull()
    expect(caught!.message).not.toContain('wamid.secret')
    expect(caught!.message).not.toContain(CUSTOMER)
  })

  it('logs only counts', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const chunks = [
      {
        threads: [
          {
            id: CUSTOMER,
            messages: [{ id: 'wamid.log', from: CUSTOMER, timestamp: '1700000000' }],
          },
        ],
      },
    ]
    await storeHistoryChunks('client-1', { phoneNumberId: OUR_PNID }, chunks)
    expect(spy).toHaveBeenCalledTimes(1)
    const line = spy.mock.calls[0].join(' ')
    expect(line).toContain('stored=1')
    expect(line).toContain('skipped=0')
    expect(line).not.toContain(CUSTOMER)
    expect(line).not.toContain('wamid.log')
    spy.mockRestore()
  })
})

describe('storeHistoryChunks — poison values must not poison the delivery', () => {
  const ours = { phoneNumberId: OUR_PNID }
  const chunk = (over: Record<string, unknown>, ts = '1700000000') => ({
    ...over,
    threads: [{ id: CUSTOMER, messages: [{ id: 'wamid.p', from: CUSTOMER, timestamp: ts }] }],
  })

  it('an absurdly long timestamp becomes null instead of throwing', async () => {
    const res = await storeHistoryChunks('client-1', ours, [chunk({}, '9'.repeat(30))])
    expect(res.stored).toBe(1)
    expect(rows()[0].sent_at).toBeNull()
  })

  it('a timestamp past the Date range becomes null instead of throwing', async () => {
    const res = await storeHistoryChunks('client-1', ours, [chunk({}, '9999999999999')])
    expect(res.stored).toBe(1)
    expect(rows()[0].sent_at).toBeNull()
  })

  it('a fractional / huge phase and chunk_order become null (integer columns)', async () => {
    const res = await storeHistoryChunks('client-1', ours, [
      chunk({ metadata: { phase: 1.5, chunk_order: 99999999999 } }),
    ])
    expect(res.stored).toBe(1)
    expect(rows()[0].phase).toBeNull()
    expect(rows()[0].chunk_order).toBeNull()
  })

  it('a partly unreadable delivery stores what it can and says so loudly', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await storeHistoryChunks('client-1', ours, [
      { threads: [{ id: CUSTOMER, messages: [{ id: 'wamid.ok', from: CUSTOMER }, { id: 'wamid.bad', from: '999000111' }] }] },
    ])
    expect(res).toEqual({ stored: 1, skipped: 1 })
    expect(errSpy.mock.calls.flat().map(String).join(' ')).toContain('skipped 1 message(s)')
    errSpy.mockRestore()
  })
})

