import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Static guard for the CRM list change log migration. The behaviour itself was run
 * against a real Postgres 17 (scenarios: docs/ledger/evidence/2026-11-16-crm-list-change-log-scenarios.sql);
 * this file keeps the properties that must never be edited away.
 */
const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261116100000_crm_list_change_log.sql'), 'utf8')
// Comments describe the alternatives that were rejected; only executable SQL is checked.
const code = sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n')

/** Every table the two list endpoints read (design doc section 5). */
const LIST_TABLES = [
  'contacts', 'contact_touchpoints', 'contact_identities', 'conversations', 'conversation_briefs',
  'contact_stage_events', 'client_pipeline_stages', 'tailor_made_itineraries',
]

describe('crm list change log migration', () => {
  it('watches every table the list reads', () => {
    for (const table of LIST_TABLES) expect(code).toContain(`'${table}'`)
    for (const op of ['insert', 'update', 'delete']) {
      expect(code).toContain(`after ${op} on public.conversation_messages`)
      expect(code).toMatch(new RegExp(`after ${op} on public\\.%I`))
    }
    expect(code).toContain('after update of leads_config, country on public.clients')
  })

  it('fires once per statement, after the write, and never returns a row', () => {
    expect(code.match(/for each statement execute function/g)).toHaveLength(6)
    expect(code.match(/for each row/g)).toHaveLength(1) // clients only: column-list triggers cannot use transition tables
    expect(code).not.toMatch(/create trigger \w+ before /)
    expect(code.match(/return null;/g)).toHaveLength(3)
  })

  it('records both the old and the new client of a changed row, including rows whose id changed', () => {
    expect(code).toContain('(values (changed.old_client), (changed.new_client))')
    expect(code.match(/full join new_rows n on n\.id = o\.id/g)).toHaveLength(2)
    expect(code.match(/o\.id is null or n\.id is null or to_jsonb\(o\) is distinct from to_jsonb\(n\)/g)).toHaveLength(2)
  })

  it('finds the client of a message through its conversation', () => {
    expect(code).toContain('from new_rows n join public.conversations c on c.id = n.conversation_id')
    expect(code).toContain('from old_rows o join public.conversations c on c.id = o.conversation_id')
    expect(code).toContain('join public.conversations c on c.id in (o.conversation_id, n.conversation_id)')
  })

  it('gives up instead of queueing behind a long transaction when taking table locks', () => {
    expect(code.indexOf("set lock_timeout = '3s'")).toBeGreaterThan(-1)
    expect(code.indexOf("set lock_timeout = '3s'")).toBeLessThan(code.indexOf('create table'))
    expect(code).toContain('reset lock_timeout')
  })

  it('only appends: never updates a shared row, so writers cannot wait on each other', () => {
    expect(code).not.toMatch(/update\s+public\.crm_list_change_log/i)
    expect(code).not.toMatch(/on conflict/i)
  })

  it('cannot fail a business write through a foreign key', () => {
    const table = code.slice(code.indexOf('create table public.crm_list_change_log'), code.indexOf('create index'))
    expect(table).not.toMatch(/references/i)
  })

  it('compares rows with to_jsonb so column types without an equality operator cannot raise', () => {
    expect(code.match(/to_jsonb\(o\) is distinct from to_jsonb\(n\)/g)).toHaveLength(2)
    expect(code).not.toMatch(/\bo\.\* is distinct from/)
    expect(code).not.toMatch(/\bo is distinct from n\b/)
  })

  it('trigger functions are security definer with an empty search_path and no public execute', () => {
    const functions = ['crm_list_change_log_by_client', 'crm_list_change_log_by_conversation', 'crm_list_change_log_for_client_row']
    for (const name of functions) {
      const start = code.indexOf(`function public.${name}()`)
      const head = code.slice(start, code.indexOf('as $$', start))
      expect(head).toContain('security definer')
      expect(head).toContain("set search_path = ''")
      expect(code).toContain(`revoke all on function public.${name}() from public, anon, authenticated`)
    }
  })

  it('is read-only for the service role and invisible to everyone else', () => {
    expect(code).toContain('enable row level security')
    expect(code).toMatch(/for select\s+to service_role\s+using \(true\);/)
    expect(code).not.toMatch(/for all\s+to service_role/)
    expect(code).toContain('revoke all on public.crm_list_change_log from anon, authenticated, service_role')
    expect(code).toContain('grant select on public.crm_list_change_log to service_role')
  })
})
