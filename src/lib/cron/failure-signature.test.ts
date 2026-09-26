/**
 * 降噪的边界：**要把同一个毛病的 N 次收成一条，但绝不能把两个不同的真问题合并。**
 *
 * 这一组断言大多是「反过来」的 —— 它们锁的是「**不许**合并」，
 * 因为降噪唯一的失败形态就是连真告警一起降掉。
 */

import { describe, expect, it } from 'vitest'
import { failureSignature } from './failure-signature'

describe('failureSignature —— 该合并的', () => {
  it('同一个毛病、只有计数不同 → 同一个签名', () => {
    expect(failureSignature('processed 12 clients, 3 failed')).toBe(
      failureSignature('processed 45 clients, 9 failed'),
    )
  })

  it('uuid 不同但说的是同一件事 → 同一个签名', () => {
    const a = 'client c0000000-0000-0000-0000-000000000000 has no primary_keywords'
    const b = 'client d5c98811-1c1d-4ded-bdf0-4cefec6afb84 has no primary_keywords'
    expect(failureSignature(a)).toBe(failureSignature(b))
  })

  it('时间戳不同 → 同一个签名', () => {
    expect(failureSignature('timed out at 2026-09-22T18:00:53Z')).toBe(
      failureSignature('timed out at 2026-09-23T06:15:01Z'),
    )
  })

  it('大小写和多余空白不影响', () => {
    expect(failureSignature('  Quota   Exceeded ')).toBe(failureSignature('quota exceeded'))
  })
})

describe('failureSignature —— 🔴 绝不许合并的', () => {
  it('平台错误码不同 = 不同的根因（PITFALLS F6 三个根因各自致命）', () => {
    const missingPerm = failureSignature('(#10) Application does not have permission for this action')
    const gone = failureSignature('(#100) Object does not exist')
    const retired = failureSignature('(#12) singular statuses API is deprecated')
    expect(new Set([missingPerm, gone, retired]).size).toBe(3)
  })

  it('HTTP 状态码不同 = 不同的问题（限流 vs 接口没了）', () => {
    const codes = ['429', '500', '404'].map((c) => failureSignature(`Request failed with status ${c}`))
    expect(new Set(codes).size).toBe(3)
  })

  it('🔴 429 和 500 分得开 —— 这次改动的核心卖点就是「429 不等于没钱」，降噪不能把它抹平', () => {
    expect(failureSignature('request failed with status 429')).not.toBe(
      failureSignature('request failed with status 500'),
    )
  })

  it('不同任务的同一句错误由调用方加任务名区分，签名本身不负责', () => {
    // 这里只断言签名函数**没有**擅自把任务名塞进来
    expect(failureSignature('boom')).toBe('boom')
  })
})

describe('failureSignature —— 边界', () => {
  it('空 / null / 全空白 → 空串，交给调用方决定怎么分组', () => {
    expect(failureSignature('')).toBe('')
    expect(failureSignature(null)).toBe('')
    expect(failureSignature(undefined)).toBe('')
    expect(failureSignature('   ')).toBe('')
  })

  it('超长错误信息被截断，不会把整页日志当签名', () => {
    expect(failureSignature('e'.repeat(1000)).length).toBeLessThanOrEqual(160)
  })

  it('同一个输入永远给同一个答案（纯函数）', () => {
    const msg = 'client c0000000-0000-0000-0000-000000000000 failed 7 times with status 429'
    expect(failureSignature(msg)).toBe(failureSignature(msg))
  })
})
