/**
 * 「这次 AI 调用失败，是账户层面的事，还是这一次的事？」
 *
 * 这套判据的全部价值在于分清 **429-没钱** 和 **429-太快**。分不清就只有两个结局：
 * 要么天天误报（人学会忽略），要么三天不报（2026-09-20 实际发生的）。
 */

import { describe, expect, it } from 'vitest'
import { classifyOpenAIFailure, needsHuman, parseProviderError } from '../provider-failure'

/** OpenAI 余额耗尽时真实返回的形状。 */
const INSUFFICIENT_QUOTA = JSON.stringify({
  error: {
    message: 'You exceeded your current quota, please check your plan and billing details.',
    type: 'insufficient_quota',
    param: null,
    code: 'insufficient_quota',
  },
})

/** 同样是 429，但只是这一秒打太快了 —— SDK 自己会重试。 */
const RATE_LIMITED = JSON.stringify({
  error: {
    message: 'Rate limit reached for gpt-4o-mini in organization org-xxx on requests per min.',
    type: 'requests',
    code: 'rate_limit_exceeded',
  },
})

describe('classifyOpenAIFailure', () => {
  it('🔴 429 + insufficient_quota = 账户没钱（这条不认出来就是 2026-09-20 的三天静默）', () => {
    expect(classifyOpenAIFailure({ status: 429, body: INSUFFICIENT_QUOTA })).toBe('account_exhausted')
  })

  it('🔴 同样是 429，但只是限流 → 不惊动人', () => {
    expect(classifyOpenAIFailure({ status: 429, body: RATE_LIMITED })).toBe('rate_limited')
  })

  it('429 但 body 读不出来 → 当限流处理，不猜成没钱', () => {
    // 猜错的代价是把一次限流报成「账户没钱」，PM 跑去看一个好好的账户，
    // 下次就不信这条告警了
    expect(classifyOpenAIFailure({ status: 429, body: '<html>bad gateway</html>' })).toBe('rate_limited')
  })

  it('账单硬顶 / 账户停用也算账户没钱', () => {
    for (const code of ['billing_hard_limit_reached', 'billing_not_active', 'account_deactivated']) {
      expect(
        classifyOpenAIFailure({ status: 403, body: JSON.stringify({ error: { code } }) }),
        code,
      ).toBe('account_exhausted')
    }
  })

  it('401 + invalid_api_key = 钥匙不认了', () => {
    expect(
      classifyOpenAIFailure({
        status: 401,
        body: JSON.stringify({ error: { code: 'invalid_api_key', message: 'Incorrect API key provided' } }),
      }),
    ).toBe('credential_invalid')
  })

  it('🔴 Cloudflare 网关回的 401 不许说成「OpenAI 钥匙失效」—— 会把人支到错的后台去', () => {
    // openai-client.ts:20-22 是 2026-07-14 的实测结论：CF AI Gateway 认证模式下
    // 缺 cf-aig-authorization 会直接 401，而 OpenAI 的钥匙一点毛病没有
    expect(
      classifyOpenAIFailure({
        status: 401,
        body: 'unauthorized',
        headers: { 'cf-ray': '8d2f1a', 'content-type': 'text/plain' },
      }),
    ).toBe('gateway_auth_failed')

    // 没有头、但 body 自报家门也算
    expect(
      classifyOpenAIFailure({ status: 401, body: 'Cloudflare AI Gateway: missing authorization' }),
    ).toBe('gateway_auth_failed')
  })

  it('401 既不像网关、也读不出 OpenAI 的错误码 → 不猜，归 other 不告警', () => {
    expect(classifyOpenAIFailure({ status: 401, body: '' })).toBe('other')
  })

  it('5xx 归 other —— 供应商抽风不是账户问题，重试会好', () => {
    expect(classifyOpenAIFailure({ status: 500, body: 'internal error' })).toBe('other')
    expect(classifyOpenAIFailure({ status: 503, body: '' })).toBe('other')
  })

  it('超长响应体只看前面一段，不把一整页 HTML 读进来', () => {
    const huge = '<html>' + 'x'.repeat(50_000) + '</html>'
    expect(classifyOpenAIFailure({ status: 502, body: huge })).toBe('other')
  })
})

describe('needsHuman', () => {
  it('只有「重试一万次也不会好」的那几种才惊动人', () => {
    expect(needsHuman('account_exhausted')).toBe(true)
    expect(needsHuman('credential_invalid')).toBe(true)
    expect(needsHuman('gateway_auth_failed')).toBe(true)
    expect(needsHuman('rate_limited')).toBe(false)
    expect(needsHuman('other')).toBe(false)
  })
})

describe('parseProviderError', () => {
  it('不是 JSON 就返回空，不从 message 里猜', () => {
    expect(parseProviderError('not json at all')).toEqual({ code: '', type: '', message: '' })
  })

  it('JSON 但没有 error 字段也返回空', () => {
    expect(parseProviderError('{"ok":true}')).toEqual({ code: '', type: '', message: '' })
  })
})
