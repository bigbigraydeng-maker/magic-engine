import { describe, expect, it } from 'vitest'
import { actionFixBadge, showActionModuleChip } from '../action-badge'

describe('action badges', () => {
  it('labels a manual action 人工执行', () => {
    expect(actionFixBadge({ fix_type: 'fde_manual', module: 'manual' }).label).toBe('人工执行')
    expect(showActionModuleChip({ module: 'manual' })).toBe(false)
  })

  it('keeps automatic and third-party labels', () => {
    expect(actionFixBadge({ fix_type: 'me_auto', module: 'seo_engine' }).label).toBe('ME')
    expect(actionFixBadge({ fix_type: 'third_party' }).label).toBe('第三方')
    expect(showActionModuleChip({ module: 'seo_engine' })).toBe(true)
  })
})
