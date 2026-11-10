import { describe, expect, it, vi } from 'vitest'
import { firstReactions, loadReactions } from '../reactions'

const send = { key: 's1', contactId: 'p1', sentAt: '2026-11-10T02:00:00.000Z' }
const touch = (over: Record<string, unknown> = {}) => ({ contact_id: 'p1', channel: 'email', occurred_at: '2026-11-10T05:00:00.000Z', source: 'microsoft_mail', ...over })

describe('firstReactions', () => {
  it('the first inbound touch AFTER the mail counts; earlier ones do not', () => {
    const got = firstReactions([send], [touch({ occurred_at: '2026-11-10T01:00:00.000Z' }), touch({ occurred_at: '2026-11-10T07:00:00.000Z' }), touch({ occurred_at: '2026-11-10T05:00:00.000Z', channel: 'phone' })])
    expect(got.get('s1')).toEqual({ at: '2026-11-10T05:00:00.000Z', channel: 'phone' })
  })
  it('another guest\'s touch does not count', () => {
    expect(firstReactions([send], [touch({ contact_id: 'p2' })]).size).toBe(0)
  })
  it('🔴 the one-click unsubscribe record is our system, not the guest writing to us', () => {
    expect(firstReactions([send], [touch({ source: 'me_unsubscribe' })]).size).toBe(0)
  })
})

function db(result: { data: unknown; error: { message: string } | null }) {
  const calls: Record<string, unknown[]> = {}
  const api: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'gte']) api[m] = (...a: unknown[]) => { calls[m] = a; return api }
  api.then = (r: (v: unknown) => unknown) => Promise.resolve(result).then(r)
  return { client: { from: () => api } as never, calls }
}

describe('loadReactions', () => {
  it('reads only this client\'s inbound chat / call / mail touches since the earliest mail', async () => {
    const { client, calls } = db({ data: [touch()], error: null })
    const out = await loadReactions(client, 'c1', [send])
    expect(out?.get('s1')?.channel).toBe('email')
    expect(calls.eq).toEqual(['direction', 'inbound'])
    expect(calls.gte).toEqual(['occurred_at', '2026-11-10T02:00:00.000Z'])
  })
  it('🔴 a failed read is null (never "nobody reacted")', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { client } = db({ data: null, error: { message: 'boom' } })
    expect(await loadReactions(client, 'c1', [send])).toBeNull()
    spy.mockRestore()
  })
  it('no mails, no query', async () => {
    const { client, calls } = db({ data: [], error: null })
    expect((await loadReactions(client, 'c1', []))?.size).toBe(0)
    expect(calls.select).toBeUndefined()
  })
})
