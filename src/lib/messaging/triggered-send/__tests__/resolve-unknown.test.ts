import { describe, expect, it } from 'vitest'
import { NOT_SENT_CONFIRMED } from '../receipt'
import {
  CONSEQUENCE,
  resolutionOf,
  resolveUnknownCommand,
  ResolveUnknownCommandSchema,
  SENT_CONFIRMED,
  type ResolvableRow,
  type ResolveDeps,
} from '../resolve-unknown'
import type { TouchpointCancel } from '../send-touchpoint'
import type { CasWrite } from '../send-types'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const OTHER_CLIENT = 'd0000000-0000-4000-8000-000000000000'
const SEND = 'e0000000-0000-4000-8000-000000000001'
const ACTOR = { email: 'pm@example.com', userId: 'f0000000-0000-4000-8000-000000000001' }
const NOW = new Date('2026-11-20T01:00:00.000Z')
const SEEN = '2026-11-19T22:00:00.123456+00:00'
const FIRST_ATTEMPT = '2026-11-19T00:00:00+00:00'

function row(over: Partial<ResolvableRow> = {}): ResolvableRow {
  return { id: SEND, clientId: CLIENT, status: 'unknown_outcome', reasonCode: 'expired_20h', firstAttemptAt: FIRST_ATTEMPT, annotations: { gate_contract_version: 1 }, updatedAt: SEEN, ...over }
}

interface Options {
  row?: ResolvableRow | null
  load?: 'fail'
  write?: CasWrite
  /** What every read after the first answers (a receipt or another tab moved the row on). */
  reread?: ResolvableRow
  cancel?: TouchpointCancel | 'throw'
  timeline?: boolean | null | 'throw'
}

/** A ledger of one row: a write that goes through changes what the next read sees, like the real table. */
function world(opts: Options = {}) {
  const writes: Array<{ row: ResolvableRow; patch: Record<string, unknown> }> = []
  const cancels: Array<{ clientId: string; sendId: string }> = []
  let current: ResolvableRow | null = opts.row === undefined ? row() : opts.row
  let loads = 0
  const deps: ResolveDeps = {
    load: async () => {
      loads += 1
      if (opts.load === 'fail') return { ok: false, error: 'ledger read: 08006' }
      if (loads > 1 && opts.reread !== undefined) return { ok: true, row: opts.reread }
      return { ok: true, row: current }
    },
    write: async (r, patch) => {
      writes.push({ row: r, patch })
      const result = opts.write ?? { ok: true, result: 'updated' }
      if (result.ok && result.result === 'updated' && current !== null) {
        current = { ...current, status: String(patch.status), reasonCode: (patch.reason_code as string | undefined) ?? current.reasonCode, annotations: patch.annotations as Record<string, unknown>, updatedAt: '2026-11-20T01:00:00.000001+00:00' }
      }
      return result
    },
    cancelTimeline: async (clientId, sendId) => {
      cancels.push({ clientId, sendId })
      if (opts.cancel === 'throw') throw new Error('db down')
      return opts.cancel ?? { ok: true, updated: 1 }
    },
    timelinePresent: async () => {
      if (opts.timeline === 'throw') throw new Error('db down')
      return opts.timeline === undefined ? true : opts.timeline
    },
    now: () => NOW,
    newRequestId: () => 'req-1',
  }
  return { deps, writes, cancels }
}

function command(over: Record<string, unknown> = {}) {
  return ResolveUnknownCommandSchema.parse({ client_id: CLIENT, send_id: SEND, outcome: 'not_sent', seen_updated_at: SEEN, ...over })
}

const RESOLUTION = (outcome: 'sent' | 'not_sent') => ({ outcome, by: ACTOR.email, by_user_id: ACTOR.userId, at: NOW.toISOString(), request_id: 'req-1' })

describe('resolve_unknown — the PM settles a letter nobody could tell about', () => {
  it('previews by default: says what follows, writes nothing, changes no timeline line', async () => {
    for (const outcome of ['sent', 'not_sent'] as const) {
      const w = world()
      const res = await resolveUnknownCommand(w.deps, CLIENT, ACTOR, command({ outcome }))
      expect(res).toMatchObject({ status: 200, body: { success: true, no_send: true, mode: 'PREVIEW', outcome, consequence: CONSEQUENCE[outcome], send: { id: SEND, status: 'unknown_outcome' }, timeline_present: true } })
      expect(w.writes).toEqual([])
      expect(w.cancels).toEqual([])
    }
  })

  it('the preview says when the letter has no timeline line at all (it never reached the provider); unknown when that read fails', async () => {
    expect((await resolveUnknownCommand(world({ timeline: false }).deps, CLIENT, ACTOR, command({ outcome: 'sent' }))).body.timeline_present).toBe(false)
    expect((await resolveUnknownCommand(world({ timeline: null }).deps, CLIENT, ACTOR, command())).body.timeline_present).toBeNull()
    expect((await resolveUnknownCommand(world({ timeline: 'throw' }).deps, CLIENT, ACTOR, command())).body).toMatchObject({ mode: 'PREVIEW', timeline_present: null })
  })

  it('🔴 「没发出」 = failed + not_sent_confirmed (who, when, request id kept on the row) and the timeline line is cancelled', async () => {
    const w = world()
    const res = await resolveUnknownCommand(w.deps, CLIENT, ACTOR, command({ confirm: true }))
    expect(w.writes).toHaveLength(1)
    expect(w.writes[0].patch).toEqual({
      status: 'failed',
      reason_code: NOT_SENT_CONFIRMED,
      annotations: { gate_contract_version: 1, resolution: RESOLUTION('not_sent') },
    })
    expect(w.cancels).toEqual([{ clientId: CLIENT, sendId: SEND }])
    expect(res).toMatchObject({ status: 200, body: { mode: 'RESOLVED', outcome: 'not_sent', consequence: 'NEVER_WELCOMED_AUTOMATICALLY_AGAIN', timeline: 'cancelled', resolution: RESOLUTION('not_sent') } })
  })

  it('🔴 「已发出」 = sent, provider accepted, NO sent time (the cap counts the latest moment it could have gone; a receipt fills it in); the timeline line stays', async () => {
    const w = world()
    const res = await resolveUnknownCommand(w.deps, CLIENT, ACTOR, command({ outcome: 'sent', confirm: true }))
    expect(w.writes[0].patch).toEqual({
      status: 'sent',
      reason_code: SENT_CONFIRMED,
      provider_impact: 'PROVIDER_ACCEPTED',
      annotations: { gate_contract_version: 1, resolution: RESOLUTION('sent') },
    })
    expect(w.writes[0].patch).not.toHaveProperty('sent_at')
    expect(w.cancels).toEqual([])
    expect(res.body).toMatchObject({ mode: 'RESOLVED', outcome: 'sent', timeline: 'unchanged' })
  })

  it('🔴 only a letter whose outcome is unknown: any other state is refused, nothing written (not_sent_confirmed on no other step)', async () => {
    for (const status of ['pending', 'sent', 'delivery_delayed', 'delivered', 'suppressed', 'failed', 'bounced', 'complained', 'blocked', 'skipped']) {
      const w = world({ row: row({ status }) })
      for (const confirm of [false, true]) {
        const res = await resolveUnknownCommand(w.deps, CLIENT, ACTOR, command({ confirm }))
        expect(res, status).toMatchObject({ status: 409, body: { error: 'NOT_UNKNOWN', send: { status } } })
      }
      expect(w.writes, status).toEqual([])
      expect(w.cancels, status).toEqual([])
    }
  })

  it('🔴 the PM settles the letter he saw: a row that changed since the page read it is refused, nothing written', async () => {
    const w = world({ row: row({ updatedAt: '2026-11-19T23:00:00.000001+00:00' }) })
    for (const confirm of [false, true]) {
      expect(await resolveUnknownCommand(w.deps, CLIENT, ACTOR, command({ confirm }))).toMatchObject({ status: 409, body: { error: 'SEND_CHANGED' } })
    }
    expect(w.writes).toEqual([])
  })

  it('🔴 a receipt that moved the row on between the read and the write wins: refused with what it is now, timeline untouched', async () => {
    const w = world({ write: { ok: true, result: 'changed' }, reread: row({ status: 'delivered', updatedAt: '2026-11-20T00:59:59+00:00' }) })
    const res = await resolveUnknownCommand(w.deps, CLIENT, ACTOR, command({ confirm: true }))
    expect(res).toMatchObject({ status: 409, body: { error: 'SEND_CHANGED', send: { status: 'delivered' } } })
    expect(w.cancels).toEqual([])
  })

  it('🔴 a receipt that moved the row on right AFTER 「没发出」 was written: the timeline line is left alone (the letter did go)', async () => {
    const delivered = row({ status: 'delivered', reasonCode: NOT_SENT_CONFIRMED, annotations: { resolution: RESOLUTION('not_sent') } })
    const w = world({ reread: delivered })
    const res = await resolveUnknownCommand(w.deps, CLIENT, ACTOR, command({ confirm: true }))
    expect(res).toMatchObject({ status: 200, body: { mode: 'RESOLVED', timeline: 'receipt_arrived' } })
    expect(w.writes).toHaveLength(1)
    expect(w.cancels).toEqual([])
  })

  it('🔴 a receipt right after 「没发出」 that says the letter did NOT go (suppressed) changes nothing: the line is cancelled as usual', async () => {
    const suppressed = row({ status: 'suppressed', reasonCode: NOT_SENT_CONFIRMED, annotations: { resolution: RESOLUTION('not_sent') } })
    const w = world({ reread: suppressed })
    expect((await resolveUnknownCommand(w.deps, CLIENT, ACTOR, command({ confirm: true }))).body).toMatchObject({ mode: 'RESOLVED', timeline: 'cancelled' })
    expect(w.cancels).toHaveLength(1)
  })

  it('another tab gave the same answer a moment earlier: that is this answer (not a conflict); a different answer meanwhile is a conflict', async () => {
    const same = world({ write: { ok: true, result: 'changed' }, reread: row({ status: 'failed', reasonCode: NOT_SENT_CONFIRMED, annotations: { resolution: RESOLUTION('not_sent') } }) })
    expect(await resolveUnknownCommand(same.deps, CLIENT, ACTOR, command({ confirm: true }))).toMatchObject({ status: 200, body: { mode: 'ALREADY_RESOLVED', timeline: 'unchanged' } })
    expect(same.cancels).toEqual([])
    const other = world({ write: { ok: true, result: 'changed' }, reread: row({ status: 'sent', reasonCode: SENT_CONFIRMED, annotations: { resolution: RESOLUTION('sent') } }) })
    expect(await resolveUnknownCommand(other.deps, CLIENT, ACTOR, command({ confirm: true }))).toMatchObject({ status: 409, body: { error: 'SEND_CHANGED', send: { status: 'sent' } } })
  })

  it('a letter of another client, or none, is "not found"; nothing written', async () => {
    for (const r of [null, row({ clientId: OTHER_CLIENT })]) {
      const w = world({ row: r })
      expect(await resolveUnknownCommand(w.deps, CLIENT, ACTOR, command({ confirm: true }))).toMatchObject({ status: 404, body: { error: 'SEND_NOT_FOUND' } })
      expect(w.writes).toEqual([])
    }
  })

  it('a failed read or write is a 500 by code; a failed write changes no timeline line', async () => {
    expect(await resolveUnknownCommand(world({ load: 'fail' }).deps, CLIENT, ACTOR, command({ confirm: true }))).toMatchObject({ status: 500, body: { error: 'SEND_UNREADABLE' } })
    const w = world({ write: { ok: false, error: 'ledger update: 23514' } })
    expect(await resolveUnknownCommand(w.deps, CLIENT, ACTOR, command({ confirm: true }))).toMatchObject({ status: 500, body: { error: 'RESOLVE_FAILED' } })
    expect(w.cancels).toEqual([])
  })

  it('the ledger answer stands when the timeline line cannot be changed; the answer says so', async () => {
    const cases: Array<[TouchpointCancel | 'throw', string]> = [
      [{ ok: false, error: 'touchpoint cancel: x' }, 'failed'],
      ['throw', 'failed'],
      [{ ok: true, updated: 0 }, 'none'],
    ]
    for (const [cancel, timeline] of cases) {
      const w = world({ cancel })
      const res = await resolveUnknownCommand(w.deps, CLIENT, ACTOR, command({ confirm: true }))
      expect(res).toMatchObject({ status: 200, body: { mode: 'RESOLVED', timeline } })
      expect(w.writes).toHaveLength(1)
    }
  })

  it('answered before: the same answer again is fine (retries the timeline line while it still says 「没发出」), the other one is refused', async () => {
    const settled = row({ status: 'failed', reasonCode: NOT_SENT_CONFIRMED, annotations: { resolution: RESOLUTION('not_sent') } })
    const again = world({ row: settled })
    expect(await resolveUnknownCommand(again.deps, CLIENT, ACTOR, command({ confirm: true }))).toMatchObject({ status: 200, body: { mode: 'ALREADY_RESOLVED', timeline: 'cancelled' } })
    expect(again.cancels).toHaveLength(1)
    expect((await resolveUnknownCommand(again.deps, CLIENT, ACTOR, command())).body).toMatchObject({ mode: 'ALREADY_RESOLVED', timeline: 'unchanged' })
    expect(again.cancels).toHaveLength(1)
    // A late real receipt overwrote 「没发出」: the line is not cancelled again.
    const overwritten = world({ row: { ...settled, status: 'delivered', reasonCode: NOT_SENT_CONFIRMED } })
    expect((await resolveUnknownCommand(overwritten.deps, CLIENT, ACTOR, command({ confirm: true }))).body).toMatchObject({ mode: 'ALREADY_RESOLVED', timeline: 'unchanged' })
    expect(overwritten.cancels).toEqual([])
    const flip = world({ row: settled })
    expect(await resolveUnknownCommand(flip.deps, CLIENT, ACTOR, command({ outcome: 'sent', confirm: true }))).toMatchObject({ status: 409, body: { error: 'ALREADY_RESOLVED', resolution: { outcome: 'not_sent' } } })
    for (const w of [again, overwritten, flip]) expect(w.writes).toEqual([])
  })

  it('reads an earlier answer only from a well-formed resolution', () => {
    expect(resolutionOf({ resolution: RESOLUTION('sent') })).toEqual(RESOLUTION('sent'))
    for (const bad of [null, [], 'x', {}, { resolution: 'sent' }, { resolution: { outcome: 'maybe' } }, { resolution: [] }]) expect(resolutionOf(bad)).toBeNull()
  })

  it('the command is strict: two answers only, ids as lower-case uuids, no extra fields', () => {
    expect(ResolveUnknownCommandSchema.safeParse({ client_id: CLIENT, send_id: SEND, outcome: 'not_sent', seen_updated_at: SEEN }).success).toBe(true)
    for (const bad of [
      { client_id: CLIENT, send_id: SEND, outcome: 'delivered', seen_updated_at: SEEN },
      { client_id: CLIENT, send_id: SEND.toUpperCase(), outcome: 'sent', seen_updated_at: SEEN },
      { client_id: CLIENT, send_id: SEND, outcome: 'sent' },
      { client_id: CLIENT, send_id: SEND, outcome: 'sent', seen_updated_at: SEEN, status: 'sent' },
    ]) {
      expect(ResolveUnknownCommandSchema.safeParse(bad).success).toBe(false)
    }
  })
})
