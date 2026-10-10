import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getClientKnowledge } from '../read'
import { getKnowledgeEntitlement, KNOWLEDGE_READ_ACTION_KEY } from '../entitlement'
import { computeContentFingerprint } from '../fingerprint'
import { KnowledgeNotEntitledError, KnowledgeReadError } from '../errors'
import { createFakeSupabase, type Row } from './fake-supabase'

const CLIENT_A = 'aaaaaaaa-0000-0000-0000-000000000001'
const CLIENT_B = 'bbbbbbbb-0000-0000-0000-000000000002'
const NOW = new Date('2026-09-14T12:00:00.000Z')

const ENTITLEMENT_GRANT: Row = {
  client_id: CLIENT_A,
  action_key: KNOWLEDGE_READ_ACTION_KEY,
  mode: 'auto_approve',
  updated_by: 'ray@magicengine.cloud',
  effective_from: '2026-01-01T00:00:00.000Z',
  effective_to: null,
  metadata: { basis: 'fde_managed' },
}

interface FactFixture {
  id: string
  client_id?: string
  fact_key: string
  scope?: Record<string, unknown>
  statement?: string
  structured_value?: unknown
  status?: string
  visibility: 'customer_ok' | 'internal_only' | 'forbidden'
  sensitivity: 'price' | 'timeline' | 'commitment' | 'policy' | 'general'
  valid_from?: string
  valid_until?: string | null
  approved_by_email?: string | null
  approved_at?: string | null
  client_confirmed_by_email?: string | null
  client_confirmed_at?: string | null
  confirmFingerprint?: boolean // if true, compute a matching fingerprint from current content
  client_confirmed_fingerprint?: string | null
  conflict_group_id?: string | null
  historical_confirmation_grandfather_until?: string | null
}

/** Build one client_knowledge_facts fixture row with sane defaults. */
function fact(f: FactFixture): Row {
  const scope = f.scope ?? {}
  const validFrom = f.valid_from ?? '2026-01-01T00:00:00.000Z'
  const validUntil = f.valid_until === undefined ? null : f.valid_until
  const structuredValue = f.structured_value ?? null
  const statement = f.statement ?? `statement for ${f.fact_key}`

  let confirmedFingerprint = f.client_confirmed_fingerprint ?? null
  if (f.confirmFingerprint) {
    confirmedFingerprint = computeContentFingerprint({
      statement,
      structuredValue,
      scope,
      validFrom,
      validUntil,
      visibility: f.visibility,
      sensitivity: f.sensitivity,
    })
  }

  return {
    id: f.id,
    client_id: f.client_id ?? CLIENT_A,
    fact_key: f.fact_key,
    scope,
    statement,
    structured_value: structuredValue,
    conflict_group_id: f.conflict_group_id ?? null,
    status: f.status ?? 'approved',
    visibility: f.visibility,
    sensitivity: f.sensitivity,
    valid_from: validFrom,
    valid_until: validUntil,
    last_verified_at: null,
    approved_by_email: f.approved_by_email === undefined ? 'ray@magicengine.cloud' : f.approved_by_email,
    approved_at: f.approved_at === undefined ? '2026-01-01T00:00:00.000Z' : f.approved_at,
    client_confirmed_by_email: f.client_confirmed_by_email ?? null,
    client_confirmed_at: f.client_confirmed_at ?? null,
    client_confirmed_fingerprint: confirmedFingerprint,
    historical_confirmation_grandfather_until: f.historical_confirmation_grandfather_until ?? null,
  }
}

const REGISTERED_CONFIRMER: Row = {
  client_id: CLIENT_A,
  confirmer_email: 'owner@ctstours.co.nz',
  registered_by_email: 'ray@magicengine.cloud',
  registered_at: '2026-01-01T00:00:00.000Z',
  revoked_at: null,
}

// 🔴 Issue #1648 gate 6 — every existing `customer_reply` test in this file
// predates the rollout-stage gate and is testing the DUAL-SIGN gate, not the
// stage gate. Defaulting these two fixtures to "live" (stage 2 + Messenger
// switch on) keeps those tests exercising exactly what they always tested;
// the stage-gate-specific tests below override these explicitly.
const LIVE_PHASE_EVENT: Row = {
  client_id: CLIENT_A,
  dimension: 'phase',
  value: '2',
  actor_email: 'ray@magicengine.cloud',
  reason: null,
  payload: {},
  created_at: '2026-03-01T00:00:00.000Z',
}
const MESSENGER_ENABLED_CLIENT: Row = { id: CLIENT_A, messenger_agent_enabled_messenger: true }

function makeSb(
  facts: Row[],
  grants: Row[] = [ENTITLEMENT_GRANT],
  confirmers: Row[] = [REGISTERED_CONFIRMER],
  events: Row[] = [LIVE_PHASE_EVENT],
  clients: Row[] = [MESSENGER_ENABLED_CLIENT],
) {
  return createFakeSupabase({
    client_automation_policies: grants,
    client_knowledge_facts: facts,
    client_knowledge_confirmers: confirmers,
    client_knowledge_events: events,
    clients,
  })
}

describe('getClientKnowledge — entitlement gate', () => {
  it('throws KnowledgeNotEntitledError when the client has no grant, even if facts exist', async () => {
    const sb = makeSb(
      [fact({ id: 'f1', fact_key: 'general.hours', visibility: 'customer_ok', sensitivity: 'general' })],
      [],
    )
    await expect(
      getClientKnowledge(CLIENT_A, { purpose: 'customer_reply' }, { supabase: sb, now: () => NOW }),
    ).rejects.toThrow(KnowledgeNotEntitledError)
  })

  it('propagates entitlement read failures as KnowledgeReadError (never a silent deny or empty result)', async () => {
    const sb = createFakeSupabase(
      { client_automation_policies: [], client_knowledge_facts: [] },
      { errorTables: new Set(['client_automation_policies']) },
    )
    await expect(
      getClientKnowledge(CLIENT_A, { purpose: 'customer_reply' }, { supabase: sb, now: () => NOW }),
    ).rejects.toThrow(KnowledgeReadError)
  })
})

describe('getClientKnowledge — read failure must throw, never return empty', () => {
  it('throws KnowledgeReadError when the facts table read fails', async () => {
    const sb = createFakeSupabase(
      { client_automation_policies: [ENTITLEMENT_GRANT], client_knowledge_facts: [] },
      { errorTables: new Set(['client_knowledge_facts']) },
    )
    await expect(
      getClientKnowledge(CLIENT_A, { purpose: 'customer_reply' }, { supabase: sb, now: () => NOW }),
    ).rejects.toThrow(KnowledgeReadError)
  })
})

describe('getClientKnowledge — status filter', () => {
  it('only ever returns status=approved rows', async () => {
    // The base query is `.eq('status','approved')`, so non-approved rows are
    // never fetched from the fake table in the first place — this test
    // proves the end-to-end behaviour regardless of where the filter lives.
    const sb = makeSb([
      fact({ id: 'f1', fact_key: 'general.a', visibility: 'customer_ok', sensitivity: 'general', status: 'candidate' }),
      fact({ id: 'f2', fact_key: 'general.b', visibility: 'customer_ok', sensitivity: 'general', status: 'approved' }),
    ])
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'internal_brief' }, { supabase: sb, now: () => NOW })
    expect(result.entries.map((e) => e.id)).toEqual(['f2'])
  })
})

describe('getClientKnowledge — validity window (server-time, not a batch job)', () => {
  it('excludes a row whose valid_from is in the future', async () => {
    const sb = makeSb([
      fact({
        id: 'f1',
        fact_key: 'general.future',
        visibility: 'customer_ok',
        sensitivity: 'general',
        valid_from: '2027-01-01T00:00:00.000Z',
      }),
    ])
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'internal_brief' }, { supabase: sb, now: () => NOW })
    expect(result.entries).toEqual([])
  })

  it('excludes a row whose valid_until has passed', async () => {
    const sb = makeSb([
      fact({
        id: 'f1',
        fact_key: 'general.expired',
        visibility: 'customer_ok',
        sensitivity: 'general',
        valid_until: '2026-01-01T00:00:00.000Z',
      }),
    ])
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'internal_brief' }, { supabase: sb, now: () => NOW })
    expect(result.entries).toEqual([])
  })

  it('includes a row with no valid_until (open-ended)', async () => {
    const sb = makeSb([
      fact({ id: 'f1', fact_key: 'general.ongoing', visibility: 'customer_ok', sensitivity: 'general', valid_until: null }),
    ])
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'internal_brief' }, { supabase: sb, now: () => NOW })
    expect(result.entries.map((e) => e.id)).toEqual(['f1'])
  })

  it('includes a row that is currently within its validity window', async () => {
    const sb = makeSb([
      fact({
        id: 'f1',
        fact_key: 'general.current',
        visibility: 'customer_ok',
        sensitivity: 'general',
        valid_from: '2026-06-01T00:00:00.000Z',
        valid_until: '2026-12-31T00:00:00.000Z',
      }),
    ])
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'internal_brief' }, { supabase: sb, now: () => NOW })
    expect(result.entries.map((e) => e.id)).toEqual(['f1'])
  })
})

describe('getClientKnowledge — visibility per purpose', () => {
  function fixtures() {
    return [
      fact({ id: 'ok', fact_key: 'k.ok', visibility: 'customer_ok', sensitivity: 'general' }),
      fact({ id: 'internal', fact_key: 'k.internal', visibility: 'internal_only', sensitivity: 'general' }),
      fact({ id: 'forbidden', fact_key: 'k.forbidden', visibility: 'forbidden', sensitivity: 'general' }),
    ]
  }

  it('customer_reply: only customer_ok bodies come back; forbidden never does, but its key is listed', async () => {
    const sb = makeSb(fixtures())
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'customer_reply' }, { supabase: sb, now: () => NOW })
    expect(result.entries.map((e) => e.id)).toEqual(['ok'])
    expect(result.forbiddenFactKeys).toEqual(['k.forbidden'])
  })

  it('internal_brief: customer_ok and internal_only bodies both come back; forbidden body never does', async () => {
    const sb = makeSb(fixtures())
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'internal_brief' }, { supabase: sb, now: () => NOW })
    expect(new Set(result.entries.map((e) => e.id))).toEqual(new Set(['ok', 'internal']))
    expect(result.forbiddenFactKeys).toEqual(['k.forbidden'])
  })

  it('lead_classification: same visibility rule as internal_brief', async () => {
    const sb = makeSb(fixtures())
    const result = await getClientKnowledge(
      CLIENT_A,
      { purpose: 'lead_classification' },
      { supabase: sb, now: () => NOW },
    )
    expect(new Set(result.entries.map((e) => e.id))).toEqual(new Set(['ok', 'internal']))
  })

  it('🔴 mutation-critical: forbidden body must NEVER leak into entries for any purpose', async () => {
    const sb = makeSb(fixtures())
    for (const purpose of ['customer_reply', 'internal_brief', 'lead_classification'] as const) {
      const result = await getClientKnowledge(CLIENT_A, { purpose }, { supabase: sb, now: () => NOW })
      expect(result.entries.some((e) => e.id === 'forbidden')).toBe(false)
    }
  })
})

describe('getClientKnowledge — dual-sign gate (customer_reply only)', () => {
  it('general sensitivity needs only approval, no customer confirmation', async () => {
    const sb = makeSb([
      fact({ id: 'f1', fact_key: 'k.general', visibility: 'customer_ok', sensitivity: 'general' }),
    ])
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'customer_reply' }, { supabase: sb, now: () => NOW })
    expect(result.entries.map((e) => e.id)).toEqual(['f1'])
  })

  it('sensitive categories are excluded from customer_reply when client_confirmed_at is unset (FDE-approved only)', async () => {
    const sb = makeSb([
      fact({
        id: 'f1',
        fact_key: 'k.price',
        visibility: 'customer_ok',
        sensitivity: 'price',
        approved_by_email: 'fde@magicengine.cloud',
        client_confirmed_by_email: null,
        client_confirmed_at: null,
      }),
    ])
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'customer_reply' }, { supabase: sb, now: () => NOW })
    expect(result.entries).toEqual([])
  })

  it('same-category sensitive fact IS returned for internal_brief even without customer confirmation', async () => {
    const sb = makeSb([
      fact({
        id: 'f1',
        fact_key: 'k.price',
        visibility: 'customer_ok',
        sensitivity: 'price',
        client_confirmed_by_email: null,
        client_confirmed_at: null,
      }),
    ])
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'internal_brief' }, { supabase: sb, now: () => NOW })
    expect(result.entries.map((e) => e.id)).toEqual(['f1'])
  })

  it('sensitive category with a real, matching, differently-authored confirmation IS returned for customer_reply', async () => {
    const sb = makeSb([
      fact({
        id: 'f1',
        fact_key: 'k.price',
        visibility: 'customer_ok',
        sensitivity: 'price',
        approved_by_email: 'fde@magicengine.cloud',
        client_confirmed_by_email: 'owner@ctstours.co.nz',
        client_confirmed_at: '2026-02-01T00:00:00.000Z',
        confirmFingerprint: true,
      }),
    ])
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'customer_reply' }, { supabase: sb, now: () => NOW })
    expect(result.entries.map((e) => e.id)).toEqual(['f1'])
  })

  it('双签变异测试②: same email as approver AND confirmer is rejected at read time (defence in depth)', async () => {
    const sb = makeSb([
      fact({
        id: 'f1',
        fact_key: 'k.price',
        visibility: 'customer_ok',
        sensitivity: 'price',
        approved_by_email: 'ray@magicengine.cloud',
        client_confirmed_by_email: 'RAY@magicengine.cloud', // same person, different case
        client_confirmed_at: '2026-02-01T00:00:00.000Z',
        confirmFingerprint: true,
      }),
    ])
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'customer_reply' }, { supabase: sb, now: () => NOW })
    expect(result.entries).toEqual([])
  })

  it('双签变异测试②b（魏征/狄仁杰联合复审 2026-09-14）: trailing whitespace must not let the approver stand in as confirmer', async () => {
    const sb = makeSb(
      [
        fact({
          id: 'f1',
          fact_key: 'k.price',
          visibility: 'customer_ok',
          sensitivity: 'price',
          approved_by_email: 'ray@magicengine.cloud',
          client_confirmed_by_email: 'ray@magicengine.cloud ', // same person, trailing space
          client_confirmed_at: '2026-02-01T00:00:00.000Z',
          confirmFingerprint: true,
        }),
      ],
      [ENTITLEMENT_GRANT],
      [{ ...REGISTERED_CONFIRMER, confirmer_email: 'ray@magicengine.cloud ' }],
    )
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'customer_reply' }, { supabase: sb, now: () => NOW })
    expect(result.entries).toEqual([])
  })

  it('双签变异测试②c（魏征/狄仁杰联合复审 2026-09-14）: a legitimate confirmation is not spuriously rejected merely because the stored email has incidental whitespace', async () => {
    const sb = makeSb(
      [
        fact({
          id: 'f1',
          fact_key: 'k.price',
          visibility: 'customer_ok',
          sensitivity: 'price',
          approved_by_email: 'fde@magicengine.cloud',
          client_confirmed_by_email: ' owner@ctstours.co.nz ', // legitimate confirmer, incidental whitespace
          client_confirmed_at: '2026-02-01T00:00:00.000Z',
          confirmFingerprint: true,
        }),
      ],
      [ENTITLEMENT_GRANT],
      [{ ...REGISTERED_CONFIRMER, confirmer_email: 'owner@ctstours.co.nz' }],
    )
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'customer_reply' }, { supabase: sb, now: () => NOW })
    expect(result.entries.map((e) => e.id)).toEqual(['f1'])
  })

  describe('双签变异测试③: a global admin cannot stand in for the customer', () => {
    const saved = process.env.ADMIN_EMAILS
    beforeEach(() => {
      process.env.ADMIN_EMAILS = 'ray@magicengine.cloud'
    })
    afterEach(() => {
      if (saved === undefined) delete process.env.ADMIN_EMAILS
      else process.env.ADMIN_EMAILS = saved
    })

    it('excludes a fact "confirmed" by an ADMIN_EMAILS address', async () => {
      const sb = makeSb([
        fact({
          id: 'f1',
          fact_key: 'k.price',
          visibility: 'customer_ok',
          sensitivity: 'price',
          approved_by_email: 'fde@magicengine.cloud',
          client_confirmed_by_email: 'ray@magicengine.cloud',
          client_confirmed_at: '2026-02-01T00:00:00.000Z',
          confirmFingerprint: true,
        }),
      ])
      const result = await getClientKnowledge(CLIENT_A, { purpose: 'customer_reply' }, { supabase: sb, now: () => NOW })
      expect(result.entries).toEqual([])
    })
  })

  it('§9.14 E.2 步 2: excludes a sensitive fact whose confirmer email was never registered for this client', async () => {
    const sb = makeSb(
      [
        fact({
          id: 'f1',
          fact_key: 'k.price',
          visibility: 'customer_ok',
          sensitivity: 'price',
          approved_by_email: 'fde@magicengine.cloud',
          client_confirmed_by_email: 'random-stranger@example.com', // never registered
          client_confirmed_at: '2026-02-01T00:00:00.000Z',
          confirmFingerprint: true,
        }),
      ],
      [ENTITLEMENT_GRANT],
      [], // no confirmers registered at all for this client
    )
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'customer_reply' }, { supabase: sb, now: () => NOW })
    expect(result.entries).toEqual([])
  })

  it('§9.14 E.2 步 2: excludes a sensitive fact whose confirmer registration has been revoked', async () => {
    const sb = makeSb(
      [
        fact({
          id: 'f1',
          fact_key: 'k.price',
          visibility: 'customer_ok',
          sensitivity: 'price',
          approved_by_email: 'fde@magicengine.cloud',
          client_confirmed_by_email: 'owner@ctstours.co.nz',
          client_confirmed_at: '2026-02-01T00:00:00.000Z',
          confirmFingerprint: true,
        }),
      ],
      [ENTITLEMENT_GRANT],
      [{ ...REGISTERED_CONFIRMER, revoked_at: '2026-01-15T00:00:00.000Z' }],
    )
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'customer_reply' }, { supabase: sb, now: () => NOW })
    expect(result.entries).toEqual([])
  })

  it('excludes a sensitive fact whose content changed after the customer confirmed it (stale fingerprint)', async () => {
    const staleFingerprint = computeContentFingerprint({
      statement: 'OLD PRICE: $6188 NZD',
      structuredValue: null,
      scope: {},
      validFrom: '2026-01-01T00:00:00.000Z',
      validUntil: null,
      visibility: 'customer_ok',
      sensitivity: 'price',
    })
    const sb = makeSb([
      fact({
        id: 'f1',
        fact_key: 'k.price',
        visibility: 'customer_ok',
        sensitivity: 'price',
        statement: 'NEW PRICE: $7188 NZD', // edited after confirmation
        approved_by_email: 'fde@magicengine.cloud',
        client_confirmed_by_email: 'owner@ctstours.co.nz',
        client_confirmed_at: '2026-02-01T00:00:00.000Z',
        client_confirmed_fingerprint: staleFingerprint,
      }),
    ])
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'customer_reply' }, { supabase: sb, now: () => NOW })
    expect(result.entries).toEqual([])
  })
})

describe('getClientKnowledge — rollout stage + channel gate (issue #1648, customer_reply only)', () => {
  it('stage 2 + Messenger switch on: a general fact is returned for customer_reply (baseline)', async () => {
    const sb = makeSb([fact({ id: 'f1', fact_key: 'k.general', visibility: 'customer_ok', sensitivity: 'general' })])
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'customer_reply' }, { supabase: sb, now: () => NOW })
    expect(result.entries.map((e) => e.id)).toEqual(['f1'])
  })

  it('🔴 stage 1 (客户共测): excludes an otherwise-fully-approved general fact from customer_reply', async () => {
    const sb = makeSb(
      [fact({ id: 'f1', fact_key: 'k.general', visibility: 'customer_ok', sensitivity: 'general' })],
      [ENTITLEMENT_GRANT],
      [REGISTERED_CONFIRMER],
      [{ ...LIVE_PHASE_EVENT, value: '1' }],
    )
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'customer_reply' }, { supabase: sb, now: () => NOW })
    expect(result.entries).toEqual([])
  })

  it('the same stage-1 client still returns the fact for internal_brief (the stage gate is customer_reply-only)', async () => {
    const sb = makeSb(
      [fact({ id: 'f1', fact_key: 'k.general', visibility: 'customer_ok', sensitivity: 'general' })],
      [ENTITLEMENT_GRANT],
      [REGISTERED_CONFIRMER],
      [{ ...LIVE_PHASE_EVENT, value: '1' }],
    )
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'internal_brief' }, { supabase: sb, now: () => NOW })
    expect(result.entries.map((e) => e.id)).toEqual(['f1'])
  })

  it('🔴 stage 2 but Messenger switch off: excludes a general fact from customer_reply — the stage alone is not enough', async () => {
    const sb = makeSb(
      [fact({ id: 'f1', fact_key: 'k.general', visibility: 'customer_ok', sensitivity: 'general' })],
      [ENTITLEMENT_GRANT],
      [REGISTERED_CONFIRMER],
      [LIVE_PHASE_EVENT],
      [{ id: CLIENT_A, messenger_agent_enabled_messenger: false }],
    )
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'customer_reply' }, { supabase: sb, now: () => NOW })
    expect(result.entries).toEqual([])
  })

  it('🔴 mutation-critical: a DB error reading the rollout stage yields zero customer_reply facts — not a throw, not "assume stage 2"', async () => {
    const sb = createFakeSupabase(
      {
        client_automation_policies: [ENTITLEMENT_GRANT],
        client_knowledge_facts: [fact({ id: 'f1', fact_key: 'k.general', visibility: 'customer_ok', sensitivity: 'general' })],
        client_knowledge_confirmers: [REGISTERED_CONFIRMER],
        client_knowledge_events: [LIVE_PHASE_EVENT],
        clients: [MESSENGER_ENABLED_CLIENT],
      },
      { errorTables: new Set(['client_knowledge_events']) },
    )
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'customer_reply' }, { supabase: sb, now: () => NOW })
    expect(result.entries).toEqual([])
  })

  it('🔴 mutation-critical: a DB error reading the Messenger switch yields zero customer_reply facts, not a throw', async () => {
    const sb = createFakeSupabase(
      {
        client_automation_policies: [ENTITLEMENT_GRANT],
        client_knowledge_facts: [fact({ id: 'f1', fact_key: 'k.general', visibility: 'customer_ok', sensitivity: 'general' })],
        client_knowledge_confirmers: [REGISTERED_CONFIRMER],
        client_knowledge_events: [LIVE_PHASE_EVENT],
        clients: [MESSENGER_ENABLED_CLIENT],
      },
      { errorTables: new Set(['clients']) },
    )
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'customer_reply' }, { supabase: sb, now: () => NOW })
    expect(result.entries).toEqual([])
  })

  it('applies uniformly to sensitive-but-fully-signed facts too, not just general ones', async () => {
    const sb = makeSb(
      [
        fact({
          id: 'f1',
          fact_key: 'k.price',
          visibility: 'customer_ok',
          sensitivity: 'price',
          approved_by_email: 'fde@magicengine.cloud',
          client_confirmed_by_email: 'owner@ctstours.co.nz',
          client_confirmed_at: '2026-02-01T00:00:00.000Z',
          confirmFingerprint: true,
        }),
      ],
      [ENTITLEMENT_GRANT],
      [REGISTERED_CONFIRMER],
      [{ ...LIVE_PHASE_EVENT, value: '1' }], // stage 1: dual-sign is satisfied, but rollout stage isn't
    )
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'customer_reply' }, { supabase: sb, now: () => NOW })
    expect(result.entries).toEqual([])
  })
})

/**
 * Issue #1647 / design doc §9.14 B "CTS 历史未确认"有条件接受: a sensitive
 * (dual-sign-required) fact can carry `historical_confirmation_grandfather_
 * until` — while `now <= that timestamp`, it is treated as eligible for
 * `customer_reply` even with `client_confirmed_at` unset. After the
 * deadline it falls straight back to the normal rule (still unconfirmed →
 * excluded), with no separate "is it expired" branch.
 */
describe('getClientKnowledge — historical confirmation grandfather (issue #1647)', () => {
  it('🔴 宽限期内：未确认的敏感事实仍然对 customer_reply 可见', async () => {
    const sb = makeSb([
      fact({
        id: 'f1',
        fact_key: 'policy.visa_free_entry',
        visibility: 'customer_ok',
        sensitivity: 'policy',
        client_confirmed_by_email: null,
        client_confirmed_at: null,
        historical_confirmation_grandfather_until: '2026-10-15T23:59:59+13:00',
      }),
    ])
    const beforeDeadline = new Date('2026-09-20T00:00:00.000Z')
    const result = await getClientKnowledge(
      CLIENT_A,
      { purpose: 'customer_reply' },
      { supabase: sb, now: () => beforeDeadline },
    )
    expect(result.entries.map((e) => e.id)).toEqual(['f1'])
  })

  it('🔴 变异测试：过了截止日，同一条未确认事实自动从 customer_reply 撤出', async () => {
    const sb = makeSb([
      fact({
        id: 'f1',
        fact_key: 'policy.visa_free_entry',
        visibility: 'customer_ok',
        sensitivity: 'policy',
        client_confirmed_by_email: null,
        client_confirmed_at: null,
        historical_confirmation_grandfather_until: '2026-10-15T23:59:59+13:00',
      }),
    ])
    const afterDeadline = new Date('2026-10-16T00:00:00.000Z')
    const result = await getClientKnowledge(
      CLIENT_A,
      { purpose: 'customer_reply' },
      { supabase: sb, now: () => afterDeadline },
    )
    expect(result.entries).toEqual([])
  })

  it('宽限期恰好在截止时刻仍然有效（<=，不是 <）', async () => {
    const sb = makeSb([
      fact({
        id: 'f1',
        fact_key: 'policy.visa_free_entry',
        visibility: 'customer_ok',
        sensitivity: 'policy',
        client_confirmed_by_email: null,
        client_confirmed_at: null,
        historical_confirmation_grandfather_until: '2026-10-15T23:59:59.000Z',
      }),
    ])
    const exactly = new Date('2026-10-15T23:59:59.000Z')
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'customer_reply' }, { supabase: sb, now: () => exactly })
    expect(result.entries.map((e) => e.id)).toEqual(['f1'])
  })

  it('宽限期不适用于 general 类事实之外的正常判据——一条真的已被客户确认的敏感事实，不需要也不受这个字段影响', async () => {
    const sb = makeSb([
      fact({
        id: 'f1',
        fact_key: 'k.price',
        visibility: 'customer_ok',
        sensitivity: 'price',
        approved_by_email: 'fde@magicengine.cloud',
        client_confirmed_by_email: 'owner@ctstours.co.nz',
        client_confirmed_at: '2026-02-01T00:00:00.000Z',
        confirmFingerprint: true,
        historical_confirmation_grandfather_until: null,
      }),
    ])
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'customer_reply' }, { supabase: sb, now: () => NOW })
    expect(result.entries.map((e) => e.id)).toEqual(['f1'])
  })
})

describe('getClientKnowledge — conflictGroupId pass-through (issue #1645 needs this to link mining conflicts back to approved facts)', () => {
  it('surfaces a non-null conflict_group_id on the returned entry', async () => {
    const sb = makeSb([
      fact({ id: 'f1', fact_key: 'k.general', visibility: 'customer_ok', sensitivity: 'general', conflict_group_id: 'group-xyz' }),
    ])
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'internal_brief' }, { supabase: sb, now: () => NOW })
    expect(result.entries[0]?.conflictGroupId).toBe('group-xyz')
  })

  it('surfaces null when the fact was never part of a conflict', async () => {
    const sb = makeSb([fact({ id: 'f1', fact_key: 'k.general', visibility: 'customer_ok', sensitivity: 'general' })])
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'internal_brief' }, { supabase: sb, now: () => NOW })
    expect(result.entries[0]?.conflictGroupId).toBeNull()
  })
})

describe('getClientKnowledge — scope filter', () => {
  it('only returns entries whose scope is a superset match of the requested scope', async () => {
    const sb = makeSb([
      fact({ id: 'auckland', fact_key: 'k.tour', scope: { city: 'Auckland' }, visibility: 'customer_ok', sensitivity: 'general' }),
      fact({ id: 'christchurch', fact_key: 'k.tour', scope: { city: 'Christchurch' }, visibility: 'customer_ok', sensitivity: 'general' }),
    ])
    const result = await getClientKnowledge(
      CLIENT_A,
      { purpose: 'internal_brief', scope: { city: 'Auckland' } },
      { supabase: sb, now: () => NOW },
    )
    expect(result.entries.map((e) => e.id)).toEqual(['auckland'])
  })

  it('returns all matching-purpose entries when no scope filter is given', async () => {
    const sb = makeSb([
      fact({ id: 'auckland', fact_key: 'k.tour', scope: { city: 'Auckland' }, visibility: 'customer_ok', sensitivity: 'general' }),
      fact({ id: 'christchurch', fact_key: 'k.tour2', scope: { city: 'Christchurch' }, visibility: 'customer_ok', sensitivity: 'general' }),
    ])
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'internal_brief' }, { supabase: sb, now: () => NOW })
    expect(result.entries.length).toBe(2)
  })
})

describe('getClientKnowledge — cross-client isolation', () => {
  it('reading client A never returns any row belonging to client B', async () => {
    const sb = makeSb([
      fact({ id: 'a1', client_id: CLIENT_A, fact_key: 'k.a', visibility: 'customer_ok', sensitivity: 'general' }),
      fact({ id: 'b1', client_id: CLIENT_B, fact_key: 'k.b', visibility: 'customer_ok', sensitivity: 'general' }),
    ])
    const result = await getClientKnowledge(CLIENT_A, { purpose: 'internal_brief' }, { supabase: sb, now: () => NOW })
    expect(result.entries.map((e) => e.id)).toEqual(['a1'])
    expect(result.entries.every((e) => e.clientId === CLIENT_A)).toBe(true)
  })

  it("client A's entitlement grant does not leak client B's facts even if B also has facts", async () => {
    const sb = makeSb(
      [
        fact({ id: 'a1', client_id: CLIENT_A, fact_key: 'k.a', visibility: 'customer_ok', sensitivity: 'general' }),
        fact({ id: 'b1', client_id: CLIENT_B, fact_key: 'k.b', visibility: 'customer_ok', sensitivity: 'general' }),
      ],
      [ENTITLEMENT_GRANT],
    )
    await expect(
      getClientKnowledge(CLIENT_B, { purpose: 'internal_brief' }, { supabase: sb, now: () => NOW }),
    ).rejects.toThrow(KnowledgeNotEntitledError) // B has no grant of its own
  })
})

// Sanity check that the fixture builder and the real getKnowledgeEntitlement
// agree on what an active grant looks like (keeps this file's ENTITLEMENT_GRANT
// fixture honest against entitlement.ts's own contract).
describe('fixture sanity', () => {
  it('ENTITLEMENT_GRANT resolves to entitled: true via getKnowledgeEntitlement directly', async () => {
    const sb = createFakeSupabase({ client_automation_policies: [ENTITLEMENT_GRANT] })
    const result = await getKnowledgeEntitlement(CLIENT_A, { supabase: sb, now: () => NOW })
    expect(result.entitled).toBe(true)
  })
})
