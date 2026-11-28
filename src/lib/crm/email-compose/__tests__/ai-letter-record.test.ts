// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { LINK_REFUSAL, linkAiLetterForSend, parseAiLetterId, parseSurface, recordAiDraft } from '../ai-letter-record'

type Row = Record<string, unknown>

/** A tiny in-memory stand-in: insert / select-eq-neq-in-or-limit-maybeSingle / update, on two tables. */
function fakeDb(rows: Row[], opts: { failInsert?: boolean; failUpdate?: boolean; receipts?: Row[]; log?: Row[] } = {}) {
  const writes: Array<{ op: string; values: Row }> = []
  const tables: Record<string, Row[]> = { crm_ai_letters: rows, crm_email_send_receipts: opts.receipts ?? [], conversation_outbound_log: opts.log ?? [] }
  const db = {
    from(table: string) {
      const data = tables[table]
      if (!data) throw new Error(`unexpected table ${table}`)
      const tests: Array<(r: Row) => boolean> = []
      const match = (r: Row) => tests.every((t) => t(r))
      let pending: { op: 'insert' | 'update'; values: Row } | null = null
      const q = {
        insert(values: Row) { pending = { op: 'insert', values }; return q },
        update(values: Row) { pending = { op: 'update', values }; return q },
        select() { return q },
        limit() { return q },
        like(k: string, pat: string) { const pre = pat.replace(/%$/, ''); tests.push((r) => String(r[k] ?? '').startsWith(pre)); return q },
        eq(k: string, v: unknown) { tests.push((r) => r[k] === v); return q },
        neq(k: string, v: unknown) { tests.push((r) => r[k] !== v); return q },
        in(k: string, vs: unknown[]) { tests.push((r) => vs.includes(r[k])); return q },
        or(expr: string) {
          // only the form used: request_id.is.null,request_id.eq.<id>
          const id = expr.split('request_id.eq.')[1]
          tests.push((r) => r.request_id === null || r.request_id === undefined || r.request_id === id)
          return q
        },
        async single() {
          if (opts.failInsert) return { data: null, error: { message: 'boom' } }
          const row = { id: `id-${data.length + 1}`, request_id: null, ...pending!.values }
          data.push(row); writes.push({ op: 'insert', values: pending!.values })
          return { data: { id: row.id }, error: null }
        },
        async maybeSingle() { const hit = data.find(match); return { data: hit ? { ...hit } : null, error: null } },
        then(resolve: (v: unknown) => void) {
          if (pending?.op === 'update') {
            if (opts.failUpdate) return resolve({ data: null, error: { message: 'boom' } })
            const hit = data.filter(match)
            for (const r of hit) Object.assign(r, pending.values)
            writes.push({ op: 'update', values: pending.values })
            return resolve({ data: hit.map((r) => ({ id: r.id })), error: null })
          }
          return resolve({ data: data.filter(match), error: null })
        },
      }
      return q
    },
  }
  return { db: db as unknown as SupabaseClient, rows, writes }
}

const NOW = new Date('2026-11-28T09:00:00Z')
const base = { id: 'L1', client_id: 'c1', contact_id: 'g1', ai_subject: 'S', ai_body: 'B', request_id: null }
const link = (over: Partial<Parameters<typeof linkAiLetterForSend>[1]> = {}) => ({
  clientId: 'c1', contactId: 'g1', aiLetterId: 'L1', requestId: 'r1', actorEmail: 'staff@x.co', subject: 'S', body: 'B', now: NOW, ...over,
})

describe('parse helpers', () => {
  it('surface: missing → drawer; known values pass; anything else is invalid', () => {
    expect(parseSurface(undefined)).toBe('drawer')
    expect(parseSurface('day7_page')).toBe('day7_page')
    expect(parseSurface('letters_page')).toBe('letters_page')
    expect(parseSurface('elsewhere')).toBeNull()
    expect(parseSurface(3)).toBeNull()
  })
  it('ai letter id: missing → not an AI letter; a uuid passes; anything else is invalid, never "not AI"', () => {
    expect(parseAiLetterId(undefined)).toEqual({ ok: true, id: null })
    expect(parseAiLetterId('0b9c2a51-1d2e-4c4b-9a1e-5f2f0d3c4b5a')).toEqual({ ok: true, id: '0b9c2a51-1d2e-4c4b-9a1e-5f2f0d3c4b5a' })
    expect(parseAiLetterId('not-a-uuid')).toEqual({ ok: false })
    expect(parseAiLetterId(42)).toEqual({ ok: false })
  })
})

describe('recordAiDraft', () => {
  it('writes one row with where, what the AI wrote, its checks and who asked', async () => {
    const f = fakeDb([])
    const id = await recordAiDraft(f.db, { clientId: 'c1', contactId: 'g1', surface: 'letters_page', kind: 'follow_up', subject: 'S', body: 'B', checks: [{ id: 'p', status: 'pass', label: '价格', detail: 'ok' }], actorEmail: 'staff@x.co' })
    expect(id).toBe('id-1')
    expect(f.writes[0].values).toMatchObject({ client_id: 'c1', contact_id: 'g1', surface: 'letters_page', draft_kind: 'follow_up', ai_subject: 'S', ai_body: 'B', drafted_by: 'staff@x.co' })
  })
  it('throws when the row cannot be written (the caller then withholds the draft)', async () => {
    await expect(recordAiDraft(fakeDb([], { failInsert: true }).db, { clientId: 'c1', contactId: 'g1', surface: 'drawer', kind: 'first', subject: 'S', body: 'B', checks: [], actorEmail: 'a' })).rejects.toThrow()
  })
})

describe('linkAiLetterForSend', () => {
  it('unedited: ties the send, records the final text, who released it and when, edited = false', async () => {
    const f = fakeDb([{ ...base }])
    expect(await linkAiLetterForSend(f.db, link())).toEqual({ ok: true, edited: false })
    expect(f.rows[0]).toMatchObject({ request_id: 'r1', released_by: 'staff@x.co', released_at: NOW.toISOString(), final_subject: 'S', final_body: 'B', edited: false })
  })
  it('edited text → edited = true, the final text is what goes', async () => {
    const f = fakeDb([{ ...base }])
    expect(await linkAiLetterForSend(f.db, link({ body: 'B, changed by staff' }))).toEqual({ ok: true, edited: true })
    expect(f.rows[0].final_body).toBe('B, changed by staff')
  })
  it("another client's or another guest's letter → not found, nothing written", async () => {
    const f = fakeDb([{ ...base }])
    expect(await linkAiLetterForSend(f.db, link({ clientId: 'c2' }))).toEqual({ ok: false, reason: 'not_found' })
    expect(await linkAiLetterForSend(f.db, link({ contactId: 'g2' }))).toEqual({ ok: false, reason: 'not_found' })
    expect(f.writes).toHaveLength(0)
  })
  it('a letter already tied to another send is refused; a retry of the same send passes', async () => {
    const f = fakeDb([{ ...base, request_id: 'r0' }])
    expect(await linkAiLetterForSend(f.db, link())).toEqual({ ok: false, reason: 'other_send' })
    expect(await linkAiLetterForSend(f.db, link({ requestId: 'r0' }))).toEqual({ ok: true, edited: false })
  })
  it('the write fails → refused, so the send does not run', async () => {
    expect(await linkAiLetterForSend(fakeDb([{ ...base }], { failUpdate: true }).db, link())).toEqual({ ok: false, reason: 'write_failed' })
    // 409, not 503: the pages read 503 as "outcome unknown, do not resend", but nothing was sent.
    expect(LINK_REFUSAL.write_failed.status).toBe(409)
  })

  it('redrafted after a refused send, same request id: the older unsent letter lets go of it and the new one is tied', async () => {
    const f = fakeDb([{ ...base, id: 'OLD', request_id: 'r1', final_body: 'old' }, { ...base }], { receipts: [{ client_id: 'c1', request_id: 'r1', outcome: 'blocked' }] })
    expect(await linkAiLetterForSend(f.db, link())).toEqual({ ok: true, edited: false })
    expect(f.rows.find((r) => r.id === 'OLD')).toMatchObject({ request_id: null, final_body: null, released_by: null })
    expect(f.rows.find((r) => r.id === 'L1')).toMatchObject({ request_id: 'r1' })
  })

  it('same request id held by another letter whose send went out (or may have) → refused, nothing changed', async () => {
    for (const outcome of ['sent', 'unknown']) {
      const f = fakeDb([{ ...base, id: 'OLD', request_id: 'r1' }, { ...base }], { receipts: [{ client_id: 'c1', request_id: 'r1', outcome }] })
      expect(await linkAiLetterForSend(f.db, link())).toEqual({ ok: false, reason: 'other_send' })
      expect(f.rows.find((r) => r.id === 'OLD')?.request_id).toBe('r1')
      expect(f.rows.find((r) => r.id === 'L1')?.request_id).toBeNull()
    }
  })

  it('two sends racing for one letter: the update only lands while the letter is free or tied to this send', async () => {
    const f = fakeDb([{ ...base }])
    // the first send ties the letter between this send's read and its write
    const raced = f.db
    const realFrom = raced.from.bind(raced)
    let reads = 0
    ;(raced as unknown as { from: typeof realFrom }).from = ((t: string) => {
      const q = realFrom(t)
      const realMaybe = (q as unknown as { maybeSingle: () => Promise<unknown> }).maybeSingle
      ;(q as unknown as { maybeSingle: () => Promise<unknown> }).maybeSingle = async () => {
        const out = await realMaybe()
        if (t === 'crm_ai_letters' && reads++ === 0) f.rows[0].request_id = 'r-other'
        return out
      }
      return q
    }) as typeof realFrom
    expect(await linkAiLetterForSend(raced, link())).toEqual({ ok: false, reason: 'write_failed' })
    expect(f.rows[0].request_id).toBe('r-other')
  })

  it('the older letter\'s send started but left no receipt yet (in flight, or a client without receipts) → refused, nothing freed', async () => {
    const f = fakeDb([{ ...base, id: 'OLD', request_id: 'r1' }, { ...base }], { log: [{ client_id: 'c1', meta_message_id: 'req:r1|msg:m', status: 'pending' }] })
    expect(await linkAiLetterForSend(f.db, link())).toEqual({ ok: false, reason: 'other_send' })
    expect(f.rows.find((r) => r.id === 'OLD')?.request_id).toBe('r1')
  })

  it('the older letter was released moments ago (its send may hold the lock with nothing written) → not freed, retry later', async () => {
    const f = fakeDb([{ ...base, id: 'OLD', request_id: 'r1', released_at: new Date(NOW.getTime() - 60_000).toISOString() }, { ...base }])
    expect(await linkAiLetterForSend(f.db, link())).toEqual({ ok: false, reason: 'write_failed' })
    expect(f.rows.find((r) => r.id === 'OLD')?.request_id).toBe('r1')
  })
})
