/**
 * The database side of a named letter (production code, fake database): its rows are `letter:<key>` of its trigger,
 * the claim goes to `triggered_send_claim_letter` with the letter key second, a decision is inserted in that scope,
 * annotations are a compare-and-set on a pending row, and a guest's letter rows are read in one bounded query.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createQueryStub, type RecordedCall } from '@/lib/crm/email-templates/__tests__/query-stub'
import { CLAIM_LEASE_MINUTES, createLetterLedger, createSendLedger, readLetterRows } from '../send-store'
import type { LifetimeRow } from '../send-types'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const CONTACT = 'b0000000-0000-4000-8000-000000000001'
const has = (calls: readonly RecordedCall[], method: string, ...args: unknown[]): boolean =>
  calls.some((c) => c.method === method && JSON.stringify(c.args) === JSON.stringify(args))

const ROW: LifetimeRow = {
  id: 'e0000000-0000-4000-8000-000000000001', contactId: CONTACT, status: 'pending', reasonCode: null, authorizationId: 'a0000000-0000-4000-8000-000000000001',
  idempotencyKey: 'k', renderedSha256: 'r', toAddressSha256: 't', firstAttemptAt: '2026-11-19T20:00:00+00:00', providerMessageId: null, attempts: 1, updatedAt: '2026-11-19T20:00:01.123456+00:00',
}
const INPUT = { authorizationId: ROW.authorizationId as string, contactId: CONTACT, toAddressSha256: 'a'.repeat(64), idempotencyKey: 'k', templateKey: 'auto-ai-catalogue', templateVersion: 2, templateSha256: 'b'.repeat(64), renderedSha256: 'c'.repeat(64), sourceRef: null, consentBasis: null }

describe('the ledger of one letter', () => {
  it('🔴 reads only this trigger\'s rows of this letter', async () => {
    const stub = createQueryStub({ triggered_sends: { data: [], error: null } })
    await createLetterLedger(stub.db, 'crm_ai_followup', 'catalogue_2027').rowsFor(CLIENT, [CONTACT])
    const q = stub.of('triggered_sends')
    for (const f of [['client_id', CLIENT], ['trigger_key', 'crm_ai_followup'], ['channel', 'email'], ['dedupe_scope', 'letter:catalogue_2027']]) expect(has(q, 'eq', ...f)).toBe(true)
  })

  it('🔴 the claim goes to triggered_send_claim_letter with the letter key; the welcome ledger still calls triggered_send_claim', async () => {
    const stub = createQueryStub({ 'rpc:triggered_send_claim_letter': { data: [{ outcome: 'letter_not_authorized', send_id: null, row_status: null, row_idempotency_key: null }], error: null } })
    expect(await createLetterLedger(stub.db, 'crm_ai_followup', 'catalogue_2027').claim(INPUT)).toEqual({ ok: true, outcome: 'letter_not_authorized', sendId: null, idempotencyKey: null })
    const call = stub.calls.find((c) => c.method === 'rpc')
    expect(call?.args[0]).toEqual({
      p_authorization_id: INPUT.authorizationId, p_letter_key: 'catalogue_2027', p_contact_id: CONTACT, p_to_address_sha256: INPUT.toAddressSha256, p_idempotency_key: 'k',
      p_template_key: 'auto-ai-catalogue', p_template_version: 2, p_template_sha256: INPUT.templateSha256, p_rendered_sha256: INPUT.renderedSha256, p_source_ref: null, p_consent_basis: null, p_lease_minutes: CLAIM_LEASE_MINUTES,
    })
    const welcome = createQueryStub({ 'rpc:triggered_send_claim': { data: [{ outcome: 'claimed', send_id: ROW.id, row_idempotency_key: 'k' }], error: null } })
    expect(await createSendLedger(welcome.db).claim(INPUT)).toMatchObject({ ok: true, outcome: 'claimed' })
    expect(welcome.calls.find((c) => c.method === 'rpc')?.args[0]).not.toHaveProperty('p_letter_key')
  })

  it('a decision is inserted in the letter\'s own scope and trigger', async () => {
    const stub = createQueryStub({ triggered_sends: { data: [{ id: ROW.id }], error: null } })
    await createLetterLedger(stub.db, 'crm_ai_followup', 'followup_d7').recordDecision({
      clientId: CLIENT, contactId: CONTACT, authorizationId: 'a', status: 'blocked', reasonCode: 'frequency_full', annotations: { request_ref: 'r1' }, toAddressSha256: null, consentBasis: null, sourceRef: null, existing: null,
    })
    const insert = stub.calls.find((c) => c.method === 'insert')
    expect(insert?.args[0]).toMatchObject({ trigger_key: 'crm_ai_followup', dedupe_scope: 'letter:followup_d7', status: 'blocked', annotations: { request_ref: 'r1' } })
  })

  it('🔴 annotations are written only on a row still pending and unchanged since it was read', async () => {
    const stub = createQueryStub({ triggered_sends: { data: [{ id: ROW.id }], error: null } })
    expect(await createLetterLedger(stub.db, 'crm_ai_followup', 'catalogue_2027').annotate(ROW, { link_tracking: { tagged: 0 } })).toEqual({ ok: true, result: 'updated' })
    const q = stub.of('triggered_sends')
    expect(has(q, 'update', { annotations: { link_tracking: { tagged: 0 } } })).toBe(true)
    expect(has(q, 'eq', 'status', 'pending') && has(q, 'eq', 'updated_at', ROW.updatedAt)).toBe(true)
  })
})

/** A query builder that also answers `.like` (the shared stub does not have it). */
function likeStub(result: { data: unknown; error: { code?: string; message: string } | null }): { db: SupabaseClient; calls: Array<[string, unknown[]]> } {
  const calls: Array<[string, unknown[]]> = []
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'like', 'limit']) {
    builder[m] = (...args: unknown[]) => {
      calls.push([m, args])
      return builder
    }
  }
  builder.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => Promise.resolve(result).then(resolve, reject)
  return { db: { from: vi.fn(() => builder) } as never, calls }
}

describe('readLetterRows', () => {
  const dbRow = (scope: string, status = 'sent') => ({
    id: `id-${scope}`, contact_id: CONTACT, status, reason_code: null, authorization_id: 'a', idempotency_key: 'k', rendered_sha256: 'r', to_address_sha256: 't',
    first_attempt_at: '2026-11-19T20:00:00Z', provider_message_id: 'm', attempts: 1, updated_at: 'u', dedupe_scope: scope, annotations: { request_ref: 'x' },
    template_key: 'auto-ai-d7', template_version: 1, template_sha256: 's', sent_at: '2026-11-19T20:00:01Z',
  })

  it('🔴 one guest, one trigger, letter scopes only; each row says which letter it is', async () => {
    const stub = likeStub({ data: [dbRow('letter:followup_d7'), dbRow('lifetime')], error: null })
    const read = await readLetterRows(stub.db, { clientId: CLIENT, triggerKey: 'crm_ai_followup', contactId: CONTACT })
    expect(read).toMatchObject({ ok: true, rows: [{ letterKey: 'followup_d7', status: 'sent', annotations: { request_ref: 'x' }, templateKey: 'auto-ai-d7', sentAt: '2026-11-19T20:00:01Z' }] })
    expect(read.ok && read.rows).toHaveLength(1)
    expect(stub.calls).toContainEqual(['eq', ['trigger_key', 'crm_ai_followup']])
    expect(stub.calls).toContainEqual(['eq', ['contact_id', CONTACT]])
    expect(stub.calls).toContainEqual(['like', ['dedupe_scope', 'letter:%']])
  })

  it('a failed read or more rows than a guest can have is a failure, never "none"', async () => {
    expect(await readLetterRows(likeStub({ data: null, error: { code: '08006', message: 'lead@example.org' } }).db, { clientId: CLIENT, triggerKey: 'crm_ai_followup', contactId: CONTACT })).toEqual({ ok: false, error: 'ledger read: 08006' })
    const many = Array.from({ length: 21 }, (_, i) => dbRow(`letter:l_${i}`))
    expect(await readLetterRows(likeStub({ data: many, error: null }).db, { clientId: CLIENT, triggerKey: 'crm_ai_followup', contactId: CONTACT })).toMatchObject({ ok: false })
  })
})
