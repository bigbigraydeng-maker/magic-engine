/**
 * The store's writes are conditional on the state they expect (a stale page or a double click changes nothing). The
 * database guards hold anyway, but without these conditions a race answers "500 something broke" instead of "409 already
 * handled": these tests pin every condition and the error-code mapping, on the repository's recording query stand-in.
 * The real table is exercised by scripts/db-behavior/triggered-send-authorization-e2e.mts.
 */
import { describe, expect, it } from 'vitest'
import { createQueryStub, ok, type RecordedCall, type StubResult } from '@/lib/crm/email-templates/__tests__/query-stub'
import { activateAuthorization, authorizeProposal, insertProposal, revokeAuthorization } from '../authorization-store'

const TABLE = 'triggered_send_authorizations'

const ROW = {
  id: 'r1',
  request_id: 'q1',
  client_id: 'c1',
  trigger_key: 'welcome',
  channel: 'email',
  account: 'cts',
  rule: {},
  rule_sha256: 'a'.repeat(64),
  template_version: 1,
  template_sha256: 'b'.repeat(64),
  daily_cap: 1,
  proposed_by_email: 'x@example.com',
  proposed_at: 'now',
  authorized_by_email: null,
  authorized_at: null,
  live_from: null,
  expires_at: null,
  activated_at: null,
  revoked_at: null,
  revoked_by: null,
  revoked_reason: null,
}

/** A database error with its SQLSTATE, the way supabase-js hands it over. */
function failWithCode(code: string): StubResult {
  return { data: null, error: Object.assign({ message: `failed ${code}` }, { code }) }
}

function stub(result: StubResult) {
  return createQueryStub({ [TABLE]: result })
}

const conditions = (calls: RecordedCall[]) =>
  calls.filter((c) => c.method === 'eq' || c.method === 'is' || c.method === 'not').map((c) => [c.method, ...c.args].join(' '))

describe('authorization store — every write is conditional', () => {
  it('revoke only touches a row that is not revoked yet; an empty reason is stored as no reason', async () => {
    const s = stub(ok([ROW]))
    await revokeAuthorization(s.db, { id: 'r1', by: 'pm@example.com', reason: '   ' })
    expect(conditions(s.calls)).toEqual(['eq id r1', 'is revoked_at '])
    expect(s.calls.find((c) => c.method === 'update')?.args[0]).toMatchObject({ revoked_by: 'pm@example.com', revoked_reason: null })
  })

  it('authorize only touches an open proposal (not authorized, not revoked)', async () => {
    const s = stub(ok([ROW]))
    await authorizeProposal(s.db, { id: 'r1', byEmail: 'pm@example.com', byUserId: 'u1', liveFrom: 'a', expiresAt: 'b' })
    expect(conditions(s.calls)).toEqual(['eq id r1', 'is authorized_at ', 'is revoked_at '])
  })

  it('arming only touches an authorized, unarmed, unrevoked row', async () => {
    const s = stub(ok([ROW]))
    await activateAuthorization(s.db, 'r1')
    expect(conditions(s.calls)).toEqual(['eq id r1', 'is activated_at ', 'is revoked_at ', 'not authorized_at is '])
  })

  it('no row written = not_open (someone else got there first), never a pretend success', async () => {
    expect(await revokeAuthorization(stub(ok([])).db, { id: 'r1', by: 'x@example.com', reason: 'r' })).toEqual({ ok: false, code: 'not_open' })
    expect(await authorizeProposal(stub(ok([])).db, { id: 'r1', byEmail: 'x@example.com', byUserId: 'u', liveFrom: 'a', expiresAt: 'b' })).toEqual({
      ok: false,
      code: 'not_open',
    })
    expect(await activateAuthorization(stub(ok([])).db, 'r1')).toEqual({ ok: false, code: 'not_open' })
  })

  it('maps the database answers: unique → conflict / authorized_exists, CHECK passes through, anything odd → unknown', async () => {
    const proposal = {
      requestId: 'q',
      clientId: 'c',
      triggerKey: 'welcome' as const,
      channel: 'email' as const,
      account: 'cts',
      rule: {},
      ruleSha256: 'a'.repeat(64),
      templateVersion: 1,
      templateSha256: 'b'.repeat(64),
      dailyCap: 1,
      proposedByEmail: 'x@example.com',
    }
    expect(await insertProposal(stub(failWithCode('23505')).db, proposal)).toEqual({ ok: false, code: 'proposal_conflict' })
    const auth = { id: 'r1', byEmail: 'x@example.com', byUserId: 'u', liveFrom: 'a', expiresAt: 'b' }
    expect(await authorizeProposal(stub(failWithCode('23505')).db, auth)).toEqual({ ok: false, code: 'authorized_exists' })
    expect(await authorizeProposal(stub(failWithCode('23514')).db, auth)).toEqual({ ok: false, code: '23514' })
    expect(await authorizeProposal(stub(failWithCode('a long code with spaces')).db, auth)).toEqual({ ok: false, code: 'unknown' })
  })
})
