/**
 * Client Knowledge Base — rollout stage machine (issue #1648, design doc
 * §3.5 / §7.3 / §9.14 A).
 */

import { describe, it, expect } from 'vitest'
import {
  consumeRolloutAdvanceRequest,
  createRolloutAdvanceRequest,
  getCurrentRolloutStage,
  INITIAL_STAGE,
  isKnowledgeLiveForCustomerReply,
  KnowledgeRolloutError,
  LIVE_STAGE,
  loadRolloutAdvanceRequest,
  meetsSampleCheckFloor,
  rollbackKnowledgeRolloutStage,
  ROLLOUT_SAMPLE_CHECK_FLOOR,
} from '../rollout'
import { KnowledgeReadError } from '../errors'
import {
  createFakeWriteSupabase as createFakeWriteSupabaseRaw,
  type FakeWriteOptions,
  type Row,
} from './fake-write-supabase'

const CLIENT_A = 'aaaaaaaa-0000-0000-0000-000000000001'
const ME_ACTOR = 'ray@magicengine.cloud'
const CUSTOMER_SIGNER = 'owner@ctstours.co.nz'
const NOW = new Date('2026-09-15T00:00:00.000Z')

/**
 * All the module functions under test are called with `now: () => NOW` (a frozen
 * clock), so the fake DB's own row-stamping clock must be frozen to the same value —
 * otherwise an expiry-style CHECK constraint compares a frozen `expires_at` against a
 * `created_at` stamped from the real wall clock, which drifts out of sync as real time
 * moves past `NOW`.
 */
function createFakeWriteSupabase(tables: Record<string, Row[]>, options: FakeWriteOptions = {}) {
  return createFakeWriteSupabaseRaw(tables, { now: () => NOW, ...options })
}

const REGISTERED_CONFIRMER: Row = {
  client_id: CLIENT_A,
  confirmer_email: CUSTOMER_SIGNER,
  registered_by_email: ME_ACTOR,
  registered_at: '2026-01-01T00:00:00.000Z',
  revoked_at: null,
}

const GOOD_SAMPLE_CHECK = { sampleSize: 30, priceErrors: 0, otherAccuracyPct: 95 }

function tables(overrides: Partial<Record<string, Row[]>> = {}) {
  return {
    clients: [{ id: CLIENT_A, name: 'CTS', messenger_agent_enabled_messenger: true }],
    client_knowledge_events: [] as Row[],
    client_knowledge_confirmers: [REGISTERED_CONFIRMER],
    client_knowledge_rollout_advance_requests: [] as Row[],
    client_knowledge_facts: [] as Row[],
    ...overrides,
  }
}

function phaseEvent(value: string, createdAt: string): Row {
  return { client_id: CLIENT_A, dimension: 'phase', value, actor_email: ME_ACTOR, created_at: createdAt }
}

describe('getCurrentRolloutStage', () => {
  it('defaults to stage 0 when no phase event exists yet', async () => {
    const sb = createFakeWriteSupabase(tables())
    expect(await getCurrentRolloutStage(CLIENT_A, sb)).toBe(INITIAL_STAGE)
  })

  it('reads the latest phase event, ignoring kill_switch-dimension events', async () => {
    const sb = createFakeWriteSupabase(
      tables({
        client_knowledge_events: [
          phaseEvent('1', '2026-01-01T00:00:00.000Z'),
          { client_id: CLIENT_A, dimension: 'kill_switch', value: 'off', actor_email: ME_ACTOR, created_at: '2026-06-01T00:00:00.000Z' },
          phaseEvent('2', '2026-03-01T00:00:00.000Z'),
        ],
      }),
    )
    expect(await getCurrentRolloutStage(CLIENT_A, sb)).toBe(2)
  })

  it('propagates a read failure rather than guessing a stage', async () => {
    const sb = createFakeWriteSupabase(tables(), { errorTables: new Set(['client_knowledge_events']) })
    await expect(getCurrentRolloutStage(CLIENT_A, sb)).rejects.toBeInstanceOf(KnowledgeReadError)
  })
})

describe('isKnowledgeLiveForCustomerReply — the one fail-closed judgement', () => {
  it('true only when stage is LIVE_STAGE (2) AND the Messenger switch is on', async () => {
    const sb = createFakeWriteSupabase(
      tables({ client_knowledge_events: [phaseEvent(String(LIVE_STAGE), '2026-01-01T00:00:00.000Z')] }),
    )
    expect(await isKnowledgeLiveForCustomerReply(CLIENT_A, sb)).toBe(true)
  })

  it('🔴 false when stage is 1 (客户共测) even if the Messenger switch is on', async () => {
    const sb = createFakeWriteSupabase(tables({ client_knowledge_events: [phaseEvent('1', '2026-01-01T00:00:00.000Z')] }))
    expect(await isKnowledgeLiveForCustomerReply(CLIENT_A, sb)).toBe(false)
  })

  it('🔴 false when stage is 2 but the Messenger switch is off — the stage alone is not enough', async () => {
    const sb = createFakeWriteSupabase(
      tables({
        clients: [{ id: CLIENT_A, name: 'CTS', messenger_agent_enabled_messenger: false }],
        client_knowledge_events: [phaseEvent('2', '2026-01-01T00:00:00.000Z')],
      }),
    )
    expect(await isKnowledgeLiveForCustomerReply(CLIENT_A, sb)).toBe(false)
  })

  it('🔴 mutation-critical: a DB error reading the stage resolves to NOT live, never throws and never "assumes stage 2"', async () => {
    const sb = createFakeWriteSupabase(
      tables({ client_knowledge_events: [phaseEvent('2', '2026-01-01T00:00:00.000Z')] }),
      { errorTables: new Set(['client_knowledge_events']) },
    )
    await expect(isKnowledgeLiveForCustomerReply(CLIENT_A, sb)).resolves.toBe(false)
  })

  it('🔴 mutation-critical: a DB error reading the Messenger switch resolves to NOT live, never throws', async () => {
    const sb = createFakeWriteSupabase(
      tables({ client_knowledge_events: [phaseEvent('2', '2026-01-01T00:00:00.000Z')] }),
      { errorTables: new Set(['clients']) },
    )
    await expect(isKnowledgeLiveForCustomerReply(CLIENT_A, sb)).resolves.toBe(false)
  })
})

describe('createRolloutAdvanceRequest', () => {
  it('creates a pending 0→1 request with no sample check required', async () => {
    const sb = createFakeWriteSupabase(tables())
    const result = await createRolloutAdvanceRequest(sb, {
      clientId: CLIENT_A,
      toStage: 1,
      confirmerEmail: CUSTOMER_SIGNER,
      actorEmail: ME_ACTOR,
      now: () => NOW,
    })
    expect(result.fromStage).toBe(0)
    expect(result.toStage).toBe(1)
    expect(result.rawToken).toBeTruthy()
  })

  it('refuses to skip a stage (0→2 directly)', async () => {
    const sb = createFakeWriteSupabase(tables())
    await expect(
      createRolloutAdvanceRequest(sb, {
        clientId: CLIENT_A,
        toStage: 2,
        confirmerEmail: CUSTOMER_SIGNER,
        actorEmail: ME_ACTOR,
        now: () => NOW,
      }),
    ).rejects.toThrow('一步一段')
  })

  it('🔴 refuses 1→2 without a sample check', async () => {
    const sb = createFakeWriteSupabase(tables({ client_knowledge_events: [phaseEvent('1', '2026-01-01T00:00:00.000Z')] }))
    await expect(
      createRolloutAdvanceRequest(sb, {
        clientId: CLIENT_A,
        toStage: 2,
        confirmerEmail: CUSTOMER_SIGNER,
        actorEmail: ME_ACTOR,
        now: () => NOW,
      }),
    ).rejects.toThrow('抽查结果')
  })

  it('🔴 §9.10 floor: refuses a sample check below the minimum sample size, even if the customer agreed to it', async () => {
    const sb = createFakeWriteSupabase(tables({ client_knowledge_events: [phaseEvent('1', '2026-01-01T00:00:00.000Z')] }))
    await expect(
      createRolloutAdvanceRequest(sb, {
        clientId: CLIENT_A,
        toStage: 2,
        confirmerEmail: CUSTOMER_SIGNER,
        actorEmail: ME_ACTOR,
        sampleCheck: { sampleSize: 10, priceErrors: 0, otherAccuracyPct: 100 },
        now: () => NOW,
      }),
    ).rejects.toThrow('不能要求调低')
  })

  it('🔴 §9.10 floor: refuses any price error, even a single one', async () => {
    const sb = createFakeWriteSupabase(tables({ client_knowledge_events: [phaseEvent('1', '2026-01-01T00:00:00.000Z')] }))
    await expect(
      createRolloutAdvanceRequest(sb, {
        clientId: CLIENT_A,
        toStage: 2,
        confirmerEmail: CUSTOMER_SIGNER,
        actorEmail: ME_ACTOR,
        sampleCheck: { sampleSize: 30, priceErrors: 1, otherAccuracyPct: 100 },
        now: () => NOW,
      }),
    ).rejects.toThrow('不能要求调低')
  })

  it('accepts exactly the floor (30 / 0 / 90%)', async () => {
    const sb = createFakeWriteSupabase(tables({ client_knowledge_events: [phaseEvent('1', '2026-01-01T00:00:00.000Z')] }))
    const result = await createRolloutAdvanceRequest(sb, {
      clientId: CLIENT_A,
      toStage: 2,
      confirmerEmail: CUSTOMER_SIGNER,
      actorEmail: ME_ACTOR,
      sampleCheck: { sampleSize: 30, priceErrors: 0, otherAccuracyPct: 90 },
      now: () => NOW,
    })
    expect(result.toStage).toBe(2)
  })

  it('职责分离: refuses when the confirmer is the same person as the ME actor', async () => {
    const sb = createFakeWriteSupabase(tables())
    await expect(
      createRolloutAdvanceRequest(sb, {
        clientId: CLIENT_A,
        toStage: 1,
        confirmerEmail: ME_ACTOR,
        actorEmail: ME_ACTOR,
        now: () => NOW,
      }),
    ).rejects.toThrow('两个人')
  })

  it('refuses a confirmer who was never registered for this client', async () => {
    const sb = createFakeWriteSupabase(tables({ client_knowledge_confirmers: [] }))
    await expect(
      createRolloutAdvanceRequest(sb, {
        clientId: CLIENT_A,
        toStage: 1,
        confirmerEmail: 'random-stranger@example.com',
        actorEmail: ME_ACTOR,
        now: () => NOW,
      }),
    ).rejects.toThrow('登记')
  })
})

describe('createRolloutAdvanceRequest → loadRolloutAdvanceRequest → consumeRolloutAdvanceRequest (dual-signature happy path)', () => {
  it('both signatures present: the event is inserted and the effective stage advances', async () => {
    const db = tables()
    const sb = createFakeWriteSupabase(db)
    const created = await createRolloutAdvanceRequest(sb, {
      clientId: CLIENT_A,
      toStage: 1,
      confirmerEmail: CUSTOMER_SIGNER,
      actorEmail: ME_ACTOR,
      now: () => NOW,
    })

    // Opening the link (a GET / mail scanner) must not consume it.
    const viewed = await loadRolloutAdvanceRequest(sb, { requestId: created.requestId, rawToken: created.rawToken, now: () => NOW })
    expect(viewed.ok).toBe(true)
    expect(db.client_knowledge_rollout_advance_requests[0].status).toBe('pending')
    expect(db.client_knowledge_events).toHaveLength(0)
    expect(await getCurrentRolloutStage(CLIENT_A, sb)).toBe(0)

    const consumed = await consumeRolloutAdvanceRequest(sb, {
      requestId: created.requestId,
      rawToken: created.rawToken,
      now: () => NOW,
    })
    expect(consumed.ok).toBe(true)
    if (!consumed.ok) throw new Error('unreachable')
    expect(consumed.newStage).toBe(1)
    expect(db.client_knowledge_events).toHaveLength(1)
    expect(db.client_knowledge_events[0]).toMatchObject({
      client_id: CLIENT_A,
      dimension: 'phase',
      value: '1',
      actor_email: ME_ACTOR,
    })
    expect(db.client_knowledge_events[0].payload).toMatchObject({
      fromStage: '0',
      toStage: '1',
      meSignerEmail: ME_ACTOR,
      customerSignerEmail: CUSTOMER_SIGNER,
    })
    expect(await getCurrentRolloutStage(CLIENT_A, sb)).toBe(1)
  })

  it('a second submit of the same link is refused and does not insert a second event', async () => {
    const db = tables()
    const sb = createFakeWriteSupabase(db)
    const created = await createRolloutAdvanceRequest(sb, {
      clientId: CLIENT_A,
      toStage: 1,
      confirmerEmail: CUSTOMER_SIGNER,
      actorEmail: ME_ACTOR,
      now: () => NOW,
    })
    await consumeRolloutAdvanceRequest(sb, { requestId: created.requestId, rawToken: created.rawToken, now: () => NOW })
    const second = await consumeRolloutAdvanceRequest(sb, { requestId: created.requestId, rawToken: created.rawToken, now: () => NOW })
    expect(second).toEqual({ ok: false, problem: 'already_used' })
    expect(db.client_knowledge_events).toHaveLength(1)
  })

  it('the wrong token is refused and does not consume the link or write an event', async () => {
    const db = tables()
    const sb = createFakeWriteSupabase(db)
    const created = await createRolloutAdvanceRequest(sb, {
      clientId: CLIENT_A,
      toStage: 1,
      confirmerEmail: CUSTOMER_SIGNER,
      actorEmail: ME_ACTOR,
      now: () => NOW,
    })
    const result = await consumeRolloutAdvanceRequest(sb, { requestId: created.requestId, rawToken: 'not-the-real-token', now: () => NOW })
    expect(result).toEqual({ ok: false, problem: 'bad_token' })
    expect(db.client_knowledge_rollout_advance_requests[0].status).toBe('pending')
    expect(db.client_knowledge_events).toHaveLength(0)
  })

  it('an expired link is refused and does not write an event', async () => {
    const db = tables()
    const sb = createFakeWriteSupabase(db)
    const created = await createRolloutAdvanceRequest(sb, {
      clientId: CLIENT_A,
      toStage: 1,
      confirmerEmail: CUSTOMER_SIGNER,
      actorEmail: ME_ACTOR,
      ttlHours: 1,
      now: () => NOW,
    })
    const muchLater = () => new Date(NOW.getTime() + 2 * 3_600_000)
    const result = await consumeRolloutAdvanceRequest(sb, { requestId: created.requestId, rawToken: created.rawToken, now: muchLater })
    expect(result).toEqual({ ok: false, problem: 'expired' })
    expect(db.client_knowledge_events).toHaveLength(0)
  })

  it('🔴 2026-09-15 子牙+魏征联合复审：a rollback that supersedes a still-pending advance link is refused as "superseded", NOT silently honoured, and NOT collapsed into "already_used"', async () => {
    // 攻击场景（两位复审各自对真实本机 Postgres 复现）：客户在阶段 1 →
    // ME 建一条 1→2 的前进请求（from_stage 冻成 '1'）→ 在客户点它之前，
    // ME 发现价格错了，一键回退到阶段 0 → 客户之后才点开这条仍然"有效、
    // 未过期、pending"的链接。修复前：consume 只查 status==='pending'，
    // 照旧把它 claim 掉，写一条 value='2' 的事件，把刚做的回退原样抹掉。
    const db = tables({ client_knowledge_events: [phaseEvent('1', '2026-01-01T00:00:00.000Z')] })
    const sb = createFakeWriteSupabase(db)

    const created = await createRolloutAdvanceRequest(sb, {
      clientId: CLIENT_A,
      toStage: 2,
      confirmerEmail: CUSTOMER_SIGNER,
      actorEmail: ME_ACTOR,
      sampleCheck: GOOD_SAMPLE_CHECK,
      now: () => NOW,
    })
    expect(await getCurrentRolloutStage(CLIENT_A, sb)).toBe(1)

    // ME 发现价格错了，在客户点链接之前一键退回阶段 0。
    const rollbackTime = new Date(NOW.getTime() + 60_000)
    await rollbackKnowledgeRolloutStage(sb, {
      clientId: CLIENT_A,
      toStage: 0,
      reason: '停售团报价写错了',
      actorEmail: ME_ACTOR,
      now: () => rollbackTime,
    })
    expect(await getCurrentRolloutStage(CLIENT_A, sb)).toBe(0)
    expect(db.client_knowledge_events).toHaveLength(2)

    // 客户现在才点开那条链接（回退之前发的，本身没过期、没被用过）。
    const clickTime = new Date(rollbackTime.getTime() + 60_000)
    const consumed = await consumeRolloutAdvanceRequest(sb, {
      requestId: created.requestId,
      rawToken: created.rawToken,
      now: () => clickTime,
    })

    // 拒绝，且是能跟"链接已经被点过"分开的、专门的原因码。
    expect(consumed).toEqual({ ok: false, problem: 'superseded' })
    // 一个字没写：还是回退之后那 2 条事件，没有第 3 条 value='2' 的事件。
    expect(db.client_knowledge_events).toHaveLength(2)
    expect(db.client_knowledge_events.some((e) => e.value === '2')).toBe(false)
    expect(await getCurrentRolloutStage(CLIENT_A, sb)).toBe(0)
    // 请求本身也没有被打上终态——留 pending，跟真实 RPC 的行为一致。
    expect(db.client_knowledge_rollout_advance_requests[0].status).toBe('pending')
  })

  it('🔴 只有一个签字人不推进: confirmer registration revoked after the link was sent — consuming it is refused, no event is inserted, and the effective stage does not change', async () => {
    const db = tables()
    const sb = createFakeWriteSupabase(db)
    const created = await createRolloutAdvanceRequest(sb, {
      clientId: CLIENT_A,
      toStage: 1,
      confirmerEmail: CUSTOMER_SIGNER,
      actorEmail: ME_ACTOR,
      now: () => NOW,
    })

    // The customer signer's registration is revoked before they click — the
    // ME side (one signature) is still on record, but the customer side no
    // longer resolves to an acceptable identity.
    db.client_knowledge_confirmers[0].revoked_at = '2026-09-14T00:00:00.000Z'

    const result = await consumeRolloutAdvanceRequest(sb, { requestId: created.requestId, rawToken: created.rawToken, now: () => NOW })
    expect(result).toEqual({ ok: false, problem: 'not_registered' })
    expect(db.client_knowledge_events).toHaveLength(0)
    expect(await getCurrentRolloutStage(CLIENT_A, sb)).toBe(INITIAL_STAGE)
  })
})

describe('rollbackKnowledgeRolloutStage', () => {
  it('immediately inserts a lower-stage event, ME-only, no customer signature required', async () => {
    const db = tables({ client_knowledge_events: [phaseEvent('2', '2026-01-01T00:00:00.000Z')] })
    const sb = createFakeWriteSupabase(db)
    const result = await rollbackKnowledgeRolloutStage(sb, {
      clientId: CLIENT_A,
      toStage: 1,
      reason: '说错了停售团的价格',
      actorEmail: ME_ACTOR,
      now: () => NOW,
    })
    expect(result).toMatchObject({ fromStage: 2, toStage: 1 })
    expect(await getCurrentRolloutStage(CLIENT_A, sb)).toBe(1)
  })

  it('🔴 does not touch client_knowledge_facts at all', async () => {
    const db = tables({
      client_knowledge_events: [phaseEvent('2', '2026-01-01T00:00:00.000Z')],
      client_knowledge_facts: [{ id: 'f1', client_id: CLIENT_A, statement: 'untouched' }],
    })
    const sb = createFakeWriteSupabase(db)
    await rollbackKnowledgeRolloutStage(sb, { clientId: CLIENT_A, toStage: 1, actorEmail: ME_ACTOR, now: () => NOW })
    expect(db.client_knowledge_facts).toEqual([{ id: 'f1', client_id: CLIENT_A, statement: 'untouched' }])
  })

  it('rolling back takes effect immediately — no async delay, checked via getCurrentRolloutStage right after', async () => {
    const db = tables({ client_knowledge_events: [phaseEvent('2', '2026-01-01T00:00:00.000Z')] })
    const sb = createFakeWriteSupabase(db)
    expect(await isKnowledgeLiveForCustomerReply(CLIENT_A, sb)).toBe(true)
    await rollbackKnowledgeRolloutStage(sb, { clientId: CLIENT_A, toStage: 1, actorEmail: ME_ACTOR, now: () => NOW })
    expect(await isKnowledgeLiveForCustomerReply(CLIENT_A, sb)).toBe(false)
  })

  it('refuses to "roll back" to the same or a higher stage', async () => {
    const sb = createFakeWriteSupabase(tables({ client_knowledge_events: [phaseEvent('1', '2026-01-01T00:00:00.000Z')] }))
    await expect(
      rollbackKnowledgeRolloutStage(sb, { clientId: CLIENT_A, toStage: 1, actorEmail: ME_ACTOR, now: () => NOW }),
    ).rejects.toBeInstanceOf(KnowledgeRolloutError)
    await expect(
      rollbackKnowledgeRolloutStage(sb, { clientId: CLIENT_A, toStage: 2, actorEmail: ME_ACTOR, now: () => NOW }),
    ).rejects.toBeInstanceOf(KnowledgeRolloutError)
  })

  it('refuses without an actor identity', async () => {
    const sb = createFakeWriteSupabase(tables({ client_knowledge_events: [phaseEvent('2', '2026-01-01T00:00:00.000Z')] }))
    await expect(
      rollbackKnowledgeRolloutStage(sb, { clientId: CLIENT_A, toStage: 1, actorEmail: '  ', now: () => NOW }),
    ).rejects.toThrow('缺少操作人身份')
  })
})

describe('meetsSampleCheckFloor', () => {
  it('the floor constants match §9.10 exactly', () => {
    expect(ROLLOUT_SAMPLE_CHECK_FLOOR).toEqual({ minSampleSize: 30, maxPriceErrors: 0, minOtherAccuracyPct: 90 })
  })

  it('accepts the floor, rejects anything worse on any one dimension', () => {
    expect(meetsSampleCheckFloor(GOOD_SAMPLE_CHECK)).toBe(true)
    expect(meetsSampleCheckFloor({ sampleSize: 29, priceErrors: 0, otherAccuracyPct: 100 })).toBe(false)
    expect(meetsSampleCheckFloor({ sampleSize: 30, priceErrors: 1, otherAccuracyPct: 100 })).toBe(false)
    expect(meetsSampleCheckFloor({ sampleSize: 30, priceErrors: 0, otherAccuracyPct: 89.9 })).toBe(false)
  })
})
