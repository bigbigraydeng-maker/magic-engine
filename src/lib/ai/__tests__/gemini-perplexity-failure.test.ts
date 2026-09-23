/**
 * Gemini / Perplexity 失败分类器的测试。
 *
 * 跟 provider-failure.test.ts 同一条原则：测的是「分得清哪些要惊动人、哪些不用」，
 * 不是穷举所有可能的错误消息。
 */

import { describe, expect, it } from 'vitest'
import {
  classifyGeminiFailure,
  classifyPerplexityFailure,
  needsHuman,
} from '../provider-failure'

// ─── Gemini ──────────────────────────────────────────────────────────────────

describe('classifyGeminiFailure', () => {
  it('API_KEY_INVALID → credential_invalid', () => {
    const err = Object.assign(new Error('[GoogleGenerativeAI Error]: API_KEY_INVALID'), {
      status: 400,
    })
    expect(classifyGeminiFailure(err)).toBe('credential_invalid')
    expect(needsHuman(classifyGeminiFailure(err))).toBe(true)
  })

  it('401 without specific code → credential_invalid', () => {
    const err = Object.assign(new Error('Request failed'), { status: 401 })
    expect(classifyGeminiFailure(err)).toBe('credential_invalid')
  })

  it('PERMISSION_DENIED → credential_invalid', () => {
    const err = new Error('[GoogleGenerativeAI Error]: PERMISSION_DENIED: API not enabled')
    expect(classifyGeminiFailure(err)).toBe('credential_invalid')
  })

  it('403 → credential_invalid', () => {
    const err = Object.assign(new Error('Forbidden'), { status: 403 })
    expect(classifyGeminiFailure(err)).toBe('credential_invalid')
  })

  it('RESOURCE_EXHAUSTED → account_exhausted (宁可多报)', () => {
    const err = Object.assign(
      new Error('[GoogleGenerativeAI Error]: RESOURCE_EXHAUSTED: check quota'),
      { status: 429 },
    )
    // 🔴 跟 outage-ledger.ts 同一条原则：到 catch 块还是 RESOURCE_EXHAUSTED 的，
    //    往 account_exhausted 偏 —— 宁可多报一次，也不能让真实断电悄悄过去。
    expect(classifyGeminiFailure(err)).toBe('account_exhausted')
    expect(needsHuman(classifyGeminiFailure(err))).toBe(true)
  })

  it('429 without RESOURCE_EXHAUSTED → rate_limited (不惊动人)', () => {
    const err = Object.assign(new Error('Too many requests'), { status: 429 })
    expect(classifyGeminiFailure(err)).toBe('rate_limited')
    expect(needsHuman(classifyGeminiFailure(err))).toBe(false)
  })

  it('真实配额耗尽响应（SDK 不会把 RESOURCE_EXHAUSTED 拼进 message）→ account_exhausted', () => {
    // 🔴 这是 GoogleGenerativeAIFetchError 的真实构造形状：SDK 只把 error.message
    //    拼进异常 message，error.status（gRPC 状态名）从未被读取，所以字面的
    //    "RESOURCE_EXHAUSTED" 不会出现。识别必须靠 message 里的配额文案。
    const err = Object.assign(
      new Error(
        'Error fetching from https://generativelanguage.googleapis.com/...: ' +
          '[429 Too Many Requests] You exceeded your current quota, please check your plan and billing details.',
      ),
      { status: 429 },
    )
    expect(classifyGeminiFailure(err)).toBe('account_exhausted')
    expect(needsHuman(classifyGeminiFailure(err))).toBe(true)
  })

  it('errorDetails 带 QuotaFailure（无配额文案）→ account_exhausted', () => {
    const err = Object.assign(new Error('Too many requests'), {
      status: 429,
      errorDetails: [
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }],
        },
      ],
    })
    expect(classifyGeminiFailure(err)).toBe('account_exhausted')
  })

  it('UNAUTHENTICATED → credential_invalid', () => {
    const err = new Error('[GoogleGenerativeAI Error]: UNAUTHENTICATED')
    expect(classifyGeminiFailure(err)).toBe('credential_invalid')
  })

  it('network error (no status) → other (不惊动人)', () => {
    // 生产最常见的 774 条 —— 纯粹网络问题，不值得报
    const err = new Error('[GoogleGenerativeAI Error]: Error fetching from https://...')
    expect(classifyGeminiFailure(err)).toBe('other')
    expect(needsHuman(classifyGeminiFailure(err))).toBe(false)
  })

  it('500 server error → other', () => {
    const err = Object.assign(new Error('Internal error'), { status: 500 })
    expect(classifyGeminiFailure(err)).toBe('other')
  })

  it('non-Error value → other', () => {
    expect(classifyGeminiFailure('string error')).toBe('other')
    expect(classifyGeminiFailure(null)).toBe('other')
    expect(classifyGeminiFailure(42)).toBe('other')
  })
})

// ─── Perplexity ──────────────────────────────────────────────────────────────

describe('classifyPerplexityFailure', () => {
  /** 模拟 OpenAI SDK 的 APIError 形状 */
  function makeAPIError(
    message: string,
    status: number,
    errorBody?: { code?: string; type?: string },
  ) {
    return Object.assign(new Error(message), {
      status,
      error: errorBody ? { ...errorBody } : undefined,
    })
  }

  it('OpenAI-compatible insufficient_quota → account_exhausted', () => {
    const err = makeAPIError('Quota exceeded', 429, { code: 'insufficient_quota' })
    expect(classifyPerplexityFailure(err)).toBe('account_exhausted')
    expect(needsHuman(classifyPerplexityFailure(err))).toBe(true)
  })

  it('invalid_api_key code → credential_invalid', () => {
    const err = makeAPIError('Invalid key', 401, { code: 'invalid_api_key' })
    expect(classifyPerplexityFailure(err)).toBe('credential_invalid')
  })

  it('401 without structured code → credential_invalid', () => {
    const err = makeAPIError('Unauthorized', 401)
    expect(classifyPerplexityFailure(err)).toBe('credential_invalid')
  })

  it('403 → credential_invalid', () => {
    const err = makeAPIError('Forbidden', 403)
    expect(classifyPerplexityFailure(err)).toBe('credential_invalid')
  })

  it('429 with quota keyword → account_exhausted', () => {
    const err = makeAPIError('Rate limit: quota exceeded', 429)
    expect(classifyPerplexityFailure(err)).toBe('account_exhausted')
  })

  it('429 without quota keyword → rate_limited (不惊动人)', () => {
    const err = makeAPIError('Rate limit reached', 429)
    expect(classifyPerplexityFailure(err)).toBe('rate_limited')
    expect(needsHuman(classifyPerplexityFailure(err))).toBe(false)
  })

  it('500 → other', () => {
    const err = makeAPIError('Internal server error', 500)
    expect(classifyPerplexityFailure(err)).toBe('other')
  })

  it('network error (no status) → other', () => {
    const err = new Error('fetch failed')
    expect(classifyPerplexityFailure(err)).toBe('other')
    expect(needsHuman(classifyPerplexityFailure(err))).toBe(false)
  })

  it('non-Error → other', () => {
    expect(classifyPerplexityFailure('error string')).toBe('other')
  })
})
