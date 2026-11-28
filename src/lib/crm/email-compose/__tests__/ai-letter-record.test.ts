// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { LINK_REFUSAL, linkAiLetterForSend, parseAiLetterId, parseSurface, recordAiDraft } from '../ai-letter-record'

type Row = Record<string, unknown>

/** A tiny in-memory stand-in for the one table, enough for insert / select-eq-maybeSingle / update-eq-select. */
function fakeDb(rows: Row[], opts: { failInsert?: boolean; failUpdate?: boolean } = {}) {
  const writes: Array<{ op: string; values: Row }> = []
  const db = {
    from(table: string) {
      if (table !== 'crm_ai_letters') throw new Error(`unexpected table ${table}`)
      const filters: Array<[string, unknown]> = []
      const match = (r: Row) => filters.every(([k, v]) => r[k] === v)
      let pending: { op: 'insert' | 'update'; values: Row } | null = null
      const q = {
        insert(values: Row) { pending = { op: 'insert', values }; return q },
        update(values: Row) { pending = { op: 'update', values }; return q },
        select() { return q },
        eq(k: string, v: unknown) { filters.push([k, v]); return q },
        async single() {
          if (opts.failInsert) return { data: null, error: { message: 'boom' } }
          const row = { id: `id-${rows.length + 1}`, request_id: null, ...pending!.values }
          rows.push(row); writes.push({ op: 'insert', values: pending!.values })
          return { data: { id: row.id }, error: null }
        },
        async maybeSingle() { return { data: rows.find(match) ?? null, error: null } },
        then(resolve: (v: unknown) => void) {
          if (pending?.op === 'update') {
            if (opts.failUpdate) return resolve({ data: null, error: { message: 'boom' } })
            const hit = rows.filter(match)
            for (const r of hit) Object.assign(r, pending.values)
            writes.push({ op: 'update', values: pending.values })
            return resolve({ data: hit.map((r) => ({ id: r.id })), error: null })
          }
          return resolve({ data: rows.filter(match), error: null })
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
    expect(LINK_REFUSAL.write_failed.status).toBe(503)
  })
})
