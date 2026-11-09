/**
 * 挑「该写卡的对话」这一步的行为锁。
 *
 * 🔴 **这份文件是魏征复审逼出来的**（2026-09-07）。`brief-cycle.ts` 的文件头把三条
 *    红线写得很清楚 ——「读失败必须抛，不能返回空」「只认私信渠道」「50 张是花钱的闸」——
 *    但三条**全是注释，一条测试都没有**。变异检验实测：把 `throw` 改成 `return []`、
 *    删掉 `channel` 筛选、删掉 `.slice(0, cap)`，全套测试 80/80 照样全绿。
 *    **注释不是闸。**
 *
 * 三条各自对着一个真事故形态：
 *   · 读失败返回空 → 记成「今天没人要写卡」，跟这次停更 14 天同型（安静地不干活）
 *   · 不筛渠道 → 邮件被当私信写卡，销售照着卡去 Messenger 找一个从没在那说过话的人
 *   · 没有上限 → 一轮坏运行变成一张没有上限的模型账单
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

interface Row {
  id: string
  client_id: string
  channel: string
  message_count: number
  last_message_at: string | null
  last_message_from: string | null
  conversation_briefs:
    | { source_message_count: number; regen_count: number; regen_count_date: string | null }
    | { source_message_count: number; regen_count: number; regen_count_date: string | null }[]
    | null
}

let rows: Row[] = []
let readError: string | null = null
/** 开了「邮件也写简报」的客户。空数组 = 一个都没开（线上默认）。 */
let emailBriefClients: string[] = []
/** 让「读哪些客户开了开关」这条查询报错，验 fail-closed。 */
let clientsReadError = false
/** 查询链上真正被用到的筛选条件 —— 少一个就说明那道闸没接上。 */
interface Filters {
  eqs: [string, unknown][]
  gts: [string, unknown][]
  ins: [string, readonly unknown[]][]
  limit: number | null
}
/** 这一轮里发出去的每一条 conversations 查询各自用了哪些筛选条件。 */
let queries: Filters[] = []
/** 所有查询的条件并起来 —— 断言「某道闸接上了」用它。 */
const allEqs = (): [string, unknown][] => queries.flatMap((q) => q.eqs)
/** 读「哪些客户开了邮件简报」时真正用上的筛选条件。 */
let seenClientFilter: [string, string, unknown] | null = null

/**
 * 🔴 每次 `from()` 各记一份筛选条件，**不能共用一份全局的**。
 *    私信和邮件两条候选查询是并发发出的（`Promise.all`），共用一份的话，
 *    一条查询的 `channel=email` 会被套到另一条上，两条都筛成空 ——
 *    那是假件自己的毛病，却长得像产品代码的 bug（第一版就这样骗了我一次）。
 */
function builder() {
  const mine: Filters = { eqs: [], gts: [], ins: [], limit: null }
  const api = {
    select: () => api,
    gt: (col: string, v: unknown) => { mine.gts.push([col, v]); return api },
    eq: (col: string, v: unknown) => { mine.eqs.push([col, v]); return api },
    in: (col: string, v: readonly unknown[]) => { mine.ins.push([col, v]); return api },
    order: () => api,
    limit: (n: number) => {
      mine.limit = n
      queries.push(mine)
      return Promise.resolve(
        readError
          ? { data: null, error: { message: readError } }
          : {
              // 照着真实查询把筛选条件也应用一遍：假件不能比真库宽松，
              // 否则「删掉 channel 筛选」这种变异在假件上看不出区别。
              data: rows
                .filter((r) => mine.gts.every(([c, v]) => (r as never as Record<string, number>)[c] > (v as number)))
                .filter((r) => mine.eqs.every(([c, v]) => (r as never as Record<string, unknown>)[c] === v))
                .filter((r) => mine.ins.every(([c, v]) => v.includes((r as never as Record<string, unknown>)[c])))
                .slice(0, n),
              error: null,
            },
      )
    },
  }
  return api
}

/**
 * `clients` 表的假件：只需要支撑 `.select('id').filter(...)` 这一条链。
 * 必须跟真查询一样「按开关筛」，否则「忘了筛开关」这种变异在假件上看不出来。
 */
function clientsBuilder() {
  const result = Promise.resolve(
    clientsReadError
      ? { data: null, error: { message: 'clients read failed' } }
      : { data: emailBriefClients.map((id) => ({ id })), error: null },
  )
  const api = {
    select: () => api,
    filter: (col: string, op: string, v: unknown) => {
      seenClientFilter = [col, op, v]
      return result
    },
  }
  return api
}

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: (table: string) => (table === 'clients' ? clientsBuilder() : builder()) },
}))

import { loadDueBriefs, chunkDueBriefs, MAX_BRIEFS_PER_RUN, BRIEFS_PER_CHUNK } from '../brief-cycle'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
/** 「安静了 30 分钟」的判据按 now 算，所以固定 now、把消息时间放在它之前。 */
const NOW = new Date('2026-09-07T22:00:00.000Z')
const QUIET = '2026-09-07T21:00:00.000Z'

function row(id: string, over: Partial<Row> = {}): Row {
  return {
    id,
    client_id: CLIENT,
    channel: 'messenger',
    message_count: 3,
    last_message_at: QUIET,
    last_message_from: 'customer',
    conversation_briefs: [],
    ...over,
  }
}

beforeEach(() => {
  rows = []
  readError = null
  emailBriefClients = []
  clientsReadError = false
  queries = []
  seenClientFilter = null
})

describe('读失败不许被写成「今天没人要写卡」', () => {
  it('🔴 读库报错必须抛出去 —— 返回空数组会让一次故障被记成一轮正常的空转', async () => {
    // 这是这次事故的同型失败：安静地不干活，跟「一切正常」长得一模一样。
    rows = [row('c1')]
    readError = 'connection reset by peer'
    await expect(loadDueBriefs(NOW)).rejects.toThrow('connection reset by peer')
  })

  it('真的没人要写卡时返回空数组（跟报错必须能分开）', async () => {
    rows = []
    await expect(loadDueBriefs(NOW)).resolves.toEqual([])
  })
})

describe('渠道：私信一律写，邮件只给开了开关的客户写', () => {
  // 原来这一组叫「只认私信渠道」，理由是「邮件会写出一张说错渠道的卡」。
  // 提示词现在认渠道了，所以邮件可以写 —— 但**必须按客户开关**，而且
  // 没开的客户一段邮件都不许被挑进来（否则等于替客户决定花钱调模型）。

  it('🔴 没有任何客户开开关 → 邮件对话一段都不许被挑进来', async () => {
    rows = [row('mail-1', { channel: 'email' }), row('dm-1')]
    const due = await loadDueBriefs(NOW)
    expect(due.map((d) => d.conversationId)).toEqual(['dm-1'])
  })

  it('🔴 没有任何客户开开关 → 连那条邮件查询都不该发（行为跟加这功能之前逐字相同）', async () => {
    rows = [row('dm-1')]
    await loadDueBriefs(NOW)
    expect(allEqs()).toContainEqual(['channel', 'messenger'])
    expect(allEqs()).not.toContainEqual(['channel', 'email'])
  })

  it('开了开关 → 邮件对话被挑进来，而且 channel 字段标对', async () => {
    emailBriefClients = [CLIENT]
    rows = [row('mail-1', { channel: 'email' }), row('dm-1')]
    const due = await loadDueBriefs(NOW)
    expect(due.map((d) => d.conversationId).sort()).toEqual(['dm-1', 'mail-1'])
    expect(due.find((d) => d.conversationId === 'mail-1')!.channel).toBe('email')
    expect(due.find((d) => d.conversationId === 'dm-1')!.channel).toBe('messenger')
  })

  it('🔴 开关真的挂在查询上（不是在内存里过一遍）', async () => {
    emailBriefClients = [CLIENT]
    rows = [row('dm-1')]
    await loadDueBriefs(NOW)
    expect(seenClientFilter).toEqual(['leads_config->email_briefs->>enabled', 'eq', 'true'])
  })

  it('🔴 读开关失败 → 当成没人开，只写私信（fail-closed，不许因为读配置失败就替客户花钱）', async () => {
    emailBriefClients = [CLIENT]
    rows = [row('mail-1', { channel: 'email' }), row('dm-1')]
    // 让 clients 那条查询报错
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    clientsReadError = true
    const due = await loadDueBriefs(NOW)
    expect(due.map((d) => d.conversationId)).toEqual(['dm-1'])
    clientsReadError = false
    spy.mockRestore()
  })
})

describe('一轮最多写几张卡（花钱的闸）', () => {
  it('🔴 候选再多也只挑 MAX_BRIEFS_PER_RUN 条 —— 没这道闸，一轮坏运行就是一张没上限的账单', async () => {
    rows = Array.from({ length: MAX_BRIEFS_PER_RUN + 25 }, (_, i) => row(`c-${i}`))
    const due = await loadDueBriefs(NOW)
    expect(due.length).toBe(MAX_BRIEFS_PER_RUN)
  })

  it('调用方可以传更小的上限，但传大了也不会超过库里真有的条数', async () => {
    rows = Array.from({ length: 10 }, (_, i) => row(`c-${i}`))
    expect((await loadDueBriefs(NOW, 4)).length).toBe(4)
    expect((await loadDueBriefs(NOW, 999)).length).toBe(10)
  })
})

describe('挑人的判据（跟 shouldGenerateBrief 一致）', () => {
  it('一条消息都没有的对话不挑', async () => {
    rows = [row('c1', { message_count: 0 })]
    expect(await loadDueBriefs(NOW)).toEqual([])
  })

  it('刚说完话（不到 30 分钟）不挑 —— 要总结聊完的，不是聊一半的', async () => {
    rows = [row('c1', { last_message_at: '2026-09-07T21:59:00.000Z' })]
    expect(await loadDueBriefs(NOW)).toEqual([])
  })

  it('卡已经比对话新就不重写', async () => {
    rows = [
      row('c1', {
        message_count: 3,
        conversation_briefs: [{ source_message_count: 3, regen_count: 0, regen_count_date: null }],
      }),
    ]
    expect(await loadDueBriefs(NOW)).toEqual([])
  })

  it('🔴 卡已经比对话新就不重写（PostgREST 一对一返回对象，不是数组）', async () => {
    // 生产里 conversation_briefs 是对象；只认数组会让「已写过卡」永远判成没写过，
    // 于是每小时把所有对话重写一遍（2026-10 审计：约 1200 次调用/天，只需约 70 次）。
    rows = [
      row('c1', {
        message_count: 3,
        conversation_briefs: { source_message_count: 3, regen_count: 0, regen_count_date: null },
      }),
    ]
    expect(await loadDueBriefs(NOW)).toEqual([])
  })

  it('对象形态的卡比对话旧（有新消息）→ 该重写', async () => {
    rows = [
      row('c1', {
        message_count: 5,
        conversation_briefs: { source_message_count: 3, regen_count: 0, regen_count_date: null },
      }),
    ]
    const due = await loadDueBriefs(NOW)
    expect(due.map((d) => d.conversationId)).toEqual(['c1'])
  })

  it('conversation_briefs 为 null → 当成还没写过卡，该写', async () => {
    rows = [row('c1', { conversation_briefs: null })]
    const due = await loadDueBriefs(NOW)
    expect(due.map((d) => d.conversationId)).toEqual(['c1'])
  })

  it('🔴 最后说话的是客人 → awaitingReply 为真（模型靠它决定「谁在等谁」）', async () => {
    rows = [row('c1', { last_message_from: 'customer' }), row('c2', { last_message_from: 'page' })]
    const due = await loadDueBriefs(NOW)
    expect(due.find((d) => d.conversationId === 'c1')!.awaitingReply).toBe(true)
    expect(due.find((d) => d.conversationId === 'c2')!.awaitingReply).toBe(false)
  })

  it('挑出来的东西必须是纯 JSON —— 它要作为 Inngest step 的结果被缓存、跨步骤传递', async () => {
    rows = [row('c1')]
    const due = await loadDueBriefs(NOW)
    expect(JSON.parse(JSON.stringify(due))).toEqual(due)
  })
})

describe('切段', () => {
  it('按大小切，最后一段可以不满', () => {
    const list = Array.from({ length: 7 }, (_, i) => ({ conversationId: `c${i}` })) as never[]
    expect(chunkDueBriefs(list, 3).map((c) => c.length)).toEqual([3, 3, 1])
  })

  it('空列表切出 0 段（不是一段空的）—— 段数会写进回执给人看', () => {
    expect(chunkDueBriefs([], 5)).toEqual([])
  })

  it('段大小 0 或负数直接抛 —— 不然会无限循环', () => {
    expect(() => chunkDueBriefs([{ conversationId: 'c' }] as never[], 0)).toThrow()
    expect(() => chunkDueBriefs([{ conversationId: 'c' }] as never[], -1)).toThrow()
  })

  it('🔴 段大小要在一个合理区间里：太大踩回 125 秒那条线，太小把 50 张卡切成几十个请求', () => {
    // 上界：实测每张约 3.2 秒（2026-08-22 那批：50 张 157~208 秒），网关约 125 秒掐断。
    expect(BRIEFS_PER_CHUNK * 3.2, '段太长会重新踩回网关超时那条线').toBeLessThan(80)
    // 下界：顶满 50 张时段数不该失控 —— 每段一个 HTTP 请求，切太碎纯属浪费。
    expect(
      Math.ceil(MAX_BRIEFS_PER_RUN / BRIEFS_PER_CHUNK),
      '段切太碎：顶满一轮会变成几十个请求',
    ).toBeLessThanOrEqual(6)
  })
})
