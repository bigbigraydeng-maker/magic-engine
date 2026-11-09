/**
 * `sendInngestEvent` 的错误契约。
 *
 * 🔴 **加这份测试的原因**（2026-09-07）：客户需求卡停更 14 天那次事故里，
 *    上游 `dispatchBriefHandoff` 把这个函数抛的错原样吞下去写进 `cron_run_logs`。
 *    原实现只把 HTTP 状态码带出来（`INNGEST_EVENT_SEND_FAILED:401`），
 *    401 到底是 event key 缺、还是 quota exceeded、还是 payload 被拒 —— 全看不出。
 *    这一份锁住「错误消息里必须带 provider 侧的响应体」。
 */

import { describe, it, expect } from 'vitest'
import { sendInngestEvent } from '../inngest-event'

const event = { id: 'evt-1', name: 'me/test.event', data: { hello: 'world' } }

describe('错误消息里必须够查', () => {
  it('🔴 4xx 时带上响应体前 200 字，前缀 INNGEST_EVENT_SEND_FAILED 保留', async () => {
    const fetcher = async () =>
      new Response('event key invalid or expired', { status: 401 })
    await expect(
      sendInngestEvent(event, { eventKey: 'k', fetcher: fetcher as never }),
    ).rejects.toThrow(/^INNGEST_EVENT_SEND_FAILED:401:event key invalid or expired$/)
  })

  it('响应体是 JSON 也照样透出去（供 grep 用）', async () => {
    const fetcher = async () =>
      new Response(JSON.stringify({ error: 'quota_exceeded', reset_at: 12345 }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      })
    await expect(sendInngestEvent(event, { eventKey: 'k', fetcher: fetcher as never }))
      .rejects.toThrow(/INNGEST_EVENT_SEND_FAILED:429:.*quota_exceeded/)
  })

  it('响应体特别长时最多带 200 字，别把日志撑爆', async () => {
    const long = 'x'.repeat(5000)
    const fetcher = async () => new Response(long, { status: 502 })
    let msg = ''
    try {
      await sendInngestEvent(event, { eventKey: 'k', fetcher: fetcher as never })
    } catch (err) {
      msg = err instanceof Error ? err.message : String(err)
    }
    // 前缀 + 状态 + `:` + 200 字体 = 长度上限
    expect(msg.startsWith('INNGEST_EVENT_SEND_FAILED:502:')).toBe(true)
    expect(msg.length).toBeLessThanOrEqual('INNGEST_EVENT_SEND_FAILED:502:'.length + 200)
  })

  it('响应体读不出来（网络中途断）也不许把这条错吞掉 —— 状态码那行还得抛', async () => {
    const fetcher = async () =>
      new Response(null, { status: 503 }) // 无 body
    await expect(
      sendInngestEvent(event, { eventKey: 'k', fetcher: fetcher as never }),
    ).rejects.toThrow(/^INNGEST_EVENT_SEND_FAILED:503$/)
  })

  it('key 缺了直接抛专门的错，不发请求', async () => {
    let called = false
    const fetcher = async () => {
      called = true
      return new Response('', { status: 200 })
    }
    await expect(
      sendInngestEvent(event, { eventKey: '  ', fetcher: fetcher as never }),
    ).rejects.toThrow('INNGEST_EVENT_KEY_MISSING')
    expect(called).toBe(false)
  })
})
