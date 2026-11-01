import { describe, it, expect } from 'vitest'
import { kindFeatureFlags } from '@/lib/clients/kind-features'

/**
 * 普通客户概览区块组合应与 kind-features 的 standard 开关一致（回归：改前全开）。
 */
describe('Client overview — standard client unchanged', () => {
  it('standard 不启用 personal_ip_metrics，其余区块全开', () => {
    const flags = kindFeatureFlags('standard')
    expect(flags.personal_ip_metrics).toBe(false)
    expect(flags.workflow_progress).toBe(true)
    expect(flags.next_step).toBe(true)
    expect(flags.brand_health).toBe(true)
    expect(flags.zhuge_priority).toBe(true)
    expect(flags.intelligence_summary).toBe(true)
    expect(flags.brief_banner).toBe(true)
  })
})

describe('Client overview — personal IP', () => {
  it('启用五格首屏', () => {
    expect(kindFeatureFlags('personal_ip').personal_ip_metrics).toBe(true)
  })
})
