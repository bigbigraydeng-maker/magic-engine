import type { TakeoverEvent } from '../state'
import type { NewTakeoverEvent, TakeoverStoreDeps } from '../store'

/** In-memory store with the same (client_id, source_ref) uniqueness as the migration. */
export function fakeStore(opts: { failInsert?: boolean; failMirror?: boolean; clock?: () => string } = {}) {
  const events: Array<NewTakeoverEvent & { createdAt: string }> = []
  const mirror = new Map<string, string | null>()
  const calls: string[] = []
  let tick = 0
  const clock = opts.clock ?? (() => new Date(Date.UTC(2026, 10, 10, 1, 0, tick++)).toISOString())
  const deps: TakeoverStoreDeps = {
    async insertEvent(e) {
      calls.push('insert')
      if (opts.failInsert) throw new Error('db down')
      if (events.some((x) => x.clientId === e.clientId && x.sourceRef === e.sourceRef)) return { inserted: false }
      events.push({ ...e, createdAt: clock() })
      return { inserted: true }
    },
    async loadEvents(clientId, contactId): Promise<TakeoverEvent[]> {
      calls.push('load')
      return events
        .filter((x) => x.clientId === clientId && x.contactId === contactId)
        .map((x) => ({ kind: x.kind, createdAt: x.createdAt, actor: x.actor }))
    },
    async setMirror(clientId, contactId, since) {
      calls.push('mirror')
      if (opts.failMirror) throw new Error('update failed')
      mirror.set(`${clientId}/${contactId}`, since)
    },
  }
  return { deps, events, mirror, calls, setFailMirror: (v: boolean) => { opts.failMirror = v } }
}
