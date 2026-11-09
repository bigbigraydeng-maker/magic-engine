/**
 * 落库层：幂等、身份核对、快照原子性。
 *
 * Codex #1399 复审四条 P1 各有对应回归：
 *   P2  同 idempotency_key 换 post/page/plan/measure_at → fail-closed
 *   P3  Graph 数字变化 → 拒绝覆盖原快照；ok/partial 不被 unmeasurable 降级
 *   P4  action 归属核对：event 声称的 client/post/page 与 DB 里那条 action 不符 → 拒
 */

import { describe, it, expect, vi } from 'vitest'
import {
  recordPublishAction,
  recordSnapshot,
  snapshotHash,
  verifyActionIdentity,
  publishIdentityMismatch,
  PublishActionIdentityMismatchError,
  SOCIAL_PUBLISH_ACTION_TYPE,
  SOCIAL_PUBLISH_STORY_ACTION_TYPE,
} from '../post-measurement-store'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const OTHER_CLIENT = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'
const PAGE = '1616575215312482'
const POST = `${PAGE}_1750182150247306`
const KEY = 'campaign_daily::c0000000::2026-09-03::post'
const ACTION = 'aaaaaaaa-0000-0000-0000-000000000001'

function actionInput(over: Record<string, unknown> = {}) {
  return {
    clientId: CLIENT,
    idempotencyKey: KEY,
    postId: POST,
    pageId: PAGE,
    permalink: 'https://www.facebook.com/CTSTOURS/posts/abc',
    campaignId: '6612eabf-dd7e-47f0-bcc4-e6a7fd813aea',
    planId: 'f166a5c0-b2df-478c-8b04-1168ef2d3641',
    publishedAt: '2026-09-03T06:00:00.000Z',
    measureAt: [{ hours: 4, at: '2026-09-03T10:00:00.000Z' }],
    ...over,
  }
}

/** 建模三张相关表 + RPC。碰别的表就炸，暴露越界写入。 */
function fakeDb(opts: {
  insertResult?: { data?: unknown; error?: unknown }
  existingRow?: unknown
  rpcResult?: { data?: unknown; error?: unknown }
  actionRow?: unknown
  actionError?: unknown
  onInsert?: (table: string, row: Record<string, unknown>) => void
  onRpc?: (name: string, args: Record<string, unknown>) => void
} = {}) {
  const ALLOWED = ['flywheel_actions', 'flywheel_metrics', 'social_post_measurement_receipts']
  return {
    from(table: string) {
      if (!ALLOWED.includes(table)) throw new Error(`fake db: table '${table}' is not modelled`)
      const chain: Record<string, unknown> = {}
      const readState = { where: {} as Record<string, unknown> }
      chain.insert = (row: Record<string, unknown>) => {
        opts.onInsert?.(table, row)
        const result = opts.insertResult ?? { data: { id: ACTION }, error: null }
        chain.select = () => chain
        chain.single = () => Promise.resolve(result)
        return chain
      }
      chain.select = () => chain
      chain.eq = (col: string, val: unknown) => {
        readState.where[col] = val
        return chain
      }
      chain.maybeSingle = () => {
        // action 查询：if we hit id filter, use actionRow
        if ('id' in readState.where) {
          return Promise.resolve({ data: opts.actionRow ?? null, error: opts.actionError ?? null })
        }
        return Promise.resolve({ data: opts.existingRow ?? null, error: null })
      }
      return chain
    },
    rpc(name: string, args: Record<string, unknown>) {
      opts.onRpc?.(name, args)
      return Promise.resolve(opts.rpcResult ?? { data: [{ receipt_id: 'r1', outcome: 'written' }], error: null })
    },
  } as never
}

// ─── P2：幂等冲突时核对完整身份 ──────────────────────────────────────────────

describe('P2: publishIdentityMismatch —— 逐字段核对，不同即报', () => {
  const baseInput = actionInput()
  const baseExisting = {
    id: ACTION,
    client_id: CLIENT,
    payload: {
      post_id: POST,
      page_id: PAGE,
      idempotency_key: KEY,
      campaign_id: baseInput.campaignId,
      plan_id: baseInput.planId,
      published_at: baseInput.publishedAt,
      measure_at: baseInput.measureAt,
    },
  }

  it('完全一致 → 无 mismatch', () => {
    expect(publishIdentityMismatch(baseExisting, baseInput)).toBeNull()
  })

  it('🔴 同 key 换 post_id → post_id_mismatch', () => {
    expect(publishIdentityMismatch(baseExisting, actionInput({ postId: `${PAGE}_9999` })))
      .toBe('post_id_mismatch')
  })

  it('🔴 同 key 换 page_id → page_id_mismatch', () => {
    expect(publishIdentityMismatch(baseExisting, actionInput({ pageId: '9999' })))
      .toBe('page_id_mismatch')
  })

  it('🔴 同 key 换 plan_id → plan_id_mismatch', () => {
    expect(publishIdentityMismatch(baseExisting, actionInput({ planId: '99999999-0000-0000-0000-000000000000' })))
      .toBe('plan_id_mismatch')
  })

  it('🔴 同 key 换 campaign_id → campaign_id_mismatch', () => {
    expect(publishIdentityMismatch(baseExisting, actionInput({ campaignId: '99999999-0000-0000-0000-000000000000' })))
      .toBe('campaign_id_mismatch')
  })

  it('🔴 同 key 换 published_at → published_at_mismatch', () => {
    expect(publishIdentityMismatch(baseExisting, actionInput({ publishedAt: '2026-09-03T07:00:00.000Z' })))
      .toBe('published_at_mismatch')
  })

  it('🔴 同 key 换 measure_at 时间 → measure_at_mismatch', () => {
    expect(publishIdentityMismatch(baseExisting, actionInput({ measureAt: [{ hours: 4, at: '2026-09-03T11:00:00.000Z' }] })))
      .toBe('measure_at_mismatch')
  })

  it('🔴 现有行读不到 → action_not_readable，不能当正常重放', () => {
    expect(publishIdentityMismatch(null, baseInput)).toBe('action_not_readable')
  })
})

describe('P2: recordPublishAction 幂等冲突时抛 Identity Mismatch', () => {
  it('🔴 唯一约束冲突 + 换 post_id → 抛 PublishActionIdentityMismatchError', async () => {
    const db = fakeDb({
      insertResult: { data: null, error: { code: '23505', message: 'dup' } },
      existingRow: {
        id: ACTION,
        client_id: CLIENT,
        payload: {
          post_id: POST, // 已存在的是旧 post
          page_id: PAGE,
          idempotency_key: KEY,
          campaign_id: '6612eabf-dd7e-47f0-bcc4-e6a7fd813aea',
          plan_id: 'f166a5c0-b2df-478c-8b04-1168ef2d3641',
          published_at: '2026-09-03T06:00:00.000Z',
          measure_at: [{ hours: 4, at: '2026-09-03T10:00:00.000Z' }],
        },
      },
    })
    // 新事件带的 post_id 不同
    await expect(recordPublishAction(db, actionInput({ postId: `${PAGE}_9999` }))).rejects.toBeInstanceOf(
      PublishActionIdentityMismatchError,
    )
  })

  it('完全一致的重放 → 返回旧 id', async () => {
    const input = actionInput()
    const db = fakeDb({
      insertResult: { data: null, error: { code: '23505', message: 'dup' } },
      existingRow: {
        id: ACTION,
        client_id: CLIENT,
        payload: {
          post_id: input.postId,
          page_id: input.pageId,
          idempotency_key: input.idempotencyKey,
          campaign_id: input.campaignId,
          plan_id: input.planId,
          published_at: input.publishedAt,
          measure_at: input.measureAt,
        },
      },
    })
    expect(await recordPublishAction(db, input)).toBe(ACTION)
  })
})

describe('recordPublishAction —— 字段合规', () => {
  it('🔴 expected_metric 必须是 NULL', async () => {
    let written: Record<string, unknown> | null = null
    await recordPublishAction(fakeDb({ onInsert: (_t, r) => { written = r } }), actionInput())
    expect(written).not.toBeNull()
    expect(written!.expected_metric).toBeNull()
    expect(written!.expected_delta).toBeNull()
  })

  it('vendor = meta_graph、execution_mode = in_house', async () => {
    let written: Record<string, unknown> | null = null
    await recordPublishAction(fakeDb({ onInsert: (_t, r) => { written = r } }), actionInput())
    expect(written!.vendor).toBe('meta_graph')
    expect(written!.execution_mode).toBe('in_house')
    expect(written!.action_type).toBe(SOCIAL_PUBLISH_ACTION_TYPE)
  })

  it('🔴 排期帖 executed_at 用公开时刻', async () => {
    let written: Record<string, unknown> | null = null
    await recordPublishAction(
      fakeDb({ onInsert: (_t, r) => { written = r } }),
      { ...actionInput(), scheduledPublishTime: '2026-09-05T20:00:00.000Z' },
    )
    expect(written!.executed_at).toBe('2026-09-05T20:00:00.000Z')
  })

  it('回执数组不写进 action payload', async () => {
    let written: Record<string, unknown> | null = null
    await recordPublishAction(fakeDb({ onInsert: (_t, r) => { written = r } }), actionInput())
    expect((written!.payload as Record<string, unknown>)).not.toHaveProperty('measurements')
  })
})

// ─── P4：消费者读 action 核对身份 ───────────────────────────────────────────

describe('P4: verifyActionIdentity —— 消费测量事件前必须核对', () => {
  const baseAction = {
    client_id: CLIENT,
    action_type: 'social.publish_post',
    payload: { post_id: POST, page_id: PAGE, idempotency_key: KEY,
      source: 'factory_reel', published_at: '2026-09-03T06:00:00.000Z',
      measure_at: [{ hours: 4, at: '2026-09-03T10:00:00.000Z' }, { hours: 72, at: '2026-09-06T06:00:00.000Z' }],
    },
  }
  const windowClaim = { windowHours: 4, targetAt: '2026-09-03T10:00:00.000Z' }

  it('全部一致 → ok', async () => {
    const r = await verifyActionIdentity(fakeDb({ actionRow: baseAction }), ACTION, {
      ...windowClaim,
      clientId: CLIENT, idempotencyKey: KEY, postId: POST, pageId: PAGE,
    })
    expect(r.ok).toBe(true)
  })

  it('🔴 event 声称的 client_id 与 action.client_id 不同 → client_mismatch，阻止跨客户串台', async () => {
    const r = await verifyActionIdentity(fakeDb({ actionRow: baseAction }), ACTION, {
      ...windowClaim,
      clientId: OTHER_CLIENT, idempotencyKey: KEY, postId: POST, pageId: PAGE,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('client_mismatch')
  })

  it('🔴 event 声称的 post_id 与 action.payload.post_id 不同 → post_mismatch', async () => {
    const r = await verifyActionIdentity(fakeDb({ actionRow: baseAction }), ACTION, {
      ...windowClaim,
      clientId: CLIENT, idempotencyKey: KEY, postId: `${PAGE}_9999`, pageId: PAGE,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('post_mismatch')
  })

  it('🔴 event 声称的 page_id 与 action.payload.page_id 不同 → page_mismatch', async () => {
    const r = await verifyActionIdentity(fakeDb({ actionRow: baseAction }), ACTION, {
      ...windowClaim,
      clientId: CLIENT, idempotencyKey: KEY, postId: POST, pageId: '9999',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('page_mismatch')
  })

  it('idempotency_key 与 action.payload 不同 → idempotency_mismatch', async () => {
    const r = await verifyActionIdentity(fakeDb({ actionRow: baseAction }), ACTION, {
      ...windowClaim,
      clientId: CLIENT, idempotencyKey: 'other', postId: POST, pageId: PAGE,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('idempotency_mismatch')
  })

  it('action 不存在 → action_not_found', async () => {
    const r = await verifyActionIdentity(fakeDb({ actionRow: null }), ACTION, {
      ...windowClaim,
      clientId: CLIENT, idempotencyKey: KEY, postId: POST, pageId: PAGE,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('action_not_found')
  })

  it('T9 social.publish_story → invalid_publish_action', async () => {
    const r = await verifyActionIdentity(fakeDb({
      actionRow: { ...baseAction, action_type: SOCIAL_PUBLISH_STORY_ACTION_TYPE },
    }), ACTION, {
      ...windowClaim,
      clientId: CLIENT, idempotencyKey: KEY, postId: POST, pageId: PAGE,
    })
    expect(r).toEqual({ ok: false, reason: 'invalid_publish_action' })
  })

  it('🔴 DB 错误必须抛出，不能塌成 action_not_found（P1 同类原理）', async () => {
    await expect(
      verifyActionIdentity(fakeDb({ actionError: { message: 'boom' } }), ACTION, {
        ...windowClaim,
        clientId: CLIENT, idempotencyKey: KEY, postId: POST, pageId: PAGE,
      }),
    ).rejects.toThrow(/db error/)
  })
})

// ─── P3：快照原子性 ────────────────────────────────────────────────────────

describe('P3: snapshotHash —— 同数字必产同 hash，不同数字必不同', () => {
  it('相同数字 → 相同 hash', () => {
    expect(snapshotHash(4, { likes: 10, comments: 2 })).toBe(snapshotHash(4, { comments: 2, likes: 10 }))
  })

  it('🔴 Graph 数字变了 → hash 变了（用于 RPC 拒绝覆盖）', () => {
    expect(snapshotHash(4, { likes: 10 })).not.toBe(snapshotHash(4, { likes: 12 }))
  })

  it('不同窗口 → 不同 hash', () => {
    expect(snapshotHash(4, { likes: 10 })).not.toBe(snapshotHash(72, { likes: 10 }))
  })
})

describe('P3: recordSnapshot —— 转发到 RPC 并解析 outcome', () => {
  it('🔴 传给 RPC 的 hash 由数字算出，不是消费者随便造', async () => {
    let rpcArgs: Record<string, unknown> | null = null
    await recordSnapshot(
      fakeDb({ onRpc: (_n, a) => { rpcArgs = a } }),
      {
        clientId: CLIENT, actionId: ACTION, idempotencyKey: KEY, postId: POST, pageId: PAGE,
        windowHours: 4, targetAt: '2026-09-03T10:00:00.000Z', measuredAt: '2026-09-03T10:00:05.000Z',
        status: 'ok', values: { likes: 10, comments: 2, shares: 1 }, missing: {},
      },
    )
    expect(rpcArgs!.p_snapshot_hash).toBe(snapshotHash(4, { likes: 10, comments: 2, shares: 1 }))
  })

  it('RPC 返回 written → written', async () => {
    const r = await recordSnapshot(
      fakeDb({ rpcResult: { data: [{ receipt_id: 'r1', outcome: 'written' }], error: null } }),
      { clientId: CLIENT, actionId: ACTION, idempotencyKey: KEY, postId: POST, pageId: PAGE,
        windowHours: 4, targetAt: '2026-09-03T10:00:00.000Z', measuredAt: '2026-09-03T10:00:05.000Z',
        status: 'ok', values: { likes: 10 }, missing: {} },
    )
    expect(r).toBe('written')
  })

  it('🔴 RPC 返回 kept_success（unmeasurable 撞上已 ok）→ kept_success，不视为错误', async () => {
    const r = await recordSnapshot(
      fakeDb({ rpcResult: { data: [{ receipt_id: 'r1', outcome: 'kept_success' }], error: null } }),
      { clientId: CLIENT, actionId: ACTION, idempotencyKey: KEY, postId: POST, pageId: PAGE,
        windowHours: 4, targetAt: '2026-09-03T10:00:00.000Z', measuredAt: null,
        status: 'unmeasurable', values: {}, missing: {} },
    )
    expect(r).toBe('kept_success')
  })

  it('🔴 RPC 抛 snapshot_hash_mismatch（数字变化）→ hash_mismatch，不视为写入', async () => {
    const r = await recordSnapshot(
      fakeDb({ rpcResult: { data: null, error: { message: 'snapshot_hash_mismatch existing=a incoming=b' } } }),
      { clientId: CLIENT, actionId: ACTION, idempotencyKey: KEY, postId: POST, pageId: PAGE,
        windowHours: 4, targetAt: '2026-09-03T10:00:00.000Z', measuredAt: '2026-09-03T11:00:00.000Z',
        status: 'partial', values: { likes: 12 }, missing: { comments: 'field_absent' } },
    )
    expect(r).toBe('hash_mismatch')
  })

  it('别的 RPC 错误照常抛', async () => {
    await expect(
      recordSnapshot(
        fakeDb({ rpcResult: { data: null, error: { message: 'connection refused' } } }),
        { clientId: CLIENT, actionId: ACTION, idempotencyKey: KEY, postId: POST, pageId: PAGE,
          windowHours: 4, targetAt: '2026-09-03T10:00:00.000Z', measuredAt: null,
          status: 'unmeasurable', values: {}, missing: {} },
      ),
    ).rejects.toThrow(/connection refused/)
  })
})

// ─── P1 事故回归：Codex 二审 ──────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const MIGRATION = resolve(
  process.cwd(),
  'supabase/migrations/20260905000001_social_post_measurement_receipts.sql',
)

describe('P1a: SECURITY DEFINER 权限收干净 —— REVOKE 必须覆盖 anon/authenticated', () => {
  const sql = readFileSync(MIGRATION, 'utf-8')

  it('🔴 REVOKE FROM 必须含 PUBLIC, anon, authenticated —— db-invariants 不变量 4', () => {
    // Supabase 用 ALTER DEFAULT PRIVILEGES 独立给 anon/authenticated 授权，
    // 只 REVOKE FROM PUBLIC 收不干净（2026-09-03 20260815000001 事故）。
    const revokeMatch = sql.match(/REVOKE\s+ALL\s+ON\s+FUNCTION[\s\S]+?FROM\s+([^;]+);/i)
    expect(revokeMatch, 'migration must contain a REVOKE ALL ON FUNCTION statement').toBeTruthy()
    const targets = revokeMatch![1].toLowerCase()
    expect(targets).toContain('public')
    expect(targets).toContain('anon')
    expect(targets).toContain('authenticated')
  })

  it('只把 EXECUTE 授给 service_role，不给 anon/authenticated', () => {
    const grantSection = sql.match(/GRANT\s+EXECUTE\s+ON\s+FUNCTION[\s\S]+?TO\s+([^;]+);/i)
    expect(grantSection).toBeTruthy()
    const grantees = grantSection![1].toLowerCase()
    expect(grantees).toContain('service_role')
    expect(grantees).not.toContain('anon')
    expect(grantees).not.toContain('authenticated')
    expect(grantees).not.toContain('public')
  })
})

describe('P1b: 首次并发写入靠 advisory lock 串行化', () => {
  const sql = readFileSync(MIGRATION, 'utf-8')

  it('🔴 RPC 必须先拿事务级 advisory lock 再 SELECT FOR UPDATE', () => {
    // 两个并发首调时 FOR UPDATE 锁不到不存在的行 —— 必须靠 advisory lock 强行
    // 串行化同 (action_id, window_hours) 的调用，否则 receipt 与 metrics 会各写
    // 不同快照。真事故复现见迁移 verify 脚本 P3-concurrent。
    expect(sql).toMatch(/pg_advisory_xact_lock\s*\(/)
    // 顺序断言：advisory lock 必须在 SELECT ... FOR UPDATE 之前。
    const lockIdx = sql.search(/pg_advisory_xact_lock\s*\(/)
    const forUpdateIdx = sql.search(/FROM\s+public\.social_post_measurement_receipts[\s\S]+?FOR\s+UPDATE/i)
    expect(lockIdx).toBeGreaterThan(0)
    expect(forUpdateIdx).toBeGreaterThan(lockIdx)
  })

  it('advisory lock 键必须由 (action_id, window_hours) 派生', () => {
    // 别的键（例如全局常量、只用 action_id）会让不同窗口互相阻塞或让同窗口并发漏。
    const lockBlock = sql.match(/v_lock_key\s*:=[\s\S]+?pg_advisory_xact_lock/i)
    expect(lockBlock).toBeTruthy()
    expect(lockBlock![0]).toContain('p_action_id')
    expect(lockBlock![0]).toContain('p_window_hours')
  })
})
