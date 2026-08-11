/**
 * Diagnose / Prioritise / Execute coverage must not depend on how many rows fit
 * in one response.
 *
 * The dashboard reads prescription and execution-item ROWS to answer a question
 * about CLIENTS. Past PostgREST's silent 1000-row cap, one busy client's rows
 * push other clients out of the set and the coverage figure quietly drops —
 * with no error and nothing in the UI to suggest the number is short.
 *
 * `execution_items` holds exactly 1000 rows in production, so this is not
 * hypothetical: the next insert crosses the line.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const PAGE_SIZE = 1000

interface Row { client_id: string; status?: string }

/** Per-table row store, so one mock serves both loaders. */
const tables: Record<string, Row[]> = {}
let rangesAsked: Record<string, Array<[number, number]>> = {}
let ordersAsked: Record<string, Array<[string, boolean | undefined]>> = {}

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const q: Record<string, unknown> = {}
      q.select = () => q
      q.order = (col: string, opts?: { ascending?: boolean }) => {
        ;(ordersAsked[table] ??= []).push([col, opts?.ascending])
        return q
      }
      q.range = async (from: number, to: number) => {
        ;(rangesAsked[table] ??= []).push([from, to])
        return { data: (tables[table] ?? []).slice(from, to + 1), error: null }
      }
      return q
    },
  },
}))

import { loadClientsWithDiagnose, loadExecutionPhaseClients } from '../phase-coverage'

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  rangesAsked = {}
  ordersAsked = {}
})

describe('loadClientsWithDiagnose', () => {
  it('returns an empty set when nothing has been diagnosed', async () => {
    expect(await loadClientsWithDiagnose()).toEqual(new Set())
  })

  it("collapses one client's many prescriptions into one member", async () => {
    tables.prescriptions = [
      { client_id: 'c1' }, { client_id: 'c1' }, { client_id: 'c1' },
    ]

    expect(await loadClientsWithDiagnose()).toEqual(new Set(['c1']))
  })

  it('still finds a client whose only rows fall past the first page', async () => {
    tables.prescriptions = [
      ...Array.from({ length: PAGE_SIZE }, () => ({ client_id: 'busy' })),
      { client_id: 'quiet' },
    ]

    const clients = await loadClientsWithDiagnose()

    expect(clients.has('quiet')).toBe(true)
    expect(clients.size).toBe(2)
    expect(rangesAsked.prescriptions?.length).toBeGreaterThan(1) // asked for page 2
  })

  it('sorts by a stable unique key so pages cannot repeat or drop rows', async () => {
    tables.prescriptions = [{ client_id: 'c1' }]

    await loadClientsWithDiagnose()

    expect(ordersAsked.prescriptions).toEqual([['id', true]])
  })
})

describe('loadExecutionPhaseClients', () => {
  it('returns empty sets when there is no execution work', async () => {
    expect(await loadExecutionPhaseClients()).toEqual({
      prioritise: new Set(),
      execute: new Set(),
    })
  })

  it('splits clients by item status, ignoring statuses that mean neither', async () => {
    tables.execution_items = [
      { client_id: 'queued',  status: 'pending' },
      { client_id: 'working', status: 'in_progress' },
      { client_id: 'done',    status: 'completed' },
      // `superseded` is the single most common status in production (480 of
      // 1000) and `skipped` is close behind — neither places a client in a phase.
      { client_id: 'dropped', status: 'superseded' },
      { client_id: 'dropped', status: 'skipped' },
    ]

    const { prioritise, execute } = await loadExecutionPhaseClients()

    expect(prioritise).toEqual(new Set(['queued', 'working']))
    expect(execute).toEqual(new Set(['done']))
  })

  it('counts a client in both phases when it has queued and finished work', async () => {
    tables.execution_items = [
      { client_id: 'c1', status: 'pending' },
      { client_id: 'c1', status: 'completed' },
    ]

    const { prioritise, execute } = await loadExecutionPhaseClients()

    expect(prioritise.has('c1')).toBe(true)
    expect(execute.has('c1')).toBe(true)
  })

  it('still finds a quiet client whose rows fall past the first page', async () => {
    // The production shape: two clients hold over half the rows, and the
    // smallest holds 2. Without paging the small one is simply not there.
    tables.execution_items = [
      ...Array.from({ length: PAGE_SIZE }, () => ({
        client_id: 'busy',
        status: 'superseded',
      })),
      { client_id: 'quiet', status: 'pending' },
      { client_id: 'quiet', status: 'completed' },
    ]

    const { prioritise, execute } = await loadExecutionPhaseClients()

    expect(prioritise.has('quiet')).toBe(true)
    expect(execute.has('quiet')).toBe(true)
    expect(rangesAsked.execution_items?.length).toBeGreaterThan(1) // asked for page 2
  })

  it('sorts by a stable unique key so pages cannot repeat or drop rows', async () => {
    tables.execution_items = [{ client_id: 'c1', status: 'pending' }]

    await loadExecutionPhaseClients()

    expect(ordersAsked.execution_items).toEqual([['id', true]])
  })
})
