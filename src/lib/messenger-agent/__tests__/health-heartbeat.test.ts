/**
 * F4 conversation.health.heartbeat（issue #1587）单测。
 *
 * 分两块：
 *   1. 纯函数边界值——`isColdStart`/`computeRollingAverage`/`isWebhookVolumeAlert`，
 *      不碰数据库。
 *   2. `runConversationHealthChecks` 集成测试——假 supabase 按真实表结构建模
 *      （`conversation_messages`/`conversations`/`conversation_reply_drafts`/
 *      `conversation_optout_write_failures`），写法跟
 *      `src/lib/knowledge/__tests__/fake-write-supabase.ts`/
 *      `src/lib/messenger-agent/__tests__/optout.test.ts` 同一约定：按表名建模，
 *      `.eq()`/`.gte()`/`.in()` 逐个收窄，未建模的表直接抛错（typo 不会被悄悄
 *      当成「这张表是空的」）。假客户端只实现 `runConversationHealthChecks`
 *      真实调用过的方法（select/eq/gte/in/order/range），跟生产代码
 *      `health-heartbeat.ts` 逐行对照过——多一个方法没实现就会在 `npx vitest run`
 *      跑这个文件时直接报错，而不是安静地返回空数据。
 */
import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  isColdStart,
  computeRollingAverage,
  isWebhookVolumeAlert,
  runConversationHealthChecks,
  VERIFIER_BLOCK_RATE_ALERT_THRESHOLD,
  VERIFIER_ERROR_COUNT_ALERT_THRESHOLD,
  type HealthCheckResult,
} from '../health-heartbeat'

// ---------------------------------------------------------------------------
// 1) 纯函数
// ---------------------------------------------------------------------------

describe('isColdStart', () => {
  const now = new Date('2026-09-15T00:00:00.000Z')

  it('13 天前上线 → 还在冷启动观察期 → true', () => {
    const firstSeenAt = new Date(now.getTime() - 13 * 86_400_000)
    expect(isColdStart(firstSeenAt, now)).toBe(true)
  })

  it('恰好 14 天前上线 → 冷启动期结束 → false', () => {
    const firstSeenAt = new Date(now.getTime() - 14 * 86_400_000)
    expect(isColdStart(firstSeenAt, now)).toBe(false)
  })

  it('15 天前上线 → false', () => {
    const firstSeenAt = new Date(now.getTime() - 15 * 86_400_000)
    expect(isColdStart(firstSeenAt, now)).toBe(false)
  })
})

describe('computeRollingAverage', () => {
  it('windowDays <= 0 → 0（防除零/负数）', () => {
    expect(computeRollingAverage(100, 0)).toBe(0)
    expect(computeRollingAverage(100, -5)).toBe(0)
  })

  it('正常情况 → 总数除以天数', () => {
    expect(computeRollingAverage(29, 29)).toBe(1)
    expect(computeRollingAverage(58, 29)).toBe(2)
    expect(computeRollingAverage(5, 29)).toBeCloseTo(5 / 29)
  })
})

describe('isWebhookVolumeAlert', () => {
  it('冷启动期间恒为 false，不管 current 跟 avg 差多少', () => {
    expect(isWebhookVolumeAlert(0, 100, true)).toBe(false)
    expect(isWebhookVolumeAlert(1000, 1, true)).toBe(false)
  })

  it('非冷启动 + current < avg → true', () => {
    expect(isWebhookVolumeAlert(1, 5, false)).toBe(true)
  })

  it('非冷启动 + current >= avg → false', () => {
    expect(isWebhookVolumeAlert(5, 5, false)).toBe(false)
    expect(isWebhookVolumeAlert(6, 5, false)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 2) runConversationHealthChecks —— 假 supabase 集成测试
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>

/** 贴合本次用到的这几张表；未建模的表直接抛错。 */
function makeFakeSupabase(tables: Record<string, Row[]>): SupabaseClient {
  const from = (table: string) => {
    if (!(table in tables)) throw new Error(`fake supabase: 表 '${table}' 没建模`)
    const rows = tables[table]

    const eqFilters: Array<[string, unknown]> = []
    const gteFilters: Array<[string, unknown]> = []
    const ltFilters: Array<[string, unknown]> = []
    const inFilters: Array<[string, readonly unknown[]]> = []
    let orderCol: string | null = null
    let orderAsc = true

    const matched = (): Row[] => {
      let out = rows.filter(
        (r) =>
          eqFilters.every(([c, v]) => r[c] === v) &&
          gteFilters.every(([c, v]) => String(r[c]) >= String(v)) &&
          ltFilters.every(([c, v]) => String(r[c]) < String(v)) &&
          inFilters.every(([c, vals]) => new Set(vals).has(r[c])),
      )
      if (orderCol) {
        const col = orderCol
        const dir = orderAsc ? 1 : -1
        out = [...out].sort((a, b) => {
          const av = String(a[col])
          const bv = String(b[col])
          if (av === bv) return 0
          return av < bv ? -dir : dir
        })
      }
      return out
    }

    const builder: Record<string, unknown> = {}
    builder.select = () => builder
    builder.eq = (col: string, val: unknown) => {
      eqFilters.push([col, val])
      return builder
    }
    builder.gte = (col: string, val: unknown) => {
      gteFilters.push([col, val])
      return builder
    }
    builder.lt = (col: string, val: unknown) => {
      ltFilters.push([col, val])
      return builder
    }
    builder.in = (col: string, vals: readonly unknown[]) => {
      inFilters.push([col, vals])
      return builder
    }
    builder.order = (col: string, opts?: { ascending?: boolean }) => {
      orderCol = col
      orderAsc = opts?.ascending !== false
      return builder
    }
    // fetchAll 只用 .range() 分页——每次调用都重新算一遍 matched()，跟真实
    // supabase-js 的行为一致（filter 是在 range 求值那一刻才真正执行）。
    builder.range = (from: number, to: number) =>
      Promise.resolve({ data: matched().slice(from, to + 1), error: null })

    return builder
  }
  // 跟 `optout.test.ts`/`fake-write-supabase.ts` 同一个已跑绿的写法：只实现
  // `runConversationHealthChecks` 真实调用过的方法，`SupabaseClient` 剩下的
  // 表面积本函数根本不会碰，运行时不会缺方法——下面每个 it() 就是这句话的
  // 实测（跑 `npx vitest run` 全部通过即证明这份最小建模足够）。
  return { from } as unknown as SupabaseClient
}

const CLIENT_A = 'client-a'
const CLIENT_B = 'client-b'

function isoDaysAgo(now: Date, days: number, extraHours = 0): string {
  return new Date(now.getTime() - days * 86_400_000 - extraHours * 3_600_000).toISOString()
}

function isoHoursAgo(now: Date, hours: number): string {
  return new Date(now.getTime() - hours * 3_600_000).toISOString()
}

function findResult(
  results: HealthCheckResult[],
  clientId: string,
  channel: string,
  checkType: HealthCheckResult['checkType'],
): HealthCheckResult | undefined {
  return results.find((r) => r.clientId === clientId && r.channel === channel && r.checkType === checkType)
}

describe('runConversationHealthChecks', () => {
  const NOW = new Date('2026-09-15T12:00:00.000Z')

  /**
   * 两个健康的 (client, channel) 组合的消息基线——两边都非冷启动
   * （最早一条 20 天前）、过去 24 小时的量（1 条）不低于过去 29 天的
   * rolling avg（5/29 ≈ 0.17），所以 webhook_silent 两边默认健康。
   */
  function baselineMessages(clientId: string, conversationId: string) {
    return [
      { conversation_id: conversationId, sent_at: isoDaysAgo(NOW, 20), direction: 'inbound' },
      { conversation_id: conversationId, sent_at: isoDaysAgo(NOW, 18), direction: 'inbound' },
      { conversation_id: conversationId, sent_at: isoDaysAgo(NOW, 15), direction: 'inbound' },
      { conversation_id: conversationId, sent_at: isoDaysAgo(NOW, 10), direction: 'inbound' },
      { conversation_id: conversationId, sent_at: isoDaysAgo(NOW, 5), direction: 'inbound' },
      { conversation_id: conversationId, sent_at: isoHoursAgo(NOW, 2), direction: 'inbound' },
    ].map((m) => ({ ...m, client_id: clientId }))
  }

  it('①opt-out 写入失败：故意让 conversation_optout_write_failures 里有一条 24 小时内的记录 → optout_write_failed 必须是 healthy:false（不能被吞掉）', async () => {
    const supabase = makeFakeSupabase({
      conversation_messages: [
        ...baselineMessages(CLIENT_A, 'conv-a1'),
        ...baselineMessages(CLIENT_B, 'conv-b1'),
      ],
      conversations: [
        { id: 'conv-a1', client_id: CLIENT_A, channel: 'whatsapp' },
        { id: 'conv-b1', client_id: CLIENT_B, channel: 'messenger' },
      ],
      conversation_reply_drafts: [],
      conversation_optout_write_failures: [
        {
          client_id: CLIENT_A,
          channel: 'whatsapp',
          occurred_at: isoHoursAgo(NOW, 1),
        },
      ],
      conversation_health_alerts: [],
    })

    const results = await runConversationHealthChecks(supabase, NOW)

    const aOptOut = findResult(results, CLIENT_A, 'whatsapp', 'optout_write_failed')
    expect(aOptOut?.healthy).toBe(false)
    expect(aOptOut?.detail).toContain('1')

    // 没有踩坑的组合必须仍然健康——不能把不该报的也报了。
    const bOptOut = findResult(results, CLIENT_B, 'messenger', 'optout_write_failed')
    expect(bOptOut?.healthy).toBe(true)
  })

  it('②verifier 出错：往 conversation_reply_drafts 塞 3 条 24 小时内 verifier_status=error → verifier_error_rate_high 是 healthy:false，其它组合/其它 check_type 该健康的还是 healthy:true', async () => {
    const supabase = makeFakeSupabase({
      conversation_messages: [
        ...baselineMessages(CLIENT_A, 'conv-a1'),
        ...baselineMessages(CLIENT_B, 'conv-b1'),
      ],
      conversations: [
        { id: 'conv-a1', client_id: CLIENT_A, channel: 'whatsapp' },
        { id: 'conv-b1', client_id: CLIENT_B, channel: 'messenger' },
      ],
      conversation_reply_drafts: [
        { client_id: CLIENT_A, channel: 'whatsapp', verifier_status: 'error', created_at: isoHoursAgo(NOW, 1) },
        { client_id: CLIENT_A, channel: 'whatsapp', verifier_status: 'error', created_at: isoHoursAgo(NOW, 2) },
        { client_id: CLIENT_A, channel: 'whatsapp', verifier_status: 'error', created_at: isoHoursAgo(NOW, 3) },
      ],
      conversation_optout_write_failures: [],
      conversation_health_alerts: [],
    })

    const results = await runConversationHealthChecks(supabase, NOW)
    expect(results).toHaveLength(8) // 2 组合 × 4 种 check_type

    const aErrorRate = findResult(results, CLIENT_A, 'whatsapp', 'verifier_error_rate_high')
    expect(aErrorRate?.healthy).toBe(false)
    expect(aErrorRate?.detail).toContain(String(VERIFIER_ERROR_COUNT_ALERT_THRESHOLD))

    // 同一组合里没被这批数据影响的 check_type：3 条全是 error，没有 blocked，
    // 拦截率是 0，不该被误判成告警。
    const aBlockRate = findResult(results, CLIENT_A, 'whatsapp', 'verifier_block_rate_high')
    expect(aBlockRate?.healthy).toBe(true)
    const aWebhook = findResult(results, CLIENT_A, 'whatsapp', 'webhook_silent')
    expect(aWebhook?.healthy).toBe(true)
    const aOptOut = findResult(results, CLIENT_A, 'whatsapp', 'optout_write_failed')
    expect(aOptOut?.healthy).toBe(true)

    // 另一个组合完全没沾这批坑数据，四项都该健康。
    for (const checkType of [
      'webhook_silent',
      'verifier_block_rate_high',
      'verifier_error_rate_high',
      'optout_write_failed',
    ] as const) {
      expect(findResult(results, CLIENT_B, 'messenger', checkType)?.healthy).toBe(true)
    }
  })

  it('verifier 拦截率刚好等于阈值（80%）→ 不算超标（阈值是「严格大于」）', async () => {
    const supabase = makeFakeSupabase({
      conversation_messages: baselineMessages(CLIENT_A, 'conv-a1'),
      conversations: [{ id: 'conv-a1', client_id: CLIENT_A, channel: 'whatsapp' }],
      conversation_reply_drafts: [
        { client_id: CLIENT_A, channel: 'whatsapp', verifier_status: 'blocked', created_at: isoHoursAgo(NOW, 1) },
        { client_id: CLIENT_A, channel: 'whatsapp', verifier_status: 'blocked', created_at: isoHoursAgo(NOW, 2) },
        { client_id: CLIENT_A, channel: 'whatsapp', verifier_status: 'blocked', created_at: isoHoursAgo(NOW, 3) },
        { client_id: CLIENT_A, channel: 'whatsapp', verifier_status: 'blocked', created_at: isoHoursAgo(NOW, 4) },
        { client_id: CLIENT_A, channel: 'whatsapp', verifier_status: 'approved', created_at: isoHoursAgo(NOW, 5) },
      ],
      conversation_optout_write_failures: [],
      conversation_health_alerts: [],
    })

    const results = await runConversationHealthChecks(supabase, NOW)
    const blockRate = findResult(results, CLIENT_A, 'whatsapp', 'verifier_block_rate_high')
    // 4/5 = 80%（恰好等于 VERIFIER_BLOCK_RATE_ALERT_THRESHOLD），阈值判据是
    // 「> 80%」，不是「>= 80%」——所以这里必须仍然健康。
    expect(VERIFIER_BLOCK_RATE_ALERT_THRESHOLD).toBe(0.8)
    expect(blockRate?.healthy).toBe(true)
  })

  it('冷启动（上线不到 14 天）→ webhook_silent 恒健康，即使当天消息量远低于稀薄的历史均值', async () => {
    const supabase = makeFakeSupabase({
      conversation_messages: [
        { client_id: CLIENT_A, conversation_id: 'conv-a1', sent_at: isoDaysAgo(NOW, 5), direction: 'inbound' },
        { client_id: CLIENT_A, conversation_id: 'conv-a1', sent_at: isoDaysAgo(NOW, 4), direction: 'inbound' },
        { client_id: CLIENT_A, conversation_id: 'conv-a1', sent_at: isoDaysAgo(NOW, 3), direction: 'inbound' },
        // 过去 24 小时一条都没有——非冷启动的话这就该报警，但这个组合 5 天前
        // 才第一次出现，还在 14 天观察期内。
      ],
      conversations: [{ id: 'conv-a1', client_id: CLIENT_A, channel: 'whatsapp' }],
      conversation_reply_drafts: [],
      conversation_optout_write_failures: [],
      conversation_health_alerts: [],
    })

    const results = await runConversationHealthChecks(supabase, NOW)
    const webhook = findResult(results, CLIENT_A, 'whatsapp', 'webhook_silent')
    expect(webhook?.healthy).toBe(true)
  })

  it('魏征复审修复①：老客户历史断档超30天、近14天才复苏 → 不能被误判成冷启动，静默要能测出来', async () => {
    const supabase = makeFakeSupabase({
      conversation_messages: [
        // 真实第一次接入是 40 天前——早于 30 天窗口，窗口内看不到这条。
        { client_id: CLIENT_A, conversation_id: 'conv-a1', sent_at: isoDaysAgo(NOW, 40), direction: 'inbound' },
        // 40 天前之后完全断档，直到 10 天前才复苏——窗口内能看到的最早一条是
        // 10 天前，如果只看窗口内数据会被错判成「10天前才第一次接入，还在冷启动」。
        { client_id: CLIENT_A, conversation_id: 'conv-a1', sent_at: isoDaysAgo(NOW, 10), direction: 'inbound' },
        // 复苏后 10 天里只发了这一条，过去 24 小时一条都没有——这才是真实故障，
        // 应该被测出来，不能被冷启动逃过一劫。
      ],
      conversations: [{ id: 'conv-a1', client_id: CLIENT_A, channel: 'whatsapp' }],
      conversation_reply_drafts: [],
      conversation_optout_write_failures: [],
      conversation_health_alerts: [],
    })

    const results = await runConversationHealthChecks(supabase, NOW)
    const webhook = findResult(results, CLIENT_A, 'whatsapp', 'webhook_silent')
    // 不是冷启动（40天前的历史证明了这一点），过去24小时0条 < rolling avg，必须告警。
    expect(webhook?.healthy).toBe(false)
  })

  it('魏征复审修复②：组合彻底静默超30天、之前已经在报警 → 旧告警不能变成永久孤儿', async () => {
    const supabase = makeFakeSupabase({
      // 这个组合过去30天完全没有消息——不会出现在 combos 里。
      conversation_messages: [],
      conversations: [],
      conversation_reply_drafts: [],
      conversation_optout_write_failures: [],
      // 但 conversation_health_alerts 里有它之前留下的告警（假设是上一轮心跳
      // 发现「消息量骤降」时写入的）——包括一条 webhook_silent 和一条已经自愈
      // 该被清掉的 verifier_error_rate_high（因为这一轮没有新草稿，谈不上出错）。
      conversation_health_alerts: [
        { client_id: CLIENT_A, channel: 'whatsapp', check_type: 'webhook_silent' },
        { client_id: CLIENT_A, channel: 'whatsapp', check_type: 'verifier_error_rate_high' },
      ],
    })

    const results = await runConversationHealthChecks(supabase, NOW)
    // webhook_silent 必须继续保持不健康——持续静默不能算恢复，不能从结果里
    // 彻底消失（消失 = sync-alerts 那一步永远不会去 delete/upsert 这一行，
    // 变成挂在 pm-daily-todo 上的永久孤儿）。
    const webhook = findResult(results, CLIENT_A, 'whatsapp', 'webhook_silent')
    expect(webhook?.healthy).toBe(false)
    // 另外三类检查这一轮该被自愈清掉——没有新消息就不可能有新草稿/新退订失败。
    const errorRate = findResult(results, CLIENT_A, 'whatsapp', 'verifier_error_rate_high')
    expect(errorRate?.healthy).toBe(true)
    const blockRate = findResult(results, CLIENT_A, 'whatsapp', 'verifier_block_rate_high')
    expect(blockRate?.healthy).toBe(true)
    const optOut = findResult(results, CLIENT_A, 'whatsapp', 'optout_write_failed')
    expect(optOut?.healthy).toBe(true)
  })

  it('没有任何组合在过去 30 天有过入站消息 → 返回空数组，不抛错', async () => {
    const supabase = makeFakeSupabase({
      conversation_messages: [],
      conversations: [],
      conversation_reply_drafts: [],
      conversation_optout_write_failures: [],
      conversation_health_alerts: [],
    })
    const results = await runConversationHealthChecks(supabase, NOW)
    expect(results).toEqual([])
  })
})
