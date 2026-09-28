/**
 * `notifyAutonomyModeChanged` / `reconcileAutonomyMode` 的 `idSuffix` 选项
 * （Codex P1 复审 round 11）：绕开 Inngest 按 `(client_id, updated_at)` 的
 * 24h 事件去重，用于"明确要求重新尝试，不管上次内容是否已经处理过"的
 * 补救场景。不重跑 `adsAutonomySyncEventId` 本身的格式（那是纯函数，另有
 * 各调用方的测试覆盖）。
 */
import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { notifyAutonomyModeChanged, reconcileAutonomyMode } from '../notify'
import { adsAutonomySyncEventId } from '@/lib/inngest/ads-events'

const CLIENT = 'client-uuid-notify-test'
const UPDATED_AT = '2026-09-28T00:00:00.000Z'

/** 捕获实际发出的事件 id，不靠内省 `.mock.calls` 的元组类型（那个泛型签名不好精确 mock）。 */
function capturingSend() {
  const ids: string[] = []
  const send = vi.fn(async (event: { id: string }) => {
    ids.push(event.id)
    return { event_ids: ['x'] }
  })
  return { send, ids }
}

describe('notifyAutonomyModeChanged — idSuffix', () => {
  it('不给 idSuffix → 事件 id 就是默认的幂等 id', async () => {
    const { send, ids } = capturingSend()
    await notifyAutonomyModeChanged(CLIENT, UPDATED_AT, { send })
    expect(send).toHaveBeenCalledTimes(1)
    expect(ids[0]).toBe(adsAutonomySyncEventId(CLIENT, UPDATED_AT))
  })

  it('🔴 给了 idSuffix → 事件 id 追加后缀，绕开默认幂等 id 的去重', async () => {
    const { send, ids } = capturingSend()
    await notifyAutonomyModeChanged(CLIENT, UPDATED_AT, { send, idSuffix: 'retry-123' })
    expect(ids[0]).toBe(`${adsAutonomySyncEventId(CLIENT, UPDATED_AT)}:retry-123`)
  })

  it('两次不同的 idSuffix → 两个不同的事件 id，各自都发得出去（不会被同一个 id 挡住）', async () => {
    const { send, ids } = capturingSend()
    await notifyAutonomyModeChanged(CLIENT, UPDATED_AT, { send, idSuffix: 'retry-1' })
    await notifyAutonomyModeChanged(CLIENT, UPDATED_AT, { send, idSuffix: 'retry-2' })
    expect(new Set(ids).size).toBe(2)
  })
})

describe('reconcileAutonomyMode — idSuffix 透传', () => {
  function fakeSupabase(updatedAt: string) {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: { updated_at: updatedAt }, error: null }),
    }
    return { from: () => chain } as unknown as SupabaseClient
  }

  it('idSuffix 原样透传给 notifyAutonomyModeChanged', async () => {
    const { send, ids } = capturingSend()
    const sb = fakeSupabase(UPDATED_AT)
    await reconcileAutonomyMode(sb, CLIENT, { send, idSuffix: 'release-retry-999' })
    expect(ids[0]).toBe(`${adsAutonomySyncEventId(CLIENT, UPDATED_AT)}:release-retry-999`)
  })
})
