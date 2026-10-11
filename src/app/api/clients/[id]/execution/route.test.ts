/**
 * GET /api/clients/[id]/execution — 执行看板接线测试
 *
 * 🔴 锁住三件事：
 *   ① 账上 payload.status 说「没做成」的自主行动，看板不再显示成「已完成」——
 *      演练 / 被拦 / 失败 / 驳回一律 skipped，等确认是 pending，认不出的状态也是 pending；
 *   ② 客户成员根本收不到「没做成」和「认不出」的行，只看到真做了 / 等确认的；
 *   ③ 内部原因（payload.reason）和原始数据库报错绝不进响应 —— 客户看不到
 *      `relation "ad_entity_snapshots" does not exist` 这种话，也看不到演练开关名。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const OTHER_CLIENT = 'd0000000-0000-0000-0000-000000000000'
const SECRET_REASON = 'relation "ad_entity_snapshots" does not exist'

const INTERNAL = { ok: true, tier: 'admin', role: 'admin', user: { email: 'pm@example.com' }, allowedClientId: null }
const CLIENT_MEMBER = { ok: true, tier: 'paid_client', role: 'client-viewer', user: { email: 'owner@example.com' }, allowedClientId: CLIENT }
const SCOPED_ADMIN = { ok: true, tier: 'admin', role: 'admin', user: { email: 'demo@example.com' }, allowedClientId: CLIENT }

interface LedgerRow {
  id: string
  client_id: string
  execution_item_id: string | null
  flywheel: string
  action_type: string
  execution_mode: string
  vendor: string | null
  payload: Record<string, unknown> | null
  expected_metric: string | null
  expected_delta: number | null
  executed_at: string | null
  created_at: string
}

const m = vi.hoisted(() => ({
  access: vi.fn(),
  outcomes: vi.fn(),
  tables: { flywheel_actions: [] as unknown[] },
}))

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: m.access }))
vi.mock('@/lib/flywheel/execution-outcomes', () => ({ fetchLatestOutcomesByAction: m.outcomes }))
vi.mock('@/lib/supabase', () => {
  // 按表建模：eq / is / in 真的过滤（支持 payload->>status 这种取 JSON 字段的写法），
  // order / limit 真的排序截断 —— 否则「先截 50 条再过滤把客户看板挤空」这种问题测不出来。
  function cell(r: Record<string, unknown>, col: string): unknown {
    const [base, key] = col.split('->>')
    if (key === undefined) return r[base] ?? null
    const obj = r[base]
    if (obj === null || typeof obj !== 'object') return null
    return (obj as Record<string, unknown>)[key] ?? null
  }
  function query(table: string) {
    let rows = [...(((m.tables as Record<string, unknown[]>)[table] ?? []) as Record<string, unknown>[])]
    const chain = {
      select: () => chain,
      not: () => chain,
      eq: (col: string, val: unknown) => { rows = rows.filter(r => cell(r, col) === val); return chain },
      is: (col: string, val: unknown) => { rows = rows.filter(r => cell(r, col) === val); return chain },
      in: (col: string, vals: unknown[]) => { rows = rows.filter(r => vals.includes(cell(r, col))); return chain },
      order: (col: string, opts?: { ascending?: boolean }) => {
        const dir = opts?.ascending === false ? -1 : 1
        rows = [...rows].sort((a, b) => dir * String(cell(a, col)).localeCompare(String(cell(b, col))))
        return chain
      },
      limit: (n: number) => { rows = rows.slice(0, n); return chain },
      then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => resolve({ data: rows, error: null }),
    }
    return chain
  }
  return { supabaseAdmin: { from: (table: string) => query(table) } }
})

import { GET } from './route'

function row(id: string, actionType: string, payload: Record<string, unknown> | null, over: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id, client_id: CLIENT, execution_item_id: null, flywheel: 'ads', action_type: actionType,
    execution_mode: 'third_party', vendor: 'meta', payload, expected_metric: null, expected_delta: null,
    executed_at: '2026-10-10T00:00:00.000Z', created_at: '2026-10-10T00:00:00.000Z', ...over,
  }
}

interface BoardItem { id: string; title: string; description: string; status: string; started_at: string | null; completed_at: string | null }

async function board(query = ''): Promise<{ items: BoardItem[]; raw: string }> {
  const res = await GET(
    new NextRequest(`http://localhost/api/clients/${CLIENT}/execution${query}`),
    { params: { id: CLIENT } },
  )
  expect(res.status).toBe(200)
  const raw = await res.text()
  return { items: (JSON.parse(raw) as { items: BoardItem[] }).items, raw }
}

const byId = (items: BoardItem[]) => Object.fromEntries(items.map(i => [i.id, i]))

beforeEach(() => {
  m.access.mockReset()
  m.outcomes.mockReset()
  m.outcomes.mockResolvedValue({})
  m.tables.flywheel_actions = [
    row('dry', 'ads.auto_pause_on_d3', { status: 'dry_run_logged', reason: '如果 autopilot_dry_run 关闭，会提交 Kernel 等人批准暂停这个广告组' }),
    row('blocked', 'ads.auto_pause_on_d3', { status: 'blocked', reason: SECRET_REASON }),
    row('failed', 'ads.auto_pause_on_d3', { status: 'failed', reason: SECRET_REASON }),
    row('rejected', 'ads.auto_pause_on_d3', { status: 'rejected' }),
    row('waiting', 'ads.auto_pause_on_d3', { status: 'awaiting_approval' }),
    row('paused', 'ads.auto_pause_on_d3', { status: 'paused' }),
    row('odd', 'ads.auto_pause_on_d3', { status: 'some_future_status' }),
    row('blog', 'seo.publish_blog', { primary_keyword: 'china tours' }, { flywheel: 'seo', execution_mode: 'in_house', vendor: null }),
    row('legacy', 'ads.pause_campaign', null),
    row('other-client', 'ads.auto_pause_on_d3', { status: 'paused' }, { client_id: OTHER_CLIENT }),
    row('has-item', 'ads.auto_pause_on_d3', { status: 'paused' }, { execution_item_id: 'e0000000-0000-0000-0000-000000000001' }),
    row('activating', 'ads.create_ad', { status: 'activating' }),
    row('pr-open', 'seo.upgrade_page', { status: 'pr_open' }, { flywheel: 'seo', execution_mode: 'third_party', vendor: 'github' }),
    row('nested', 'ads.create_ad', { activation: { status: 'meta_failed' } }),
    row('kernel-denied', 'ads.adjust_bid', { status: 'denied', reason: SECRET_REASON }),
  ]
})

describe('内部（admin）看板', () => {
  beforeEach(() => {
    m.access.mockResolvedValue(INTERNAL)
  })

  it('payload.status 说没做成的，不再显示成已完成', async () => {
    const { items } = await board()
    const map = byId(items)
    expect(map.dry.status).toBe('skipped')
    expect(map.blocked.status).toBe('skipped')
    expect(map.failed.status).toBe('skipped')
    expect(map.rejected.status).toBe('skipped')
    expect(map.waiting.status).toBe('pending')
    expect(map.odd.status).toBe('pending')
    expect(map.paused.status).toBe('completed')
    expect(map.blog.status).toBe('completed')
    expect(map.legacy.status).toBe('completed')
    expect(map.activating.status).toBe('in_progress')
    expect(map['pr-open'].status).toBe('in_progress')
    expect(map.nested.status).toBe('completed')
    expect(map['kernel-denied'].status).toBe('skipped')

    expect(items.map(i => i.id).sort()).toEqual(
      ['activating', 'blocked', 'blog', 'dry', 'failed', 'kernel-denied', 'legacy', 'nested', 'odd', 'paused', 'pr-open', 'rejected', 'waiting'].sort(),
    )
  })

  it('没做完的不带完成时间', async () => {
    const { items } = await board()
    const map = byId(items)
    for (const id of ['dry', 'blocked', 'failed', 'rejected', 'waiting', 'odd']) {
      expect(map[id].completed_at).toBeNull()
      expect(map[id].started_at).toBeNull()
    }
    expect(map.paused.completed_at).toBe('2026-10-10T00:00:00.000Z')
    for (const id of ['activating', 'pr-open']) {
      expect(map[id].completed_at).toBeNull()
      expect(map[id].started_at).toBe('2026-10-10T00:00:00.000Z')
    }
  })

  it('标题和说明写明真实状态', async () => {
    const { items } = await board()
    const map = byId(items)
    expect(map.dry.title).toContain('未执行：仅演练记录')
    expect(map.blocked.title).toContain('未生效：被安全检查拦下')
    expect(map.waiting.title).toContain('等待确认，确认前不会执行')
    expect(map.odd.title).toContain('状态未识别')
    expect(map.activating.title).toContain('执行中或结果未回写')
    expect(map['kernel-denied'].title).toContain('未执行：未获授权')
    expect(map.paused.title).toBe('ADS · ads.auto_pause_on_d3')
    expect(map.blog.title).toBe('生成博客：china tours')
    expect(map.dry.description).toContain('未执行：仅演练记录')
  })

  it('内部原因和数据库报错不进响应', async () => {
    const { raw } = await board()
    expect(raw).not.toContain(SECRET_REASON)
    expect(raw).not.toContain('ad_entity_snapshots')
    expect(raw).not.toContain('autopilot_dry_run')
    expect(raw).not.toContain('some_future_status')
  })
})

describe('客户成员看板', () => {
  beforeEach(() => {
    m.access.mockResolvedValue(CLIENT_MEMBER)
  })

  it('只收到真做了 / 等确认的，没做成的和认不出的一条都不给', async () => {
    const { items } = await board()
    expect(items.map(i => i.id).sort()).toEqual(['blog', 'legacy', 'nested', 'paused', 'pr-open', 'waiting'])
  })

  it('没有任何一条没做成的被说成已完成', async () => {
    const { items } = await board()
    const map = byId(items)
    for (const item of items) {
      if (item.status === 'completed') {
        expect(['blog', 'legacy', 'nested', 'paused']).toContain(item.id)
      }
    }
    expect(map.waiting.status).toBe('pending')
    expect(map['pr-open'].status).toBe('in_progress')
    expect(map.activating).toBeUndefined()
  })

  it('响应里没有内部原因', async () => {
    const { raw } = await board()
    expect(raw).not.toContain(SECRET_REASON)
    expect(raw).not.toContain('autopilot_dry_run')
    expect(raw).not.toContain('演练')
    expect(raw).not.toContain('拦下')
    expect(raw).not.toContain('some_future_status')
    expect(raw).not.toContain('结果未回写')
    expect(raw).not.toContain('未获授权')
  })
})

describe('受限管理员（演示 / 试用账号）', () => {
  beforeEach(() => {
    m.access.mockResolvedValue(SCOPED_ADMIN)
  })

  it('按客户看：只收到真做了 / 等确认的', async () => {
    const { items } = await board()
    expect(items.map(i => i.id).sort()).toEqual(['blog', 'legacy', 'nested', 'paused', 'pr-open', 'waiting'])
  })
})

describe('看不到的记录不占客户的名额', () => {
  beforeEach(() => {
    const dryRows = Array.from({ length: 60 }, (_, i) =>
      row(`dry-${i}`, 'ads.auto_pause_on_d3', { status: 'dry_run_logged' }, {
        executed_at: `2026-10-11T00:${String(i).padStart(2, '0')}:00.000Z`,
      }),
    )
    m.tables.flywheel_actions = [
      ...dryRows,
      row('old-paused', 'ads.auto_pause_on_d3', { status: 'paused' }, { executed_at: '2026-09-01T00:00:00.000Z' }),
      row('old-blog', 'seo.publish_blog', { primary_keyword: 'k' }, { flywheel: 'seo', execution_mode: 'in_house', vendor: null, executed_at: '2026-09-02T00:00:00.000Z' }),
    ]
  })

  it('客户成员仍能看到更早的真做了的记录', async () => {
    m.access.mockResolvedValue(CLIENT_MEMBER)
    const { items } = await board()
    expect(items.map(i => i.id)).toEqual(['old-blog', 'old-paused'])
  })

  it('内部成员只拿到最近 50 条，且都是没做成的', async () => {
    m.access.mockResolvedValue(INTERNAL)
    const { items } = await board()
    expect(items).toHaveLength(50)
    for (const item of items) {
      expect(item.status).toBe('skipped')
    }
  })
})

describe('按处方过滤时', () => {
  it('不带自主行动（原行为不变）', async () => {
    m.access.mockResolvedValue(INTERNAL)
    const { items } = await board('?prescription_id=p-1')
    expect(items).toHaveLength(0)
  })
})
