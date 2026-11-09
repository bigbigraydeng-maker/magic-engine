/**
 * Tests for the confirmer registry's write side (issue #1669):
 * registerConfirmer / revokeConfirmer. The read side
 * (getRegisteredConfirmerEmails) is already covered via read.test.ts's
 * dual-sign gate tests.
 *
 * The fake client here deliberately models REAL Postgres/PostgREST
 * semantics that bit the first version of this file (子牙+魏征联合复审
 * 2026-09-14): `.insert()` without `.select()` returns `data: null`, and a
 * duplicate insert against the active-confirmer partial unique index
 * surfaces as a `{ code: '23505' }` error — not a thrown "already exists"
 * exception. A fake that's more lenient than the real database is exactly
 * how the original ilike-as-exact-match bug slipped through unnoticed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  registerConfirmer,
  revokeConfirmer,
  KnowledgeConfirmerAuthorizationError,
  type KnowledgeConfirmerWriteClient,
} from '../confirmers'

const CLIENT_A = 'aaaaaaaa-0000-0000-0000-000000000001'
const GLOBAL_ADMIN = 'ray@magicengine.cloud'

type Row = Record<string, unknown>

interface Fixture {
  portalUsers: Row[]
  confirmers: Row[]
}
let fixture: Fixture
/** Set by a test to force the NEXT insert to fail with a unique-violation, simulating a concurrent racer that won. */
let forceNextInsertConflict = false

function applyEq(rows: Row[], filters: Record<string, unknown>): Row[] {
  return rows.filter((row) => Object.entries(filters).every(([k, v]) => row[k] === v))
}

function makeFakeClient(): KnowledgeConfirmerWriteClient {
  return {
    from(table: string) {
      const rows = table === 'client_portal_users' ? fixture.portalUsers : fixture.confirmers
      const filters: Record<string, unknown> = {}
      let isNullFilter: string | null = null

      // 用真实 Promise 实例 + Object.assign 挂链式方法——这样 `.then()` 的
      // 泛型签名天然满足 PromiseLike<T>，不用自己手写一份容易跟标准签名
      // 对不上的 then。真实 supabase-js 的查询构建器也是这个套路（thenable
      // 对象，不是手搓一个假 then）。
      function buildFilterBuilder() {
        const promise = Promise.resolve().then(() => {
          const matched = applyEq(rows, filters).filter(
            (row) => !isNullFilter || row[isNullFilter] === null || row[isNullFilter] === undefined,
          )
          return { data: matched.map((r) => ({ ...r })), error: null }
        })
        return Object.assign(promise, {
          eq(column: string, value: unknown) {
            filters[column] = value
            return builder
          },
          is(column: string, _value: null) {
            isNullFilter = column
            return builder
          },
        })
      }
      const builder = buildFilterBuilder()

      return {
        select: (_columns: string) => builder,
        insert: (row: Record<string, unknown>) => ({
          select: (_columns: string) => {
            if (forceNextInsertConflict) {
              forceNextInsertConflict = false
              return Promise.resolve({
                data: null,
                error: { message: 'duplicate key value violates unique constraint "uq_client_knowledge_confirmers_active"', code: '23505' },
              })
            }
            const withId = { id: `confirmer-${fixture.confirmers.length + 1}`, revoked_at: null, revoked_by_email: null, ...row }
            fixture.confirmers.push(withId)
            // 🔴 真实 supabase-js 行为：insert().select('id') 才会带回 data；
            // 这条测试文件里所有断言"拿到真实 id"的用例都靠这一步验证
            // registerConfirmer 真的调用了 .select()，不是像旧实现那样漏调。
            return Promise.resolve({ data: [{ id: withId.id }], error: null })
          },
        }),
        update: (fields: Record<string, unknown>) => ({
          eq: (column: string, value: unknown) => {
            const target = fixture.confirmers.find((r) => r[column] === value)
            if (target) Object.assign(target, fields)
            return Promise.resolve({ data: null, error: null })
          },
        }),
      }
    },
  }
}

const savedAdminEmails = process.env.ADMIN_EMAILS

beforeEach(() => {
  fixture = {
    portalUsers: [{ id: 'user-1', client_id: CLIENT_A, email: 'owner@ctstours.co.nz', access_type: 'client' }],
    confirmers: [],
  }
  forceNextInsertConflict = false
  process.env.ADMIN_EMAILS = GLOBAL_ADMIN
})

afterEach(() => {
  if (savedAdminEmails === undefined) delete process.env.ADMIN_EMAILS
  else process.env.ADMIN_EMAILS = savedAdminEmails
})

describe('registerConfirmer', () => {
  it('registers a confirmer who has a real access_type=client account for this client, and returns a real id', async () => {
    const sb = makeFakeClient()
    const result = await registerConfirmer(sb, {
      clientId: CLIENT_A,
      confirmerEmail: 'owner@ctstours.co.nz',
      actorEmail: GLOBAL_ADMIN,
    })
    expect(result.alreadyActive).toBe(false)
    // 🔴 子牙复审（2026-09-14）实测发现的真 bug 的回归锁：原实现的
    // insert() 没接 .select()，真实 supabase-js 在这种情况下 data 是
    // null，id 永远是空字符串。
    expect(result.id).toBeTruthy()
    expect(result.id).not.toBe('')
    expect(fixture.confirmers).toHaveLength(1)
    expect(fixture.confirmers[0]).toMatchObject({
      client_id: CLIENT_A,
      confirmer_email: 'owner@ctstours.co.nz',
      registered_by_email: GLOBAL_ADMIN,
    })
  })

  it('rejects a non-global-admin actor', async () => {
    const sb = makeFakeClient()
    await expect(
      registerConfirmer(sb, { clientId: CLIENT_A, confirmerEmail: 'owner@ctstours.co.nz', actorEmail: 'fde@magicengine.cloud' }),
    ).rejects.toThrow(KnowledgeConfirmerAuthorizationError)
    expect(fixture.confirmers).toHaveLength(0)
  })

  it('rejects registering an email with no paid-client account for this client (issue #1646 requirement)', async () => {
    const sb = makeFakeClient()
    await expect(
      registerConfirmer(sb, { clientId: CLIENT_A, confirmerEmail: 'stranger@example.com', actorEmail: GLOBAL_ADMIN }),
    ).rejects.toThrow(/付费客户账号/)
    expect(fixture.confirmers).toHaveLength(0)
  })

  // 🔴 2026-09-20 实测回归：CTS 的两个真实联系人账号 access_type 都是
  // 'both'，不是 'client'。access-types.ts 的 migration 注释早就把
  // {dashboard, fde, both, client} 定成同一档付费客户的历史别名——这里必须
  // 认 'both'，不能只认字面值 'client'，否则老客户联系人全部被无差别挡在
  // 知识库确认人门外。
  it('accepts an account whose access_type is a legacy paid-client alias like "both", not just the literal "client"', async () => {
    fixture.portalUsers = [{ id: 'user-cts', client_id: CLIENT_A, email: 'bdm@ctstours.co.nz', access_type: 'both' }]
    const sb = makeFakeClient()
    const result = await registerConfirmer(sb, {
      clientId: CLIENT_A,
      confirmerEmail: 'bdm@ctstours.co.nz',
      actorEmail: GLOBAL_ADMIN,
    })
    expect(result.alreadyActive).toBe(false)
    expect(fixture.confirmers).toHaveLength(1)
  })

  // 🔴 self_serve / portal 不属于付费客户档，不该被接受——确认修复没
  // 把检查放宽到"任何在这张表里的人"，只是补齐了付费客户的历史别名。
  it('still rejects an account whose access_type is self_serve or portal (not a customer-only tier)', async () => {
    fixture.portalUsers = [{ id: 'user-free', client_id: CLIENT_A, email: 'free@example.com', access_type: 'self_serve' }]
    const sb = makeFakeClient()
    await expect(
      registerConfirmer(sb, { clientId: CLIENT_A, confirmerEmail: 'free@example.com', actorEmail: GLOBAL_ADMIN }),
    ).rejects.toThrow(/付费客户账号/)
    expect(fixture.confirmers).toHaveLength(0)
  })

  // 🔴 子牙+魏征联合复审（2026-09-20）实测发现的真漏洞回归锁：'fde' 虽然
  // 跟 'client'/'dashboard'/'both' 同属 paid_client 档（能登录 /dashboard），
  // 但它原本代表"Magic Engine 内部 FDE 代客户操作"，不是客户公司自己的
  // 人。如果这里接受 'fde'，等于让 ME 一方的账号冒充客户签字，双签分离
  // （ME 签字人 ≠ 客户签字人）名存实亡。必须拒绝。
  it('rejects an account whose access_type is "fde" even though it is paid_client tier (ME-side account, not a real customer)', async () => {
    fixture.portalUsers = [{ id: 'user-fde', client_id: CLIENT_A, email: 'fde-assigned@ctstours.co.nz', access_type: 'fde' }]
    const sb = makeFakeClient()
    await expect(
      registerConfirmer(sb, { clientId: CLIENT_A, confirmerEmail: 'fde-assigned@ctstours.co.nz', actorEmail: GLOBAL_ADMIN }),
    ).rejects.toThrow(/付费客户账号/)
    expect(fixture.confirmers).toHaveLength(0)
  })

  // 🔴 魏征复审（2026-09-14）实测跑通的真漏洞的回归锁：ilike 的 `_` 通配
  // 符曾经让"账号根本不存在"的邮箱被误判成"存在"，因为它恰好通配匹配上
  // 了另一个真实账号。现在改成精确比较后，这条必须失败。
  it('does NOT let a wildcard-adjacent email slip past the real-account check (regression: ilike-as-exact-match bug)', async () => {
    // 真实账号是 johnadoe@ctstours.co.nz；尝试登记形似但不同的
    // john_doe@ctstours.co.nz —— 旧版 ilike 会把 `_` 当通配符，误判命中。
    fixture.portalUsers = [{ id: 'user-x', client_id: CLIENT_A, email: 'johnadoe@ctstours.co.nz', access_type: 'client' }]
    const sb = makeFakeClient()
    await expect(
      registerConfirmer(sb, { clientId: CLIENT_A, confirmerEmail: 'john_doe@ctstours.co.nz', actorEmail: GLOBAL_ADMIN }),
    ).rejects.toThrow(/付费客户账号/)
    expect(fixture.confirmers).toHaveLength(0)
  })

  it('rejects an actor registering themselves as the confirmer', async () => {
    fixture.portalUsers.push({ id: 'user-2', client_id: CLIENT_A, email: GLOBAL_ADMIN, access_type: 'client' })
    const sb = makeFakeClient()
    await expect(
      registerConfirmer(sb, { clientId: CLIENT_A, confirmerEmail: GLOBAL_ADMIN, actorEmail: GLOBAL_ADMIN }),
    ).rejects.toThrow(/登记人不能把自己登记成客户确认人/)
  })

  it('rejects registering a global admin email as the confirmer (§9.4: admin cannot stand in for the customer)', async () => {
    process.env.ADMIN_EMAILS = `${GLOBAL_ADMIN},other-admin@magicengine.cloud`
    fixture.portalUsers.push({ id: 'user-3', client_id: CLIENT_A, email: 'other-admin@magicengine.cloud', access_type: 'client' })
    const sb = makeFakeClient()
    await expect(
      registerConfirmer(sb, { clientId: CLIENT_A, confirmerEmail: 'other-admin@magicengine.cloud', actorEmail: GLOBAL_ADMIN }),
    ).rejects.toThrow(/全局管理员账号不能被登记/)
  })

  it('is idempotent — registering an already-active confirmer again returns alreadyActive:true without a duplicate row', async () => {
    const sb = makeFakeClient()
    const first = await registerConfirmer(sb, { clientId: CLIENT_A, confirmerEmail: 'owner@ctstours.co.nz', actorEmail: GLOBAL_ADMIN })
    const second = await registerConfirmer(sb, { clientId: CLIENT_A, confirmerEmail: 'owner@ctstours.co.nz', actorEmail: GLOBAL_ADMIN })
    expect(second.alreadyActive).toBe(true)
    expect(second.id).toBe(first.id)
    expect(fixture.confirmers).toHaveLength(1)
  })

  it('allows re-registering an email whose PRIOR registration was revoked', async () => {
    fixture.confirmers.push({
      id: 'old-1',
      client_id: CLIENT_A,
      confirmer_email: 'owner@ctstours.co.nz',
      registered_by_email: GLOBAL_ADMIN,
      revoked_at: '2026-01-01T00:00:00Z',
      revoked_by_email: GLOBAL_ADMIN,
    })
    const sb = makeFakeClient()
    const result = await registerConfirmer(sb, { clientId: CLIENT_A, confirmerEmail: 'owner@ctstours.co.nz', actorEmail: GLOBAL_ADMIN })
    expect(result.alreadyActive).toBe(false)
    expect(fixture.confirmers).toHaveLength(2)
  })

  // 🔴 子牙+魏征联合复审（2026-09-14）：并发登记撞唯一约束时，必须被当成
  // "对方抢先登记成功了"处理，而不是把 Postgres 报错字符串直接抛给调用方。
  it('treats a concurrent unique-constraint conflict on insert as alreadyActive, not a thrown DB error', async () => {
    const sb = makeFakeClient()
    forceNextInsertConflict = true
    // 模拟"竞态对手已经写进去了"——在强制冲突发生前，先在 fixture 里放一条
    // 已生效的登记，回查时能找到它。
    fixture.confirmers.push({
      id: 'winner-row',
      client_id: CLIENT_A,
      confirmer_email: 'owner@ctstours.co.nz',
      registered_by_email: GLOBAL_ADMIN,
      revoked_at: null,
      revoked_by_email: null,
    })
    const result = await registerConfirmer(sb, { clientId: CLIENT_A, confirmerEmail: 'owner@ctstours.co.nz', actorEmail: GLOBAL_ADMIN })
    expect(result.alreadyActive).toBe(true)
    expect(result.id).toBe('winner-row')
  })
})

describe('revokeConfirmer', () => {
  it('revokes an active confirmer, recording revoked_at and revoked_by_email', async () => {
    fixture.confirmers.push({
      id: 'c-1',
      client_id: CLIENT_A,
      confirmer_email: 'owner@ctstours.co.nz',
      registered_by_email: GLOBAL_ADMIN,
      revoked_at: null,
      revoked_by_email: null,
    })
    const sb = makeFakeClient()
    await revokeConfirmer(sb, { clientId: CLIENT_A, confirmerEmail: 'owner@ctstours.co.nz', actorEmail: GLOBAL_ADMIN })
    expect(fixture.confirmers[0].revoked_at).toBeTruthy()
    expect(fixture.confirmers[0].revoked_by_email).toBe(GLOBAL_ADMIN)
  })

  it('rejects a non-global-admin actor', async () => {
    fixture.confirmers.push({
      id: 'c-1',
      client_id: CLIENT_A,
      confirmer_email: 'owner@ctstours.co.nz',
      revoked_at: null,
      revoked_by_email: null,
    })
    const sb = makeFakeClient()
    await expect(
      revokeConfirmer(sb, { clientId: CLIENT_A, confirmerEmail: 'owner@ctstours.co.nz', actorEmail: 'fde@magicengine.cloud' }),
    ).rejects.toThrow(KnowledgeConfirmerAuthorizationError)
    expect(fixture.confirmers[0].revoked_at).toBeNull()
  })

  it('throws when trying to revoke an email that is not currently an active confirmer', async () => {
    const sb = makeFakeClient()
    await expect(
      revokeConfirmer(sb, { clientId: CLIENT_A, confirmerEmail: 'never-registered@example.com', actorEmail: GLOBAL_ADMIN }),
    ).rejects.toThrow(/无需撤销/)
  })

  // 🔴 魏征复审（2026-09-14）：撤销同样必须精确匹配，不能被通配符误伤到
  // 一个形似但不同的邮箱（"撤销了不确定是谁的确认人"）。
  it('does NOT revoke a wildcard-adjacent email it was not asked to revoke', async () => {
    fixture.confirmers.push({
      id: 'c-real',
      client_id: CLIENT_A,
      confirmer_email: 'johnadoe@ctstours.co.nz',
      revoked_at: null,
      revoked_by_email: null,
    })
    const sb = makeFakeClient()
    await expect(
      revokeConfirmer(sb, { clientId: CLIENT_A, confirmerEmail: 'john_doe@ctstours.co.nz', actorEmail: GLOBAL_ADMIN }),
    ).rejects.toThrow(/无需撤销/)
    expect(fixture.confirmers[0].revoked_at).toBeNull() // untouched
  })
})
