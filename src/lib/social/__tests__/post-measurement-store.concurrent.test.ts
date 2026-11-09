/**
 * 真 PostgreSQL 双连接并发事故测试（Codex 二审 P1b）。
 *
 * 复现事故：两个不同 hash 同时首次写入。事故形态：A 写入 hash_A，B 撞
 * `ON CONFLICT DO UPDATE` 把 receipt 覆盖成 hash_B，B 的指标撞唯一索引被跳过，
 * 最终 receipt 与 metrics 属于不同快照。
 *
 * 预期修复后：A 成功，B 抛 `snapshot_hash_mismatch`，receipt 与 metrics 完全一致。
 *
 * ## 跑法
 *
 * 需要一个可写的 PostgreSQL DSN。默认不跑（CI 上仓库既有的自动测试也不假设本机
 * 有 PG）。设 `POST_ACT_CHECK_PG_DSN=postgres://.../post_act_check_concurrent`
 * 后跑：
 *
 *   POST_ACT_CHECK_PG_DSN=... npx vitest run \
 *     src/lib/social/__tests__/post-measurement-store.concurrent.test.ts
 *
 * 测试自己会 CREATE / DROP 数据库对象；请务必用一个专用测试库，别指向生产。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Client } from 'pg'

const DSN = process.env.POST_ACT_CHECK_PG_DSN
const RUN = DSN ? describe : describe.skip

const CLIENT_UUID = 'c0000000-0000-0000-0000-000000000000'
const ACTION_UUID = '11111111-0000-0000-0000-000000000001'
const POST_ID = '1616575215312482_1750182150247306'
const PAGE_ID = '1616575215312482'
const KEY = 'K1_concurrent'

const MIGRATION_SQL = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260905000001_social_post_measurement_receipts.sql'),
  'utf-8',
)

/** Minimal fixture: create the tables that migration references, then run migration. */
const SETUP_SQL = `
DROP FUNCTION IF EXISTS record_post_measurement_snapshot(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, JSONB, JSONB, TEXT, TEXT, INTEGER, INTEGER);
DROP TABLE IF EXISTS social_post_measurement_receipts CASCADE;
DROP TABLE IF EXISTS flywheel_metrics CASCADE;
DROP TABLE IF EXISTS flywheel_actions CASCADE;
DROP TABLE IF EXISTS clients CASCADE;
DROP TYPE IF EXISTS flywheel_name CASCADE;
DROP TYPE IF EXISTS flywheel_execution_mode CASCADE;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE clients (id UUID PRIMARY KEY);
CREATE TYPE flywheel_name AS ENUM ('seo','social','ads','reputation','geo','competitor');
CREATE TYPE flywheel_execution_mode AS ENUM ('in_house','third_party');
CREATE TABLE flywheel_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  flywheel flywheel_name NOT NULL, action_type TEXT NOT NULL,
  execution_mode flywheel_execution_mode NOT NULL DEFAULT 'in_house',
  vendor TEXT, payload JSONB, expected_metric TEXT, expected_delta NUMERIC,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE flywheel_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  flywheel flywheel_name NOT NULL, metric_key TEXT NOT NULL,
  metric_value NUMERIC NOT NULL, source TEXT NOT NULL, source_ref JSONB,
  measured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated;  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
`

async function connect() {
  const c = new Client({ connectionString: DSN })
  await c.connect()
  return c
}

async function snapshotCall(
  client: Client,
  values: Record<string, number>,
  hash: string,
  measuredAt: string,
) {
  return client.query(
    `SELECT outcome FROM record_post_measurement_snapshot(
      $1::uuid, $2::uuid, $3, $4, $5, $6::int, $7::timestamptz, $8::timestamptz,
      $9, $10::jsonb, $11::jsonb, $12, NULL, NULL, NULL
    )`,
    [
      CLIENT_UUID,
      ACTION_UUID,
      KEY,
      POST_ID,
      PAGE_ID,
      4,
      '2026-09-03T10:00:00Z',
      measuredAt,
      'ok',
      JSON.stringify(values),
      '{}',
      hash,
    ],
  )
}

RUN('真 PostgreSQL 双连接并发 —— 首次写入两个不同 hash', () => {
  let admin: Client

  beforeAll(async () => {
    admin = await connect()
    await admin.query(SETUP_SQL)
    // 运行 migration —— 分批把 DO $$…END $$ 保持整体执行
    await admin.query(MIGRATION_SQL)
    await admin.query(
      'INSERT INTO clients(id) VALUES ($1) ON CONFLICT DO NOTHING',
      [CLIENT_UUID],
    )
    await admin.query(
      `INSERT INTO flywheel_actions(id, client_id, flywheel, action_type, vendor, payload)
         VALUES ($1, $2, 'social', 'social.publish_post', 'meta_graph', $3::jsonb)
         ON CONFLICT DO NOTHING`,
      [ACTION_UUID, CLIENT_UUID, JSON.stringify({ idempotency_key: KEY })],
    )
  }, 30_000)

  afterAll(async () => {
    if (admin) await admin.end()
  })

  it('🔴 A 先入 advisory lock 内写入 hash_A，B 阻塞后见到 hash_A → RAISE snapshot_hash_mismatch；receipt 与 metrics 保持一致', async () => {
    const a = await connect()
    const b = await connect()
    try {
      await a.query('BEGIN')
      const aResult = await snapshotCall(a, { likes: 10 }, 'hash_A', '2026-09-03T10:00:05Z')
      expect(aResult.rows[0].outcome).toBe('written')

      // B 在 A 事务未提交时并发进入 —— 会被 advisory lock 阻塞。
      // 用 setTimeout 保证 B 的 BEGIN 已开始但会阻塞在 RPC 上。
      const bPromise = (async () => {
        try {
          await b.query('BEGIN')
          await snapshotCall(b, { likes: 12 }, 'hash_B', '2026-09-03T10:00:06Z')
          await b.query('COMMIT')
          return { ok: true as const }
        } catch (e) {
          await b.query('ROLLBACK').catch(() => {})
          return { ok: false as const, err: (e as Error).message }
        }
      })()

      // 给 B 一小段时间进入并阻塞
      await new Promise((r) => setTimeout(r, 400))

      // A 提交，释放 advisory lock —— B 醒来读到 hash_A 已存在 → 抛 mismatch
      await a.query('COMMIT')

      const bResult = await bPromise
      expect(bResult.ok).toBe(false)
      if (!bResult.ok) expect(bResult.err).toContain('snapshot_hash_mismatch')

      // 最终一致性：receipt.hash === metric.hash === hash_A
      const receipt = await admin.query(
        `SELECT status, (values->>'likes')::int AS likes, missing->>'__snapshot_hash' AS hash
           FROM social_post_measurement_receipts WHERE action_id = $1`,
        [ACTION_UUID],
      )
      expect(receipt.rows).toHaveLength(1)
      expect(receipt.rows[0]).toMatchObject({ status: 'ok', likes: 10, hash: 'hash_A' })

      const metrics = await admin.query(
        `SELECT metric_key, metric_value::int AS v, source_ref->>'snapshot_hash' AS hash
           FROM flywheel_metrics WHERE source_ref->>'idempotency_key' = $1 ORDER BY metric_key`,
        [KEY],
      )
      expect(metrics.rows).toHaveLength(1)
      expect(metrics.rows[0]).toMatchObject({ metric_key: 'social.post.likes', v: 10, hash: 'hash_A' })
    } finally {
      await a.end()
      await b.end()
    }
  }, 30_000)
})
