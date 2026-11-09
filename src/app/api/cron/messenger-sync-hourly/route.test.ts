/**
 * GET /api/cron/messenger-sync-hourly —— 只测这条路由 2026-09-07 新长出来的那件事：
 * **跑完之后把「同步跑完了」那张条子发出去**。
 *
 * 🔴 **这份文件是魏征复审逼出来的**（2026-09-07）。变异检验实测：把发条子那一行整个删掉
 *    ——也就是整条新链路的引信拔掉、客户需求卡从此永不再写、事故原样复现——
 *    全套测试 80/80 照样全绿。一条断言都没有盯着这个引信。
 *
 * 同步本身怎么拉数据不在这里测（那在 `src/lib/messenger/__tests__/sync.test.ts`）。
 * 这里只管四件事：鉴权、条子发没发、条子里写的是不是真话、发不出去时怎么办。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/** 有 facebook_page_id 的客户名单。 */
let clientsResult: { data: unknown; error: { message: string } | null } = { data: [], error: null }

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'clients') {
        return {
          select: () => ({
            not: () => Promise.resolve(clientsResult),
            // 邮箱那半边会按 id 反查客户，这里一律给空。
            in: () => Promise.resolve({ data: [], error: null }),
          }),
        }
      }
      // platform_oauth_connections：没有已连的邮箱。
      return { select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }) }
    },
  },
}))

const finish = vi.fn(async (_o: Record<string, unknown>) => {})
vi.mock('@/lib/cron/run-logger', () => ({
  startCronRun: async () => ({ finish }),
  startCronRunId: vi.fn(),
  cronRunHandle: vi.fn(),
}))

const syncClientMessenger = vi.fn()
vi.mock('@/lib/messenger/sync', () => ({
  syncClientMessenger: (c: unknown) => syncClientMessenger(c),
}))
vi.mock('@/lib/microsoft/mail-ingest', () => ({ syncMailbox: vi.fn() }))

const sendInngestEvent = vi.fn()
vi.mock('@/lib/workflows/inngest-event', () => ({
  sendInngestEvent: (e: unknown) => sendInngestEvent(e),
}))

import { MESSENGER_SYNC_COMPLETED_EVENT } from '@/lib/messenger/sync-completed-event'

const CRON_SECRET = 'test-cron-secret'
const CTS = 'c0000000-0000-0000-0000-000000000000'

function req(secret: string | null) {
  const headers: Record<string, string> = {}
  if (secret !== null) headers['authorization'] = `Bearer ${secret}`
  return new NextRequest('http://localhost:3001/api/cron/messenger-sync-hourly', { method: 'GET', headers })
}

/** syncClientMessenger 的返回形状（跟 MessengerSyncResult 一致的那几个数）。 */
function syncResult(over: Record<string, unknown> = {}) {
  return {
    clientId: CTS,
    clientName: 'CTS Tours NZ',
    conversations: 2,
    messages: 5,
    created: 1,
    linked: 1,
    backfilled: 0,
    backfillRemaining: 3,
    leadIntroScanned: 134,
    error: null,
    ...over,
  }
}

async function callRoute() {
  const { GET } = await import('./route')
  return GET(req(CRON_SECRET))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  process.env.CRON_SECRET = CRON_SECRET
  clientsResult = { data: [{ id: CTS, name: 'CTS Tours NZ', facebook_page_id: '1616575215312482' }], error: null }
  syncClientMessenger.mockResolvedValue(syncResult())
  sendInngestEvent.mockResolvedValue({ event_ids: ['evt_1'] })
})

describe('鉴权', () => {
  it('密钥不对 → 401，一张条子都不发', async () => {
    const { GET } = await import('./route')
    const res = await GET(req('wrong'))
    expect(res.status).toBe(401)
    expect(sendInngestEvent).not.toHaveBeenCalled()
  })

  it('没配 CRON_SECRET → 500，一张条子都不发', async () => {
    delete process.env.CRON_SECRET
    const { GET } = await import('./route')
    const res = await GET(req('anything'))
    expect(res.status).toBe(500)
    expect(sendInngestEvent).not.toHaveBeenCalled()
  })
})

describe('🔴 跑完必须发「同步跑完了」那张条子（整条新链路的引信）', () => {
  it('发了，而且事件名就是消费者监听的那个', async () => {
    await callRoute()
    expect(sendInngestEvent).toHaveBeenCalledTimes(1)
    expect(sendInngestEvent.mock.calls[0][0]).toMatchObject({ name: MESSENGER_SYNC_COMPLETED_EVENT })
  })

  it('🔴 条子里的数字是这一轮真实的回执，不是写死的', async () => {
    syncClientMessenger.mockResolvedValue(syncResult({ conversations: 7, messages: 11, created: 3 }))
    await callRoute()
    expect(sendInngestEvent.mock.calls[0][0].data).toMatchObject({
      clients: 1,
      conversations: 7,
      messages: 11,
      new_contacts: 3,
      failed: 0,
    })
  })

  it('🔴 一条消息都没拉到也照样发 —— 卡写的是库里已有的对话', async () => {
    // 深夜那几个小时常常一条新消息都没有。这里若跳过，那批小时一张卡都不出，
    // 而积压的老对话本来就该在那时候被写掉。
    syncClientMessenger.mockResolvedValue(syncResult({ conversations: 0, messages: 0, created: 0 }))
    await callRoute()
    expect(sendInngestEvent).toHaveBeenCalledTimes(1)
  })

  it('已知坏令牌不算进 failed，真错误照算', async () => {
    syncClientMessenger.mockResolvedValue(
      syncResult({ error: 'page_not_verified: unverified_shared_token', skipped: 'page_not_verified' }),
    )
    await callRoute()
    expect(sendInngestEvent.mock.calls[0][0].data).toMatchObject({ failed: 0 })
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ failed: 0 }))
  })

  it('🔴 部分客户同步失败也照样发 —— 跟改造之前 `&&` 那套的行为一致', async () => {
    // 改造前：单个客户失败只记一笔、路由仍返 200，`&&` 后面那条 curl 照跑。
    // 这里若收紧成「有失败就不写卡」，就是借这次修复偷偷改了业务行为。
    syncClientMessenger.mockResolvedValue(syncResult({ error: 'page token expired' }))
    await callRoute()
    expect(sendInngestEvent).toHaveBeenCalledTimes(1)
    expect(sendInngestEvent.mock.calls[0][0].data).toMatchObject({ failed: 1 })
  })

  it('🔴 同步整轮读客户名单就失败 → 不发条子（这是原来那个意图：别拿半截数据写卡）', async () => {
    clientsResult = { data: null, error: { message: 'clients table unreachable' } }
    const res = await callRoute()
    expect(res.status).toBe(500)
    expect(sendInngestEvent).not.toHaveBeenCalled()
  })

  it('条子的 id 按小时去重 —— 同一小时手动补触发一次同步不会再触发一整批卡', async () => {
    await callRoute()
    expect(sendInngestEvent.mock.calls[0][0].id).toMatch(/^messenger-sync-completed-\d{4}-\d{2}-\d{2}T\d{2}$/)
  })
})

describe('条子发不出去的时候', () => {
  it('🔴 不许让本轮同步判失败 —— 私信已经跑完并且入库了', async () => {
    // 把一个下游步骤的问题误报成上游没跑，正是这次事故的形态。
    sendInngestEvent.mockRejectedValue(new Error('INNGEST_EVENT_KEY_MISSING'))
    const res = await callRoute()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    // 但也不许装作发出去了 —— 响应里要如实写着没发成和为什么。
    expect(body.briefHandoff).toMatchObject({ sent: false, error: 'INNGEST_EVENT_KEY_MISSING' })
  })

  it('发成功时响应里也写明发出去了', async () => {
    const res = await callRoute()
    expect((await res.json()).briefHandoff).toMatchObject({ sent: true, error: null })
  })
})

describe('🔴 观测 —— handoff 结果必须进 cron_run_logs.summary（响应被网关吞掉时唯一能查的地方）', () => {
  // 上次事故的失败模式：`&&` 守错信号 + handoff 结果只放响应里 + 响应被网关掐 =
  // 观测数据消失，监控上看不出「发条子那一步是不是挂了」。这一组测试锁的就是
  // 「观测数据到底在没在」——不是「同步跑没跑」。

  it('发成功时，run.finish 的 summary.briefHandoff.sent 是 true', async () => {
    await callRoute()
    expect(finish).toHaveBeenCalledTimes(1)
    const summary = (finish.mock.calls[0][0] as { summary: { briefHandoff?: { sent: boolean; error: string | null } } }).summary
    expect(summary?.briefHandoff).toMatchObject({ sent: true, error: null })
  })

  it('🔴 发失败时，失败原因也必须进 summary —— 这就是加观测要看到的那一行', async () => {
    // 生产上真出的错，比如 event key 缺、Inngest 拒收，都会在这里落下。
    sendInngestEvent.mockRejectedValue(new Error('INNGEST_EVENT_SEND_FAILED:401:invalid event key'))
    await callRoute()
    const summary = (finish.mock.calls[0][0] as { summary: { briefHandoff?: { sent: boolean; error: string | null } } }).summary
    expect(summary?.briefHandoff).toMatchObject({
      sent: false,
      error: 'INNGEST_EVENT_SEND_FAILED:401:invalid event key',
    })
  })

  it('🔴 handoff 必须发生在 run.finish 之前 —— 反过来 summary 里拿不到值', async () => {
    // 顺序不对，运行记录就永远缺 briefHandoff 字段，这个观测跟没加一样。
    const order: string[] = []
    sendInngestEvent.mockImplementation(async () => {
      order.push('handoff')
      return { event_ids: ['evt_1'] }
    })
    finish.mockImplementation(async () => {
      order.push('finish')
    })
    await callRoute()
    expect(order).toEqual(['handoff', 'finish'])
  })
})
