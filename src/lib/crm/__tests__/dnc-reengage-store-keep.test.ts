/**
 * 自动解除「别再联系」不许顺手放出电话（魏征 2026-11-09 P1-3）。
 *
 * 解除触点（dnc_cleared）同时作废之前的 do_not_call。客人重填表单 ≠ 同意接电话（设计稿 v1 §E），
 * 所以之前说过「不要打电话」的人，解除时要补一条 do_not_call。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const db: { contacts: Row[]; touches: Row[]; written: Row[]; patches: Row[] } = {
  contacts: [],
  touches: [],
  written: [],
  patches: [],
}

function rowsOf(table: string): Row[] {
  if (table === 'contacts') return db.contacts
  if (table === 'contact_touchpoints') return db.touches
  return []
}

function builder(table: string): Row {
  const result = () => ({ data: rowsOf(table), error: null })
  const b: Row = {}
  for (const m of ['select', 'eq', 'in', 'order', 'or']) b[m] = () => b
  b.range = async () => result()
  b.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, bad)
  b.update = (patch: Row) => {
    db.patches.push(patch)
    return b
  }
  b.upsert = (row: Row) => {
    db.written.push(row)
    return {
      select: () => ({ maybeSingle: async () => ({ data: { id: `w${db.written.length}` }, error: null }) }),
      then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) =>
        Promise.resolve({ error: null }).then(ok, bad),
    }
  }
  return b
}

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: (t: string) => builder(t) } }))

import { applyReengageClear, loadReengageCandidates } from '../dnc-reengage-store'
import { decideReengageClear } from '../dnc-reengage'
import { isDoNotCall, isDoNotContact, type DncTouch } from '../dnc'

function touch(id: string, at: string, over: Row): Row {
  return {
    id,
    contact_id: 'c1',
    channel: 'phone',
    direction: 'outbound',
    occurred_at: at,
    summary: null,
    raw: null,
    metadata: {},
    source: 'me_manual',
    ...over,
  }
}

const DO_NOT_CALL = touch('t1', '2026-10-01T00:00:00.000Z', { metadata: { outcome: 'do_not_call', do_not_contact: false } })
const DO_NOT_CONTACT = touch('t2', '2026-10-02T00:00:00.000Z', { metadata: { outcome: 'do_not_contact', do_not_contact: true } })
const FB_FORM = touch('t3', '2026-10-04T00:00:00.000Z', {
  channel: 'meta_lead_form',
  direction: 'inbound',
  source: 'meta_lead_form',
})

function asDnc(rows: Row[]): DncTouch[] {
  return rows.map((r) => {
    const m = (r.metadata ?? {}) as Row
    return { outcome: (m.outcome as string) ?? null, flagged: m.do_not_contact === true, occurredAt: r.occurred_at as string }
  })
}

async function sweepOnce() {
  const [cand] = await loadReengageCandidates('cts')
  const decision = decideReengageClear(cand.input)
  if (!decision.clear) throw new Error(`expected a clear, got ${decision.why}`)
  await applyReengageClear('cts', 'c1', decision)
}

beforeEach(() => {
  db.contacts = [{ id: 'c1', do_not_contact: true, do_not_contact_reason: null }]
  db.written = []
  db.patches = []
})

describe('自动解除时保住「不要打电话」', () => {
  it('先说不要电话、后说别再联系、再填 Facebook 表单 → 解除后仍然不能打电话，但邮件放开', async () => {
    db.touches = [DO_NOT_CALL, DO_NOT_CONTACT, FB_FORM]
    await sweepOnce()
    const after = asDnc([...db.touches, ...db.written])
    expect(isDoNotContact(false, after)).toBe(false)
    expect(isDoNotCall(false, after)).toBe(true)
    const keep = db.written.find((w) => (w.metadata as Row).outcome === 'do_not_call')
    expect(keep).toMatchObject({
      channel: 'phone',
      direction: 'outbound',
      source: 'me_system',
      source_ref: 'dnc-reengage:c1:t3:keep-do-not-call',
      metadata: { outcome: 'do_not_call', do_not_contact: false, automated: true, kept_by: 'system:customer-reengaged' },
    })
  })

  it('之前没说过不要电话 → 只写解除那一条，不多写', async () => {
    db.touches = [DO_NOT_CONTACT, FB_FORM]
    await sweepOnce()
    expect(db.written).toHaveLength(1)
    expect((db.written[0].metadata as Row).outcome).toBe('dnc_cleared')
    expect(isDoNotCall(false, asDnc([...db.touches, ...db.written]))).toBe(false)
  })
})
