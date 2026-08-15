import { describe, it, expect } from 'vitest'
import { mergeSyncSnapshot, runSyncStep, shouldProcessDelivery } from '../reconciliation'
import type { ComponentSyncSnapshot } from '../reconciliation'

function snapshot(overrides: Partial<ComponentSyncSnapshot> = {}): ComponentSyncSnapshot {
  return {
    componentId: 'me2-execution-kernel',
    mainSha: 'sha-1',
    issues: [],
    pullRequests: [],
    syncedAt: '2026-08-15T00:00:00Z',
    ...overrides,
  }
}

describe('mergeSyncSnapshot', () => {
  it('没有旧快照时直接采用新快照', () => {
    const next = snapshot()
    expect(mergeSyncSnapshot(null, next)).toBe(next)
  })

  it('新快照比旧的更新 —— 采用新快照', () => {
    const previous = snapshot({ syncedAt: '2026-08-15T00:00:00Z', mainSha: 'old' })
    const next = snapshot({ syncedAt: '2026-08-15T01:00:00Z', mainSha: 'new' })
    expect(mergeSyncSnapshot(previous, next)).toBe(next)
  })

  it('新快照比旧的更旧（乱序到达）—— 保留旧快照，不倒退', () => {
    const previous = snapshot({ syncedAt: '2026-08-15T02:00:00Z', mainSha: 'newer' })
    const next = snapshot({ syncedAt: '2026-08-15T01:00:00Z', mainSha: 'older' })
    expect(mergeSyncSnapshot(previous, next)).toBe(previous)
  })

  it('时间戳完全相同（同一份重复投递）—— 幂等，采用新快照且内容一致', () => {
    const same = '2026-08-15T00:00:00Z'
    const previous = snapshot({ syncedAt: same })
    const next = snapshot({ syncedAt: same })
    expect(mergeSyncSnapshot(previous, next)).toBe(next)
  })

  it('componentId 不一致时抛出，防止调用方把两个组件的快照搞混', () => {
    const previous = snapshot({ componentId: 'a' })
    const next = snapshot({ componentId: 'b' })
    expect(() => mergeSyncSnapshot(previous, next)).toThrow()
  })
})

describe('shouldProcessDelivery', () => {
  it('没见过的 delivery id 应该处理', () => {
    expect(shouldProcessDelivery('d1', new Set())).toBe(true)
  })

  it('见过的 delivery id 不应该重复处理', () => {
    expect(shouldProcessDelivery('d1', new Set(['d1']))).toBe(false)
  })
})

describe('runSyncStep', () => {
  it('成功时返回 { ok: true, snapshot }', async () => {
    const result = await runSyncStep('c1', async () => snapshot(), () => '2026-08-15T00:00:00Z')
    expect(result).toEqual({ ok: true, snapshot: snapshot() })
  })

  it('失败时返回带 reason 与 failedAt 的显式失败记录，不吞异常', async () => {
    const result = await runSyncStep(
      'c1',
      async () => {
        throw new Error('GitHub REST /repos/x 返回 500')
      },
      () => '2026-08-15T00:00:00Z',
    )
    expect(result).toEqual({
      ok: false,
      componentId: 'c1',
      reason: 'GitHub REST /repos/x 返回 500',
      failedAt: '2026-08-15T00:00:00Z',
    })
  })

  it('非 Error 异常也能转成字符串 reason', async () => {
    const result = await runSyncStep(
      'c1',
      async () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 'plain string failure'
      },
      () => '2026-08-15T00:00:00Z',
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('plain string failure')
  })
})
