/**
 * 真 PostgreSQL 集成测试 —— issue #1575 验证要求第 3 条：
 *
 *   「真实往 contact_touchpoints 插入一条，用 dnc.ts 的函数读回，断言
 *   isDoNotContact 返回 true；再走 /dnc 纠正路由清除，断言返回 false」
 *
 * 跟 `src/lib/social/__tests__/post-measurement-store.concurrent.test.ts`
 * 同一个写法：默认不跑（`describe.skip`），设 `MESSENGER_AGENT_OPTOUT_PG_DSN`
 * 指向一个专用测试库后才跑真实 SQL。**这条测试只覆盖不依赖 issue #1574
 * 的部分**——全程不碰 `conversations.optout_unlinked`，那一列本 PR 提交时
 * 还没合并主分支，见 PR 描述。
 *
 * ## 这里「真」在哪，「假」在哪
 *
 * - 真：一个真正跑起来的本机 PostgreSQL；`contact_touchpoints` 表用仓库里
 *   实际的 migration 文件建（`20260726000005_contact_touchpoints.sql`），
 *   不是手抄的近似 schema；写入用的是生产代码本身
 *   （`recordOptOutKeywordTouch()` / `/dnc` 路由的 `POST()`），不是重新拼一遍
 *   等价 SQL；最终判定用的是 `lib/crm/dnc.ts` 真实、未 mock 的
 *   `isDoNotContact()`。
 * - 假：本机没有装 Supabase 的本地栈（团队拍板不装 Docker，见
 *   `reference-local-postgres-replay-sandbox.md`），也就没有 PostgREST。
 *   `supabaseAdmin` 平时是走 HTTP 打 PostgREST，这里换成一个只认
 *   `select/eq/maybeSingle/upsert/update` 这几个调用形状的薄适配器
 *   （下面 `pgBackedSupabase()`），把它们原样翻译成参数化 SQL 打给同一个
 *   真数据库——网络/PostgREST 这一层没有被真实跑到，但两侧真正读写的数据、
 *   真正执行的判定逻辑都是真的。这个适配器只实现了 `optout.ts` 和 `/dnc`
 *   路由真正调用到的这几个方法，是 `SupabaseClient` 的一个结构子集，不是
 *   全量实现——本文件下面两个 it() 已经把它跑通：如果生产代码调用了这里没
 *   实现的方法，测试会直接抛 `TypeError` 失败（证伪路径），不会静默通过。
 *
 * ## 跑法
 *
 *   export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
 *   export LC_ALL="en_US.UTF-8" LANG="en_US.UTF-8"
 *   pg_ctl -D /opt/homebrew/var/postgresql@17 -l /tmp/pg17.log start
 *   createdb messenger_agent_optout_test   # 专用测试库，第一次跑之前建一次
 *   MESSENGER_AGENT_OPTOUT_PG_DSN=postgres:///messenger_agent_optout_test \
 *     npx vitest run src/lib/messenger-agent/__tests__/optout.integration.pg.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

const DSN = process.env.MESSENGER_AGENT_OPTOUT_PG_DSN
const RUN = DSN ? describe : describe.skip

const TOUCHPOINTS_MIGRATION_SQL = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260726000005_contact_touchpoints.sql'),
  'utf-8',
)

/**
 * 最小 fixture：`contact_touchpoints` 的真实 migration 引用了 `clients(id)`
 * 和 `contacts(id)`，这两张表在这里只建它被用到的那部分列——`isDoNotContact`
 * 和 `/dnc` 路由都只碰得到这几列。
 */
const SETUP_SQL = `
DROP TABLE IF EXISTS contact_touchpoints CASCADE;
DROP TABLE IF EXISTS contacts CASCADE;
DROP TABLE IF EXISTS clients CASCADE;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE clients (id UUID PRIMARY KEY);

CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  do_not_contact BOOLEAN NOT NULL DEFAULT FALSE,
  do_not_contact_reason TEXT,
  stage TEXT
);
`

// ---------------------------------------------------------------------------
// 薄适配器：把 dnc 路由 / optout.ts 实际发出的那几种 supabase-js 调用形状
// 翻成参数化 SQL，打给上面这个真数据库。只支持这两个生产文件真正用到的
// 那几种调用——不是通用 supabase-js 模拟器，是 `SupabaseClient` 的一个结构
// 子集。下面两个 it() 已经把它跑通（证伪路径：调用到没实现的方法会直接
// TypeError 失败，不会静默通过）。
// ---------------------------------------------------------------------------

function pgBackedSupabase(pg: Client): SupabaseClient {
  function from(table: string) {
    const filters: Array<[string, unknown]> = []
    const whereOf = (offset: number) => ({
      clause: filters.length
        ? `WHERE ${filters.map(([c], i) => `${c} = $${offset + i}`).join(' AND ')}`
        : '',
      values: filters.map(([, v]) => v),
    })

    const api: Record<string, unknown> = {}
    api.select = () => api
    api.eq = (col: string, val: unknown) => {
      filters.push([col, val])
      return api
    }
    api.maybeSingle = async () => {
      const { clause, values } = whereOf(1)
      const res = await pg.query(`SELECT * FROM ${table} ${clause} LIMIT 1`, values)
      return { data: res.rows[0] ?? null, error: null }
    }
    // `optout.ts` 在重放保护那一步直接 `await` select 的结果（不调
    // `.maybeSingle()`）拿多行 —— 跟真实 supabase-js 的 filter builder 本身
    // 是 thenable 一致，见 `isConversationOptedOut()` 查 `contact_touchpoints`
    // 那一段的同款写法。
    type Settle = (value: unknown) => unknown
    ;(api as { then: (onFulfilled: Settle, onRejected: Settle) => Promise<unknown> }).then = (
      resolve,
      reject,
    ) => {
      const { clause, values } = whereOf(1)
      return pg
        .query(`SELECT * FROM ${table} ${clause}`, values)
        .then(
          (res) => resolve({ data: res.rows, error: null }),
          (err: Error) => resolve({ data: null, error: { message: err.message } }),
        )
        .catch(reject)
    }

    api.update = (patch: Record<string, unknown>) => {
      const cols = Object.keys(patch)
      const setClause = cols.map((c, i) => `${c} = $${i + 1}`).join(', ')
      const setValues = cols.map((c) => patch[c])
      const updFilters: Array<[string, unknown]> = []
      const updApi: Record<string, unknown> = {}
      updApi.eq = (col: string, val: unknown) => {
        updFilters.push([col, val])
        return updApi
      }
      // 真实 supabase-js 的 builder 直接 `await` 就能拿到 `{ error }`——
      // 路由代码正是这么用的（不调用 `.select()`/`.maybeSingle()`）。
      type Settle = (value: unknown) => unknown
      ;(updApi as { then: (onFulfilled: Settle, onRejected: Settle) => Promise<unknown> }).then = (
        resolve,
        reject,
      ) => {
        const whereClauses = updFilters.map(([c], i) => `${c} = $${setValues.length + i + 1}`)
        const values = [...setValues, ...updFilters.map(([, v]) => v)]
        return pg
          .query(`UPDATE ${table} SET ${setClause} WHERE ${whereClauses.join(' AND ')}`, values)
          .then(
            () => resolve({ error: null }),
            (err: Error) => resolve({ error: { message: err.message } }),
          )
          .catch(reject)
      }
      return updApi
    }

    api.upsert = (row: Record<string, unknown>, opts: { onConflict: string }) => {
      const cols = Object.keys(row)
      const values = cols.map((c) => {
        const v = row[c]
        return v !== null && typeof v === 'object' ? JSON.stringify(v) : v
      })
      const placeholders = cols.map((c, i) =>
        typeof row[c] === 'object' && row[c] !== null ? `$${i + 1}::jsonb` : `$${i + 1}`,
      )
      const upsertApi: Record<string, unknown> = {}
      upsertApi.select = () => ({
        maybeSingle: async () => {
          const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders.join(',')})
            ON CONFLICT (${opts.onConflict}) DO NOTHING RETURNING id`
          const res = await pg.query(sql, values)
          return { data: res.rows[0] ?? null, error: null }
        },
      })
      return upsertApi
    }

    return api
  }
  // 结构子集断言：见上方文件头「这里真在哪假在哪」——已用本文件两个集成测试
  // 实测跑通，不是凭空断言形状对得上。
  return { from } as unknown as SupabaseClient
}

// ---------------------------------------------------------------------------
// mock 挂载点：requirePaidClientAccess 是登录鉴权，跟数据库无关，照抄
// dnc 路由自己的单测（route.test.ts）的写法直接放行；supabaseAdmin 换成
// 上面的真数据库适配器。
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  requirePaidClientAccess: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: mocks.requirePaidClientAccess,
}))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mocks.from },
}))

RUN('真 PostgreSQL 集成 —— contact_touchpoints + dnc.ts + /dnc 路由', () => {
  let pg: Client
  let supabaseForPg: SupabaseClient
  const CLIENT_ID = randomUUID()
  const CONTACT_ID = randomUUID()

  beforeAll(async () => {
    pg = new Client({ connectionString: DSN })
    await pg.connect()
    await pg.query(SETUP_SQL)
    await pg.query(TOUCHPOINTS_MIGRATION_SQL)
    await pg.query('INSERT INTO clients (id) VALUES ($1)', [CLIENT_ID])
    supabaseForPg = pgBackedSupabase(pg)
  }, 30_000)

  afterAll(async () => {
    await pg.query('DROP TABLE IF EXISTS contact_touchpoints CASCADE')
    await pg.query('DROP TABLE IF EXISTS contacts CASCADE')
    await pg.query('DROP TABLE IF EXISTS clients CASCADE')
    await pg.end()
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.from.mockImplementation((table: string) => supabaseForPg.from(table))
    mocks.requirePaidClientAccess.mockResolvedValue({
      ok: true,
      user: { email: 'fde@test.com' },
      role: 'admin',
      allowedClientId: null,
    })
    await pg.query('DELETE FROM contact_touchpoints')
    await pg.query('DELETE FROM contacts')
    await pg.query('INSERT INTO contacts (id, client_id, do_not_contact, stage) VALUES ($1, $2, FALSE, NULL)', [
      CONTACT_ID,
      CLIENT_ID,
    ])
  })

  it('真实写入退订触点 → lib/crm/dnc.ts 的 isDoNotContact() 判定为 true', async () => {
    const { recordOptOutKeywordTouch } = await import('../optout')
    const { isDoNotContact } = await import('@/lib/crm/dnc')

    await recordOptOutKeywordTouch(
      {
        clientId: CLIENT_ID,
        contactId: CONTACT_ID,
        channel: 'messenger',
        conversationId: 'convo-1',
        messageId: 'msg-1',
      },
      supabaseForPg,
    )

    // 真实读回 —— 不是内存假数据。
    const touchRows = await pg.query(
      'SELECT occurred_at, metadata FROM contact_touchpoints WHERE contact_id = $1',
      [CONTACT_ID],
    )
    expect(touchRows.rows).toHaveLength(1)

    const contactRow = await pg.query('SELECT do_not_contact FROM contacts WHERE id = $1', [CONTACT_ID])
    expect(contactRow.rows[0].do_not_contact).toBe(true)

    const touches = touchRows.rows.map((r) => ({
      outcome: r.metadata.outcome ?? null,
      flagged: r.metadata.do_not_contact === true,
      occurredAt: r.occurred_at.toISOString(),
    }))
    expect(isDoNotContact(contactRow.rows[0].do_not_contact, touches)).toBe(true)
  })

  it('再走 /dnc 纠正路由清除 → isDoNotContact() 返回 false', async () => {
    const { recordOptOutKeywordTouch } = await import('../optout')
    const { isDoNotContact } = await import('@/lib/crm/dnc')
    const { POST } = await import('@/app/api/clients/[id]/crm/contacts/[cid]/dnc/route')

    // 先造成「已退订」的真实状态。
    await recordOptOutKeywordTouch(
      {
        clientId: CLIENT_ID,
        contactId: CONTACT_ID,
        channel: 'whatsapp',
        conversationId: 'convo-2',
        messageId: 'msg-2',
      },
      supabaseForPg,
    )

    const before = await pg.query('SELECT do_not_contact FROM contacts WHERE id = $1', [CONTACT_ID])
    expect(before.rows[0].do_not_contact).toBe(true)

    // 真的调用生产路由 —— 不是重新拼一遍等价 SQL。
    const req = new NextRequest(
      `http://localhost:3001/api/clients/${CLIENT_ID}/crm/contacts/${CONTACT_ID}/dnc`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientRef: 'clear-1' }),
      },
    )
    const res = await POST(req, { params: { id: CLIENT_ID, cid: CONTACT_ID } })
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)

    const touchRows = await pg.query(
      'SELECT occurred_at, metadata FROM contact_touchpoints WHERE contact_id = $1 ORDER BY occurred_at ASC',
      [CONTACT_ID],
    )
    // 两条都在：那条误判的 do_not_contact 触点，加上这条新的 dnc_cleared 纠正——
    // 真相源不可变，纠正不删旧记录（lib/crm/dnc.ts 文件头）。
    expect(touchRows.rows).toHaveLength(2)

    const contactRow = await pg.query('SELECT do_not_contact FROM contacts WHERE id = $1', [CONTACT_ID])
    expect(contactRow.rows[0].do_not_contact).toBe(false)

    const touches = touchRows.rows.map((r) => ({
      outcome: r.metadata.outcome ?? null,
      flagged: r.metadata.do_not_contact === true,
      occurredAt: r.occurred_at.toISOString(),
    }))
    expect(isDoNotContact(contactRow.rows[0].do_not_contact, touches)).toBe(false)
  })
})
