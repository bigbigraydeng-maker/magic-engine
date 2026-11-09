/**
 * 客户确认链接（issue #1646）。
 *
 * 这个文件锁的是设计稿 §9.14 D 变异清单里跟本 issue 有关的几条：
 *   · 3  指纹任一组成项改动 → 这一条不再算已确认
 *   · 7  公司域名账号不算全局管理员、未登记的邮箱不能确认
 *   · 8  登记人/批准人 = 确认人时拒绝
 *   · 9  打开链接不消耗，只有提交才生效
 * 外加"库里只存哈希不存原始令牌"这条安全硬要求。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  consumeConfirmationRequest,
  createConfirmationRequest,
  hashConfirmationToken,
  KnowledgeConfirmationError,
  loadConfirmationRequest,
} from '../confirmation-requests'
import { computeContentFingerprint } from '../fingerprint'
import { createFakeWriteSupabase, type Row } from './fake-write-supabase'

const CLIENT_A = 'aaaaaaaa-0000-0000-0000-000000000001'
const CLIENT_B = 'bbbbbbbb-0000-0000-0000-000000000002'
const ADMIN = 'ray@magicengine.cloud'
const FDE = 'fde@magicengine.cloud'
const CONFIRMER = 'owner@ctstours.co.nz'

const savedAdminEmails = process.env.ADMIN_EMAILS
beforeEach(() => {
  process.env.ADMIN_EMAILS = ADMIN
})
afterEach(() => {
  if (savedAdminEmails === undefined) delete process.env.ADMIN_EMAILS
  else process.env.ADMIN_EMAILS = savedAdminEmails
})

function approvedFact(overrides: Row & { id: string }): Row {
  return {
    client_id: CLIENT_A,
    fact_key: 'rate.parcel.per_kg',
    scope: { service_line: 'parcel_sea' },
    statement: '20 公斤以下每公斤 NZD 4',
    structured_value: { amount: 4, currency: 'NZD', unit: 'kg' },
    status: 'approved',
    visibility: 'customer_ok',
    sensitivity: 'price',
    valid_from: '2026-09-01T00:00:00.000Z',
    valid_until: '2026-12-01T00:00:00.000Z',
    source_kind: 'conversation_mining',
    evidence: {},
    conflict_group_id: null,
    approved_by_email: FDE,
    approved_at: '2026-09-11T00:00:00.000Z',
    client_confirmed_by_email: null,
    client_confirmed_at: null,
    client_rejection_note: null,
    client_confirmed_fingerprint: null,
    ...overrides,
  }
}

function fingerprintOfRow(row: Row): string {
  return computeContentFingerprint({
    statement: row.statement as string,
    structuredValue: row.structured_value,
    scope: (row.scope ?? {}) as Record<string, unknown>,
    validFrom: row.valid_from as string,
    validUntil: (row.valid_until ?? null) as string | null,
    visibility: row.visibility as 'customer_ok',
    sensitivity: row.sensitivity as 'price',
  })
}

function baseTables(facts: Row[], confirmers: Row[] = [{ id: 'reg-1', client_id: CLIENT_A, confirmer_email: CONFIRMER, registered_by_email: ADMIN, revoked_at: null }]) {
  return {
    client_knowledge_facts: facts,
    client_knowledge_confirmers: confirmers,
    client_knowledge_confirmation_requests: [] as Row[],
    clients: [{ id: CLIENT_A, name: 'CTS Tours NZ' }] as Row[],
    client_knowledge_events: [] as Row[],
  }
}

const NOW = () => new Date('2026-09-14T00:00:00.000Z')

describe('createConfirmationRequest', () => {
  it('🔴 库里只存 sha256 哈希，绝不存原始令牌', async () => {
    const tables = baseTables([approvedFact({ id: 'f1' })])
    const sb = createFakeWriteSupabase(tables)
    const result = await createConfirmationRequest(sb, {
      clientId: CLIENT_A,
      factIds: ['f1'],
      confirmerEmail: CONFIRMER,
      actorEmail: FDE,
      now: NOW,
    })

    const stored = tables.client_knowledge_confirmation_requests[0]
    expect(stored.token_hash).toBe(hashConfirmationToken(result.rawToken))
    expect(stored.token_hash).not.toBe(result.rawToken)
    // 整行里任何一个字段都不许出现原始令牌
    expect(JSON.stringify(stored)).not.toContain(result.rawToken)
    // 建表 CHECK 只接受 64 位十六进制；假件也按这个判，写错了会当场挂
    expect(String(stored.token_hash)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('把发链接那一刻每条事实的指纹钉进请求里', async () => {
    const fact = approvedFact({ id: 'f1' })
    const tables = baseTables([fact])
    const sb = createFakeWriteSupabase(tables)
    await createConfirmationRequest(sb, {
      clientId: CLIENT_A,
      factIds: ['f1'],
      confirmerEmail: CONFIRMER,
      actorEmail: FDE,
      now: NOW,
    })
    expect(tables.client_knowledge_confirmation_requests[0].fact_fingerprints).toEqual([
      { fact_id: 'f1', fingerprint: fingerprintOfRow(fact) },
    ])
  })

  it('未登记的邮箱发不出去', async () => {
    const sb = createFakeWriteSupabase(baseTables([approvedFact({ id: 'f1' })]))
    await expect(
      createConfirmationRequest(sb, {
        clientId: CLIENT_A,
        factIds: ['f1'],
        confirmerEmail: 'stranger@example.com',
        actorEmail: FDE,
        now: NOW,
      }),
    ).rejects.toThrow('还不是这个客户登记过的确认人')
  })

  it('🔴 全局管理员账号发不出去（不能代客户确认）', async () => {
    const sb = createFakeWriteSupabase(
      baseTables([approvedFact({ id: 'f1' })], [
        { id: 'reg-1', client_id: CLIENT_A, confirmer_email: ADMIN, registered_by_email: ADMIN, revoked_at: null },
      ]),
    )
    await expect(
      createConfirmationRequest(sb, {
        clientId: CLIENT_A,
        factIds: ['f1'],
        confirmerEmail: ADMIN,
        actorEmail: FDE,
        now: NOW,
      }),
    ).rejects.toThrow('管理员账号，不能代客户确认')
  })

  it('🔴 批准人 = 确认人时拒绝', async () => {
    const sb = createFakeWriteSupabase(
      baseTables([approvedFact({ id: 'f1', approved_by_email: CONFIRMER })]),
    )
    await expect(
      createConfirmationRequest(sb, {
        clientId: CLIENT_A,
        factIds: ['f1'],
        confirmerEmail: CONFIRMER,
        actorEmail: FDE,
        now: NOW,
      }),
    ).rejects.toThrow('批的人和确认的人必须是两个人')
  })

  it('还没批准的条目不能发给客户确认', async () => {
    const sb = createFakeWriteSupabase(
      baseTables([approvedFact({ id: 'f1', status: 'candidate', approved_by_email: null, approved_at: null })]),
    )
    await expect(
      createConfirmationRequest(sb, {
        clientId: CLIENT_A,
        factIds: ['f1'],
        confirmerEmail: CONFIRMER,
        actorEmail: FDE,
        now: NOW,
      }),
    ).rejects.toThrow('还没被 ME 批准')
  })

  it('别的客户的条目编号混进来时整批拒绝', async () => {
    const sb = createFakeWriteSupabase(
      baseTables([approvedFact({ id: 'f1' }), approvedFact({ id: 'f2', client_id: CLIENT_B })]),
    )
    await expect(
      createConfirmationRequest(sb, {
        clientId: CLIENT_A,
        factIds: ['f1', 'f2'],
        confirmerEmail: CONFIRMER,
        actorEmail: FDE,
        now: NOW,
      }),
    ).rejects.toThrow('不属于这个客户')
  })

  it('空批次不发', async () => {
    const sb = createFakeWriteSupabase(baseTables([approvedFact({ id: 'f1' })]))
    await expect(
      createConfirmationRequest(sb, { clientId: CLIENT_A, factIds: [], confirmerEmail: CONFIRMER, actorEmail: FDE, now: NOW }),
    ).rejects.toBeInstanceOf(KnowledgeConfirmationError)
  })

  it('发起人和收件人是同一个人时，数据库那条 CHECK 也会挡住', async () => {
    const sb = createFakeWriteSupabase(
      baseTables([approvedFact({ id: 'f1', approved_by_email: 'someone-else@magicengine.cloud' })]),
    )
    await expect(
      createConfirmationRequest(sb, {
        clientId: CLIENT_A,
        factIds: ['f1'],
        confirmerEmail: CONFIRMER,
        actorEmail: CONFIRMER,
        now: NOW,
      }),
    ).rejects.toThrow(/sender_is_not_confirmer/)
  })
})

describe('loadConfirmationRequest —— 打开链接不许改任何东西', () => {
  async function seed() {
    const fact = approvedFact({ id: 'f1' })
    const tables = baseTables([fact])
    const sb = createFakeWriteSupabase(tables)
    const created = await createConfirmationRequest(sb, {
      clientId: CLIENT_A,
      factIds: ['f1'],
      confirmerEmail: CONFIRMER,
      actorEmail: FDE,
      now: NOW,
    })
    return { tables, sb, created, fact }
  }

  it('🔴 GET 之后请求还是 pending、事实还是未确认（把确认挪到打开时，这条必红）', async () => {
    const { tables, sb, created } = await seed()
    const view = await loadConfirmationRequest(sb, {
      requestId: created.requestId,
      rawToken: created.rawToken,
      now: NOW,
    })
    expect(view.ok).toBe(true)
    expect(tables.client_knowledge_confirmation_requests[0].status).toBe('pending')
    expect(tables.client_knowledge_confirmation_requests[0].confirmed_at ?? null).toBeNull()
    expect(tables.client_knowledge_facts[0].client_confirmed_at).toBeNull()
  })

  it('渲染给客户的内容里不带任何代码词（只有正文、敏感度、有效期）', async () => {
    const { sb, created } = await seed()
    const view = await loadConfirmationRequest(sb, { requestId: created.requestId, rawToken: created.rawToken, now: NOW })
    if (!view.ok) throw new Error('expected ok')
    expect(Object.keys(view.facts[0]).sort()).toEqual(
      ['changedSinceSent', 'conflictGroupId', 'factId', 'sensitivity', 'statement', 'validUntil'].sort(),
    )
    expect(view.facts[0].statement).toBe('20 公斤以下每公斤 NZD 4')
  })

  it('令牌不对 → bad_token', async () => {
    const { sb, created } = await seed()
    const view = await loadConfirmationRequest(sb, { requestId: created.requestId, rawToken: 'nope', now: NOW })
    expect(view).toEqual({ ok: false, problem: 'bad_token' })
  })

  it('过期 → expired', async () => {
    const { sb, created } = await seed()
    const view = await loadConfirmationRequest(sb, {
      requestId: created.requestId,
      rawToken: created.rawToken,
      now: () => new Date('2027-01-01T00:00:00.000Z'),
    })
    expect(view).toEqual({ ok: false, problem: 'expired' })
  })

  it('请求不存在 → not_found', async () => {
    const { sb, created } = await seed()
    const view = await loadConfirmationRequest(sb, { requestId: 'nope', rawToken: created.rawToken, now: NOW })
    expect(view).toEqual({ ok: false, problem: 'not_found' })
  })

  it('发链接之后被改过的条目，页面上就标成"变过了"', async () => {
    const { tables, sb, created } = await seed()
    tables.client_knowledge_facts[0].statement = '20 公斤以下每公斤 NZD 5'
    const view = await loadConfirmationRequest(sb, { requestId: created.requestId, rawToken: created.rawToken, now: NOW })
    if (!view.ok) throw new Error('expected ok')
    expect(view.facts[0].changedSinceSent).toBe(true)
  })
})

describe('consumeConfirmationRequest —— 唯一会写东西的路径', () => {
  async function seed(facts: Row[] = [approvedFact({ id: 'f1' })], confirmers?: Row[]) {
    const tables = baseTables(facts, confirmers)
    const sb = createFakeWriteSupabase(tables)
    const created = await createConfirmationRequest(sb, {
      clientId: CLIENT_A,
      factIds: facts.filter((f) => f.client_id === CLIENT_A).map((f) => f.id as string),
      confirmerEmail: CONFIRMER,
      actorEmail: FDE,
      now: NOW,
    })
    return { tables, sb, created }
  }

  it('客户点"对" → 写确认人、确认时间、当前指纹', async () => {
    const { tables, sb, created } = await seed()
    const result = await consumeConfirmationRequest(sb, {
      requestId: created.requestId,
      rawToken: created.rawToken,
      choices: { f1: 'confirm' },
      now: NOW,
    })
    expect(result.ok).toBe(true)
    const fact = tables.client_knowledge_facts[0]
    expect(fact.client_confirmed_by_email).toBe(CONFIRMER)
    expect(fact.client_confirmed_at).toBe('2026-09-14T00:00:00.000Z')
    expect(fact.client_confirmed_fingerprint).toBe(fingerprintOfRow(approvedFact({ id: 'f1' })))
    expect(tables.client_knowledge_confirmation_requests[0].status).toBe('confirmed')
  })

  it('客户点"需要修改" → 写意见，条目仍然是未确认', async () => {
    const { tables, sb, created } = await seed()
    const result = await consumeConfirmationRequest(sb, {
      requestId: created.requestId,
      rawToken: created.rawToken,
      choices: { f1: 'reject' },
      notes: { f1: '这是旧价，现在是 5 块' },
      now: NOW,
    })
    if (!result.ok) throw new Error('expected ok')
    expect(result.rejectedFactIds).toEqual(['f1'])
    expect(tables.client_knowledge_facts[0].client_rejection_note).toBe('这是旧价，现在是 5 块')
    expect(tables.client_knowledge_facts[0].client_confirmed_at).toBeNull()
    expect(tables.client_knowledge_confirmation_requests[0].status).toBe('rejected')
  })

  it('没表态的条目既不确认也不驳回', async () => {
    const { tables, sb, created } = await seed()
    await consumeConfirmationRequest(sb, {
      requestId: created.requestId,
      rawToken: created.rawToken,
      choices: {},
      now: NOW,
    })
    expect(tables.client_knowledge_facts[0].client_confirmed_at).toBeNull()
    expect(tables.client_knowledge_facts[0].client_rejection_note).toBeNull()
  })

  it('🔴 §9.5 发链接后被改过的条目，本次不确认，报成"要重发一条新链接"', async () => {
    const { tables, sb, created } = await seed()
    tables.client_knowledge_facts[0].statement = '20 公斤以下每公斤 NZD 5'
    const result = await consumeConfirmationRequest(sb, {
      requestId: created.requestId,
      rawToken: created.rawToken,
      choices: { f1: 'confirm' },
      now: NOW,
    })
    if (!result.ok) throw new Error('expected ok')
    expect(result.staleFactIds).toEqual(['f1'])
    expect(result.confirmedFactIds).toEqual([])
    expect(tables.client_knowledge_facts[0].client_confirmed_at).toBeNull()
  })

  it('🔴 只改有效期也算内容变了（指纹包含有效期）', async () => {
    const { tables, sb, created } = await seed()
    tables.client_knowledge_facts[0].valid_until = '2027-01-01T00:00:00.000Z'
    const result = await consumeConfirmationRequest(sb, {
      requestId: created.requestId,
      rawToken: created.rawToken,
      choices: { f1: 'confirm' },
      now: NOW,
    })
    if (!result.ok) throw new Error('expected ok')
    expect(result.staleFactIds).toEqual(['f1'])
  })

  it('🔴 单次使用：同一条链接提交第二次直接拒绝，什么都不写', async () => {
    const { tables, sb, created } = await seed()
    await consumeConfirmationRequest(sb, {
      requestId: created.requestId,
      rawToken: created.rawToken,
      choices: { f1: 'reject' },
      notes: { f1: '第一次' },
      now: NOW,
    })
    const second = await consumeConfirmationRequest(sb, {
      requestId: created.requestId,
      rawToken: created.rawToken,
      choices: { f1: 'confirm' },
      now: NOW,
    })
    expect(second).toEqual({ ok: false, problem: 'already_used' })
    expect(tables.client_knowledge_facts[0].client_confirmed_at).toBeNull()
    expect(tables.client_knowledge_facts[0].client_rejection_note).toBe('第一次')
  })

  it('🔴 确认人在发链接之后被撤销登记 → 整条链接作废，一个字都不写', async () => {
    const { tables, sb, created } = await seed()
    tables.client_knowledge_confirmers[0].revoked_at = '2026-09-13T00:00:00.000Z'
    tables.client_knowledge_confirmers[0].revoked_by_email = ADMIN
    const result = await consumeConfirmationRequest(sb, {
      requestId: created.requestId,
      rawToken: created.rawToken,
      choices: { f1: 'confirm' },
      now: NOW,
    })
    expect(result).toEqual({ ok: false, problem: 'not_registered' })
    expect(tables.client_knowledge_facts[0].client_confirmed_at).toBeNull()
    expect(tables.client_knowledge_confirmation_requests[0].status).toBe('pending')
  })

  it('🔴 发链接之后有人把批准人改成了确认人本人 → 整条链接作废', async () => {
    const { tables, sb, created } = await seed()
    tables.client_knowledge_facts[0].approved_by_email = CONFIRMER
    const result = await consumeConfirmationRequest(sb, {
      requestId: created.requestId,
      rawToken: created.rawToken,
      choices: { f1: 'confirm' },
      now: NOW,
    })
    expect(result).toEqual({ ok: false, problem: 'same_as_approver' })
    expect(tables.client_knowledge_facts[0].client_confirmed_at).toBeNull()
  })

  it('过期的链接提交不进来', async () => {
    const { tables, sb, created } = await seed()
    const result = await consumeConfirmationRequest(sb, {
      requestId: created.requestId,
      rawToken: created.rawToken,
      choices: { f1: 'confirm' },
      now: () => new Date('2027-01-01T00:00:00.000Z'),
    })
    expect(result).toEqual({ ok: false, problem: 'expired' })
    expect(tables.client_knowledge_facts[0].client_confirmed_at).toBeNull()
  })

  it('令牌不对提交不进来', async () => {
    const { tables, sb, created } = await seed()
    const result = await consumeConfirmationRequest(sb, {
      requestId: created.requestId,
      rawToken: `${created.rawToken}x`,
      choices: { f1: 'confirm' },
      now: NOW,
    })
    expect(result).toEqual({ ok: false, problem: 'bad_token' })
    expect(tables.client_knowledge_facts[0].client_confirmed_at).toBeNull()
  })

  it('🔴 claim 和写事实是一个事务：中途失败一个字都不会落库（子牙+魏征 复审发现）', async () => {
    // 复现两份独立复审都抓到的同一个问题：旧代码先 UPDATE 确认请求表把
    // 状态改成 confirmed，再逐条 UPDATE client_knowledge_facts —— 中间任何
    // 一次失败都会留下"请求已终态但事实没写全"的中间态，而且没人会去查。
    // 现在两步收进同一个 Postgres 函数（一次 rpc 调用 = 一个事务），这里
    // 用 rpcErrors 模拟函数内部失败，断言请求表和事实表都完全没变——
    // 不是"部分写了"，是"什么都没写"，客户重新点链接才能真的重试。
    const fact = approvedFact({ id: 'f1' })
    const tables = baseTables([fact])
    const sb = createFakeWriteSupabase(tables, { rpcErrors: new Set(['consume_knowledge_confirmation_request']) })
    const created = await createConfirmationRequest(sb, {
      clientId: CLIENT_A,
      factIds: ['f1'],
      confirmerEmail: CONFIRMER,
      actorEmail: FDE,
      now: NOW,
    })

    await expect(
      consumeConfirmationRequest(sb, {
        requestId: created.requestId,
        rawToken: created.rawToken,
        choices: { f1: 'confirm' },
        now: NOW,
      }),
    ).rejects.toThrow(KnowledgeConfirmationError)

    // 请求本身仍是 pending —— 没有变成"已确认但没写全"的假终态。
    expect(tables.client_knowledge_confirmation_requests[0].status).toBe('pending')
    expect(tables.client_knowledge_confirmation_requests[0].confirmed_at ?? null).toBeNull()
    // 事实一个字都没被写上。
    expect(tables.client_knowledge_facts[0].client_confirmed_at).toBeNull()
    expect(tables.client_knowledge_facts[0].client_confirmed_by_email).toBeNull()

    // 链接因此真的可以重试（不是撞上"已经确认过了"的假墙）。
    const retry = await consumeConfirmationRequest(
      createFakeWriteSupabase(tables),
      { requestId: created.requestId, rawToken: created.rawToken, choices: { f1: 'confirm' }, now: NOW },
    )
    expect(retry.ok).toBe(true)
    expect(tables.client_knowledge_facts[0].client_confirmed_at).toBe('2026-09-14T00:00:00.000Z')
  })

  it('一批多条：确认一条、驳回一条、第三条被改过 —— 三种结果各归各的', async () => {
    const f1 = approvedFact({ id: 'f1' })
    const f2 = approvedFact({ id: 'f2', fact_key: 'cutoff', statement: '空运周五 18:00 截单', sensitivity: 'timeline' })
    const f3 = approvedFact({ id: 'f3', fact_key: 'gst', statement: 'GST 15%', sensitivity: 'policy' })
    const { tables, sb, created } = await seed([f1, f2, f3])
    tables.client_knowledge_facts[2].statement = 'GST 15%（含运费）'

    const result = await consumeConfirmationRequest(sb, {
      requestId: created.requestId,
      rawToken: created.rawToken,
      choices: { f1: 'confirm', f2: 'reject', f3: 'confirm' },
      notes: { f2: '改成周四了' },
      now: NOW,
    })
    if (!result.ok) throw new Error('expected ok')
    expect(result.confirmedFactIds).toEqual(['f1'])
    expect(result.rejectedFactIds).toEqual(['f2'])
    expect(result.staleFactIds).toEqual(['f3'])
    expect(tables.client_knowledge_confirmation_requests[0].status).toBe('confirmed')
  })
})
