/**
 * FDE 审核队列（issue #1646）：排序规则 + 五个决定写了什么。
 *
 * 假 Supabase 建模的是真实 PostgREST 行为（见 fake-write-supabase.ts）：
 * update 匹配不到行返回空数组而不是报错、不接 .select() 拿不到 data、
 * CHECK 约束以 error.message 形式回来而不是抛异常。
 */

import { describe, it, expect } from 'vitest'
import {
  applyCandidateDecision,
  buildDecisionFields,
  groupCandidates,
  listFactsAwaitingCustomerConfirmation,
  listKnowledgeCandidates,
  KnowledgeReviewError,
  type ApprovedCounterpart,
  type KnowledgeCandidate,
} from '../review'
import { KnowledgeReadError } from '../errors'
import { createFakeWriteSupabase, type Row } from './fake-write-supabase'

const CLIENT_A = 'aaaaaaaa-0000-0000-0000-000000000001'
const CLIENT_B = 'bbbbbbbb-0000-0000-0000-000000000002'
const FDE = 'fde@magicengine.cloud'

function candidate(overrides: Partial<KnowledgeCandidate> & { id: string }): KnowledgeCandidate {
  return {
    factKey: 'rate.parcel.per_kg',
    scope: { service_line: 'parcel_sea' },
    statement: '20 公斤以下每公斤 NZD 4',
    structuredValue: { amount: 4 },
    sensitivity: 'price',
    visibility: 'internal_only',
    validFrom: '2026-09-01T00:00:00.000Z',
    validUntil: null,
    sourceKind: 'conversation_mining',
    conflictGroupId: null,
    evidence: {
      occurrenceCount: 1,
      distinctConversationCount: 1,
      firstSeenAt: '2026-09-01T00:00:00.000Z',
      lastSeenAt: '2026-09-01T00:00:00.000Z',
    },
    createdAt: '2026-09-10T00:00:00.000Z',
    ...overrides,
  }
}

function factRow(overrides: Row & { id: string }): Row {
  return {
    client_id: CLIENT_A,
    fact_key: 'rate.parcel.per_kg',
    scope: { service_line: 'parcel_sea' },
    statement: '20 公斤以下每公斤 NZD 4',
    structured_value: { amount: 4 },
    status: 'candidate',
    visibility: 'internal_only',
    sensitivity: 'price',
    valid_from: '2026-09-01T00:00:00.000Z',
    valid_until: null,
    source_kind: 'conversation_mining',
    evidence: { occurrence_count: 51, distinct_conversation_count: 44, first_seen_at: '2026-06-01T00:00:00.000Z', last_seen_at: '2026-09-10T00:00:00.000Z' },
    conflict_group_id: null,
    approved_by_email: null,
    approved_at: null,
    client_confirmed_by_email: null,
    client_confirmed_at: null,
    client_confirmed_fingerprint: null,
    created_at: '2026-09-10T00:00:00.000Z',
    ...overrides,
  }
}

describe('groupCandidates — 排序是 §3.3 的产品决定，不是排版', () => {
  it('先冲突组，再新增，再佐证', () => {
    const approved = new Map<string, ApprovedCounterpart>([
      [
        'rate.airfreight::[["service_line","air"]]',
        { id: 'approved-1', statement: '空运每公斤 NZD 7', validUntil: null, approvedByEmail: FDE, clientConfirmedAt: null },
      ],
    ])

    const groups = groupCandidates(
      [
        // 佐证：跟一条已批准的事实同身份，且没有冲突组号
        candidate({ id: 'c-corroborate', factKey: 'rate.airfreight', scope: { service_line: 'air' } }),
        // 新增
        candidate({ id: 'c-new', factKey: 'cutoff.airfreight', scope: {} }),
        // 冲突
        candidate({ id: 'c-conflict-a', conflictGroupId: 'g1' }),
        candidate({ id: 'c-conflict-b', conflictGroupId: 'g1', statement: '10 公斤以下每公斤 NZD 4' }),
      ],
      approved,
    )

    expect(groups.map((g) => g.kind)).toEqual(['conflict', 'new', 'corroborating'])
    expect(groups[0].candidates.map((c) => c.id)).toEqual(['c-conflict-a', 'c-conflict-b'])
    expect(groups[2].approvedCounterpart?.statement).toBe('空运每公斤 NZD 7')
  })

  it('同一类里，覆盖对话最多的排前面（51 次那条不能沉到底下）', () => {
    const loud = candidate({
      id: 'loud',
      factKey: 'a',
      evidence: { occurrenceCount: 51, distinctConversationCount: 44, firstSeenAt: null, lastSeenAt: '2026-09-01T00:00:00.000Z' },
    })
    const quiet = candidate({
      id: 'quiet',
      factKey: 'b',
      evidence: { occurrenceCount: 2, distinctConversationCount: 2, firstSeenAt: null, lastSeenAt: '2026-09-02T00:00:00.000Z' },
    })
    const groups = groupCandidates([quiet, loud], new Map())
    expect(groups.map((g) => g.candidates[0].id)).toEqual(['loud', 'quiet'])
  })

  it('带冲突组号的候选，即使同时佐证了一条已批准事实，仍然按冲突组处理', () => {
    const approved = new Map<string, ApprovedCounterpart>([
      [
        'rate.parcel.per_kg::[["service_line","parcel_sea"]]',
        { id: 'approved-1', statement: '旧价', validUntil: null, approvedByEmail: FDE, clientConfirmedAt: null },
      ],
    ])
    const groups = groupCandidates([candidate({ id: 'x', conflictGroupId: 'g9' })], approved)
    expect(groups[0].kind).toBe('conflict')
  })

  it('范围键顺序不同不算两个身份', () => {
    const approved = new Map<string, ApprovedCounterpart>([
      [
        'k::[["a",1],["b",2]]',
        { id: 'approved-1', statement: '现行', validUntil: null, approvedByEmail: FDE, clientConfirmedAt: null },
      ],
    ])
    const groups = groupCandidates([candidate({ id: 'x', factKey: 'k', scope: { b: 2, a: 1 } })], approved)
    expect(groups[0].kind).toBe('corroborating')
  })
})

describe('listKnowledgeCandidates', () => {
  it('只返回这个客户的候选行，不返回已批准的行', async () => {
    const sb = createFakeWriteSupabase({
      client_knowledge_facts: [
        factRow({ id: 'f1' }),
        factRow({ id: 'f2', status: 'approved', approved_by_email: FDE, approved_at: '2026-09-11T00:00:00.000Z', fact_key: 'other' }),
        factRow({ id: 'f3', client_id: CLIENT_B }),
      ],
    })
    const groups = await listKnowledgeCandidates(CLIENT_A, sb)
    const ids = groups.flatMap((g) => g.candidates.map((c) => c.id))
    expect(ids).toEqual(['f1'])
  })

  it('读库失败必须抛错，不能返回空列表（空列表在页面上跟"没东西要审"一模一样）', async () => {
    const sb = createFakeWriteSupabase(
      { client_knowledge_facts: [factRow({ id: 'f1' })] },
      { errorTables: new Set(['client_knowledge_facts']) },
    )
    await expect(listKnowledgeCandidates(CLIENT_A, sb)).rejects.toBeInstanceOf(KnowledgeReadError)
  })

  it('把 evidence 里的计数原样带出来给页面显示', async () => {
    const sb = createFakeWriteSupabase({ client_knowledge_facts: [factRow({ id: 'f1' })] })
    const groups = await listKnowledgeCandidates(CLIENT_A, sb)
    expect(groups[0].candidates[0].evidence).toEqual({
      occurrenceCount: 51,
      distinctConversationCount: 44,
      firstSeenAt: '2026-06-01T00:00:00.000Z',
      lastSeenAt: '2026-09-10T00:00:00.000Z',
    })
  })
})

describe('listFactsAwaitingCustomerConfirmation', () => {
  it('只出"已批准 + 还没客户确认 + 敏感四类"的条目', async () => {
    const sb = createFakeWriteSupabase({
      client_knowledge_facts: [
        factRow({ id: 'want', status: 'approved', approved_by_email: FDE, approved_at: 'x', sensitivity: 'price' }),
        factRow({ id: 'general-skip', status: 'approved', approved_by_email: FDE, approved_at: 'x', sensitivity: 'general', fact_key: 'g' }),
        factRow({ id: 'candidate-skip', fact_key: 'c' }),
        factRow({
          id: 'already-confirmed-skip',
          fact_key: 'd',
          status: 'approved',
          approved_by_email: FDE,
          approved_at: 'x',
          client_confirmed_by_email: 'owner@ctstours.co.nz',
          client_confirmed_at: '2026-09-12T00:00:00.000Z',
          client_confirmed_fingerprint: 'fp',
        }),
        factRow({ id: 'other-client-skip', client_id: CLIENT_B, status: 'approved', approved_by_email: FDE, approved_at: 'x' }),
      ],
    })
    const facts = await listFactsAwaitingCustomerConfirmation(CLIENT_A, sb)
    expect(facts.map((f) => f.id)).toEqual(['want'])
  })
})

describe('buildDecisionFields — 每个动作到底写了哪些字段', () => {
  const NOW = '2026-09-14T10:00:00.000Z'

  it('批准：标成 approved、记批准人、对客可见', () => {
    expect(buildDecisionFields({ action: 'approve' }, FDE, NOW)).toEqual({
      status: 'approved',
      approved_by_email: FDE,
      approved_at: NOW,
      visibility: 'customer_ok',
    })
  })

  it('🔴 任何一个动作都绝不写 client_confirmed_* —— 那是客户那一签，只能由确认链接写', () => {
    const decisions = [
      { action: 'approve' as const },
      { action: 'approve_with_edits' as const, statement: '改过的说法' },
      { action: 'reject' as const },
      { action: 'forbid' as const },
      { action: 'set_valid_until' as const, validUntil: null },
    ]
    for (const decision of decisions) {
      const fields = buildDecisionFields(decision, FDE, NOW)
      expect(Object.keys(fields).filter((k) => k.startsWith('client_confirmed'))).toEqual([])
    }
  })

  it('🔴 任何一个动作都不改 sensitivity（§9.5：降级成 general 也要客户确认）', () => {
    const decisions = [
      { action: 'approve' as const },
      { action: 'approve_with_edits' as const, statement: 'x' },
      { action: 'forbid' as const },
    ]
    for (const decision of decisions) {
      expect(buildDecisionFields(decision, FDE, NOW)).not.toHaveProperty('sensitivity')
    }
  })

  it('禁止对客说：仍然要 approved，否则读取入口根本看不到它（forbiddenFactKeys 只扫 approved 行）', () => {
    expect(buildDecisionFields({ action: 'forbid' }, FDE, NOW)).toMatchObject({
      status: 'approved',
      visibility: 'forbidden',
    })
  })

  it('改后批准：只写被改过的那几项，没传的不动', () => {
    const fields = buildDecisionFields({ action: 'approve_with_edits', statement: '新说法' }, FDE, NOW)
    expect(fields).toMatchObject({ statement: '新说法', status: 'approved' })
    expect(fields).not.toHaveProperty('scope')
    expect(fields).not.toHaveProperty('valid_until')
  })

  it('改后批准：正文改成空白直接拒绝', () => {
    expect(() => buildDecisionFields({ action: 'approve_with_edits', statement: '   ' }, FDE, NOW)).toThrow(
      KnowledgeReviewError,
    )
  })

  it('设有效期：只写 valid_until，不碰状态', () => {
    expect(buildDecisionFields({ action: 'set_valid_until', validUntil: '2026-12-31' }, FDE, NOW)).toEqual({
      valid_until: new Date('2026-12-31').toISOString(),
    })
  })

  it('认不出来的日期直接拒绝，不静默塞一个 Invalid Date 进库', () => {
    expect(() => buildDecisionFields({ action: 'set_valid_until', validUntil: '下周三' }, FDE, NOW)).toThrow(
      KnowledgeReviewError,
    )
  })

  it('驳回：写状态和原因，不写批准人', () => {
    expect(buildDecisionFields({ action: 'reject', note: ' 价格早改了 ' }, FDE, NOW)).toEqual({
      status: 'rejected',
      client_rejection_note: '价格早改了',
    })
  })
})

describe('applyCandidateDecision', () => {
  it('批准一条候选，行真的被改了', async () => {
    const tables = { client_knowledge_facts: [factRow({ id: 'f1' })] }
    const sb = createFakeWriteSupabase(tables)
    await applyCandidateDecision(sb, {
      clientId: CLIENT_A,
      factId: 'f1',
      actorEmail: FDE,
      decision: { action: 'approve' },
      now: () => new Date('2026-09-14T10:00:00.000Z'),
    })
    expect(tables.client_knowledge_facts[0]).toMatchObject({
      status: 'approved',
      approved_by_email: FDE,
      visibility: 'customer_ok',
    })
  })

  it('🔴 改不到行时必须报错 —— PostgREST 的空数组不是成功', async () => {
    const sb = createFakeWriteSupabase({
      // 已经离开待审队列的行：status 不是 candidate
      client_knowledge_facts: [factRow({ id: 'f1', status: 'approved', approved_by_email: FDE, approved_at: 'x' })],
    })
    await expect(
      applyCandidateDecision(sb, { clientId: CLIENT_A, factId: 'f1', actorEmail: FDE, decision: { action: 'approve' } }),
    ).rejects.toBeInstanceOf(KnowledgeReviewError)
  })

  it('🔴 跨客户隔离：拿别的客户的条目编号过来，改不动', async () => {
    const tables = { client_knowledge_facts: [factRow({ id: 'f1', client_id: CLIENT_B })] }
    const sb = createFakeWriteSupabase(tables)
    await expect(
      applyCandidateDecision(sb, { clientId: CLIENT_A, factId: 'f1', actorEmail: FDE, decision: { action: 'approve' } }),
    ).rejects.toBeInstanceOf(KnowledgeReviewError)
    expect(tables.client_knowledge_facts[0].status).toBe('candidate')
  })

  it('🔴 已经被客户确认过的行，改不动（它早就不是 candidate 了）', async () => {
    const tables = {
      client_knowledge_facts: [
        factRow({
          id: 'f1',
          status: 'approved',
          approved_by_email: FDE,
          approved_at: 'x',
          client_confirmed_by_email: 'owner@ctstours.co.nz',
          client_confirmed_at: '2026-09-12T00:00:00.000Z',
          client_confirmed_fingerprint: 'fp',
        }),
      ],
    }
    const sb = createFakeWriteSupabase(tables)
    await expect(
      applyCandidateDecision(sb, {
        clientId: CLIENT_A,
        factId: 'f1',
        actorEmail: FDE,
        decision: { action: 'approve_with_edits', statement: '偷偷改一下价格' },
      }),
    ).rejects.toBeInstanceOf(KnowledgeReviewError)
    expect(tables.client_knowledge_facts[0].statement).toBe('20 公斤以下每公斤 NZD 4')
  })

  it('没有审核人身份就拒绝写入', async () => {
    const sb = createFakeWriteSupabase({ client_knowledge_facts: [factRow({ id: 'f1' })] })
    await expect(
      applyCandidateDecision(sb, { clientId: CLIENT_A, factId: 'f1', actorEmail: '  ', decision: { action: 'approve' } }),
    ).rejects.toThrow('缺少审核人身份')
  })

  it('触发器报"同一身份已有一条 approved"时，翻译成 FDE 看得懂的话', async () => {
    const sb = createFakeWriteSupabase(
      { client_knowledge_facts: [factRow({ id: 'f1' })] },
      { errorTables: new Set([]) },
    )
    // 直接构造一个返回该报错的假客户端
    const failing = {
      from() {
        return {
          select: () => failingBuilder,
          insert: () => failingBuilder,
          update: () => failingBuilder,
        }
      },
    }
    const failingBuilder = Object.assign(
      Promise.resolve({
        data: null,
        error: { message: 'client_knowledge_facts: another approved row already exists for this identity (...)' },
      }),
      {
        eq: () => failingBuilder,
        is: () => failingBuilder,
        in: () => failingBuilder,
        order: () => failingBuilder,
        limit: () => failingBuilder,
        select: () => failingBuilder,
      },
    )
    void sb
    await expect(
      applyCandidateDecision(failing as never, {
        clientId: CLIENT_A,
        factId: 'f1',
        actorEmail: FDE,
        decision: { action: 'approve' },
      }),
    ).rejects.toThrow('已经有一条生效中的版本')
  })
})
