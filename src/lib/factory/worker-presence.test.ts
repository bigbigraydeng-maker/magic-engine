import { describe, it, expect } from 'vitest'
import {
  judgeWorkerPresence,
  judgeQueueByClient,
  QUEUE_STALE_HOURS,
  WORKER_OFFLINE_HOURS,
  latestAliveAt,
  type QueueSnapshot,
} from './worker-presence'

/** 默认：队列里的活都是等人干的新活（没有失败原因）。 */
function snap(over: Partial<QueueSnapshot> = {}): QueueSnapshot {
  return {
    queued: 0,
    oldestQueuedHours: null,
    lastHeartbeatHours: null,
    queuedStuckOnFailure: 0,
    stuckSampleReason: null,
    ...over,
  }
}

describe('judgeWorkerPresence —— 队列里有活但没人干', () => {
  it('🔴 队列空 → 不报。工人没开机是常态，没活时报了就是噪音', () => {
    expect(judgeWorkerPresence(snap({ queued: 0, lastHeartbeatHours: 500 })).idle).toBe(true)
  })

  it('有活但刚进队列（不到 30 分钟）→ 不报，可能工人正在跑别的单', () => {
    expect(judgeWorkerPresence(snap({ queued: 2, oldestQueuedHours: 0.2 })).idle).toBe(true)
  })

  it('🔴 有活、等久了、也确实没人动 → 报，并说清等了多久', () => {
    const v = judgeWorkerPresence(
      snap({ queued: 3, oldestQueuedHours: 26, lastHeartbeatHours: 30 }),
    )
    expect(v.idle).toBe(false)
    if (!v.idle) {
      expect(v.kind).toBe('worker_offline')
      expect(v.humanReason).toContain('3 个')
      expect(v.humanReason).toContain('26 小时')
      expect(v.humanReason).toContain('30 小时')
    }
  })

  it('🔴 有活等久了，但工人还在动 → 不报。那是产能不够，不是没人干活', () => {
    // 这两件事的处置完全不同：前者是去开机，后者是加并发或减量。
    // 混成一条告警，人会去做错的事。
    expect(
      judgeWorkerPresence(snap({ queued: 5, oldestQueuedHours: 40, lastHeartbeatHours: 0.2 })).idle,
    ).toBe(true)
  })

  it('从来没有工人连上来过 → 说清是「从来没有」，不是「停了」', () => {
    const v = judgeWorkerPresence(snap({ queued: 1, oldestQueuedHours: QUEUE_STALE_HOURS + 1 }))
    expect(v.idle).toBe(false)
    if (!v.idle) expect(v.humanReason).toContain('从来没有')
  })

  it('刚好卡在门槛上不报 —— 边界宁可漏一次，不要天天嚷', () => {
    expect(
      judgeWorkerPresence(snap({ queued: 1, oldestQueuedHours: WORKER_OFFLINE_HOURS })).idle,
    ).toBe(false)
    expect(
      judgeWorkerPresence(snap({ queued: 1, oldestQueuedHours: WORKER_OFFLINE_HOURS - 0.1 })).idle,
    ).toBe(true)
  })

  it('🔴 离线 30 分钟 + 队列有活 → 报，话术用分钟（不用等 6 小时）', () => {
    const v = judgeWorkerPresence(snap({ queued: 1, oldestQueuedHours: 0.8, lastHeartbeatHours: 0.6 }))
    expect(v.idle).toBe(false)
    if (!v.idle) {
      expect(v.kind).toBe('worker_offline')
      expect(v.humanReason).toContain('48 分钟')
      expect(v.humanReason).toContain('36 分钟没有工人动过')
    }
  })

  it('🔴 活着但没领到单（4 分钟前刚报过存活，排了 2 小时）→ 不报', () => {
    expect(
      judgeWorkerPresence(snap({ queued: 1, oldestQueuedHours: 2, lastHeartbeatHours: 0.07 })).idle,
    ).toBe(true)
  })
})

/**
 * 🔴 误诊防线（2026-09-08 生产实测 + Codex P1 复审两轮）。
 *
 * 第一轮修的是：Oztop 一条 8-03 的工单因 `Insufficient credit balance` 失败后退回
 * 队列，一躺 36 天（`attempt_count=1`，失败后就没再被碰过）。恰好赶上工人离线，被
 * 判成「工人没开机」，待办让 PM 去开机跑 CLI —— 他就算开机跑了也没用。
 *
 * 第二轮把优先级改回来了，因为第一版矫枉过正：带 `reject_reason` 的 queued 工单
 * **不等于「没救了」**。`fail` 路由把可重试失败原样退回 queued 并留下原因，而
 * `max_attempts` 默认是 2，所以队列里带原因的工单通常**只失败过一次、还有一次机会**；
 * 真正没救的进 `dead_letter`，压根不在 queued 里。
 *
 * 于是「有原因就判卡住 + 劝阻开机」会造成死结：网络抖动失败一次后，只要工人恰好
 * 离线，重试就永远不会发生。**开机是离线状态下无条件正确的第一步**，所以它优先；
 * 失败原因作为附加信息一起带上，不丢。
 */
describe('judgeWorkerPresence —— 🔴 「没人干活」优先于「失败后卡住」', () => {
  it('🔴 工人离线 + 排队的全失败过（Oztop 真实场景）→ 报 worker_offline，但把失败原因带上', () => {
    const v = judgeWorkerPresence(
      snap({
        queued: 1,
        oldestQueuedHours: 36 * 24,
        lastHeartbeatHours: 8 * 24,
        queuedStuckOnFailure: 1,
        stuckSampleReason: 'muapi submit: Insufficient credit balance',
      }),
    )
    expect(v.idle).toBe(false)
    if (!v.idle) {
      // 开机是离线时无条件正确的第一步 —— 绝不能因为「失败过」就劝阻它，
      // 那会让本该有效的重试永远跑不了。
      expect(v.kind).toBe('worker_offline')
      // 但失败原因不能丢：开机后还是过不去时，那就是下一步。
      expect(v.sampleReason).toContain('Insufficient credit balance')
    }
  })

  it('🔴 工人在线 + 排队的全失败过 → 这才是 stuck_on_failure（旧逻辑这里静默判 idle，属于漏报）', () => {
    const v = judgeWorkerPresence(
      snap({
        queued: 2,
        oldestQueuedHours: 50,
        lastHeartbeatHours: 0.1, // 工人刚刚还在动
        queuedStuckOnFailure: 2,
        stuckSampleReason: 'complete 422: scene_tag not in whitelist',
      }),
    )
    expect(v.idle).toBe(false)
    if (!v.idle) {
      expect(v.kind).toBe('stuck_on_failure')
      expect(v.humanReason).toContain('工人在线')
      expect(v.sampleReason).toContain('scene_tag')
    }
  })

  it('🔴 工人在线 + 还有没失败过的新活在等 → 不报（那是产能问题）', () => {
    expect(
      judgeWorkerPresence(
        snap({
          queued: 3,
          oldestQueuedHours: 40,
          lastHeartbeatHours: 0.2,
          queuedStuckOnFailure: 1,
          stuckSampleReason: 'muapi submit: Insufficient credit balance',
        }),
      ).idle,
    ).toBe(true)
  })

  it('工人离线 + 只有一部分失败过 → 报 worker_offline，照样把原因带上', () => {
    const v = judgeWorkerPresence(
      snap({
        queued: 3,
        oldestQueuedHours: 40,
        lastHeartbeatHours: 30,
        queuedStuckOnFailure: 1,
        stuckSampleReason: 'muapi submit: Insufficient credit balance',
      }),
    )
    expect(v.idle).toBe(false)
    if (!v.idle) expect(v.kind).toBe('worker_offline')
  })

  it('工人离线 + 一个都没失败过 → worker_offline 且不带 sampleReason（没有就不硬编一句）', () => {
    const v = judgeWorkerPresence(
      snap({ queued: 2, oldestQueuedHours: 40, lastHeartbeatHours: 30, queuedStuckOnFailure: 0 }),
    )
    expect(v.idle).toBe(false)
    if (!v.idle) {
      expect(v.kind).toBe('worker_offline')
      expect(v.sampleReason).toBeUndefined()
    }
  })

  it('工人在线 + 失败工单还没等够 6 小时 → 不报（跟新活同一个门槛，不给失败单开小灶）', () => {
    expect(
      judgeWorkerPresence(
        snap({
          queued: 1,
          oldestQueuedHours: QUEUE_STALE_HOURS - 0.1,
          lastHeartbeatHours: 0.1,
          queuedStuckOnFailure: 1,
          stuckSampleReason: 'muapi submit: Insufficient credit balance',
        }),
      ).idle,
    ).toBe(true)
  })

  it('工人在线、拿不到失败原因原文 → stuck_on_failure 但不硬编一句', () => {
    const v = judgeWorkerPresence(
      snap({
        queued: 1,
        oldestQueuedHours: 100,
        lastHeartbeatHours: 0.1,
        queuedStuckOnFailure: 1,
        stuckSampleReason: null,
      }),
    )
    expect(v.idle).toBe(false)
    if (!v.idle) {
      expect(v.kind).toBe('stuck_on_failure')
      expect(v.sampleReason).toBeUndefined()
    }
  })
})

/**
 * 🔴 跨客户串台防线（Codex P1 复审 PR #1485）。
 *
 * worker 可以按 client_id 限定认领范围，所以不同客户可能由不同 worker 实例服务。
 * 拿「所有工单里最新的心跳」当「工人在线」，会让 CTS 的 worker 心跳把 Oztop 的
 * 离线状态盖掉 —— 判定说「工人在线、开机没用」，而真正需要开机的那台继续躺着。
 */
describe('judgeQueueByClient —— 🔴 心跳按客户算，不跨客户串台', () => {
  const NOW = new Date('2026-09-08T12:00:00Z')
  const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()

  it('🔴 CTS worker 在线 + Oztop worker 离线 → Oztop 报 worker_offline，不被 CTS 的心跳盖掉', () => {
    const out = judgeQueueByClient(
      [{ client_id: 'oztop', created_at: hoursAgo(40), reject_reason: 'muapi: Insufficient credit' }],
      // 全局最新心跳是 CTS 的（6 分钟前），但 Oztop 自己一条心跳都没有
      new Map([['cts', hoursAgo(0.1)]]),
      NOW,
    )
    expect(out).toHaveLength(1)
    expect(out[0].clientId).toBe('oztop')
    // 关键：不能因为「有个 worker 在线」就说 Oztop 不用开机
    expect(out[0].verdict.kind).toBe('worker_offline')
  })

  it('同一个客户自己的 worker 在线、活又都失败过 → 才是 stuck_on_failure', () => {
    const out = judgeQueueByClient(
      [{ client_id: 'oztop', created_at: hoursAgo(40), reject_reason: 'muapi: Insufficient credit' }],
      new Map([['oztop', hoursAgo(0.1)]]),
      NOW,
    )
    expect(out[0].verdict.kind).toBe('stuck_on_failure')
  })

  it('两个客户各判各的，互不影响', () => {
    const out = judgeQueueByClient(
      [
        { client_id: 'cts', created_at: hoursAgo(40), reject_reason: 'boom' },
        { client_id: 'oztop', created_at: hoursAgo(40), reject_reason: null },
      ],
      new Map([['cts', hoursAgo(0.1)]]), // CTS 在线，Oztop 没心跳
      NOW,
    )
    const byClient = new Map(out.map((o) => [o.clientId, o.verdict.kind]))
    expect(byClient.get('cts')).toBe('stuck_on_failure')
    expect(byClient.get('oztop')).toBe('worker_offline')
  })

  it('入参没排序也能取到最老那单（不假设调用方排过序）', () => {
    const out = judgeQueueByClient(
      [
        { client_id: 'a', created_at: hoursAgo(1), reject_reason: null },
        { client_id: 'a', created_at: hoursAgo(50), reject_reason: null },
      ],
      new Map(),
      NOW,
    )
    expect(out).toHaveLength(1)
    if (!out[0].verdict.idle) expect(out[0].verdict.humanReason).toContain('50 小时')
  })

  it('没到门槛的客户不进结果', () => {
    expect(
      judgeQueueByClient(
        [{ client_id: 'a', created_at: hoursAgo(0.2), reject_reason: null }],
        new Map(),
        NOW,
      ),
    ).toHaveLength(0)
  })
})

describe('latestAliveAt —— 存活信号只算给它声明能领的客户', () => {
  const ping = (started_at: string, client_ids: string[]) => ({ started_at, summary: { client_ids } })
  it('干活心跳和存活信号取最新；没声明的客户不被担保', () => {
    const pings = [ping('2026-09-08T10:00:00Z', ['a']), ping('2026-09-08T09:00:00Z', ['a', 'B'])]
    expect(latestAliveAt('2026-09-08T08:00:00Z', pings, 'a')).toBe('2026-09-08T10:00:00Z')
    expect(latestAliveAt('2026-09-08T08:00:00Z', pings, 'b')).toBe('2026-09-08T09:00:00Z')
    expect(latestAliveAt(undefined, pings, 'c')).toBeUndefined()
  })
})
