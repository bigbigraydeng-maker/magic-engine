import { describe, expect, it } from 'vitest'
import { failureCell } from '../digest-cells'

describe('failureCell', () => {
  it('真有失败对象就报数', () => {
    expect(failureCell({ status: 'failed', failed_count: 4 })).toBe('4 failed')
    expect(failureCell({ status: 'completed', failed_count: 2 })).toBe('2 failed')
  })

  it('这次跑没干成、但没有可数的失败对象 → 不许显示「0 failed」', () => {
    // 真实场景：meta-leads-sync 的 Mailchimp 出口坏了 —— 线索都进了 CRM
    //（取不到线索的客户数 = 0），但一个人都没进邮件名单。
    expect(failureCell({ status: 'failed', failed_count: 0 })).toBe('needs attention')
    expect(failureCell({ status: 'failed' })).toBe('needs attention')
    expect(failureCell({ status: 'failed', failed_count: null })).toBe('needs attention')
  })

  it('跑成功的照旧（这种行压根不会进日报，兜底而已）', () => {
    expect(failureCell({ status: 'completed', failed_count: 0 })).toBe('0 failed')
  })
})
