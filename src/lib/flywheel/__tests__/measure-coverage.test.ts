/**
 * Measure-phase coverage must not depend on how many rows fit in one response.
 *
 * The dashboard reads outcome ROWS to answer a question about CLIENTS. Past
 * PostgREST's silent 1000-row cap, one busy client's rows push other clients
 * out of the set and the coverage figure quietly drops — with no error and
 * nothing in the UI to suggest the number is short. (Issue #859, round 27.)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const PAGE_SIZE = 1000

let allRows: Array<{ client_id: string }> = []
let rangesAsked: Array<[number, number]> = []
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => {
      const q: Record<string, unknown> = {}
      q.select = () => q
      q.order = () => q
      q.range = async (from: number, to: number) => {
        rangesAsked.push([from, to])
        return { data: allRows.slice(from, to + 1), error: null }
      }
      return q
    },
  },
}))

import { loadClientsWithOutcomes } from '../measure-coverage'

beforeEach(() => {
  allRows = []
  rangesAsked = []
})

describe('loadClientsWithOutcomes', () => {
  it('returns an empty set when nothing has been attributed', async () => {
    expect(await loadClientsWithOutcomes()).toEqual(new Set())
  })

  it('collapses one client\'s many rows into one member', async () => {
    // Three metric rows for one action, plus a second window, is still one
    // client that has reached Measure.
    allRows = [
      { client_id: 'c1' }, { client_id: 'c1' }, { client_id: 'c1' },
      { client_id: 'c1' }, { client_id: 'c1' }, { client_id: 'c1' },
    ]

    expect(await loadClientsWithOutcomes()).toEqual(new Set(['c1']))
  })

  it('still finds a client whose only rows fall past the first page', async () => {
    // The failure this guards: one busy client fills the first response and the
    // quiet client behind it disappears from the coverage figure.
    allRows = [
      ...Array.from({ length: PAGE_SIZE }, () => ({ client_id: 'busy' })),
      { client_id: 'quiet' },
    ]

    const clients = await loadClientsWithOutcomes()

    expect(clients.has('quiet')).toBe(true)
    expect(clients.size).toBe(2)
    expect(rangesAsked.length).toBeGreaterThan(1) // it asked for a second page
  })
})
