/**
 * GET /api/cron/meta-leads-sync —— 只测这条路由 2026-09-20 改掉的那件事：
 * **整轮 status 到底反映什么**。
 *
 * 🔴 改之前的实测（生产库 glbdnayojixmexgofbsd）：这个任务每 2 小时一跑，
 *    26 小时里跑了 13 次、13 次全部 `status='failed'`、`failed_count=3`，
 *    每次都是同一句「3/5 个客户取不到线索」。三家的病因是 Magic Lab Class /
 *    New Asian Logistics 的主页令牌被 Meta 拒了（Graph #190）、NZCPE 2026 的
 *    主页绑定没核实 —— 全都只有人动手才会好，重跑一万次也一样。
 *
 *    后果不是「多了一条红记录」，而是**这条任务永远是红的**：CTS Tours NZ
 *    （5 家里正常的 2 家之一）哪天真的断供，日检和任何按 status 报警的东西
 *    都看不出区别。这份文件钉的就是这个区别。
 *
 * 每个客户各自怎么取数不在这里测（那在 `src/lib/meta/__tests__/leads-sync.test.ts`）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { MetaLeadsSyncResult } from '@/lib/meta/leads-sync'

let clientsResult: { data: unknown; error: { message: string } | null } = { data: [], error: null }

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({ select: () => ({ not: () => Promise.resolve(clientsResult) }) }),
  },
}))

const finish = vi.fn(async (_o: Record<string, unknown>) => {})
vi.mock('@/lib/cron/run-logger', () => ({
  startCronRun: async () => ({ finish }),
  startCronRunId: vi.fn(),
  cronRunHandle: vi.fn(),
}))

const syncClientMetaLeads = vi.fn()
vi.mock('@/lib/meta/leads-sync', () => ({
  syncClientMetaLeads: (c: unknown) => syncClientMetaLeads(c),
}))

import { GET } from '../route'

const CRON_SECRET = 'test-cron-secret'

function req(): NextRequest {
  return new NextRequest('https://app.magicengine.com.au/api/cron/meta-leads-sync', {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  })
}

/** 一条干净跑通的结果。 */
function ok(id: string, name: string, leads = 3): MetaLeadsSyncResult {
  return {
    clientId: id, clientName: name, forms: 2, leadsFetched: leads, leadsIngested: leads,
    newContacts: leads, skippedNoIdentity: 0, failed: 0, mailchimp: {},
  }
}

/** 卡在授权上的结果 —— 人不动手永远不会好。 */
function blocked(id: string, name: string, kind: MetaLeadsSyncResult['blocked']): MetaLeadsSyncResult {
  return {
    clientId: id, clientName: name, forms: 0, leadsFetched: 0, leadsIngested: 0,
    newContacts: 0, skippedNoIdentity: 0, failed: 0, mailchimp: {},
    blocked: kind,
    ...(kind === 'page_binding_unverified'
      ? { skipped: 'page_not_verified' as const, error: '主页绑定没核实，线索同步已暂停（unverified_shared_token）' }
      : { error: 'leadgen_forms HTTP 400: {"error":{"code":190}}' }),
  }
}

/** 重跑可能好的故障（限流 / 5xx / 网络断）。 */
function broken(id: string, name: string): MetaLeadsSyncResult {
  return {
    clientId: id, clientName: name, forms: 0, leadsFetched: 0, leadsIngested: 0,
    newContacts: 0, skippedNoIdentity: 0, failed: 0, mailchimp: {},
    error: 'leadgen_forms HTTP 500: {"error":{"message":"Please reduce the amount of data","code":1}}',
  }
}

/** 2026-09-20 生产那一轮的真实形状：5 家，2 家正常、3 家卡在授权上。 */
const REAL_2026_09_20: MetaLeadsSyncResult[] = [
  blocked('377468af-b103-45f0-984a-b353febb56a1', 'Magic Lab Class', 'token_rejected'),
  blocked('4ae76381-cd45-43bd-85cd-98cfd7604007', 'New Asian Logistics', 'token_rejected'),
  ok('c0000000-0000-0000-0000-000000000000', 'CTS Tours NZ', 10),
  ok('e7465ac7-4f3d-4d6a-afbe-d036ab419708', 'Roman HU', 0),
  blocked('3f3617f5-2124-475d-9212-6f8c14f0b0e2', 'NZCPE 2026', 'page_binding_unverified'),
]

function runWith(results: MetaLeadsSyncResult[]): Promise<Response> {
  clientsResult = {
    data: results.map((r) => ({
      id: r.clientId, name: r.clientName, facebook_page_id: 'p', country: 'NZ', semrush_db: 'nz',
    })),
    error: null,
  }
  let i = 0
  syncClientMetaLeads.mockImplementation(async () => results[i++])
  return GET(req())
}

/** finish() 收到的那一份。`error` 非空 = run-logger 会把整轮标成 failed。 */
function finishArg(): Record<string, unknown> {
  return finish.mock.calls.at(-1)![0]
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = CRON_SECRET
})

describe('整轮 status 只反映系统性故障', () => {
  it('🔴 2026-09-20 那一轮的输入：改之前每次判 failed，现在必须不红', async () => {
    await runWith(REAL_2026_09_20)
    // error 非空就会被 run-logger 标成 status='failed'（见 lib/cron/run-logger.ts）。
    expect(finishArg().error).toBeUndefined()
  })

  it('🔴 同一轮里，卡住的 3 家各自留下自己的失败记录 —— 不许因为整轮转绿就被吞掉', async () => {
    await runWith(REAL_2026_09_20)
    const summary = finishArg().summary as {
      blocked: number
      blockedSummary: string | null
      results: MetaLeadsSyncResult[]
    }

    expect(summary.blocked).toBe(3)
    for (const name of ['Magic Lab Class', 'New Asian Logistics', 'NZCPE 2026']) {
      const row = summary.results.find((r) => r.clientName === name)!
      expect(row.blocked).toBeTruthy()
      // 报错原话一个字都不能丢 —— 丢了追查就只能回去猜。
      expect(row.error).toBeTruthy()
      expect(summary.blockedSummary).toContain(name)
    }
  })

  it('failed_count 不再把等人处理的客户算进去 —— 日报按它捞红跑', async () => {
    await runWith(REAL_2026_09_20)
    expect(finishArg().failed).toBe(0)
    expect(finishArg().completed).toBe(2)
    expect(finishArg().processed).toBe(5)
  })

  it('真故障（限流 / 5xx）照样把整轮判失败 —— 这次改的是噪音，不是把报警关掉', async () => {
    await runWith([ok('a', 'A'), broken('b', 'B'), blocked('c', 'C', 'token_rejected')])
    const arg = finishArg()
    expect(arg.error).toContain('1/3 个客户取不到线索')
    expect(arg.failed).toBe(1)
    // 等人处理的那家不进 error_message，否则 200 字符里又全是老问题。
    expect(String(arg.error)).not.toContain('token_rejected')
  })

  it('一家跑通的都不剩 = 系统性故障，照样红，而且说得出是什么事', async () => {
    await runWith([
      blocked('a', 'A', 'token_rejected'),
      blocked('b', 'B', 'page_binding_unverified'),
    ])
    const arg = finishArg()
    expect(arg.error).toContain('卡在授权上')
    expect(arg.error).toContain('2/2')
  })

  it('全好时仍然是绿的，不制造新噪音', async () => {
    await runWith([ok('a', 'A'), ok('b', 'B')])
    expect(finishArg().error).toBeUndefined()
    expect(finishArg().failed).toBe(0)
  })

  it('鉴权不对不跑', async () => {
    const res = await GET(
      new NextRequest('https://app.magicengine.com.au/api/cron/meta-leads-sync', {
        headers: { authorization: 'Bearer wrong' },
      }),
    )
    expect(res.status).toBe(401)
    expect(finish).not.toHaveBeenCalled()
  })
})
