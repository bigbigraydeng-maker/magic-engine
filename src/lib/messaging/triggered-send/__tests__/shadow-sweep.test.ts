import { describe, it, expect, vi } from 'vitest'
import {
  CHUNK_SIZE,
  chunkIds,
  decideChunk,
  finalizeSweep,
  prepareSweep,
  runShadowSweep,
  type SweepDeps,
} from '../shadow-sweep'
import { ruleSha256, type TriggeredSendRule } from '../rule'
import { addressSha256, type ShadowRowInput } from '../shadow-store'
import type {
  AuthorizationRead,
  ChunkResult,
  ContactsRead,
  LegacyBatchSeen,
  MailboxCheck,
  OpenAuthorization,
  ShadowContact,
  ShadowGatePorts,
  ShadowRowsRead,
  SweepPlan,
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
            legacy: { welcomed: false, batchSeen: true, campaignIds: [] },
          }),
  }
}

interface FakeDepsOptions {
  auth?: AuthorizationRead
  contacts?: ContactsRead
  contactsByIds?: ContactsRead
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
  loadContactsByIds: ReturnType<typeof vi.fn>
  findContactsWithShadowRows: ReturnType<typeof vi.fn>
  checkMailboxes: ReturnType<typeof vi.fn>
  createPorts: ReturnType<typeof vi.fn>
  insertShadowRows: ReturnType<typeof vi.fn>
}

function makeDeps(opts: FakeDepsOptions = {}): FakeDeps {
  const loadAuthorization = vi.fn(async (): Promise<AuthorizationRead> => opts.auth ?? { ok: true, row: makeAuth() })
  const loadContacts = vi.fn(async (): Promise<ContactsRead> => opts.contacts ?? { ok: true, contacts: [] })
  // The chunk steps read their contacts again by id; the fake answers from the same list.
  const loadContactsByIds = vi.fn(async (a: { contactIds: readonly string[] }): Promise<ContactsRead> => {
    if (opts.contactsByIds) return opts.contactsByIds
    const all = opts.contacts && opts.contacts.ok ? opts.contacts.contacts : []
    return { ok: true, contacts: all.filter((c) => a.contactIds.includes(c.contactId)) }
  })
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
    loadContactsByIds,
    findContactsWithShadowRows,
    checkMailboxes,
    createPorts,
    insertShadowRows,
  }
  return { deps, loadAuthorization, loadContacts, loadContactsByIds, findContactsWithShadowRows, checkMailboxes, createPorts, insertShadowRows }
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
    expect(receipt.already_decided).toBe(0)
    expect(receipt.deferred).toBe(0)
    expect(receipt.inserted).toBe(3)
    expect(receipt.would_send).toBe(1) // a
    expect(receipt.skipped_by_reason).toEqual({ dnc: 1, stale: 1 }) // b, c
    expect(receipt.deferred_by_reason).toEqual({})

    // every row is written as soon as it is decided: one call per row
    expect(f.insertShadowRows).toHaveBeenCalledTimes(3)
    const rows = f.insertShadowRows.mock.calls.flatMap((c) => c[0] as ShadowRowInput[])
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
      mailbox: { ok: false, reason: 'missing', detail: '1 of 1 required mailboxes are not connected' },
    })
    const receipt = await runShadowSweep({ clientId: 'client-1', dryRun: false, deps: f.deps })

    expect(receipt.status).toBe('mailbox_unreadable')
    expect(receipt.error).toBe('1 of 1 required mailboxes are not connected')
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
    // nothing was stored, so nothing counts as decided: the contact is tried again by the next run
    expect(receipt.decided).toBe(0)
    expect(receipt.would_send).toBe(0)
    expect(receipt.deferred).toBe(1)
    expect(receipt.deferred_by_reason).toEqual({ write_failed: 1 })
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
        return { ok: true, items: [], legacy: { welcomed: false, batchSeen: true, campaignIds: [] } }
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
    })
    // the first row appeared meanwhile (the database ignored the duplicate), the second is new
    f.insertShadowRows.mockImplementationOnce(async () => ({ ok: true as const, inserted: 0 }))
    const receipt = await runShadowSweep({ clientId: 'client-1', dryRun: false, deps: f.deps })
    expect(receipt.decided).toBe(1)
    expect(receipt.already_decided).toBe(1)
    expect(receipt.would_send).toBe(1)
    expect(receipt.inserted).toBe(1)
  })
})

// ── the sweep in phases (what the Inngest function runs as separate steps) ─────────────────────────────

describe('chunkIds', () => {
  it('splits into chunks of CHUNK_SIZE and keeps the order', () => {
    expect(CHUNK_SIZE).toBe(4)
    expect(chunkIds(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'])).toEqual([['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h'], ['i']])
    expect(chunkIds([])).toEqual([])
    expect(chunkIds(['a', 'b', 'c'], 2)).toEqual([['a', 'b'], ['c']])
  })
})

function leadContacts(n: number): ShadowContact[] {
  return Array.from({ length: n }, (_, i) => contact(`k${String(i).padStart(2, '0')}`, '2026-11-02T00:00:00Z'))
}

async function planOf(f: FakeDeps, dryRun = false): Promise<SweepPlan> {
  const prepared = await prepareSweep({ clientId: 'client-1', dryRun, deps: f.deps })
  if (prepared.kind !== 'plan') throw new Error(`expected a plan, got ${prepared.receipt.status}`)
  return prepared.plan
}

describe('prepareSweep', () => {
  it('returns a finished receipt when there is no open proposal', async () => {
    const prepared = await prepareSweep({ clientId: 'client-1', dryRun: false, deps: makeDeps({ auth: { ok: true, row: null } }).deps })
    expect(prepared.kind).toBe('done')
    if (prepared.kind === 'done') expect(prepared.receipt.status).toBe('no_open_proposal')
  })

  it('returns a plan with ids and counters only: plain JSON without any e-mail address', async () => {
    const f = makeDeps({
      contacts: {
        ok: true,
        contacts: [
          contact('a', '2026-11-02T00:00:00Z'),
          contact('c', '2026-10-30T06:00:00Z'), // stale
          contact('d', '2026-11-02T20:00:00Z'), // not yet
          contact('f', '2026-11-02T00:00:00Z'), // already holds a row
        ],
      },
      shadowRows: { ok: true, contactIds: new Set(['f']) },
    })
    const plan = await planOf(f)
    expect(plan).toMatchObject({
      clientId: 'client-1',
      dryRun: false,
      authorizationId: 'auth-1',
      sweepDay: SWEEP_DAY,
      candidateIds: ['a'],
      staleIds: ['c'],
      to_decide: 2,
      ignored: 2,
      deferred: 0,
      status: 'swept',
      error: null,
    })
    expect(JSON.stringify(plan)).not.toContain('@')
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan)
    expect(f.createPorts).not.toHaveBeenCalled()
    expect(f.insertShadowRows).not.toHaveBeenCalled()
    expect(f.loadContactsByIds).not.toHaveBeenCalled()
  })

  it('sets the candidates aside when a required mailbox is missing but keeps the stale ones', async () => {
    const f = makeDeps({
      contacts: { ok: true, contacts: [contact('a', '2026-11-02T00:00:00Z'), contact('c', '2026-10-30T06:00:00Z')] },
      mailbox: { ok: false, reason: 'missing', detail: '1 of 1 required mailboxes are not connected' },
    })
    const plan = await planOf(f)
    expect(plan.status).toBe('mailbox_unreadable')
    expect(plan.error).toBe('1 of 1 required mailboxes are not connected')
    expect(plan.candidateIds).toEqual([])
    expect(plan.staleIds).toEqual(['c'])
    expect(plan.deferred).toBe(1)
    expect(plan.deferred_by_reason).toEqual({ mailbox_unreadable: 1 })
    expect(plan.to_decide).toBe(2)
  })
})

describe('decideChunk', () => {
  it('writes every decided row at once (one insert per contact, in order) and counts them', async () => {
    const f = makeDeps({ contacts: { ok: true, contacts: leadContacts(3) }, ports: makePorts({ dncBlocked: (id) => id === 'k01' }) })
    const plan = await planOf(f)
    const result = await decideChunk({ plan, kind: 'candidates', contactIds: plan.candidateIds, deps: f.deps })
    expect(result).toMatchObject({ decided: 3, deferred: 0, inserted: 3, would_send: 2, skipped_by_reason: { dnc: 1 }, error: null, error_status: null })
    expect(f.insertShadowRows.mock.calls.map((c) => (c[0] as ShadowRowInput[]).map((r) => r.contactId))).toEqual([['k00'], ['k01'], ['k02']])
    expect(f.createPorts).toHaveBeenCalledTimes(1)
  })

  it('keeps the rows already written when a later write fails, stops there and defers the rest', async () => {
    const f = makeDeps({ contacts: { ok: true, contacts: leadContacts(4) } })
    const plan = await planOf(f)
    f.insertShadowRows
      .mockImplementationOnce(async (rows: ShadowRowInput[]) => ({ ok: true as const, inserted: rows.length }))
      .mockImplementationOnce(async () => ({ ok: false as const, error: 'db down' }))
    const result = await decideChunk({ plan, kind: 'candidates', contactIds: plan.candidateIds, deps: f.deps })
    expect(result.inserted).toBe(1)
    // only the stored row counts as decided; the failed contact and the two after it are tried again later
    expect(result.decided).toBe(1)
    expect(result.would_send).toBe(1)
    expect(result.error).toBe('db down')
    expect(result.error_status).toBe('write_failed')
    expect(result.deferred).toBe(3)
    expect(result.deferred_by_reason).toEqual({ write_failed: 3 })
    expect(f.insertShadowRows).toHaveBeenCalledTimes(2)
  })

  it('does nothing when the proposal was revoked or replaced since the plan was made', async () => {
    for (const auth of [
      { ok: true as const, row: null },
      { ok: true as const, row: makeAuth({ id: 'auth-2' }) },
    ]) {
      const f = makeDeps({ contacts: { ok: true, contacts: leadContacts(2) } })
      const plan = await planOf(f)
      const later = makeDeps({ auth, contacts: { ok: true, contacts: leadContacts(2) } })
      const result = await decideChunk({ plan, kind: 'candidates', contactIds: plan.candidateIds, deps: later.deps })
      expect(result).toMatchObject({ decided: 0, deferred: 2, inserted: 0, deferred_by_reason: { proposal_changed: 2 } })
      expect(later.createPorts).not.toHaveBeenCalled()
      expect(later.insertShadowRows).not.toHaveBeenCalled()
      expect(later.loadContactsByIds).not.toHaveBeenCalled()
    }
  })

  it('defers everything when the authorization or the contacts cannot be read', async () => {
    const f = makeDeps({ contacts: { ok: true, contacts: leadContacts(2) } })
    const plan = await planOf(f)
    const noAuth = makeDeps({ auth: { ok: false, error: 'auth down' } })
    expect(await decideChunk({ plan, kind: 'candidates', contactIds: ['k00', 'k01'], deps: noAuth.deps })).toMatchObject({
      deferred: 2, error: 'auth down', error_status: 'read_failed', deferred_by_reason: { read_failed: 2 },
    })
    const noContacts = makeDeps({ contactsByIds: { ok: false, error: 'contacts down' } })
    expect(await decideChunk({ plan, kind: 'candidates', contactIds: ['k00', 'k01'], deps: noContacts.deps })).toMatchObject({
      deferred: 2, error: 'contacts down', error_status: 'read_failed',
    })
    expect(noContacts.insertShadowRows).not.toHaveBeenCalled()
  })

  it('counts contacts that cannot be found any more as deferred, not as an error', async () => {
    const f = makeDeps({ contacts: { ok: true, contacts: leadContacts(2) } })
    const plan = await planOf(f)
    const gone = makeDeps({ contactsByIds: { ok: true, contacts: [leadContacts(2)[0]] } })
    const result = await decideChunk({ plan, kind: 'candidates', contactIds: ['k00', 'k01'], deps: gone.deps })
    expect(result).toMatchObject({ decided: 1, deferred: 1, deferred_by_reason: { contact_missing: 1 }, error: null })
  })

  it('writes nothing in a dry run', async () => {
    const f = makeDeps({ contacts: { ok: true, contacts: leadContacts(2) } })
    const plan = await planOf(f, true)
    const result = await decideChunk({ plan, kind: 'candidates', contactIds: plan.candidateIds, deps: f.deps })
    expect(result).toMatchObject({ decided: 2, would_send: 2, inserted: 0 })
    expect(f.insertShadowRows).not.toHaveBeenCalled()
  })

  it('freezes stale contacts without creating ports (no external read)', async () => {
    const f = makeDeps({ contacts: { ok: true, contacts: [contact('c', '2026-10-30T06:00:00Z')] } })
    const plan = await planOf(f)
    const result = await decideChunk({ plan, kind: 'stale', contactIds: plan.staleIds, deps: f.deps })
    expect(result).toMatchObject({ decided: 1, inserted: 1, skipped_by_reason: { stale: 1 } })
    expect(f.createPorts).not.toHaveBeenCalled()
  })

  it('does not touch anything for an empty chunk', async () => {
    const f = makeDeps({ contacts: { ok: true, contacts: leadContacts(1) } })
    const plan = await planOf(f)
    const later = makeDeps()
    expect(await decideChunk({ plan, kind: 'candidates', contactIds: [], deps: later.deps })).toMatchObject({ decided: 0, deferred: 0, inserted: 0 })
    expect(later.loadAuthorization).not.toHaveBeenCalled()
  })

  it('never throws, even when a dependency throws', async () => {
    const f = makeDeps({ contacts: { ok: true, contacts: leadContacts(1) } })
    const plan = await planOf(f)
    f.loadContactsByIds.mockImplementationOnce(async () => {
      throw new Error('kaboom')
    })
    const result = await decideChunk({ plan, kind: 'candidates', contactIds: plan.candidateIds, deps: f.deps })
    expect(result.error).toBe('unexpected: kaboom')
    expect(result.error_status).toBe('read_failed')
  })
})

describe('decideChunk — retries and a second run', () => {
  it('does not decide a contact again that already holds a shadow row', async () => {
    const f = makeDeps({ contacts: { ok: true, contacts: leadContacts(3) } })
    const plan = await planOf(f)
    const retry = makeDeps({
      contacts: { ok: true, contacts: leadContacts(3) },
      shadowRows: { ok: true, contactIds: new Set(['k01']) },
    })
    const result = await decideChunk({ plan, kind: 'candidates', contactIds: plan.candidateIds, deps: retry.deps })
    expect(result).toMatchObject({ decided: 2, already_decided: 1, inserted: 2, would_send: 2, deferred: 0, error: null })
    expect(retry.findContactsWithShadowRows).toHaveBeenCalledWith('client-1', ['k00', 'k01', 'k02'])
    // the contact that holds a row is neither read nor decided nor written again
    expect(retry.loadContactsByIds.mock.calls[0][0]).toEqual({
      clientId: 'client-1',
      contactIds: ['k00', 'k02'],
      sources: ['meta_lead_form'],
    })
    expect(retry.insertShadowRows.mock.calls.map((c) => (c[0] as ShadowRowInput[])[0].contactId)).toEqual(['k00', 'k02'])
  })

  it('reads and decides nothing when every contact of the chunk already holds a row', async () => {
    const f = makeDeps({ contacts: { ok: true, contacts: leadContacts(2) } })
    const plan = await planOf(f)
    const retry = makeDeps({ shadowRows: { ok: true, contactIds: new Set(['k00', 'k01']) } })
    const result = await decideChunk({ plan, kind: 'candidates', contactIds: plan.candidateIds, deps: retry.deps })
    expect(result).toMatchObject({ decided: 0, already_decided: 2, deferred: 0, inserted: 0, error: null })
    expect(retry.loadContactsByIds).not.toHaveBeenCalled()
    expect(retry.createPorts).not.toHaveBeenCalled()
    expect(retry.insertShadowRows).not.toHaveBeenCalled()
  })

  it('defers the whole chunk when it cannot be checked which contacts already hold a row', async () => {
    const f = makeDeps({ contacts: { ok: true, contacts: leadContacts(2) } })
    const plan = await planOf(f)
    const broken = makeDeps({ shadowRows: { ok: false, error: 'rows down' } })
    const result = await decideChunk({ plan, kind: 'candidates', contactIds: plan.candidateIds, deps: broken.deps })
    expect(result).toMatchObject({
      decided: 0, deferred: 2, error: 'rows down', error_status: 'read_failed', deferred_by_reason: { read_failed: 2 },
    })
    expect(broken.insertShadowRows).not.toHaveBeenCalled()
  })

  it('keeps the count of already-decided contacts when the remaining ones cannot be read', async () => {
    const f = makeDeps({ contacts: { ok: true, contacts: leadContacts(3) } })
    const plan = await planOf(f)
    const broken = makeDeps({
      shadowRows: { ok: true, contactIds: new Set(['k00']) },
      contactsByIds: { ok: false, error: 'contacts down' },
    })
    const result = await decideChunk({ plan, kind: 'candidates', contactIds: plan.candidateIds, deps: broken.deps })
    expect(result).toMatchObject({ decided: 0, already_decided: 1, deferred: 2, error: 'contacts down' })
  })

  it('counts a row that appeared between the check and the write as already decided, not as decided', async () => {
    const f = makeDeps({ contacts: { ok: true, contacts: leadContacts(3) } })
    const plan = await planOf(f)
    f.insertShadowRows
      .mockImplementationOnce(async () => ({ ok: true as const, inserted: 1 }))
      .mockImplementationOnce(async () => ({ ok: true as const, inserted: 0 }))
      .mockImplementationOnce(async () => ({ ok: true as const, inserted: 1 }))
    const result = await decideChunk({ plan, kind: 'candidates', contactIds: plan.candidateIds, deps: f.deps })
    expect(result).toMatchObject({ decided: 2, already_decided: 1, inserted: 2, would_send: 2 })
  })

  it('still looks at the existing rows in a dry run (a read), and writes nothing', async () => {
    const f = makeDeps({ contacts: { ok: true, contacts: leadContacts(2) } })
    const plan = await planOf(f, true)
    const dry = makeDeps({ shadowRows: { ok: true, contactIds: new Set(['k00']) }, contacts: { ok: true, contacts: leadContacts(2) } })
    const result = await decideChunk({ plan, kind: 'candidates', contactIds: plan.candidateIds, deps: dry.deps })
    expect(result).toMatchObject({ decided: 1, already_decided: 1, inserted: 0 })
    expect(dry.insertShadowRows).not.toHaveBeenCalled()
  })

  it('does the same for the stale chunks', async () => {
    const f = makeDeps({ contacts: { ok: true, contacts: [contact('c', '2026-10-30T06:00:00Z'), contact('e', '2026-10-30T07:00:00Z')] } })
    const plan = await planOf(f)
    const retry = makeDeps({
      shadowRows: { ok: true, contactIds: new Set(['c']) },
      contacts: { ok: true, contacts: [contact('c', '2026-10-30T06:00:00Z'), contact('e', '2026-10-30T07:00:00Z')] },
    })
    const result = await decideChunk({ plan, kind: 'stale', contactIds: plan.staleIds, deps: retry.deps })
    expect(result).toMatchObject({ decided: 1, already_decided: 1, inserted: 1, skipped_by_reason: { stale: 1 } })
    expect(retry.createPorts).not.toHaveBeenCalled()
  })
})

describe('finalizeSweep', () => {
  const chunk = (over: Partial<ChunkResult>): ChunkResult => ({
    decided: 0, already_decided: 0, deferred: 0, inserted: 0, would_send: 0, skipped_by_reason: {}, deferred_by_reason: {}, legacy_batches: [], error: null, error_status: null, ...over,
  })
  const basePlan: SweepPlan = {
    clientId: 'client-1', dryRun: false, authorizationId: 'auth-1', sweepDay: SWEEP_DAY, candidateIds: [], staleIds: [],
    to_decide: 6, ignored: 2, deferred: 1, deferred_by_reason: { mailbox_unreadable: 1 }, status: 'swept', error: null,
    createdAt: NOW.toISOString(),
  }

  it('adds the chunk results up and merges the reason counters', () => {
    const receipt = finalizeSweep(basePlan, [
      chunk({ decided: 3, inserted: 3, would_send: 2, skipped_by_reason: { dnc: 1 }, deferred: 1, deferred_by_reason: { evidence_unverifiable: 1 } }),
      chunk({ decided: 2, inserted: 1, would_send: 1, skipped_by_reason: { dnc: 1, stale: 0 }, deferred: 0 }),
    ])
    expect(receipt).toMatchObject({
      status: 'swept', client_id: 'client-1', authorization_id: 'auth-1', to_decide: 6, ignored: 2, decided: 5, inserted: 4, would_send: 3,
      deferred: 2, skipped_by_reason: { dnc: 2, stale: 0 }, deferred_by_reason: { mailbox_unreadable: 1, evidence_unverifiable: 1 },
      no_send: true, provider_impact: 'NONE', error: null, created_at: NOW.toISOString(),
    })
  })

  it('adds the already-decided counts up', () => {
    const receipt = finalizeSweep(basePlan, [chunk({ already_decided: 2 }), chunk({ already_decided: 3, decided: 1 })])
    expect(receipt).toMatchObject({ already_decided: 5, decided: 1 })
  })

  it('shows the first failing chunk as the status, but keeps a plan-level status that is already shown', () => {
    const failed = chunk({ error: 'db down', error_status: 'write_failed' })
    expect(finalizeSweep(basePlan, [chunk({}), failed])).toMatchObject({ status: 'write_failed', error: 'db down' })
    expect(finalizeSweep(basePlan, [chunk({ error: 'x', error_status: 'read_failed' })])).toMatchObject({ status: 'read_failed', error: 'x' })
    expect(finalizeSweep({ ...basePlan, status: 'mailbox_unreadable', error: '1 of 1 required mailboxes are not connected' }, [failed])).toMatchObject({
      status: 'mailbox_unreadable', error: '1 of 1 required mailboxes are not connected',
    })
  })

  it('merges the old-batch campaigns by id and sorts them by send time (unknown time last)', () => {
    const b = (campaignId: string, sentAt: string | null): LegacyBatchSeen => ({ campaignId, title: `legacy_batch_${campaignId}`, sentAt, emailsSent: 5 })
    const receipt = finalizeSweep(basePlan, [
      chunk({ legacy_batches: [b('z', '2026-11-02T08:00:00Z'), b('n', null)] }),
      chunk({ legacy_batches: [b('z', '2026-11-02T08:00:00Z'), b('y', '2026-11-01T08:00:00Z')] }),
    ])
    expect(receipt.legacy_batches.map((x) => x.campaignId)).toEqual(['y', 'z', 'n'])
  })
})

describe('runShadowSweep in chunks', () => {
  it('decides 9 candidates in 3 chunks (4/4/1), creating the ports once per chunk and writing 9 rows', async () => {
    const f = makeDeps({ contacts: { ok: true, contacts: leadContacts(9) } })
    const receipt = await runShadowSweep({ clientId: 'client-1', dryRun: false, deps: f.deps })
    expect(receipt).toMatchObject({ status: 'swept', to_decide: 9, decided: 9, inserted: 9, would_send: 9, deferred: 0 })
    expect(f.createPorts).toHaveBeenCalledTimes(3)
    expect(f.loadContactsByIds.mock.calls.map((c) => (c[0] as { contactIds: string[] }).contactIds.length)).toEqual([4, 4, 1])
    expect(f.loadContactsByIds.mock.calls.every((c) => (c[0] as { sources: string[] }).sources.join() === 'meta_lead_form')).toBe(true)
    expect(f.insertShadowRows).toHaveBeenCalledTimes(9)
  })
})

describe('runShadowSweep order', () => {
  it('writes the stale rows first, then the decided candidates (no external read is needed for the stale ones)', async () => {
    const f = makeDeps({
      contacts: { ok: true, contacts: [contact('a', '2026-11-02T00:00:00Z'), contact('c', '2026-10-30T06:00:00Z')] },
    })
    await runShadowSweep({ clientId: 'client-1', dryRun: false, deps: f.deps })
    expect(f.insertShadowRows.mock.calls.map((c) => (c[0] as ShadowRowInput[])[0].contactId)).toEqual(['c', 'a'])
  })
})
