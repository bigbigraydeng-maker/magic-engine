/** 测试 / 试跑用的内存存储：按表建模，行为对齐 Supabase 实现（唯一键、client_id 隔离）。 */

import type {
  CallRow,
  RawEventRow,
  RawStatus,
  TelephonyConnection,
  TelephonyStore,
  TouchpointInput,
} from '../types'

export interface MemTouchpoint extends TouchpointInput {
  id: string
}

export function createMemoryStore(connections: TelephonyConnection[]) {
  const conns = new Map(connections.map((c) => [c.id, c]))
  const raw = new Map<string, RawEventRow & { payload: unknown; rawType: string; lastError: string | null }>()
  const rejections: Array<{ connectionId: string | null; clientId: string | null; reason: string; payload?: unknown }> = []
  const calls = new Map<string, CallRow>()
  /** clientId -> phone -> contact ids */
  const contacts = new Map<string, Map<string, string[]>>()
  const touchpoints = new Map<string, MemTouchpoint>()
  const lastSeen = new Map<string, string>()
  let seq = 0
  const failures = { touchpointWrites: 0 }

  const callKey = (clientId: string, callId: string) => `${clientId}|${callId}`
  const phoneMap = (clientId: string) => {
    if (!contacts.has(clientId)) contacts.set(clientId, new Map())
    return contacts.get(clientId)!
  }

  const store: TelephonyStore = {
    async getConnection(id) {
      return conns.get(id) ?? null
    },
    async insertRawEvent(row) {
      for (const r of raw.values()) if (r.dedupeKey === row.dedupeKey) return { inserted: false, id: null }
      const id = `raw-${++seq}`
      raw.set(id, {
        id,
        clientId: row.clientId,
        connectionId: row.connectionId,
        callId: row.callId,
        dedupeKey: row.dedupeKey,
        receivedAt: row.receivedAt,
        status: 'pending',
        attempts: 0,
        event: row.event,
        payload: row.payload,
        rawType: row.rawType,
        lastError: null,
      })
      return { inserted: true, id }
    },
    async insertRejection(row) {
      rejections.push({ connectionId: row.connectionId, clientId: row.clientId, reason: row.reason, payload: row.payload })
    },
    async getRawEvent(id) {
      return raw.get(id) ?? null
    },
    async listRawEventsForCall(clientId, connectionId, callId) {
      return [...raw.values()].filter((r) => r.clientId === clientId && r.connectionId === connectionId && r.callId === callId)
    },
    async markRaw(id, status: RawStatus, error) {
      const r = raw.get(id)
      if (!r) return
      r.status = status
      r.lastError = error
      if (status === 'failed') r.attempts += 1
    },
    async listStaleRaw(olderThanIso, maxAttempts, limit) {
      return [...raw.values()]
        .filter((r) => (r.status === 'pending' || r.status === 'failed') && r.receivedAt < olderThanIso && r.attempts < maxAttempts)
        .slice(0, limit)
    },
    async updateCallTouchpoint(t) {
      const key = `${t.clientId}|${t.source}|${t.sourceRef}`
      const cur = touchpoints.get(key)
      if (cur) touchpoints.set(key, { ...cur, ...t, id: cur.id })
    },
    async purgeRejections(before) {
      void before
      return 0
    },
    async countExhaustedRaw(max) {
      return [...raw.values()].filter((r) => r.status === 'failed' && r.attempts >= max).length
    },
    async getCall(clientId, provider, callId) {
      void provider
      return calls.get(callKey(clientId, callId)) ?? null
    },
    async listStaleCalls(before, limit) {
      return [...calls.values()].filter((c) => c.crmStatus === 'pending' && c.startedAt < before).slice(0, limit)
    },
    async saveCall(row) {
      calls.set(callKey(row.clientId, row.providerCallId), structuredClone(row))
    },
    async findContactIdsByPhone(clientId, phone) {
      return [...(phoneMap(clientId).get(phone) ?? [])]
    },
    async createContactForInboundCall({ clientId, phoneE164 }) {
      const id = `contact-${++seq}`
      const m = phoneMap(clientId)
      m.set(phoneE164, [...(m.get(phoneE164) ?? []), id])
      return id
    },
    async writeCallTouchpoint(t) {
      if (failures.touchpointWrites > 0) {
        failures.touchpointWrites--
        throw new Error('写通话触点失败: simulated outage')
      }
      const key = `${t.clientId}|${t.source}|${t.sourceRef}`
      if (touchpoints.has(key)) return { touchpointId: touchpoints.get(key)!.id, created: false }
      const id = `tp-${++seq}`
      touchpoints.set(key, { ...t, id })
      if (t.direction === 'inbound' || t.reached) lastSeen.set(t.contactId, t.occurredAt)
      return { touchpointId: id, created: true }
    },
  }

  return {
    store,
    raw,
    rejections,
    calls,
    touchpoints,
    lastSeen,
    failures,
    addContact(clientId: string, phone: string): string {
      const id = `contact-${++seq}`
      const m = phoneMap(clientId)
      m.set(phone, [...(m.get(phone) ?? []), id])
      return id
    },
    contactCount(clientId: string): number {
      return new Set([...phoneMap(clientId).values()].flat()).size
    },
  }
}
