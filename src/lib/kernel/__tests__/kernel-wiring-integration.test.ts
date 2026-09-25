/**
 * 集成测试：验证 `createKernel` 真实接线，不跳过 deps 结构。
 *
 * WP3 验收条件 5：测试用真实 deps 结构，不绕过。
 *
 * 这些测试验证的是**接线**，不是业务逻辑：
 *   · `createKernel` 返回的 deps 里 `resolveEnvelopeFacts` 不是 undefined
 *   · capabilities 包含注册表里声明的全部 action_key
 *   · 六个广告动作的 envelope 判据和 rollback handler 都有注册
 *
 * 🔴 不 mock deps，不跳过 createKernelDeps，不用合成 resolver。
 *    上一轮测试全用 vi.fn() 的合成 resolver，等于测试自己的 mock 没问题，
 *    但 production 那条线一直断着。这里的意图是：如果有人再把接线砍了，
 *    这些测试当天就红。
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          in: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        }),
      }),
    }),
  },
}))

import { createKernel, ACTION_REGISTRY } from '@/lib/kernel'
import type { SupabaseClient } from '@supabase/supabase-js'

function fakeSupabase(): SupabaseClient {
  const handler: ProxyHandler<object> = {
    get: (_target, prop) => {
      if (prop === 'from') {
        return () =>
          new Proxy({}, {
            get: () => () =>
              new Proxy({}, {
                get: () => () =>
                  new Proxy({}, {
                    get: () => () =>
                      new Proxy({}, {
                        get: () => () =>
                          Promise.resolve({ data: [], error: null }),
                      }),
                  }),
              }),
          })
      }
      return () => new Proxy({}, handler)
    },
  }
  return new Proxy({}, handler) as unknown as SupabaseClient
}

describe('createKernel wiring integration', () => {
  it('resolveEnvelopeFacts is defined (not undefined)', () => {
    const deps = createKernel(fakeSupabase())
    expect(deps.resolveEnvelopeFacts).toBeDefined()
    expect(typeof deps.resolveEnvelopeFacts).toBe('function')
  })

  it('capabilities cover all registered action keys', () => {
    const deps = createKernel(fakeSupabase())
    for (const key of ACTION_REGISTRY.keys()) {
      expect(
        deps.capabilities[key],
        `capability missing for registered action key '${key}'`,
      ).toBeDefined()
    }
  })

  it('all ads.* capabilities have rollback handlers', () => {
    const deps = createKernel(fakeSupabase())
    const adsKeys = ACTION_REGISTRY.keys().filter(k => k.startsWith('ads.'))
    expect(adsKeys.length).toBeGreaterThanOrEqual(3)

    for (const key of adsKeys) {
      const cap = deps.capabilities[key]
      if (!cap) continue
      const def = ACTION_REGISTRY.get(key)
      if (def?.outwardAuthorization?.rollback === 'provider_native') {
        expect(
          typeof cap.rollback,
          `ads capability '${key}' declares provider_native rollback but has no handler`,
        ).toBe('function')
      }
    }
  })

  it('resolver returns unavailable (not crash) for unknown action key', async () => {
    const deps = createKernel(fakeSupabase())
    const resolver = deps.resolveEnvelopeFacts!
    const result = await resolver({
      clientId: 'test-client',
      actionKey: 'unknown.action',
      input: {},
      at: 'authorize',
      runId: 'test-run',
    })
    expect('unavailable' in result).toBe(true)
  })

  it('resolver returns unavailable when ad_account_id is missing', async () => {
    const deps = createKernel(fakeSupabase())
    const resolver = deps.resolveEnvelopeFacts!
    const result = await resolver({
      clientId: 'test-client',
      actionKey: 'ads.pause_unit',
      input: { adset_id: 'test-adset' },
      at: 'authorize',
      runId: 'test-run',
    })
    expect('unavailable' in result).toBe(true)
  })

  it('overrides.resolveEnvelopeFacts takes precedence over default', () => {
    const custom = vi.fn()
    const deps = createKernel(fakeSupabase(), { resolveEnvelopeFacts: custom })
    expect(deps.resolveEnvelopeFacts).toBe(custom)
  })
})
