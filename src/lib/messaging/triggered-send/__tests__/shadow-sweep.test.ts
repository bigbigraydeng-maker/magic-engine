import { describe, it, expect, vi } from 'vitest'
import { runShadowSweep, type SweepDeps } from '../shadow-sweep'
import { ruleSha256, type TriggeredSendRule } from '../rule'
import { addressSha256, type ShadowRowInput } from '../shadow-store'
import type {
  AuthorizationRead,
  ContactsRead,
  LegacyBatchSeen,
  MailboxCheck,
  OpenAuthorization,
  ShadowContact,
  ShadowGatePorts,
  ShadowRowsRead,
} from '../types'

const NOW = new Date('2026-11-02T20:15:00Z')
const PROPOSED_AT = '2026-10-30T00:00:00Z'
const SWEEP_DAY = '2026-11-03'

function makeRule(): TriggeredSendRule {
  return {
    gate_contract_version: 1,
    audience: { sources: ['meta_lead_form'], max_age_days: 3, min_age: 'previous_local_day' },
    schedule: { timezone: 'Pacific/Auckland' },
    frequency_cap: { max: 2, window_days: 7 },
    consent: { accepted_bases: ['form_disclosure_attested'] },
    legacy: { mailchimp_campaign_title_prefix: 'legacy_batch_' },
    human_mail: { required_mailboxes: ['sales@example.com'] },
    recipient_allowlist: null,
  }
}

function makeAuth(overrides: Partial<OpenAuthorization> = {}): OpenAuthorization {
  const rule = makeRule()
  return {
    id: 'auth-1',
    clientId: 'client-1',
    rule,
    ruleSha256: ruleSha256(rule),
    proposedAt: PROPOSED_AT,
    authorized: false,
    ...overrides,
  }
}

function contact(id: string, createdAt: string, email: string | null = `${id}@example.com`): ShadowContact {
  return {
    contactId: id,
    createdAt,
    primaryEmail: email,
    addresses: email === null ? [] : [email],
  }
}

interface FakePortsOptions {
  dncBlocked?: (contactId: string) => boolean
  evidenceFail?: (contactId: string) => boolean
  onCall?: (contactId: string, method: string) => void
}

function makePorts(opts: FakePortsOptions = {}): ShadowGatePorts {
  const wrap = <T>(contactId: string, method: string, value: T): Promise<T> => {
    opts.onCall?.(contactId, method)
    return Promise.resolve(value)
  }
  return {
    consent: (contactId) =>
      wrap(contactId, 'consent', { ok: true, bases: ['form_disclosure_attested'], sourceRef: null }),
    dnc: (contactId) => wrap(contactId, 'dnc', { ok: true, blocked: opts.dncBlocked?.(contactId) ?? false }),
    member: (contactId) => wrap(contactId, 'member', { ok: true, state: 'active' }),
    evidence: (contact) =>
      opts.evidenceFail?.(contact.contactId)
        ? wrap(contact.contactId, 'evidence', { ok: false, error: 'evidence down' })
        : wrap(contact.contactId, 'evidence', {
            ok: true,
            items: [],
            isLegacyBatchItem: () => false,
          }),
  }
}

interface FakeDepsOptions {
  auth?: AuthorizationRead
  contacts?: ContactsRead
  shadowRows?: ShadowRowsRead
  mailbox?: MailboxCheck
  ports?: ShadowGatePorts
  legacyBatches?: LegacyBatchSeen[]
  insert?: { ok: true; inserted: number } | { ok: false; error: string }
  onCall?: (contactId: string, method: string) => void
}

interface FakeDeps {
  deps: SweepDeps
  loadAuthorization: ReturnType<typeof vi.fn>
  loadContacts: ReturnType<typeof vi.fn>
  findContactsWithShadowRows: ReturnType<typeof vi.fn>
  checkMailboxes: ReturnType<typeof vi.fn>
  createPorts: ReturnType<typeof vi.fn>
  insertShadowRows: ReturnType<typeof vi.fn>
}

function makeDeps(opts: FakeDepsOptions = {}): FakeDeps {
  const loadAuthorization = vi.fn(async (): Promise<AuthorizationRead> => opts.auth ?? { ok: true, row: makeAuth() })
  const loadContacts = vi.fn(async (): Promise<ContactsRead> => opts.contacts ?? { ok: true, contacts: [] })
  const findContactsWithShadowRows = vi.fn(
    async (): Promise<ShadowRowsRead> => opts.shadowRows ?? { ok: true, contactIds: new Set() },
  )
  const checkMailboxes = vi.fn(async (): Promise<MailboxCheck> => opts.mailbox ?? { ok: true })
  // Like the real ports: the old batch campaigns are only known after the evidence port has been read.
  const createPorts = vi.fn(() => {
    let evidenceRead = false
    const base = opts.ports ?? makePorts({ onCall: opts.onCall })
    const ports: ShadowGatePorts = {
      ...base,
      evidence: (c) => {
        evidenceRead = true
        return base.evidence(c)
      },
    }
    return { ports, legacyBatches: () => (evidenceRead ? opts.legacyBatches ?? [] : []) }
  })
  const insertShadowRows = vi.fn(
    async (rows: readonly ShadowRowInput[]): Promise<{ ok: true; inserted: number } | { ok: false; error: string }> =>
      opts.insert ?? { ok: true, inserted: rows.length },
  )
  const deps: SweepDeps = {
    now: () => NOW,
    loadAuthorization,
    loadContacts,
    findContactsWithShadowRows,
    checkMailboxes,
    createPorts,
    insertShadowRows,
  }
  return { deps, loadAuthorization, loadContacts, findContactsWithShadowRows, checkMailboxes, createPorts, insertShadowRows }
}

describe('runShadowSweep — authorization and rule', () => {
  it('returns no_open_proposal when there is no open proposal and calls no later dep', async () => {
    const f = makeDeps({ auth: { ok: true, row: null } })
    const receipt = await runShadowSweep({ clientId: 'client-1', dryRun: false, deps: f.deps })
    expect(receipt.status).toBe('no_open_proposal')
    expect(receipt.authorization_id).toBeNull()
    expect(f.loadContacts).not.toHaveBeenCalled()
    expect(f.findContactsWithShadowRows).not.toHaveBeenCalled()
    expect(f.checkMailboxes).not.toHaveBeenCalled()
    expect(f.createPorts).not.toHaveBeenCalled()
    expect(f.insertShadowRows).not.toHaveBeenCalled()
  })

  it('returns read_failed when loadAuthorization fails', async () => {
    const f = makeDeps({ auth: { ok: false, error: 'db down' } })
    const receipt = await runShadowSweep({ clientId: 'client-1', dryRun: false, deps: f.deps })
    expect(receipt.status).toBe('read_failed')
    expect(receipt.error).toBe('db down')
    expect(f.loadContacts).not.toHaveBeenCalled()
  })

  it('returns rule_invalid when the rule does not parse', async () => {
    const f = makeDeps({ auth: { ok: true, row: makeAuth({ rule: { nope: true } }) } })
    const receipt = await runShadowSweep({ clientId: 'client-1', dryRun: false, deps: f.deps })
    expect(receipt.status).toBe('rule_invalid')
    expect(receipt.error).toBeTruthy()
    expect(f.loadContacts).not.toHaveBeenCalled()
    expect(f.insertShadowRows).not.toHaveBeenCalled()
  })

  it('returns rule_invalid when the sha does not match', async () => {
    const f = makeDeps({ auth: { ok: true, row: makeAuth({ ruleSha256: 'deadbeef' }) } })
    const receipt = await runShadowSweep({ clientId: 'client-1', dryRun: false, deps: f.deps })
    expect(receipt.status).toBe('rule_invalid')
    expect(receipt.error).toBe('rule_sha256 does not match the stored rule')
    expect(f.loadContacts).not.toHaveBeenCalled()
    expect(f.insertShadowRows).not.toHaveBeenCalled()
  })

  it('returns gate_changed when the gate contract version differs', async () => {
    const rule = { ...makeRule(), gate_contract_version: 2 }
    const f = makeDeps({ auth: { ok: true, row: makeAuth({ rule, ruleSha256: ruleSha256(rule) }) } })
    const receipt = await runShadowSweep({ clientId: 'client-1', dryRun: false, deps: f.deps })
    expect(receipt.status).toBe('gate_changed')
    expect(receipt.error).toBe('rule has gate_contract_version 2 but the code is 1')
    expect(f.loadContacts).not.toHaveBeenCalled()
    expect(f.insertShadowRows).not.toHaveBeenCalled()
  })
})

describe('runShadowSweep — happy path', () => {
  function happyContacts(): ShadowContact[] {
    return [
      contact('a', '2026-11-02T00:00:00Z'),
      contact('b', '2026-11-02T00:00:00Z'),
      contact('c', '2026-10-30T06:00:00Z'),
      contact('d', '2026-11-02T20:00:00Z'),
      contact('f', '2026-11-02T00:00:00Z'),
    ]
  }

  it('decides, skips, stales and ignores the six contacts and writes the rows', async () => {
    const ports = makePorts({ dncBlocked: (id) => id === 'b' })
    const f = makeDeps({
      contacts: { ok: true, contacts: happyContacts() },
      shadowRows: { ok: true, contactIds: new Set(['f']) },
      ports,
    })
    const receipt = await runShadowSweep({ clientId: 'client-1', dryRun: false, deps: f.deps })

    expect(receipt.status).toBe('swept')
    expect(receipt.authorization_id).toBe('auth-1')
    expect(receipt.to_decide).toBe(3) // a, b, c
    expect(receipt.ignored).toBe(2) // d (not_yet), f (already has a row)
    expect(receipt.decided).toBe(3)
    expect(receipt.deferred).toBe(0)
    expect(receipt.inserted).toBe(3)
    expect(receipt.would_send).toBe(1) // a
    expect(receipt.skipped_by_reason).toEqual({ dnc: 1, stale: 1 }) // b, c
    expect(receipt.deferred_by_reason).toEqual({})

    expect(f.insertShadowRows).toHaveBeenCalledTimes(1)
    const rows = f.insertShadowRows.mock.calls[0][0] as ShadowRowInput[]
    expect(rows).toHaveLength(3)

    const byId = new Map(rows.map((r) => [r.contactId, r]))
    const rowA = byId.get('a')
    expect(rowA).toBeDefined()
    expect(rowA?.authorizationId).toBe('auth-1')
    expect(rowA?.localDay).toBe(SWEEP_DAY)
    expect(rowA?.status).toBe('shadow')
    expect(rowA?.reasonCode).toBeNull()
    expect(rowA?.toAddressSha256).toBe(addressSha256('a@example.com'))
    expect(rowA?.consentBasis).toBe('form_disclosure_attested')
    // the lead arrived on 2026-11-02 (NZ), the sweep runs on the morning of 2026-11-03
    expect(rowA?.annotations).toMatchObject({ would_send: true, lead_local_day: '2026-11-02' })

    const rowB = byId.get('b')
    expect(rowB?.status).toBe('skipped')
    expect(rowB?.reasonCode).toBe('dnc')
    expect(rowB?.toAddressSha256).toBe(addressSha256('b@example.com'))

    const rowC = byId.get('c')
    expect(rowC?.status).toBe('skipped')
    expect(rowC?.reasonCode).toBe('stale')
    expect(rowC?.toAddressSha256).toBe(addressSha256('c@example.com'))
  })

  it('does not insert in a dry run but keeps the counters', async () => {
    const ports = makePorts({ dncBlocked: (id) => id === 'b' })
    const f = makeDeps({
      contacts: { ok: true, contacts: happyContacts() },
      shadowRows: { ok: true, contactIds: new Set(['f']) },
      ports,
    })
    const receipt = await runShadowSweep({ clientId: 'client-1', dryRun: true, deps: f.deps })

    expect(receipt.status).toBe('swept')
    expect(receipt.dry_run).toBe(true)
    expect(receipt.to_decide).toBe(3)
    expect(receipt.ignored).toBe(2)
    expect(receipt.decided).toBe(3)
    expect(receipt.would_send).toBe(1)
    expect(receipt.skipped_by_reason).toEqual({ dnc: 1, stale: 1 })
    expect(receipt.inserted).toBe(0)
    expect(f.insertShadowRows).not.toHaveBeenCalled()
  })

  it('counts a deferred contact and writes no row for it', async () => {
    const ports = makePorts({ evidenceFail: (id) => id === 'a' })
    const f = makeDeps({
      contacts: { ok: true, contacts: [contact('a', '2026-11-02T00:00:00Z'), contact('c', '2026-10-30T06:00:00Z')] },
      ports,
    })
    const receipt = await runShadowSweep({ clientId: 'client-1', dryRun: false, deps: f.deps })

    expect(receipt.status).toBe('swept')
    expect(receipt.to_decide).toBe(2)
    expect(receipt.decided).toBe(1)
    expect(receipt.deferred).toBe(1)
    expect(receipt.deferred_by_reason).toEqual({ evidence_unverifiable: 1 })
    expect(receipt.inserted).toBe(1)
    const rows = f.insertShadowRows.mock.calls[0][0] as ShadowRowInput[]
    expect(rows.map((r) => r.contactId)).toEqual(['c'])
  })

  it('defers the candidates but still writes the stale row when a mailbox is missing', async () => {
    const f = makeDeps({
      contacts: {
        ok: true,
        contacts: [contact('a', '2026-11-02T00:00:00Z'), contact('c', '2026-10-30T06:00:00Z')],
      },
      mailbox: { ok: false, reason: 'missing', detail: 'sales@example.com missing' },
    })
    const receipt = await runShadowSweep({ clientId: 'client-1', dryRun: false, deps: f.deps })

    expect(receipt.status).toBe('mailbox_unreadable')
    expect(receipt.error).toBe('sales@example.com missing')
    expect(receipt.to_decide).toBe(2)
    expect(receipt.decided).toBe(1)
    expect(receipt.deferred).toBe(1)
    expect(receipt.deferred_by_reason).toEqual({ mailbox_unreadable: 1 })
    expect(receipt.inserted).toBe(1)
    expect(f.createPorts).not.toHaveBeenCalled()
    const rows = f.insertShadowRows.mock.calls[0][0] as ShadowRowInput[]
    expect(rows.map((r) => r.contactId)).toEqual(['c'])
  })

  it('does not check mailboxes or create ports when there are no candidates', async () => {
    const f = makeDeps({
      contacts: { ok: true, contacts: [contact('c', '2026-10-30T06:00:00Z')] },
    })
    const receipt = await runShadowSweep({ clientId: 'client-1', dryRun: false, deps: f.deps })

    expect(receipt.status).toBe('swept')
    expect(receipt.to_decide).toBe(1)
    expect(receipt.decided).toBe(1)
    expect(f.checkMailboxes).not.toHaveBeenCalled()
    expect(f.createPorts).not.toHaveBeenCalled()
    expect(f.insertShadowRows).toHaveBeenCalledTimes(1)
  })

  it('takes legacy_batches from the ports', async () => {
    const legacy: LegacyBatchSeen[] = [
      { campaignId: 'camp-1', title: 'legacy_batch_2026-10-31', sentAt: '2026-10-31T19:00:00Z', emailsSent: 12 },
    ]
    const f = makeDeps({
      contacts: { ok: true, contacts: [contact('a', '2026-11-02T00:00:00Z')] },
      legacyBatches: legacy,
    })
    const receipt = await runShadowSweep({ clientId: 'client-1', dryRun: false, deps: f.deps })
    expect(receipt.legacy_batches).toEqual(legacy)
  })
})

describe('runShadowSweep — before_proposal', () => {
  it('ignores a contact created before the proposal', async () => {
    const auth = makeAuth({ proposedAt: '2026-11-01T00:00:00Z' })
    const f = makeDeps({
      auth: { ok: true, row: auth },
      contacts: { ok: true, contacts: [contact('old', '2026-10-20T00:00:00Z')] },
    })
    const receipt = await runShadowSweep({ clientId: 'client-1', dryRun: false, deps: f.deps })
    expect(receipt.status).toBe('swept')
    expect(receipt.to_decide).toBe(0)
    expect(receipt.ignored).toBe(1)
    expect(receipt.decided).toBe(0)
    expect(f.insertShadowRows).not.toHaveBeenCalled()
  })
})

describe('runShadowSweep — failures', () => {
  it('returns read_failed when loadContacts fails', async () => {
    const f = makeDeps({ contacts: { ok: false, error: 'contacts down' } })
    const receipt = await runShadowSweep({ clientId: 'client-1', dryRun: false, deps: f.deps })
    expect(receipt.status).toBe('read_failed')
    expect(receipt.error).toBe('contacts down')
  })

  it('returns read_failed when findContactsWithShadowRows fails', async () => {
    const f = makeDeps({
      contacts: { ok: true, contacts: [contact('a', '2026-11-02T00:00:00Z')] },
      shadowRows: { ok: false, error: 'rows down' },
    })
    const receipt = await runShadowSweep({ clientId: 'client-1', dryRun: false, deps: f.deps })
    expect(receipt.status).toBe('read_failed')
    expect(receipt.error).toBe('rows down')
  })

  it('returns write_failed with inserted 0 when insertShadowRows fails', async () => {
    const f = makeDeps({
      contacts: { ok: true, contacts: [contact('a', '2026-11-02T00:00:00Z')] },
      insert: { ok: false, error: 'insert down' },
    })
    const receipt = await runShadowSweep({ clientId: 'client-1', dryRun: false, deps: f.deps })
    expect(receipt.status).toBe('write_failed')
    expect(receipt.error).toBe('insert down')
    expect(receipt.inserted).toBe(0)
  })
})

describe('runShadowSweep — sinceIso', () => {
  it('uses the proposal when it is later than the cap window', async () => {
    const auth = makeAuth({ proposedAt: '2026-11-01T00:00:00Z' })
    const f = makeDeps({ auth: { ok: true, row: auth } })
    await runShadowSweep({ clientId: 'client-1', dryRun: false, deps: f.deps })
    const call = f.loadContacts.mock.calls[0][0] as { sinceIso: string }
    expect(call.sinceIso).toBe('2026-11-01T00:00:00.000Z')
  })

  it('uses the cap window when it is later than the proposal', async () => {
    const auth = makeAuth({ proposedAt: '2026-10-01T00:00:00Z' })
    const f = makeDeps({ auth: { ok: true, row: auth } })
    await runShadowSweep({ clientId: 'client-1', dryRun: false, deps: f.deps })
    const call = f.loadContacts.mock.calls[0][0] as { sinceIso: string }
    // now - (3 + 4) days = 2026-10-26T20:15:00Z
    expect(call.sinceIso).toBe('2026-10-26T20:15:00.000Z')
  })
})

describe('runShadowSweep — sequential decisions', () => {
  it('decides the candidates one by one, never in parallel', async () => {
    const events: string[] = []
    const ports = makePorts({
      onCall: (contactId, method) => {
        events.push(`${contactId}:${method}`)
      },
    })
    const f = makeDeps({
      contacts: {
        ok: true,
        contacts: [contact('a', '2026-11-02T00:00:00Z'), contact('b', '2026-11-02T00:00:00Z')],
      },
      ports,
    })
    await runShadowSweep({ clientId: 'client-1', dryRun: false, deps: f.deps })

    // Every call for 'a' must come before every call for 'b'.
    const firstB = events.findIndex((e) => e.startsWith('b:'))
    const lastA = events.map((e) => e.startsWith('a:')).lastIndexOf(true)
    expect(firstB).toBeGreaterThan(-1)
    expect(lastA).toBeGreaterThan(-1)
    expect(firstB).toBeGreaterThan(lastA)
  })
})

describe('runShadowSweep — never throws', () => {
  it('turns a throwing loadAuthorization into read_failed', async () => {
    const f = makeDeps()
    f.loadAuthorization.mockImplementationOnce(async () => {
      throw new Error('boom')
    })
    const receipt = await runShadowSweep({ clientId: 'client-1', dryRun: false, deps: f.deps })
    expect(receipt.status).toBe('read_failed')
    expect(receipt.error).toBe('unexpected: boom')
    expect(receipt.no_send).toBe(true)
    expect(receipt.provider_impact).toBe('NONE')
    expect(receipt.created_at).toBe(NOW.toISOString())
  })

  it('turns a rejecting loadContacts into read_failed', async () => {
    const f = makeDeps()
    f.loadContacts.mockImplementationOnce(async () => {
      throw new Error('contacts boom')
    })
    const receipt = await runShadowSweep({ clientId: 'client-1', dryRun: false, deps: f.deps })
    expect(receipt.status).toBe('read_failed')
    expect(receipt.error).toBe('unexpected: contacts boom')
  })

  it('turns a throwing insertShadowRows into read_failed', async () => {
    const f = makeDeps({ contacts: { ok: true, contacts: [contact('a', '2026-11-02T00:00:00Z')] } })
    f.insertShadowRows.mockImplementationOnce(async () => {
      throw new Error('insert boom')
    })
    const receipt = await runShadowSweep({ clientId: 'client-1', dryRun: false, deps: f.deps })
    expect(receipt.status).toBe('read_failed')
    expect(receipt.error).toBe('unexpected: insert boom')
    expect(receipt.no_send).toBe(true)
    expect(receipt.provider_impact).toBe('NONE')
  })
})

describe('runShadowSweep - added after the mutation probe', () => {
  it('decides the candidates strictly one after the other', async () => {
    const events: string[] = []
    const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
    const ports: ShadowGatePorts = {
      consent: async () => ({ ok: true, bases: ['form_disclosure_attested'], sourceRef: null }),
      dnc: async () => ({ ok: true, blocked: false }),
      member: async () => ({ ok: true, state: 'active' }),
      evidence: async (c) => {
        events.push(`start:${c.contactId}`)
        await delay(15)
        events.push(`end:${c.contactId}`)
        return { ok: true, items: [], isLegacyBatchItem: () => false }
      },
    }
    const f = makeDeps({
      contacts: {
        ok: true,
        contacts: [contact('a', '2026-11-02T00:00:00Z'), contact('b', '2026-11-02T00:00:00Z')],
      },
      ports,
    })
    await runShadowSweep({ clientId: 'client-1', dryRun: true, deps: f.deps })
    expect(events).toEqual(['start:a', 'end:a', 'start:b', 'end:b'])
  })

  it('reports the number of rows the writer really inserted (duplicates are ignored by the database)', async () => {
    const f = makeDeps({
      contacts: {
        ok: true,
        contacts: [contact('a', '2026-11-02T00:00:00Z'), contact('b', '2026-11-02T00:00:00Z')],
      },
      insert: { ok: true, inserted: 1 },
    })
    const receipt = await runShadowSweep({ clientId: 'client-1', dryRun: false, deps: f.deps })
    expect(receipt.decided).toBe(2)
    expect(receipt.inserted).toBe(1)
  })
})
