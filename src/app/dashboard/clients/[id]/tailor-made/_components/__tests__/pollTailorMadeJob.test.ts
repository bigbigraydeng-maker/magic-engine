/**
 * pollTailorMadeJob() 有界重试测试
 *
 * 背景：DB 抖动 / Render 重新部署时的一次性 5xx 或网络错误不该让整条轮询链
 * 直接判死——后台任务其实还在跑。只对 5xx / 网络错误做有界重试（最多连续 3
 * 次），4xx（任务不存在 / 无权限）不会自愈，照旧立即终止。
 *
 * Scenarios:
 *  1. 一两次瞬时失败后成功 → 正常返回结果，不提前终止
 *  2. 连续第 3 次瞬时失败 → 判死，不再发第 4 次请求
 *  3. 中途一次成功会把连续失败计数清零
 *  4. 4xx 立即终止，不重试
 *  5. 取消后不再安排下一次轮询
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { pollTailorMadeJob } from '../TailorMadeEditor'

function makeResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response
}

beforeEach(() => {
  global.fetch = vi.fn()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const notCancelled = () => false

describe('pollTailorMadeJob()', () => {
  it('tolerates one or two consecutive transient failures then succeeds', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeResponse(502, { error: 'bad gateway' }))
      .mockResolvedValueOnce(makeResponse(500, { error: 'internal error' }))
      .mockResolvedValueOnce(makeResponse(200, { status: 'completed', result: { ok: true } }))

    const outcome = await pollTailorMadeJob('client-1', 'job-1', notCancelled)

    expect(outcome).toEqual({ result: { ok: true } })
    expect(global.fetch).toHaveBeenCalledTimes(3)
  })

  it('tolerates network errors the same way as 5xx responses', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(makeResponse(200, { status: 'completed', result: { ok: true } }))

    const outcome = await pollTailorMadeJob('client-1', 'job-1', notCancelled)

    expect(outcome).toEqual({ result: { ok: true } })
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('terminates on the third consecutive transient failure without a fourth request', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeResponse(502, { error: 'bad gateway' }))
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(makeResponse(503, { error: 'unavailable' }))

    const outcome = await pollTailorMadeJob('client-1', 'job-1', notCancelled)

    expect(outcome.error).toBeTruthy()
    expect(outcome.result).toBeUndefined()
    expect(global.fetch).toHaveBeenCalledTimes(3)
  })

  it('resets the consecutive-failure counter after a successful poll', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeResponse(500, { error: 'internal error' })) // transient #1
      .mockResolvedValueOnce(makeResponse(200, { status: 'pending' })) // success -> reset
      .mockResolvedValueOnce(makeResponse(502, { error: 'bad gateway' })) // transient #1 (post-reset)
      .mockResolvedValueOnce(makeResponse(500, { error: 'internal error' })) // transient #2 (post-reset)
      .mockResolvedValueOnce(makeResponse(200, { status: 'completed', result: { ok: true } }))

    const outcome = await pollTailorMadeJob('client-1', 'job-1', notCancelled)

    // 若计数没有被中间那次成功清零，第 4 次请求就会是「连续第 3 次瞬时失败」而提前判死，
    // 永远拿不到第 5 次请求的结果。
    expect(outcome).toEqual({ result: { ok: true } })
    expect(global.fetch).toHaveBeenCalledTimes(5)
  })

  it('terminates immediately on a 4xx response without retrying', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse(404, { error: '任务不存在' })
    )

    const outcome = await pollTailorMadeJob('client-1', 'job-1', notCancelled)

    expect(outcome).toEqual({ error: '任务不存在' })
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('stops polling and schedules no further request once cancelled', async () => {
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout')
    let calls = 0
    const isCancelled = () => {
      calls += 1
      return calls > 1 // 第一次检查放行，拿到响应后的检查判定已取消
    }
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeResponse(200, { status: 'pending' })
    )

    const outcome = await pollTailorMadeJob('client-1', 'job-1', isCancelled)

    expect(outcome).toEqual({ cancelled: true })
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(setTimeoutSpy).not.toHaveBeenCalled()
  })
})
