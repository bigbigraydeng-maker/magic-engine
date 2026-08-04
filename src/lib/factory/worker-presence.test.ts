import { describe, it, expect } from 'vitest'
import { judgeWorkerPresence, QUEUE_STALE_HOURS } from './worker-presence'

describe('judgeWorkerPresence —— 队列里有活但没人干', () => {
  it('🔴 队列空 → 不报。工人没开机是常态，没活时报了就是噪音', () => {
    expect(
      judgeWorkerPresence({ queued: 0, oldestQueuedHours: null, lastHeartbeatHours: 500 }).idle,
    ).toBe(true)
  })

  it('有活但刚进队列 → 不报，可能工人正在跑别的单', () => {
    expect(
      judgeWorkerPresence({ queued: 2, oldestQueuedHours: 1, lastHeartbeatHours: null }).idle,
    ).toBe(true)
  })

  it('🔴 有活、等久了、也确实没人动 → 报，并说清等了多久', () => {
    const v = judgeWorkerPresence({
      queued: 3,
      oldestQueuedHours: 26,
      lastHeartbeatHours: 30,
    })
    expect(v.idle).toBe(false)
    if (!v.idle) {
      expect(v.humanReason).toContain('3 个')
      expect(v.humanReason).toContain('26 小时')
      expect(v.humanReason).toContain('30 小时')
    }
  })

  it('🔴 有活等久了，但工人还在动 → 不报。那是产能不够，不是没人干活', () => {
    // 这两件事的处置完全不同：前者是去开机，后者是加并发或减量。
    // 混成一条告警，人会去做错的事。
    expect(
      judgeWorkerPresence({ queued: 5, oldestQueuedHours: 40, lastHeartbeatHours: 0.2 }).idle,
    ).toBe(true)
  })

  it('从来没有工人连上来过 → 说清是「从来没有」，不是「停了」', () => {
    const v = judgeWorkerPresence({
      queued: 1,
      oldestQueuedHours: QUEUE_STALE_HOURS + 1,
      lastHeartbeatHours: null,
    })
    expect(v.idle).toBe(false)
    if (!v.idle) expect(v.humanReason).toContain('从来没有')
  })

  it('刚好卡在门槛上不报 —— 边界宁可漏一次，不要天天嚷', () => {
    expect(
      judgeWorkerPresence({
        queued: 1,
        oldestQueuedHours: QUEUE_STALE_HOURS,
        lastHeartbeatHours: null,
      }).idle,
    ).toBe(false)
    expect(
      judgeWorkerPresence({
        queued: 1,
        oldestQueuedHours: QUEUE_STALE_HOURS - 0.1,
        lastHeartbeatHours: null,
      }).idle,
    ).toBe(true)
  })
})
