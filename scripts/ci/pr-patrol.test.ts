import { describe, expect, it } from 'vitest'

import { classifyPr, fingerprint, parseState, plan, problemKeys, renderBody } from './pr-patrol.mjs'

const NOW = Date.parse('2026-11-02T00:00:00Z')
const fresh = { updated_at: '2026-11-01T23:00:00Z' }
const gateOk = { name: 'Risk gate', conclusion: 'success' }

describe('classifyPr', () => {
  it('is clean when gate and checks pass', () => {
    expect(classifyPr(fresh, [gateOk, { name: 'build', conclusion: 'success' }], NOW)).toEqual([])
  })

  it('flags red checks, fix-scope and a red gate separately', () => {
    const runs = [
      { name: 'Risk gate', conclusion: 'failure' },
      { name: 'Fix-scope guard', conclusion: 'failure' },
      { name: 'Kernel test', conclusion: 'failure' },
    ]
    expect(classifyPr(fresh, runs, NOW)).toEqual(['checks-red', 'fix-scope-red', 'risk-gate-red'])
  })

  it('flags a missing gate and staleness', () => {
    const old = { updated_at: '2026-10-29T00:00:00Z' }
    expect(classifyPr(old, [], NOW)).toEqual(['risk-gate-missing', 'stale'])
  })

  it('does not treat in-progress checks as red', () => {
    expect(classifyPr(fresh, [gateOk, { name: 'build', conclusion: null }], NOW)).toEqual([])
  })
})

describe('plan', () => {
  const items = [{ number: 5, sha: 'abcdef123456', problems: ['checks-red'] }]
  const keys = problemKeys(items)
  const stored = renderBody(items, keys, fingerprint(keys), 'now')

  it('writes the first time and reports added keys', () => {
    const p = plan(null, keys)
    expect(p.write).toBe(true)
    expect(p.added).toEqual(['5:checks-red@abcdef1'])
  })

  it('stays silent when nothing changed', () => {
    expect(plan(parseState(stored), keys).write).toBe(false)
  })

  it('writes on recovery without announcing new problems', () => {
    const p = plan(parseState(stored), [])
    expect(p.write).toBe(true)
    expect(p.added).toEqual([])
    expect(p.recovered).toEqual(keys)
  })

  it('treats a new push (new sha) as a new problem', () => {
    const next = problemKeys([{ ...items[0], sha: '9999999aaaa' }])
    expect(plan(parseState(stored), next).added).toEqual(['5:checks-red@9999999'])
  })

  it('ignores a corrupt marker', () => {
    expect(parseState('<!-- pr-patrol-state:v1 {bad} -->')).toBeNull()
  })
})
