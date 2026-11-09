import { describe, it, expect } from 'vitest'
import { CreatomateRenderRequestedSchema, CreatomateRenderWebhookReceivedSchema } from './events'

// 纯格式测试用的虚构 UUID——不用任何真实客户 ID（魏征复审 ⚠️3：早期版本误用了
// CTS Tours NZ 的真实生产 client_id 当格式夹具，容易被误读成生产数据）。
const FAKE_UUID_1 = '00000000-0000-4000-8000-000000000001'
const FAKE_UUID_2 = '00000000-0000-4000-8000-000000000002'

describe('CreatomateRenderRequestedSchema', () => {
  it('接受合法 payload', () => {
    const r = CreatomateRenderRequestedSchema.safeParse({
      job_id: FAKE_UUID_1,
      client_id: FAKE_UUID_1,
      post_id: FAKE_UUID_2,
    })
    expect(r.success).toBe(true)
  })

  it('拒绝缺字段的 payload', () => {
    expect(CreatomateRenderRequestedSchema.safeParse({ job_id: 'x' }).success).toBe(false)
  })
})

describe('CreatomateRenderWebhookReceivedSchema', () => {
  it('只接受 job_id + render_id，不接受夹带 status/url（红线：不给下游误信的机会）', () => {
    const r = CreatomateRenderWebhookReceivedSchema.safeParse({
      job_id: FAKE_UUID_1,
      render_id: 'r1',
      status: 'succeeded', // 多余字段——zod 默认 strip，不应该出现在解析结果里
      url: 'https://evil.example.com/fake.mp4',
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data).toEqual({ job_id: FAKE_UUID_1, render_id: 'r1' })
      expect(r.data).not.toHaveProperty('status')
      expect(r.data).not.toHaveProperty('url')
    }
  })
})
