import { describe, expect, it } from 'vitest'
import { humanJobError } from '../copy'

describe('humanJobError', () => {
  it('does not show internal names or raw payloads', () => {
    expect(humanJobError('诸葛亮流意外关闭')).not.toContain('诸葛亮')
    expect(humanJobError('huatuo failed')).not.toMatch(/huatuo/i)
    expect(humanJobError('{"error":"广告 Agent"}')).toBe('这次没写成。请换一句再说。')
  })
})
