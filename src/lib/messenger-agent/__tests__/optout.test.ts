/**
 * `src/lib/messenger-agent/optout.ts` 的单测 + 变异测试。
 *
 * 三块：
 *   1. `isOptOutKeyword` —— 纯函数，中英双语各 3 正例 + 3 反例（issue #1575 验证要求）。
 *   2. `isConversationOptedOut` —— 用假 supabase 数据源钉住四种路径 + 一条
 *      「伪造 client_id 跨客户读」的变异测试（4 轴红线之一）。
 *   3. `recordOptOutKeywordTouch` —— 断言写入的字段形状跟 issue 给的例子完全一致
 *      （`outcome` 在 `metadata` 里，不是顶层）。
 */

import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  isOptOutKeyword,
  isConversationOptedOut,
  recordOptOutKeywordTouch,
} from '../optout'

// ---------------------------------------------------------------------------
// 1) isOptOutKeyword
// ---------------------------------------------------------------------------

describe('isOptOutKeyword', () => {
  describe('英文', () => {
    it.each([
      ['STOP', 'SMS 行业标准退订词，全大写'],
      ['stop', '小写'],
      ['unsubscribe', '完整词'],
    ])('正例：%s（%s）→ true', (text) => {
      expect(isOptOutKeyword(text)).toBe(true)
    })

    it.each([
      ["please don't stop the tour, keep going", '"stop" 出现在句子中间，不是整条退订指令'],
      ['can you stop by our hotel to pick us up?', '同上，正常问句里带 "stop"'],
      ["I'll unsubscribe from the newsletter next month", '"unsubscribe" 出现在句子中间'],
    ])('反例：%s（%s）→ false', (text) => {
      expect(isOptOutKeyword(text)).toBe(false)
    })
  })

  describe('中文', () => {
    it.each([
      ['退订', '标准退订词'],
      ['取消关注', '标准取关词'],
      ['  退订!  ', '带标点和空白，应被裁掉后仍命中'],
    ])('正例：%s（%s）→ true', (text) => {
      expect(isOptOutKeyword(text)).toBe(true)
    })

    it.each([
      ['麻烦帮我退订这个套餐可以吗', '"退订" 出现在句子中间，不是整条退订指令'],
      ['取消关注之前先看看这个活动', '"取消关注" 出现在句子中间'],
      ['我不想再联系你了', '完全不含退订关键词的另一种拒联表达'],
    ])('反例：%s（%s）→ false', (text) => {
      expect(isOptOutKeyword(text)).toBe(false)
    })
  })

  it('空字符串 / 非字符串输入 → false，不抛错', () => {
    expect(isOptOutKeyword('')).toBe(false)
    expect(isOptOutKeyword('   ')).toBe(false)
    // @ts-expect-error 故意传非法类型，验证防御性写法
    expect(isOptOutKeyword(null)).toBe(false)
  })

  describe('包着常见包装标点的独立指令（Codex 复审第 4 轮）', () => {
    it.each([
      ['(STOP)', '括号包住'],
      ['STOP:', '冒号收尾'],
      ['"STOP"', '双引号包住'],
      ['退订；', '中文分号收尾'],
      ['「退订」', '中文引号包住'],
    ])('%s（%s）→ true', (text) => {
      expect(isOptOutKeyword(text)).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// 假 supabase 数据源 —— 跟 `lib/crm/__tests__/messenger-stop-signal-io.test.ts`
// 同一个写法：按表名建模，`.eq()` 逐个收窄，最后要么 `.maybeSingle()` 取一行，
// 要么直接 `await` 取全部匹配行（真实 supabase-js 的 builder 本身就是 thenable）。
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>

function makeFakeSupabase(tables: Record<string, Row[]>): SupabaseClient {
  const from = (table: string) => {
    if (!(table in tables)) throw new Error(`fake supabase: 表 '${table}' 没建模`)
    const rows = tables[table]
    const filters: Array<(r: Row) => boolean> = []
    const matched = () => rows.filter((r) => filters.every((f) => f(r)))

    const builder: Record<string, unknown> = {}
    builder.select = () => builder
    builder.eq = (col: string, val: unknown) => {
      filters.push((r) => r[col] === val)
      return builder
    }
    builder.maybeSingle = async () => ({ data: matched()[0] ?? null, error: null })
    // 真实 supabase-js 的 filter builder 本身是 thenable —— 不调用 `.maybeSingle()`
    // 直接 `await` 就能拿到数组结果，这里的 `contact_touchpoints` 查询正是这么用的。
    ;(builder as { then: PromiseLike<unknown>['then'] }).then = (resolve, reject) =>
      Promise.resolve({ data: matched(), error: null }).then(resolve, reject)
    return builder
  }
  return { from } as unknown as SupabaseClient
}

// ---------------------------------------------------------------------------
// 2) isConversationOptedOut —— 四种路径
// ---------------------------------------------------------------------------

const CLIENT_A = 'client-a'
const CLIENT_B = 'client-b'
const CONVO = 'convo-1'
const CONTACT = 'contact-1'

describe('isConversationOptedOut', () => {
  it('路径①：有 contact_id，contacts.do_not_contact = true → true', async () => {
    const supabase = makeFakeSupabase({
      conversations: [{ id: CONVO, client_id: CLIENT_A, contact_id: CONTACT, optout_unlinked: false }],
      contacts: [{ id: CONTACT, client_id: CLIENT_A, do_not_contact: true }],
      contact_touchpoints: [],
    })
    expect(await isConversationOptedOut(CONVO, supabase)).toBe(true)
  })

  it('路径②：有 contact_id，未被标 DNC → false', async () => {
    const supabase = makeFakeSupabase({
      conversations: [{ id: CONVO, client_id: CLIENT_A, contact_id: CONTACT, optout_unlinked: false }],
      contacts: [{ id: CONTACT, client_id: CLIENT_A, do_not_contact: false }],
      contact_touchpoints: [],
    })
    expect(await isConversationOptedOut(CONVO, supabase)).toBe(false)
  })

  it('路径③：无 contact_id，命中 conversations.optout_unlinked → true', async () => {
    const supabase = makeFakeSupabase({
      conversations: [{ id: CONVO, client_id: CLIENT_A, contact_id: null, optout_unlinked: true }],
      contacts: [],
      contact_touchpoints: [],
    })
    expect(await isConversationOptedOut(CONVO, supabase)).toBe(true)
  })

  it('路径④：无 contact_id，未命中 optout_unlinked → false', async () => {
    const supabase = makeFakeSupabase({
      conversations: [{ id: CONVO, client_id: CLIENT_A, contact_id: null, optout_unlinked: false }],
      contacts: [],
      contact_touchpoints: [],
    })
    expect(await isConversationOptedOut(CONVO, supabase)).toBe(false)
  })

  it('复用 dnc.ts 的「人纠正过」判词：contacts 列还没放下，但最后一次触点是 dnc_cleared → false', async () => {
    // 证明这里真的在调用 lib/crm/dnc.ts 的 isDoNotContact()，不是自己另写了一套
    // 更简单（更容易判错）的逻辑 —— 纠正之后必须立刻生效，哪怕镜像列还没收敛。
    const supabase = makeFakeSupabase({
      conversations: [{ id: CONVO, client_id: CLIENT_A, contact_id: CONTACT, optout_unlinked: false }],
      contacts: [{ id: CONTACT, client_id: CLIENT_A, do_not_contact: true }],
      contact_touchpoints: [
        {
          contact_id: CONTACT,
          client_id: CLIENT_A,
          occurred_at: '2026-09-01T00:00:00Z',
          metadata: { outcome: 'do_not_contact', do_not_contact: true },
        },
        {
          contact_id: CONTACT,
          client_id: CLIENT_A,
          occurred_at: '2026-09-02T00:00:00Z',
          metadata: { outcome: 'dnc_cleared', do_not_contact: false },
        },
      ],
    })
    expect(await isConversationOptedOut(CONVO, supabase)).toBe(false)
  })

  // -------------------------------------------------------------------------
  // 变异测试：伪造 client_id 跨客户读退订状态 —— 4 轴红线之一。
  // -------------------------------------------------------------------------
  it('🔴 变异测试：contact_id 撞上另一个客户名下的行，必须 fail-closed 拦下，不许放行', async () => {
    // 会话属于 CLIENT_A，contact_id = CONTACT。但 `contacts` / `contact_touchpoints`
    // 里唯一能查到的 CONTACT 行挂在 CLIENT_B 名下、且被标了 DNC —— 模拟「数据被
    // 拼错 client_id」或「攻击者伪造跨客户查询」的场景。
    //
    // 实现必须同时按 `contact_id` 和「会话自己带的」`client_id` 过滤
    // （跟 `lib/crm/dnc` 路由的 IDOR 闸同一个写法），这道过滤会让按 CLIENT_A
    // 过滤的查询查不到任何行（`data: null`）。查不到不等于「没被标 DNC」——
    // 这已经是数据异常（`contact_id` 挂错了客户），必须 fail-closed 拦下，
    // 而不是把「查不到」悄悄当成「放行」（Codex 复审 2026-09-13）。
    const supabase = makeFakeSupabase({
      conversations: [{ id: CONVO, client_id: CLIENT_A, contact_id: CONTACT, optout_unlinked: false }],
      contacts: [{ id: CONTACT, client_id: CLIENT_B, do_not_contact: true }],
      contact_touchpoints: [
        {
          contact_id: CONTACT,
          client_id: CLIENT_B,
          occurred_at: '2026-09-01T00:00:00Z',
          metadata: { outcome: 'do_not_contact', do_not_contact: true },
        },
      ],
    })
    expect(await isConversationOptedOut(CONVO, supabase)).toBe(true)
  })

  it('查会话失败 → fail-closed，返回 true（宁可拦一条，不许放过一条）', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: { message: 'db 抽风' } }),
          }),
        }),
      }),
    } as unknown as SupabaseClient
    expect(await isConversationOptedOut(CONVO, supabase)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 3) recordOptOutKeywordTouch —— 字段形状必须跟 issue 给的例子完全一致
// ---------------------------------------------------------------------------

describe('recordOptOutKeywordTouch', () => {
  /**
   * `existingTouchpoints`：这个联系人「已经存在」的触点（不含本次要写的这一条）——
   * 用来模拟「写镜像列之前，先看一眼有没有更晚的人工纠正」这一步查到的数据。
   *
   * `recheckTouchpoints`（可选）：写完之后**第二次**查触点表时应该看到的数据——
   * 不传就跟第一次一样（默认没有并发变化）。传了就能模拟「两次查询之间有别的
   * 事件插了进来」这个 TOCTOU 缩窗场景（Codex 复审第 3 轮）。
   *
   * 实测：这个假数据源只实现 `optout.ts` 真正调用到的
   * `from/select/eq/upsert/update` 这几个方法名，调用形状已经在
   * `optout.integration.pg.test.ts` 里对真实 Postgres 跑过一遍确认一致，
   * 不是凭空猜的接口。
   */
  /**
   * `failUpdateOnCall`（可选，1-based）：让 `contacts.update()` 的第 N 次调用
   * 返回一个错误——用来测「回验补偿那次写入本身失败」这条路径（Codex 复审
   * 第 6 轮）：第 1 次 update 是主流程写 true，第 2 次才是回验补偿。
   *
   * 实测：下面的假数据源调用形状（`from/select/eq/upsert/update`）已经在本文件
   * 前面那些真实跑通的用例、以及 `optout.integration.pg.test.ts` 对真实
   * Postgres 跑的集成测试里反复验证过，不是凭空猜的接口。
   */
  function makeWritableFake(
    existingTouchpoints: Row[] = [],
    recheckTouchpoints?: Row[],
    failUpdateOnCall?: number,
  ) {
    const inserted: Row[] = []
    const updates: Row[] = []
    let selectCallCount = 0
    let updateCallCount = 0
    const supabase = {
      from: (table: string) => {
        if (table === 'contact_touchpoints') {
          return {
            upsert: (row: Row) => {
              inserted.push(row)
              return {
                select: () => ({
                  maybeSingle: async () => ({ data: { id: 'tp-1' }, error: null }),
                }),
              }
            },
            select: () => {
              selectCallCount += 1
              const isRecheck = selectCallCount > 1
              const rows =
                isRecheck && recheckTouchpoints !== undefined ? recheckTouchpoints : existingTouchpoints
              const builder: Record<string, unknown> = {}
              builder.eq = () => builder
              ;(builder as { then: PromiseLike<unknown>['then'] }).then = (resolve, reject) =>
                Promise.resolve({ data: rows, error: null }).then(resolve, reject)
              return builder
            },
          }
        }
        if (table === 'contacts') {
          return {
            update: (patch: Row) => {
              updateCallCount += 1
              updates.push(patch)
              const shouldFail = failUpdateOnCall === updateCallCount
              return {
                eq: () => ({
                  eq: async () => ({ error: shouldFail ? { message: 'db 抽风' } : null }),
                }),
              }
            },
          }
        }
        throw new Error(`fake supabase: 表 '${table}' 没建模`)
      },
    } as unknown as SupabaseClient
    return { supabase, inserted, updates }
  }

  it('写入的触点：outcome 在 metadata 里，不是顶层字段', async () => {
    const { supabase, inserted } = makeWritableFake()
    await recordOptOutKeywordTouch(
      {
        clientId: CLIENT_A,
        contactId: CONTACT,
        channel: 'messenger',
        conversationId: CONVO,
        messageId: 'msg-1',
        occurredAt: '2026-09-13T00:00:00Z',
      },
      supabase,
    )

    expect(inserted).toHaveLength(1)
    const row = inserted[0]
    // 顶层绝不能有 outcome —— contact_touchpoints 表根本没有这一列，
    // 照字面写会插入失败（issue #1575 已核实的落地细节）。
    expect(row.outcome).toBeUndefined()
    expect(row).toMatchObject({
      client_id: CLIENT_A,
      contact_id: CONTACT,
      channel: 'messenger',
      direction: 'inbound',
      summary: '系统自动判定：客户消息命中退订关键词',
      source: 'messenger',
      source_ref: `${CONVO}:optout:msg-1`,
      metadata: {
        outcome: 'do_not_contact',
        do_not_contact: true,
        detected_by: 'keyword',
      },
    })
  })

  it('同步放下反规范化镜像列 contacts.do_not_contact = true', async () => {
    const { supabase, updates } = makeWritableFake()
    await recordOptOutKeywordTouch(
      {
        clientId: CLIENT_A,
        contactId: CONTACT,
        channel: 'whatsapp',
        conversationId: CONVO,
        messageId: 'msg-2',
      },
      supabase,
    )
    expect(updates).toEqual([{ do_not_contact: true }])
  })

  it('🔴 变异测试：旧 webhook 重放，重放时已有更晚的人工纠正 dnc_cleared → 不许覆盖镜像列', async () => {
    // 场景：客人很早以前发过一条退订消息（这条事件本身的 occurredAt 更早），
    // 之后人已经走 /dnc 纠正路由清除过（写了一条更晚的 dnc_cleared 触点，
    // 镜像列被放回 false）。现在 Meta 的 at-least-once webhook 把那条很旧的
    // 退订消息又送达一次（同一个 sourceRef，upsert 会被 ignoreDuplicates 吃掉）。
    // 这次重放不该把镜像列重新推回 true —— 否则 /dnc 刚做完的纠正会被
    // 一条旧事件的重试悄悄推翻，且没有任何报错提示。
    const { supabase, updates } = makeWritableFake([
      {
        occurred_at: '2026-09-13T00:00:00Z',
        metadata: { outcome: 'dnc_cleared', do_not_contact: false },
      },
    ])
    await recordOptOutKeywordTouch(
      {
        clientId: CLIENT_A,
        contactId: CONTACT,
        channel: 'messenger',
        conversationId: CONVO,
        messageId: 'msg-1',
        occurredAt: '2026-09-01T00:00:00Z', // 早于上面那条 dnc_cleared
      },
      supabase,
    )
    expect(updates).toEqual([])
  })

  it('没有更晚的人工纠正时，镜像列照常放下 true（不因为新增的重放检查漏掉正常路径）', async () => {
    const { supabase, updates } = makeWritableFake([
      {
        occurred_at: '2026-08-01T00:00:00Z',
        metadata: { outcome: 'dnc_cleared', do_not_contact: false },
      },
    ])
    await recordOptOutKeywordTouch(
      {
        clientId: CLIENT_A,
        contactId: CONTACT,
        channel: 'messenger',
        conversationId: CONVO,
        messageId: 'msg-1',
        occurredAt: '2026-09-01T00:00:00Z', // 晚于那条早年的 dnc_cleared
      },
      supabase,
    )
    expect(updates).toEqual([{ do_not_contact: true }])
  })

  describe('写完之后回验（TOCTOU 缩窗，Codex 复审第 3/4 轮）', () => {
    it('写入 true 之后，回验发现两次查询之间多了一条更晚的人工纠正 → 补偿纠正回 false', async () => {
      const { supabase, updates } = makeWritableFake(
        [], // 第一次查（写入前）：什么都没有，正常判 post_sale/写 true
        [
          // 第二次查（写入后的回验）：多了一条比写入时间还晚的人工纠正。
          {
            occurred_at: '2026-09-13T00:05:00Z',
            metadata: { outcome: 'dnc_cleared', do_not_contact: false },
          },
        ],
      )
      await recordOptOutKeywordTouch(
        {
          clientId: CLIENT_A,
          contactId: CONTACT,
          channel: 'messenger',
          conversationId: CONVO,
          messageId: 'msg-1',
          occurredAt: '2026-09-13T00:00:00Z',
        },
        supabase,
      )
      // 第一次是主流程写 true，第二次是回验发现纠正后补偿写 false。
      expect(updates).toEqual([{ do_not_contact: true }, { do_not_contact: false }])
    })

    it('回验发现「先纠正、又有更新的真实退订」→ 最终判决仍是 true，不能被无脑冲成 false（Codex 复审第 4 轮反例）', async () => {
      const { supabase, updates } = makeWritableFake(
        [],
        [
          {
            occurred_at: '2026-09-13T00:05:00Z',
            metadata: { outcome: 'dnc_cleared', do_not_contact: false },
          },
          // 纠正之后又来了一条更新的真实退订判词——最终判决应该是「退订」，
          // 不是「没退订」。旧写法（只看有没有更晚的 dnc_cleared 就无条件写
          // false）会在这里判错。
          {
            occurred_at: '2026-09-13T00:10:00Z',
            metadata: { outcome: 'do_not_contact', do_not_contact: true },
          },
        ],
      )
      await recordOptOutKeywordTouch(
        {
          clientId: CLIENT_A,
          contactId: CONTACT,
          channel: 'messenger',
          conversationId: CONVO,
          messageId: 'msg-1',
          occurredAt: '2026-09-13T00:00:00Z',
        },
        supabase,
      )
      // 主流程写了一次 true；回验算出最终判决仍是 true，跟镜像列当前值一致，
      // 不需要再补一次写——只应该有主流程那一次 update。
      expect(updates).toEqual([{ do_not_contact: true }])
    })

    it('补偿写入本身失败 → 抛错，不能悄悄吞掉（Codex 复审第 6 轮）', async () => {
      // 触发补偿分支（跟第一条测试同一个场景），但让第 2 次 update（补偿那次）
      // 返回数据库错误——之前的实现会把这个 error 丢在原地继续报告成功，
      // 镜像列永久卡在 true，直接读镜像列的消费方会一直误拦一个已解除退订
      // 的联系人，而且没有任何报错信号。
      const { supabase } = makeWritableFake(
        [],
        [
          {
            occurred_at: '2026-09-13T00:05:00Z',
            metadata: { outcome: 'dnc_cleared', do_not_contact: false },
          },
        ],
        2, // 第 2 次 update（补偿那次）失败
      )
      await expect(
        recordOptOutKeywordTouch(
          {
            clientId: CLIENT_A,
            contactId: CONTACT,
            channel: 'messenger',
            conversationId: CONVO,
            messageId: 'msg-1',
            occurredAt: '2026-09-13T00:00:00Z',
          },
          supabase,
        ),
      ).rejects.toThrow('回验补偿写入')
    })
  })

  it('触点写入失败 → 抛错，不去动镜像列', async () => {
    const supabase = {
      from: (table: string) => {
        if (table === 'contact_touchpoints') {
          return {
            upsert: () => ({
              select: () => ({
                maybeSingle: async () => ({ data: null, error: { message: 'timeout' } }),
              }),
            }),
          }
        }
        return {
          update: vi.fn(() => {
            throw new Error('不该走到这里 —— 触点没写成就不该碰镜像列')
          }),
        }
      },
    } as unknown as SupabaseClient

    await expect(
      recordOptOutKeywordTouch(
        { clientId: CLIENT_A, contactId: CONTACT, channel: 'messenger', conversationId: CONVO, messageId: 'm' },
        supabase,
      ),
    ).rejects.toThrow('写退订触点失败')
  })
})
