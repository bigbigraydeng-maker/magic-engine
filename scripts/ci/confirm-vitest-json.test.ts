import { describe, expect, it } from 'vitest'

import { judgeVitestJson } from './confirm-vitest-json.mjs'

const EXPECTED = '/repo/src/lib/kernel/__tests__/architecture.test.ts'

function report(overrides: Record<string, unknown> = {}) {
  return {
    testResults: [{ name: EXPECTED }],
    numPassedTests: 203,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    ...overrides,
  }
}

describe('judgeVitestJson', () => {
  it('accepts the one expected file at the floor', () => {
    const judged = judgeVitestJson(report(), EXPECTED, 203)
    expect(judged.problems).toEqual([])
  })

  it('rejects a different file, a failure, a skip, or a short run', () => {
    expect(judgeVitestJson(report({ testResults: [{ name: '/other' }] }), EXPECTED, 203).problems.length).toBeGreaterThan(0)
    expect(judgeVitestJson(report({ numFailedTests: 1 }), EXPECTED, 203).problems.some((item) => item.includes('失败'))).toBe(true)
    expect(judgeVitestJson(report({ numPendingTests: 1 }), EXPECTED, 203).problems.some((item) => item.includes('跳过'))).toBe(true)
    expect(judgeVitestJson(report({ numPassedTests: 202 }), EXPECTED, 203).problems.some((item) => item.includes('下限'))).toBe(true)
  })
})
