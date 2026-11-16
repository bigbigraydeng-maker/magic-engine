/** Shared test world for the AI pickup run and list: REAL Supabase client, stub network that applies eq / in / gte. */
import { createClient } from '@supabase/supabase-js'

export const CLIENT = 'c0000000-0000-4000-8000-000000000001'
export const OTHER = 'c0000000-0000-4000-8000-000000000002'
export const NOW = new Date('2026-11-16T18:45:00.000Z')
export const LEAD = '2026-11-12T01:00:00.000Z'
export const at = (minutes: number) => new Date(Date.parse(LEAD) + minutes * 60_000).toISOString()

export type Row = Record<string, unknown>
const META_PARAMS = new Set(['select', 'order', 'offset', 'limit'])

function matches(row: Row, key: string, cond: string): boolean {
  const v = row[key]
  if (cond.startsWith('eq.')) return String(v) === cond.slice(3)
  if (cond.startsWith('in.(')) return new Set(cond.slice(4, -1).split(',').map((s) => s.replace(/^"|"$/g, ''))).has(String(v))
  if (cond.startsWith('gte.')) return Date.parse(String(v)) >= Date.parse(cond.slice(4))
  throw new Error(`stub does not understand ${key}=${cond}`)
}

export function db(tables: Record<string, Row[]>, writes: string[]) {
  const stub = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    const table = url.pathname.split('/').pop() ?? ''
    if ((init?.method ?? 'GET') !== 'GET') {
      writes.push(`${init?.method} ${table}`)
      return new Response('[]', { status: 201, headers: { 'content-type': 'application/json' } })
    }
    let rows = tables[table] ?? []
    url.searchParams.forEach((cond, key) => {
      if (!META_PARAMS.has(key)) rows = rows.filter((r) => matches(r, key, cond))
    })
    return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return createClient('https://proj.supabase.co', 'service-key', { global: { fetch: stub } })
}

export const form = (id: string, contact: string, occurred = LEAD, client = CLIENT): Row =>
  ({ id, client_id: client, contact_id: contact, channel: 'meta_lead_form', direction: 'inbound', occurred_at: occurred, summary: null, raw: null, metadata: {}, source: 'meta_lead_form' })
export const voicemail = (id: string, contact: string, minutes: number): Row =>
  ({ id, client_id: CLIENT, contact_id: contact, channel: 'phone', direction: 'outbound', occurred_at: at(minutes), summary: null, raw: null, metadata: { customer_spoke: 'no', outcome: 'spoke', talk_seconds: 30 }, source: 'twilio' })
export const talked = (id: string, contact: string, minutes: number): Row => ({ ...voicemail(id, contact, minutes), metadata: { customer_spoke: 'yes', talk_seconds: 200 } })
export const contact = (id: string, stage = 'contacted', client = CLIENT): Row => ({ id, client_id: client, do_not_contact: false, stage, snooze_until: null, ai_takeover_since: null })
export const email = (contactId: string, client = CLIENT): Row => ({ id: `e-${contactId}`, client_id: client, contact_id: contactId, kind: 'email', value: `${contactId}@x.co` })

export function world(): Record<string, Row[]> {
  return {
    contacts: [contact('a'), contact('b'), contact('c', 'new'), contact('d', 'new'), contact('q', 'quoted'), contact('z', 'contacted', OTHER)],
    client_pipeline_stages: [
      { client_id: CLIENT, stage_key: 'new', marketing_action: 'nurture', is_terminal: false, sort_order: 1 },
      { client_id: CLIENT, stage_key: 'contacted', marketing_action: 'nurture', is_terminal: false, sort_order: 2 },
      { client_id: CLIENT, stage_key: 'quoted', marketing_action: 'nurture', is_terminal: false, sort_order: 3 },
    ],
    ad_strategy_configs: [{ client_id: CLIENT, qualified_stage_keys: ['quoted', 'deposit_paid'] }],
    contact_touchpoints: [
      // the client's first tracked call (calls are tracked from 10-12); the stub returns rows in this order
      { ...voicemail('v0', 'old', 0), occurred_at: '2026-10-12T00:00:00.000Z' },
      form('fa', 'a'), voicemail('va', 'a', 60),            // a: rang, voicemail → AI
      form('fb', 'b'), voicemail('vb', 'b', 60), talked('tb', 'b', 300), // b: reached later → staff
      form('fc', 'c', '2026-11-05T01:00:00.000Z'),            // c: 11 days, never rung → AI
      form('fd', 'd'),                                         // d: 4 days, never rung → wait
      form('fq', 'q'), voicemail('vq', 'q', 60),              // q: quoted (qualified) → staff
      form('fz', 'z', LEAD, OTHER), voicemail('vz', 'z', 60),  // another client, not opted in
    ],
    contact_automation_events: [],
    contact_identities: [email('a'), email('b'), email('c'), email('d'), email('q'), email('z', OTHER)],
    crm_bookings: [],
  }
}

