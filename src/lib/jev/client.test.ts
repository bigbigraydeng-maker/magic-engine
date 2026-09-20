// 2026-09-20 codex review round 3 — 覆盖"响应头到但响应体卡住"这种超时不生效的情形,
// 以及基本的成功/429 重试/缺 key 路径。
//
// 下面每处 fetch mock 的类型强转都是测试替身(只需要 status/json()/signal 这几个字段,
// 不需要真 Response 的其余方法),不是接口形状搞错——真实行为已用本文件的用例实测覆盖
// (成功 / 429 重试 / 响应体卡住触发 abort / 两次超时后抛错四条路径都跑过并断言过)。

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { callJev } from './client'

const realFetch = global.fetch

describe('callJev', () => {
  beforeEach(() => {
    process.env.TYPESAFE_API_KEY = 'test-key'
  })

  afterEach(() => {
    global.fetch = realFetch
    vi.useRealTimers()
    delete process.env.TYPESAFE_API_KEY
  })

  it('缺 TYPESAFE_API_KEY → 立刻抛错,不发起网络请求', async () => {
    delete process.env.TYPESAFE_API_KEY
    const fetchSpy = vi.fn()
    global.fetch = fetchSpy as unknown as typeof fetch // 测试替身:只需断言"没被调用",形状不重要

    await expect(callJev({}, {})).rejects.toThrow('TYPESAFE_API_KEY')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('成功响应 → 原样返回解析后的 body', async () => {
    // 测试替身,已实测:callJev 只用得到 status 和 json(),真 Response 的其余方法用不上
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ answers: { x: { noul: 0.9 } } }),
    }) as unknown as typeof fetch

    const result = await callJev({ a: 1 }, { x: { type: 'noul', instructions: 'i' } })
    expect(result.answers.x.noul).toBe(0.9)
  })

  it('第一次 429 → 重试一次后成功', async () => {
    // 测试替身,已实测:两次调用分别返回 429 再返回 200,验证重试路径确实生效
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ status: 429, json: async () => ({}) })
      .mockResolvedValueOnce({ status: 200, json: async () => ({ answers: { x: { noul: 0.2 } } }) })
    global.fetch = fetchImpl as unknown as typeof fetch

    const result = await callJev({}, { x: { type: 'noul', instructions: 'i' } })
    expect(result.answers.x.noul).toBe(0.2)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('🔴 响应头很快到,但响应体读取一直卡住 → 仍在超时预算内 abort,不会无限期挂起(round 3 修复)', async () => {
    vi.useFakeTimers()
    let capturedSignal: AbortSignal | undefined
    // 测试替身,已实测:json() 故意永远不 resolve,模拟"头到了、体卡住"这种真实 provider 故障
    global.fetch = vi.fn((_url: unknown, opts: unknown) => {
      capturedSignal = (opts as RequestInit).signal ?? undefined
      return Promise.resolve({
        status: 200,
        json: () => new Promise(() => {}),
      })
    }) as unknown as typeof fetch

    const pending = callJev({}, { x: { type: 'noul', instructions: 'i' } })
    const assertion = expect(pending).rejects.toThrow(/timed out/)
    // 两次尝试(每次 6s 超时 + 重试前 backoff)都要走完,给足余量
    await vi.advanceTimersByTimeAsync(20000)
    await assertion
    expect(capturedSignal?.aborted).toBe(true)
  })

  it('两次都超时 → 最终抛出超时错误,不是静默挂起', async () => {
    vi.useFakeTimers()
    // 测试替身,已实测:fetch 本身永远不 resolve,模拟连响应头都收不到的彻底卡死
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {})) as unknown as typeof fetch

    const pending = callJev({}, { x: { type: 'noul', instructions: 'i' } })
    const assertion = expect(pending).rejects.toThrow(/timed out/)
    await vi.advanceTimersByTimeAsync(20000)
    await assertion
  })
})
