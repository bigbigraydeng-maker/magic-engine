/**
 * The brief cycle picks a thread whose customer was rung after the stored brief was written, although no message is
 * new (CTS 2026-11-10: a 17-minute call never reached the summary). Same fake-database style as brief-cycle.test.ts,
 * but table-aware: conversations, phone touchpoints and AI call notes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface Rows {
  conversations: Record<string, unknown>[]
  contact_touchpoints: Record<string, unknown>[] | 'error'
  telephony_call_analyses: Record<string, unknown>[]
}
let db: Rows

function table(name: keyof Rows | 'clients') {
  const api: Record<string, unknown> = {}
  const done = () => {
    if (name === 'clients') return { data: [], error: null }
    const v = db[name]
    return v === 'error' ? { data: null, error: { message: 'read failed' } } : { data: v, error: null }
  }
  for (const m of ['select', 'gt', 'eq', 'in', 'gte', 'filter']) api[m] = () => api
  api.order = () => api
  api.limit = () => Promise.resolve(done())
  api.then = (resolve: (r: unknown) => unknown) => Promise.resolve(done()).then(resolve)
  return api
}

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: (t: keyof Rows | 'clients') => table(t) } }))

import { loadDueBriefs } from '../brief-cycle'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const NOW = new Date('2026-11-11T00:00:00.000Z')
const QUIET = '2026-11-10T06:32:23.000Z'

function conversation(briefGeneratedAt: string | null) {
  return {
    id: 'conv-1',
    client_id: CLIENT,
    contact_id: 'contact-1',
    channel: 'messenger',
    message_count: 3,
    last_message_at: QUIET,
    last_message_from: 'page',
    conversation_briefs: briefGeneratedAt
      ? [{ source_message_count: 3, regen_count: 0, regen_count_date: null, knowledge_status: 'ok', generated_at: briefGeneratedAt }]
      : [],
  }
}

const callTouch = { contact_id: 'contact-1', occurred_at: '2026-11-10T05:58:34+00:00', metadata: { call_analysis_id: 'a1' } }
const callNote = { id: 'a1', summary: 'wants March', created_at: '2026-11-10T06:18:00+00:00' }

beforeEach(() => {
  db = { conversations: [], contact_touchpoints: [], telephony_call_analyses: [] }
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('loadDueBriefs — phone calls', () => {
  it('🔴 call note newer than the brief, no new message → the thread is picked and flagged', async () => {
    db.conversations = [conversation('2026-11-10T05:00:00.000Z')]
    db.contact_touchpoints = [callTouch]
    db.telephony_call_analyses = [callNote]
    const due = await loadDueBriefs(NOW)
    expect(due.map((d) => d.conversationId)).toEqual(['conv-1'])
    expect(due[0]?.callsSinceBrief).toBe(true)
    expect(due[0]?.contactId).toBe('contact-1')
  })

  it('brief newer than the call note → not picked (no rewrite every hour)', async () => {
    db.conversations = [conversation('2026-11-10T07:12:19.000Z')]
    db.contact_touchpoints = [callTouch]
    db.telephony_call_analyses = [callNote]
    expect(await loadDueBriefs(NOW)).toEqual([])
  })

  it('no calls at all → same as before this feature (nothing new, nothing picked)', async () => {
    db.conversations = [conversation('2026-11-10T07:12:19.000Z')]
    expect(await loadDueBriefs(NOW)).toEqual([])
  })

  it('call table unreadable → logged, behaviour exactly as before (not picked, and the run does not fail)', async () => {
    db.conversations = [conversation('2026-11-10T05:00:00.000Z')]
    db.contact_touchpoints = 'error'
    await expect(loadDueBriefs(NOW)).resolves.toEqual([])
    expect(console.error).toHaveBeenCalled()
  })

  it('a thread without a brief yet is picked by the old rule, not by the call rule', async () => {
    db.conversations = [conversation(null)]
    db.contact_touchpoints = [callTouch]
    db.telephony_call_analyses = [callNote]
    const due = await loadDueBriefs(NOW)
    expect(due).toHaveLength(1)
    expect(due[0]?.callsSinceBrief).toBeUndefined()
  })
})
