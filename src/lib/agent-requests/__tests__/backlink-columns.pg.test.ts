/**
 * 真 PostgreSQL 集成测试 —— 验证迁移
 * `supabase/migrations/20261021100000_agent_request_backlink_columns.sql`
 * 的 write-once 语义：`execution_items.agent_request_id` 只写一次；
 * `content_work_orders.agent_request_id` 只写一次，但允许一次「后继请求接管」
 * （会话标记 `ad_agent.ledger_writer = 'apply_receipt_v1'` + 表属主角色 + 仅一次）。
 *
 * 默认不跑（`describe.skip`），设 `AGENT_REQUEST_BACKLINK_PG_DSN` 指向一个
 * 专用测试库后才跑真实 SQL。表结构用仓库里实际的 migration 文件建，不是手抄
 * 的近似 schema。
 *
 * ## 跑法
 *
 *   export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
 *   export LC_ALL="en_US.UTF-8" LANG="en_US.UTF-8"
 *   pg_ctl -D /opt/homebrew/var/postgresql@17 -l /tmp/pg17.log start
 *   createdb agent_request_backlink_test   # 专用测试库，第一次跑之前建一次
 *   AGENT_REQUEST_BACKLINK_PG_DSN=postgres:///agent_request_backlink_test \
 *     npx vitest run src/lib/agent-requests/__tests__/backlink-columns.pg.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'

const DSN = process.env.AGENT_REQUEST_BACKLINK_PG_DSN
const RUN = DSN ? describe : describe.skip

const MIGRATION_SQL = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20261021100000_agent_request_backlink_columns.sql'),
  'utf-8',
)

/**
 * 最小 fixture：迁移只引用这两张表本身（加列、索引、触发器），不引用别的表，
 * 所以这里只建它被用到的那部分列。
 */
const SETUP_SQL = `
DROP TABLE IF EXISTS public.execution_items CASCADE;
DROP TABLE IF EXISTS public.content_work_orders CASCADE;

CREATE TABLE public.execution_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'pending',
  title text
);

CREATE TABLE public.content_work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'queued',
  title text
);

DO $$ BEGIN CREATE ROLE agent_req_test_service NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
`

const GRANT_SQL = `
GRANT SELECT, UPDATE ON public.execution_items, public.content_work_orders TO agent_req_test_service;
`

// SQLSTATE of integrity_constraint_violation —— 迁移里所有 RAISE EXCEPTION 都用它。
const INTEGRITY_VIOLATION = '23000'

type Table = 'execution_items' | 'content_work_orders'

RUN('真 PostgreSQL 集成 —— agent_request 回链列 write-once 语义', () => {
  let pg: Client

  beforeAll(async () => {
    pg = new Client({ connectionString: DSN })
    await pg.connect()
    await pg.query(SETUP_SQL)
    await pg.query(MIGRATION_SQL)
    await pg.query(GRANT_SQL)
  }, 30_000)

  afterAll(async () => {
    if (pg) await pg.end()
  })

  async function newRow(table: Table): Promise<string> {
    const res = await pg.query(`INSERT INTO public.${table} DEFAULT VALUES RETURNING id`)
    return res.rows[0].id as string
  }

  async function getRow(
    table: Table,
    id: string,
  ): Promise<{ agent_request_id: string | null; agent_request_prev_id: string | null }> {
    const cols =
      table === 'content_work_orders'
        ? 'agent_request_id, agent_request_prev_id'
        : 'agent_request_id, NULL::uuid AS agent_request_prev_id'
    const res = await pg.query(`SELECT ${cols} FROM public.${table} WHERE id = $1`, [id])
    return res.rows[0]
  }

  describe('execution_items', () => {
    it('NULL -> A 成功', async () => {
      const id = await newRow('execution_items')
      const a = randomUUID()
      await pg.query('UPDATE public.execution_items SET agent_request_id = $1 WHERE id = $2', [a, id])
      const row = await getRow('execution_items', id)
      expect(row.agent_request_id).toBe(a)
    })

    it('A -> B 被拒（23000），行仍持有 A', async () => {
      const id = await newRow('execution_items')
      const a = randomUUID()
      const b = randomUUID()
      await pg.query('UPDATE public.execution_items SET agent_request_id = $1 WHERE id = $2', [a, id])

      await expect(
        pg.query('UPDATE public.execution_items SET agent_request_id = $1 WHERE id = $2', [b, id]),
      ).rejects.toMatchObject({ code: INTEGRITY_VIOLATION })

      const row = await getRow('execution_items', id)
      expect(row.agent_request_id).toBe(a)
    })

    it('A -> NULL 被拒', async () => {
      const id = await newRow('execution_items')
      const a = randomUUID()
      await pg.query('UPDATE public.execution_items SET agent_request_id = $1 WHERE id = $2', [a, id])

      await expect(
        pg.query('UPDATE public.execution_items SET agent_request_id = NULL WHERE id = $1', [id]),
      ).rejects.toMatchObject({ code: INTEGRITY_VIOLATION })

      const row = await getRow('execution_items', id)
      expect(row.agent_request_id).toBe(a)
    })

    it('A -> A 同时改 title 成功', async () => {
      const id = await newRow('execution_items')
      const a = randomUUID()
      await pg.query('UPDATE public.execution_items SET agent_request_id = $1 WHERE id = $2', [a, id])

      await pg.query(
        'UPDATE public.execution_items SET agent_request_id = $1, title = $2 WHERE id = $3',
        [a, 'renamed', id],
      )

      const row = await getRow('execution_items', id)
      expect(row.agent_request_id).toBe(a)
      const titleRes = await pg.query('SELECT title FROM public.execution_items WHERE id = $1', [id])
      expect(titleRes.rows[0].title).toBe('renamed')
    })

    it('agent_request_id 为 NULL 时只改 status 成功，仍为 NULL', async () => {
      const id = await newRow('execution_items')
      await pg.query('UPDATE public.execution_items SET status = $1 WHERE id = $2', ['done', id])
      const row = await getRow('execution_items', id)
      expect(row.agent_request_id).toBeNull()
    })
  })

  describe('content_work_orders', () => {
    it('NULL -> A 成功；A -> B（无标记）被拒；A -> NULL 被拒', async () => {
      const id = await newRow('content_work_orders')
      const a = randomUUID()
      const b = randomUUID()

      await pg.query('UPDATE public.content_work_orders SET agent_request_id = $1 WHERE id = $2', [
        a,
        id,
      ])
      expect((await getRow('content_work_orders', id)).agent_request_id).toBe(a)

      await expect(
        pg.query('UPDATE public.content_work_orders SET agent_request_id = $1 WHERE id = $2', [
          b,
          id,
        ]),
      ).rejects.toMatchObject({ code: INTEGRITY_VIOLATION })

      await expect(
        pg.query('UPDATE public.content_work_orders SET agent_request_id = NULL WHERE id = $1', [
          id,
        ]),
      ).rejects.toMatchObject({ code: INTEGRITY_VIOLATION })

      const row = await getRow('content_work_orders', id)
      expect(row.agent_request_id).toBe(a)
      expect(row.agent_request_prev_id).toBeNull()
    })

    it('接管成功一次：属主 + 标记，A -> B 且 prev = A', async () => {
      const id = await newRow('content_work_orders')
      const a = randomUUID()
      const b = randomUUID()
      await pg.query('UPDATE public.content_work_orders SET agent_request_id = $1 WHERE id = $2', [
        a,
        id,
      ])

      await pg.query('BEGIN')
      try {
        await pg.query("SELECT set_config('ad_agent.ledger_writer', 'apply_receipt_v1', true)")
        await pg.query(
          'UPDATE public.content_work_orders SET agent_request_id = $1, agent_request_prev_id = $2 WHERE id = $3',
          [b, a, id],
        )
        await pg.query('COMMIT')
      } catch (err) {
        await pg.query('ROLLBACK')
        throw err
      }

      const row = await getRow('content_work_orders', id)
      expect(row.agent_request_id).toBe(b)
      expect(row.agent_request_prev_id).toBe(a)
    })

    it('第二次接管（B -> C，prev = B）即使有标记也被拒（prev 已用掉）', async () => {
      const id = await newRow('content_work_orders')
      const a = randomUUID()
      const b = randomUUID()
      const c = randomUUID()
      await pg.query('UPDATE public.content_work_orders SET agent_request_id = $1 WHERE id = $2', [
        a,
        id,
      ])

      // 第一次接管
      await pg.query('BEGIN')
      try {
        await pg.query("SELECT set_config('ad_agent.ledger_writer', 'apply_receipt_v1', true)")
        await pg.query(
          'UPDATE public.content_work_orders SET agent_request_id = $1, agent_request_prev_id = $2 WHERE id = $3',
          [b, a, id],
        )
        await pg.query('COMMIT')
      } catch (err) {
        await pg.query('ROLLBACK')
        throw err
      }

      // 第二次接管：prev 已非空，触发器 a 分支直接拒
      await pg.query('BEGIN')
      try {
        await pg.query("SELECT set_config('ad_agent.ledger_writer', 'apply_receipt_v1', true)")
        await expect(
          pg.query(
            'UPDATE public.content_work_orders SET agent_request_id = $1, agent_request_prev_id = $2 WHERE id = $3',
            [c, b, id],
          ),
        ).rejects.toMatchObject({ code: INTEGRITY_VIOLATION })
        await pg.query('ROLLBACK')
      } catch (err) {
        await pg.query('ROLLBACK')
        throw err
      }

      const row = await getRow('content_work_orders', id)
      expect(row.agent_request_id).toBe(b)
      expect(row.agent_request_prev_id).toBe(a)
    })

    it('无标记的接管被拒', async () => {
      const id = await newRow('content_work_orders')
      const a = randomUUID()
      const b = randomUUID()
      await pg.query('UPDATE public.content_work_orders SET agent_request_id = $1 WHERE id = $2', [
        a,
        id,
      ])

      await expect(
        pg.query(
          'UPDATE public.content_work_orders SET agent_request_id = $1, agent_request_prev_id = $2 WHERE id = $3',
          [b, a, id],
        ),
      ).rejects.toMatchObject({ code: INTEGRITY_VIOLATION })

      const row = await getRow('content_work_orders', id)
      expect(row.agent_request_id).toBe(a)
      expect(row.agent_request_prev_id).toBeNull()
    })

    it('有标记但 prev 不是旧值（随机 uuid）被拒', async () => {
      const id = await newRow('content_work_orders')
      const a = randomUUID()
      const b = randomUUID()
      const wrongPrev = randomUUID()
      await pg.query('UPDATE public.content_work_orders SET agent_request_id = $1 WHERE id = $2', [
        a,
        id,
      ])

      await pg.query('BEGIN')
      try {
        await pg.query("SELECT set_config('ad_agent.ledger_writer', 'apply_receipt_v1', true)")
        await expect(
          pg.query(
            'UPDATE public.content_work_orders SET agent_request_id = $1, agent_request_prev_id = $2 WHERE id = $3',
            [b, wrongPrev, id],
          ),
        ).rejects.toMatchObject({ code: INTEGRITY_VIOLATION })
        await pg.query('ROLLBACK')
      } catch (err) {
        await pg.query('ROLLBACK')
        throw err
      }

      const row = await getRow('content_work_orders', id)
      expect(row.agent_request_id).toBe(a)
      expect(row.agent_request_prev_id).toBeNull()
    })

    it('有标记但以非属主角色执行被拒', async () => {
      const id = await newRow('content_work_orders')
      const a = randomUUID()
      const b = randomUUID()
      await pg.query('UPDATE public.content_work_orders SET agent_request_id = $1 WHERE id = $2', [
        a,
        id,
      ])

      await pg.query('BEGIN')
      try {
        await pg.query("SELECT set_config('ad_agent.ledger_writer', 'apply_receipt_v1', true)")
        await pg.query('SET LOCAL ROLE agent_req_test_service')
        await expect(
          pg.query(
            'UPDATE public.content_work_orders SET agent_request_id = $1, agent_request_prev_id = $2 WHERE id = $3',
            [b, a, id],
          ),
        ).rejects.toMatchObject({ code: INTEGRITY_VIOLATION })
        await pg.query('ROLLBACK')
      } catch (err) {
        await pg.query('ROLLBACK')
        throw err
      }

      const row = await getRow('content_work_orders', id)
      expect(row.agent_request_id).toBe(a)
      expect(row.agent_request_prev_id).toBeNull()
    })

    it('NULL -> A 同时写 prev 被拒', async () => {
      const id = await newRow('content_work_orders')
      const a = randomUUID()
      const prev = randomUUID()

      await expect(
        pg.query(
          'UPDATE public.content_work_orders SET agent_request_id = $1, agent_request_prev_id = $2 WHERE id = $3',
          [a, prev, id],
        ),
      ).rejects.toMatchObject({ code: INTEGRITY_VIOLATION })

      const row = await getRow('content_work_orders', id)
      expect(row.agent_request_id).toBeNull()
      expect(row.agent_request_prev_id).toBeNull()
    })

    it('单独改 prev 被拒；接管后清空 prev 也被拒', async () => {
      const id = await newRow('content_work_orders')
      const a = randomUUID()
      const b = randomUUID()
      await pg.query('UPDATE public.content_work_orders SET agent_request_id = $1 WHERE id = $2', [
        a,
        id,
      ])

      // 单独改 prev（agent_request_id 未变）
      await expect(
        pg.query('UPDATE public.content_work_orders SET agent_request_prev_id = $1 WHERE id = $2', [
          randomUUID(),
          id,
        ]),
      ).rejects.toMatchObject({ code: INTEGRITY_VIOLATION })

      // 先做一次合法接管
      await pg.query('BEGIN')
      try {
        await pg.query("SELECT set_config('ad_agent.ledger_writer', 'apply_receipt_v1', true)")
        await pg.query(
          'UPDATE public.content_work_orders SET agent_request_id = $1, agent_request_prev_id = $2 WHERE id = $3',
          [b, a, id],
        )
        await pg.query('COMMIT')
      } catch (err) {
        await pg.query('ROLLBACK')
        throw err
      }

      // 接管后清空 prev 被拒
      await expect(
        pg.query('UPDATE public.content_work_orders SET agent_request_prev_id = NULL WHERE id = $1', [
          id,
        ]),
      ).rejects.toMatchObject({ code: INTEGRITY_VIOLATION })

      const row = await getRow('content_work_orders', id)
      expect(row.agent_request_id).toBe(b)
      expect(row.agent_request_prev_id).toBe(a)
    })

    it('有标记时清空 agent_request_id 并同时写 prev（A -> NULL, prev = A）也被拒', async () => {
      const id = await newRow('content_work_orders')
      const a = randomUUID()
      await pg.query('UPDATE public.content_work_orders SET agent_request_id = $1 WHERE id = $2', [
        a,
        id,
      ])

      await pg.query('BEGIN')
      try {
        await pg.query("SELECT set_config('ad_agent.ledger_writer', 'apply_receipt_v1', true)")
        await expect(
          pg.query(
            'UPDATE public.content_work_orders SET agent_request_id = NULL, agent_request_prev_id = $1 WHERE id = $2',
            [a, id],
          ),
        ).rejects.toMatchObject({ code: INTEGRITY_VIOLATION })
        await pg.query('ROLLBACK')
      } catch (err) {
        await pg.query('ROLLBACK')
        throw err
      }

      const row = await getRow('content_work_orders', id)
      expect(row.agent_request_id).toBe(a)
    })

    it('有标记时清空 agent_request_id（A -> NULL）被拒', async () => {
      const id = await newRow('content_work_orders')
      const a = randomUUID()
      await pg.query('UPDATE public.content_work_orders SET agent_request_id = $1 WHERE id = $2', [
        a,
        id,
      ])

      await pg.query('BEGIN')
      try {
        await pg.query("SELECT set_config('ad_agent.ledger_writer', 'apply_receipt_v1', true)")
        await expect(
          pg.query('UPDATE public.content_work_orders SET agent_request_id = NULL WHERE id = $1', [
            id,
          ]),
        ).rejects.toMatchObject({ code: INTEGRITY_VIOLATION })
        await pg.query('ROLLBACK')
      } catch (err) {
        await pg.query('ROLLBACK')
        throw err
      }

      const row = await getRow('content_work_orders', id)
      expect(row.agent_request_id).toBe(a)
    })

    it('迁移 SQL 再跑一次不报错，且保留已有值', async () => {
      const id = await newRow('content_work_orders')
      const a = randomUUID()
      await pg.query('UPDATE public.content_work_orders SET agent_request_id = $1 WHERE id = $2', [
        a,
        id,
      ])

      await pg.query(MIGRATION_SQL)

      const row = await getRow('content_work_orders', id)
      expect(row.agent_request_id).toBe(a)
      expect(row.agent_request_prev_id).toBeNull()
    })
  })
})
