import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveThreadsForComments } from '../src/github.mjs'

/**
 * Direct cover for the GraphQL path in github.mjs. It was invisible to every
 * other test in this suite, which mocks the whole module out — a mutation run
 * (2026-08-12) removed the `body.errors` check and all 106 tests still passed.
 */

const threadsPayload = (nodes: unknown[]) => ({
  data: { repository: { pullRequest: { reviewThreads: { nodes } } } },
})

function mockFetch(responses: Array<{ ok?: boolean; status?: number; body: unknown }>) {
  const calls: Array<Record<string, unknown>> = []
  const fn = vi.fn(async (_url: string, init: { body: string }) => {
    calls.push(JSON.parse(init.body))
    const next = responses.shift() ?? { body: { data: {} } }
    return {
      ok: next.ok ?? true,
      status: next.status ?? 200,
      json: async () => next.body,
    }
  })
  vi.stubGlobal('fetch', fn)
  return calls
}

afterEach(() => vi.unstubAllGlobals())

describe('resolveThreadsForComments', () => {
  it('resolves only unresolved threads containing one of the given comments', async () => {
    const calls = mockFetch([
      {
        body: threadsPayload([
          { id: 'T_match', isResolved: false, comments: { nodes: [{ databaseId: 11 }] } },
          { id: 'T_other', isResolved: false, comments: { nodes: [{ databaseId: 99 }] } },
          { id: 'T_done', isResolved: true, comments: { nodes: [{ databaseId: 22 }] } },
        ]),
      },
      { body: { data: { resolveReviewThread: { thread: { isResolved: true } } } } },
    ])

    const resolved = await resolveThreadsForComments('tok', 'o', 'r', 931, [11, 22])

    expect(resolved).toEqual(['T_match'])
    // One query + exactly one mutation: the unrelated thread is untouched, and
    // the already-resolved one is not re-resolved.
    expect(calls).toHaveLength(2)
    expect(calls[1].variables).toEqual({ id: 'T_match' })
  })

  it('throws when GraphQL reports errors, even though the HTTP status is 200', async () => {
    // GraphQL answers 200 with an `errors` array. Checking only `res.ok` would
    // let a failed resolve be reported to the PR as a successful one — the same
    // class of lie as the "pushed the change" message that pushed nothing.
    mockFetch([{ ok: true, status: 200, body: { errors: [{ message: 'Resource not accessible' }] } }])

    await expect(resolveThreadsForComments('tok', 'o', 'r', 931, [11])).rejects.toThrow(/Resource not accessible/)
  })

  it('makes no request at all when there is nothing to resolve', async () => {
    const calls = mockFetch([])
    await expect(resolveThreadsForComments('tok', 'o', 'r', 931, [])).resolves.toEqual([])
    expect(calls).toHaveLength(0)
  })
})
