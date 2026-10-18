/**
 * A0 只读熔断探针的测试。
 *
 * 第一组是本文件最要紧的：**机械地钉住「这个模块没有写入路径」**。
 * 两轮四次复审否掉「直接接上写入」的理由之一，是「默认关的开关」靠的是承诺
 * （哪天有人打开就生效）。A0 的强处在于**代码里压根没有写入那一行** ——
 * 所以这件事必须由一条扫源码的测试守着，不能由注释声明。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { probeClientCircuit, CANDIDATE_ABSOLUTE_CAP_MULTIPLES } from '../circuit-probe'

const PROBE_FILE = join(process.cwd(), 'src/lib/ads-strategy/circuit-probe.ts')

/** 一次断言、集中一处 —— 同 `src/lib/pm-todo/__tests__/ads-account-status-items.test.ts` 的写法。 */
function asSupabase(stub: object): SupabaseClient {
  return stub as SupabaseClient
}

/** 只读探针只用 `from().select()…limit()/maybeSingle()` 两条链，替身只覆盖它们。 */
function emptyReadOnlyStub(): SupabaseClient {
  const api: Record<string, unknown> = {}
  const self = () => api
  api.select = self
  api.eq = self
  api.gte = self
  api.order = self
  api.limit = () => Promise.resolve({ data: [], error: null })
  api.maybeSingle = () => Promise.resolve({ data: null, error: null })
  return asSupabase({ from: () => api })
}

describe('🔴 A0 的硬约束：这个模块不许有写入路径', () => {
  const source = readFileSync(PROBE_FILE, 'utf8')
  /** 先剥注释再判 —— 注释里本来就会出现「不写 ads_circuit_events」这类字样。 */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('源码里不出现熔断事件表', () => {
    expect(code).not.toContain('ads_circuit_events')
  })

  it.each(['.insert(', '.upsert(', '.update(', '.delete(', '.rpc('])(
    '源码里不出现写操作 %s',
    (writeCall) => {
      expect(code).not.toContain(writeCall)
    },
  )

  it('也不发任何 Inngest 事件', () => {
    expect(code).not.toContain('inngest')
    expect(code).not.toContain('sendInngestEvent')
  })
})

describe('probeClientCircuit', () => {
  it('非 bounded_auto 的客户直接跳过，并如实记原因（跳过 ≠ 没问题）', async () => {
    const out = await probeClientCircuit(emptyReadOnlyStub(), {
      clientId: 'c-1',
      autonomyMode: 'observe',
      now: new Date('2026-10-18T00:00:00Z'),
    })

    expect(out.skipped).toBe('not_bounded_auto')
    expect(out.accounts).toHaveLength(0)
    // 🔴 跳过的客户不许被记成「没超」——那会让「没观察」和「观察过没事」长得一样
    expect(out.clientCapKind).toBe('undeterminable')
    expect(out.clientCapReason).toBe('skipped:not_bounded_auto')
  })
})

describe('候选倍数清单', () => {
  it('是 1 / 3 / 5 / 6 —— 1 是为了看「拿上限本身当硬顶」有多离谱', () => {
    expect([...CANDIDATE_ABSOLUTE_CAP_MULTIPLES]).toEqual([1, 3, 5, 6])
  })

  it('🔴 不许在这里把它收成一个值', () => {
    // 只剩一个值 = 有人把它当成「选定的阈值」了，而 A0 的全部意义是先不选。
    expect(CANDIDATE_ABSOLUTE_CAP_MULTIPLES.length).toBeGreaterThan(1)
  })
})
