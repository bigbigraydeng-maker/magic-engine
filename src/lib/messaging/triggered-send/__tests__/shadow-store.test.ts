import { createHash } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import {
  addressSha256,
  validateShadowRow,
  findContactsWithShadowRows,
  insertShadowRows,
  type ShadowRowInput,
} from '../shadow-store'

type QueryResult = { data: unknown; error: { message: string } | null }

interface RecordedCall {
  method: string
  args: unknown[]
}

interface FakeClient {
  from: (table: string) => FakeQuery
  tables: string[]
  calls: RecordedCall[]
}

interface FakeQuery extends PromiseLike<QueryResult> {
  select: (...args: unknown[]) => FakeQuery
  eq: (...args: unknown[]) => FakeQuery
  in: (...args: unknown[]) => FakeQuery
  upsert: (...args: unknown[]) => FakeQuery
  then: PromiseLike<QueryResult>['then']
}

const ALLOWED_METHODS = new Set(['select', 'eq', 'in', 'upsert'])

function makeFakeClient(
  resolve: (call: RecordedCall, index: number) => QueryResult,
): FakeClient {
  const tables: string[] = []
  const calls: RecordedCall[] = []
  let queryIndex = 0

  const from = (table: string): FakeQuery => {
    tables.push(table)
    const currentIndex = queryIndex
    queryIndex += 1

    // Calls of THIS query only: `upsert(...).select('id')` ends with a select, but the response depends on the upsert.
    const own: RecordedCall[] = []
    const record = (method: string, args: unknown[]): void => {
      calls.push({ method, args })
      own.push({ method, args })
    }

    const query: FakeQuery = {
      select: (...args: unknown[]) => {
        record('select', args)
        return query
      },
      eq: (...args: unknown[]) => {
        record('eq', args)
        return query
      },
      in: (...args: unknown[]) => {
        record('in', args)
        return query
      },
      upsert: (...args: unknown[]) => {
        record('upsert', args)
        return query
      },
      then: (onFulfilled, onRejected) =>
        Promise.resolve(resolve(own.find((c) => c.method === 'upsert') ?? own[own.length - 1], currentIndex)).then(
          onFulfilled,
          onRejected,
        ),
    }

    // Any method other than the allowed chain must fail loudly.
    return new Proxy(query, {
      get(target, prop, receiver) {
        if (typeof prop === 'string' && !(prop in target)) {
          if (!ALLOWED_METHODS.has(prop)) {
            throw new Error(`forbidden method: ${prop}`)
          }
        }
        return Reflect.get(target, prop, receiver)
      },
    })
  }

  return { from, tables, calls }
}

function validShadowRow(overrides: Partial<ShadowRowInput> = {}): ShadowRowInput {
  return {
    clientId: 'client-1',
    authorizationId: 'auth-1',
    contactId: 'contact-1',
    status: 'shadow',
    reasonCode: null,
    annotations: { sweep: 'p2-1b' },
    consentBasis: 'explicit',
    sourceRef: 'welcome-form',
    toAddressSha256: addressSha256('a@b.co'),
    localDay: '2024-05-01',
    ...overrides,
  }
}

function validSkippedRow(overrides: Partial<ShadowRowInput> = {}): ShadowRowInput {
  return validShadowRow({
    status: 'skipped',
    reasonCode: 'no_consent',
    ...overrides,
  })
}

describe('addressSha256', () => {
  it('returns the lower-case hex sha256 of the trimmed, lower-cased email', () => {
    const expected = createHash('sha256').update('a@b.co').digest('hex')
    expect(addressSha256('a@b.co')).toBe(expected)
  })

  it('trims and lower-cases its input', () => {
    expect(addressSha256('  A@B.CO ')).toBe(addressSha256('a@b.co'))
  })
})

describe('validateShadowRow', () => {
  it('accepts a valid shadow row', () => {
    expect(validateShadowRow(validShadowRow())).toBeNull()
  })

  it('accepts a valid skipped row', () => {
    expect(validateShadowRow(validSkippedRow())).toBeNull()
  })

  it('rejects a shadow row with a reasonCode', () => {
    expect(validateShadowRow(validShadowRow({ reasonCode: 'x' }))).not.toBeNull()
  })

  it('rejects a skipped row without a reasonCode', () => {
    expect(validateShadowRow(validSkippedRow({ reasonCode: null }))).not.toBeNull()
  })

  it('rejects a skipped row with an empty reasonCode', () => {
    expect(validateShadowRow(validSkippedRow({ reasonCode: '   ' }))).not.toBeNull()
  })

  it('rejects a reasonCode longer than 60 characters', () => {
    expect(
      validateShadowRow(validSkippedRow({ reasonCode: 'x'.repeat(61) })),
    ).not.toBeNull()
  })

  it('rejects a malformed localDay', () => {
    expect(validateShadowRow(validShadowRow({ localDay: '2024-5-1' }))).not.toBeNull()
  })

  it('rejects a malformed toAddressSha256', () => {
    expect(
      validateShadowRow(validShadowRow({ toAddressSha256: 'ABC' })),
    ).not.toBeNull()
  })

  it('accepts a null toAddressSha256', () => {
    expect(validateShadowRow(validShadowRow({ toAddressSha256: null }))).toBeNull()
  })

  it('rejects an empty clientId', () => {
    expect(validateShadowRow(validShadowRow({ clientId: '' }))).not.toBeNull()
  })

  it('rejects an empty authorizationId', () => {
    expect(validateShadowRow(validShadowRow({ authorizationId: '' }))).not.toBeNull()
  })

  it('rejects an empty contactId', () => {
    expect(validateShadowRow(validShadowRow({ contactId: '' }))).not.toBeNull()
  })

  it('rejects an array as annotations', () => {
    expect(
      validateShadowRow(
        validShadowRow({ annotations: [] as unknown as Record<string, unknown> }),
      ),
    ).not.toBeNull()
  })

  it('rejects a null annotations value', () => {
    expect(
      validateShadowRow(
        validShadowRow({ annotations: null as unknown as Record<string, unknown> }),
      ),
    ).not.toBeNull()
  })

  it('rejects an empty consentBasis', () => {
    expect(validateShadowRow(validShadowRow({ consentBasis: '' }))).not.toBeNull()
  })

  it('rejects a consentBasis longer than 200 characters', () => {
    expect(
      validateShadowRow(validShadowRow({ consentBasis: 'x'.repeat(201) })),
    ).not.toBeNull()
  })

  it('rejects an empty sourceRef', () => {
    expect(validateShadowRow(validShadowRow({ sourceRef: '' }))).not.toBeNull()
  })

  it('rejects a sourceRef longer than 200 characters', () => {
    expect(
      validateShadowRow(validShadowRow({ sourceRef: 'x'.repeat(201) })),
    ).not.toBeNull()
  })
})

describe('findContactsWithShadowRows', () => {
  it('makes no call for empty input', async () => {
    const client = makeFakeClient(() => ({ data: [], error: null }))
    const result = await findContactsWithShadowRows(client as never, 'client-1', [])
    expect(result).toEqual({ ok: true, contactIds: new Set() })
    expect(client.tables).toHaveLength(0)
    expect(client.calls).toHaveLength(0)
  })

  it('queries 250 ids in 3 chunks with the exact filters and merges results', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `contact-${i}`)
    const client = makeFakeClient((call) => {
      if (call.method === 'in') {
        const chunkIds = call.args[1] as string[]
        return {
          data: chunkIds.map((id) => ({ contact_id: id })),
          error: null,
        }
      }
      return { data: [], error: null }
    })

    const result = await findContactsWithShadowRows(client as never, 'client-1', ids)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.contactIds.size).toBe(250)
      expect(result.contactIds.has('contact-0')).toBe(true)
      expect(result.contactIds.has('contact-249')).toBe(true)
    }

    expect(client.tables).toEqual([
      'triggered_sends',
      'triggered_sends',
      'triggered_sends',
    ])

    const inCalls = client.calls.filter((c) => c.method === 'in')
    expect(inCalls).toHaveLength(3)
    expect((inCalls[0].args[1] as string[]).length).toBe(100)
    expect((inCalls[1].args[1] as string[]).length).toBe(100)
    expect((inCalls[2].args[1] as string[]).length).toBe(50)

    const eqCalls = client.calls.filter((c) => c.method === 'eq')
    expect(eqCalls).toHaveLength(12)
    expect(eqCalls[0].args).toEqual(['client_id', 'client-1'])
    expect(eqCalls[1].args).toEqual(['trigger_key', 'welcome'])
    expect(eqCalls[2].args).toEqual(['channel', 'email'])
    expect(eqCalls[3].args).toEqual(['dedupe_scope', 'shadow'])

    const selectCalls = client.calls.filter((c) => c.method === 'select')
    expect(selectCalls).toHaveLength(3)
    expect(selectCalls[0].args).toEqual(['contact_id'])
  })

  it('returns ok:false with the message on an error object', async () => {
    const client = makeFakeClient(() => ({
      data: null,
      error: { message: 'boom' },
    }))
    const result = await findContactsWithShadowRows(client as never, 'client-1', ['c1'])
    expect(result).toEqual({ ok: false, error: 'boom' })
  })

  it('returns ok:false with the message on a thrown exception', async () => {
    const client = makeFakeClient(() => {
      throw new Error('thrown')
    })
    const result = await findContactsWithShadowRows(client as never, 'client-1', ['c1'])
    expect(result).toEqual({ ok: false, error: 'thrown' })
  })
})

describe('insertShadowRows', () => {
  it('makes no call for empty input', async () => {
    const client = makeFakeClient(() => ({ data: [], error: null }))
    const result = await insertShadowRows(client as never, [])
    expect(result).toEqual({ ok: true, inserted: 0 })
    expect(client.tables).toHaveLength(0)
    expect(client.calls).toHaveLength(0)
  })

  it('uses the exact upsert options and snake_case row objects', async () => {
    const client = makeFakeClient(() => ({ data: [{ id: 'row-1' }], error: null }))
    const row = validShadowRow()
    const result = await insertShadowRows(client as never, [row])

    expect(result).toEqual({ ok: true, inserted: 1 })
    expect(client.tables).toEqual(['triggered_sends'])

    const upsertCall = client.calls.find((c) => c.method === 'upsert')
    expect(upsertCall).toBeDefined()
    if (!upsertCall) {
      return
    }

    expect(upsertCall.args[1]).toEqual({
      onConflict: 'client_id,trigger_key,channel,contact_id,dedupe_scope',
      ignoreDuplicates: true,
    })

    expect(upsertCall.args[0]).toEqual([
      {
        client_id: 'client-1',
        trigger_key: 'welcome',
        channel: 'email',
        contact_id: 'contact-1',
        dedupe_scope: 'shadow',
        status: 'shadow',
        reason_code: null,
        authorization_id: 'auth-1',
        to_address_sha256: addressSha256('a@b.co'),
        consent_basis: 'explicit',
        source_ref: 'welcome-form',
        annotations: { sweep: 'p2-1b' },
        local_day: '2024-05-01',
        provider_impact: 'NONE',
      },
    ])

    const selectCall = client.calls.find((c) => c.method === 'select')
    expect(selectCall?.args).toEqual(['id'])
  })

  it('sends 250 rows in 3 chunks and sums returned data lengths', async () => {
    const rows = Array.from({ length: 250 }, (_, i) =>
      validShadowRow({ contactId: `contact-${i}` }),
    )
    const client = makeFakeClient((call, index) => {
      if (call.method === 'upsert') {
        const chunkRows = call.args[0] as unknown[]
        // Second chunk returns fewer rows: duplicates were ignored.
        const returned = index === 1 ? chunkRows.length - 10 : chunkRows.length
        return {
          data: Array.from({ length: returned }, (_, i) => ({ id: `id-${i}` })),
          error: null,
        }
      }
      return { data: [], error: null }
    })

    const result = await insertShadowRows(client as never, rows)

    expect(result).toEqual({ ok: true, inserted: 240 })

    const upsertCalls = client.calls.filter((c) => c.method === 'upsert')
    expect(upsertCalls).toHaveLength(3)
    expect((upsertCalls[0].args[0] as unknown[]).length).toBe(100)
    expect((upsertCalls[1].args[0] as unknown[]).length).toBe(100)
    expect((upsertCalls[2].args[0] as unknown[]).length).toBe(50)
  })

  it('writes nothing when one row is invalid and reports its index', async () => {
    const client = makeFakeClient(() => ({ data: [{ id: 'x' }], error: null }))
    const rows = [
      validShadowRow({ contactId: 'c0' }),
      validShadowRow({ contactId: 'c1' }),
      validShadowRow({ contactId: 'c2', localDay: 'bad' }),
      validShadowRow({ contactId: 'c3' }),
    ]

    const result = await insertShadowRows(client as never, rows)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.startsWith('row 2: ')).toBe(true)
    }
    expect(client.tables).toHaveLength(0)
    expect(client.calls).toHaveLength(0)
  })

  it('stops before the 3rd chunk when the 2nd chunk errors', async () => {
    const rows = Array.from({ length: 250 }, (_, i) =>
      validShadowRow({ contactId: `contact-${i}` }),
    )
    const client = makeFakeClient((call, index) => {
      if (call.method === 'upsert') {
        if (index === 1) {
          return { data: null, error: { message: 'chunk-2-failed' } }
        }
        const chunkRows = call.args[0] as unknown[]
        return {
          data: Array.from({ length: chunkRows.length }, (_, i) => ({ id: `id-${i}` })),
          error: null,
        }
      }
      return { data: [], error: null }
    })

    const result = await insertShadowRows(client as never, rows)

    expect(result).toEqual({ ok: false, error: 'chunk-2-failed' })
    const upsertCalls = client.calls.filter((c) => c.method === 'upsert')
    expect(upsertCalls).toHaveLength(2)
  })

  it('returns ok:false on a thrown exception', async () => {
    const client = makeFakeClient(() => {
      throw new Error('thrown')
    })
    const result = await insertShadowRows(client as never, [validShadowRow()])
    expect(result).toEqual({ ok: false, error: 'thrown' })
  })
})
