/**
 * 「重试也没用」的判据 —— 2026-09-23 私信简报停产 3 天的那个放大器。
 *
 * OpenAI 余额 9/20 19:11 用光。写卡循环是逐条 try/catch 的，所以额度错误不中断循环，
 * 而 SDK 对 429 默认重试两次 → 一条注定失败的调用烧 20.1 秒（生产实测 22.2 / 18.5 /
 * 19.0）→ 一段 12 条约 242 秒 → 撞穿网关约 125 秒的线 → 段永远不返回 → 运行记录
 * 永远停在「在跑」。一个「充钱就好」的问题被乘法放大成「监控上看不出坏」。
 *
 * 所以这里判的只有一件事：**这个错误对这一轮剩下的每一条是不是同一个结论**。
 */

import { describe, expect, it } from 'vitest'
import { fatalAiReason } from './fatal-error'

describe('fatalAiReason', () => {
  it('余额用光 → 熄火（复刻 2026-09-23 生产实测那个错误对象）', () => {
    const err = Object.assign(new Error('You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.'), {
      status: 429,
      code: 'credit_balance_exhausted',
      type: 'insufficient_quota',
    })
    expect(fatalAiReason(err)).toContain('余额')
  })

  it('额度用光的另一种文案（exceeded your current quota）也算', () => {
    const err = Object.assign(new Error('You exceeded your current quota, please check your plan and billing details.'), {
      status: 429,
      type: 'insufficient_quota',
    })
    expect(fatalAiReason(err)).not.toBeNull()
  })

  it('Anthropic 的 credit_balance_too_low 也算 —— 判据是账户级，不是某一家供应商', () => {
    const err = Object.assign(new Error('Your credit balance is too low to access the API'), {
      status: 400,
      type: 'invalid_request_error',
      code: 'credit_balance_too_low',
    })
    expect(fatalAiReason(err)).not.toBeNull()
  })

  it('密钥无效 / 被拒（401、403）→ 熄火', () => {
    for (const status of [401, 403]) {
      const err = Object.assign(new Error('Incorrect API key provided'), { status })
      expect(fatalAiReason(err), `status=${status}`).not.toBeNull()
    }
  })

  it('🔴 普通限流不算 —— 那是「现在太挤，等一下就好」，熄火会把一次拥堵变成一轮不写卡', () => {
    const err = Object.assign(new Error('Rate limit reached for gpt-4o-mini in organization org-x on requests per min'), {
      status: 429,
      code: 'rate_limit_exceeded',
      type: 'requests',
    })
    expect(fatalAiReason(err)).toBeNull()
  })

  it('🔴 业务错误不算 —— 一个人的对话数据坏了，不该让这一批剩下的人今天都看不到卡', () => {
    expect(fatalAiReason(new Error('brief upsert failed: invalid input syntax for type timestamptz'))).toBeNull()
    expect(fatalAiReason(Object.assign(new Error('The server had an error'), { status: 500 }))).toBeNull()
    expect(fatalAiReason(Object.assign(new Error('Request timed out'), { status: 408 }))).toBeNull()
  })

  it('不是对象的东西不许猜 —— 宁可不熄火，也不凭空停掉一轮', () => {
    expect(fatalAiReason(null)).toBeNull()
    expect(fatalAiReason(undefined)).toBeNull()
    expect(fatalAiReason('no credits remaining')).toBeNull()
  })
})
