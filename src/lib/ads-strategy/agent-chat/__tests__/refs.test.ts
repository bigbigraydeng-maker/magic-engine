import { describe, expect, it } from 'vitest'
import { opaqueEntityRef, opaqueAccountRef } from '../refs'

describe('opaque refs', () => {
  it('stable and non-empty', () => {
    const a = opaqueEntityRef('campaign', 'demo-entity-id')
    const b = opaqueEntityRef('campaign', 'demo-entity-id')
    expect(a).toBe(b)
    expect(a.startsWith('c_')).toBe(true)
    expect(a).not.toContain('demo-entity-id')
  })

  it('account ref uses index', () => {
    expect(opaqueAccountRef('act_demo', 1)).toMatch(/^acct1_/)
  })
})
