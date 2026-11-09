import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { recordUnclaimedNumber } from '../unclaimed'

type UpsertRow = {
  phone_number_id: string
  last_seen_at: string
  last_kind: string
  resolved_at: null
}

type UpsertOptions = {
  onConflict: string
}

type UpsertResult = { error: { message: string } | null }

type RecordedCall = {
  table: string
  row: UpsertRow
  options: UpsertOptions
}

const upsertCalls: RecordedCall[] = []

let nextResult: UpsertResult | (() => UpsertResult) = { error: null }

function makeFakeClient() {
  return {
    from(table: string) {
      return {
        upsert(row: UpsertRow, options: UpsertOptions): Promise<UpsertResult> {
          upsertCalls.push({ table, row, options })
          if (typeof nextResult === 'function') {
            return Promise.resolve(nextResult())
          }
          return Promise.resolve(nextResult)
        },
      }
    },
  }
}

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: makeFakeClient(),
}))

describe('recordUnclaimedNumber', () => {
  beforeEach(() => {
    upsertCalls.length = 0
    nextResult = { error: null }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('writes the row on first sighting with onConflict and without first_seen_at', async () => {
    const now = new Date('2024-01-02T03:04:05.000Z')

    await recordUnclaimedNumber('1234567890', 'customer_messages', now)

    expect(upsertCalls).toHaveLength(1)
    const call = upsertCalls[0]
    expect(call.table).toBe('whatsapp_unclaimed_numbers')
    expect(call.options).toEqual({ onConflict: 'phone_number_id' })
    expect(call.row).toEqual({
      phone_number_id: '1234567890',
      last_seen_at: '2024-01-02T03:04:05.000Z',
      last_kind: 'customer_messages',
      resolved_at: null,
    })
    expect('first_seen_at' in call.row).toBe(false)
  })

  it('updates last_seen_at/last_kind and resets resolved_at to null on a second call', async () => {
    const first = new Date('2024-01-02T03:04:05.000Z')
    const second = new Date('2024-02-03T04:05:06.000Z')

    await recordUnclaimedNumber('1234567890', 'customer_messages', first)
    await recordUnclaimedNumber('1234567890', 'echoes', second)

    expect(upsertCalls).toHaveLength(2)
    const call = upsertCalls[1]
    expect(call.options).toEqual({ onConflict: 'phone_number_id' })
    expect(call.row).toEqual({
      phone_number_id: '1234567890',
      last_seen_at: '2024-02-03T04:05:06.000Z',
      last_kind: 'echoes',
      resolved_at: null,
    })
    expect('first_seen_at' in call.row).toBe(false)
  })

  it('does not call the db for invalid numbers', async () => {
    const invalid = ['abc', '', '1'.repeat(33)]

    for (const value of invalid) {
      await recordUnclaimedNumber(value, 'statuses')
    }

    expect(upsertCalls).toHaveLength(0)
  })

  it('resolves and logs the fixed text when the db returns an error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    nextResult = { error: { message: 'boom' } }

    await expect(
      recordUnclaimedNumber('1234567890', 'history'),
    ).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledWith(
      '[whatsapp/unclaimed] registry write failed',
    )
    const logged = errorSpy.mock.calls.flat().join(' ')
    expect(logged).not.toContain('1234567890')
  })

  it('resolves when the db call throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    nextResult = () => {
      throw new Error('network down')
    }

    await expect(
      recordUnclaimedNumber('1234567890', 'echoes'),
    ).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalledWith(
      '[whatsapp/unclaimed] registry write failed',
    )
  })
})
