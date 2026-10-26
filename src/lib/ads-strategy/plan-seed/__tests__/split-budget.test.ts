import { describe, it, expect } from 'vitest'
import { splitBudget, type SplitInput } from '../split-budget'

function input(over: Partial<SplitInput>): SplitInput {
  return {
    steps: [{ step_key: 's1', accountId: 'A' }],
    clientHeadroomMinor: 15000,
    accountHeadroomMinor: { A: 10000, B: 3000 },
    share: 0.5,
    halve: { stale: false, dailyUnknown: false },
    ...over,
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
    Object.freeze(value)
  }
  return value
}

describe('splitBudget', () => {
  it('1. N=1 only on A, no halving -> 5000', () => {
    const result = splitBudget(input({}))
    expect(result).toHaveLength(1)
    expect(result[0].step_key).toBe('s1')
    expect(result[0].budgetMinor).toBe(5000)
    expect(result[0].divisors).toEqual({ N: 1, n_a: 1 })
  })

  it('2. N=2, s1@A and s2@B -> 3750 and 1500', () => {
    const result = splitBudget(
      input({
        steps: [
          { step_key: 's1', accountId: 'A' },
          { step_key: 's2', accountId: 'B' },
        ],
      }),
    )
    expect(result).toHaveLength(2)
    expect(result[0].step_key).toBe('s1')
    expect(result[0].budgetMinor).toBe(3750)
    expect(result[0].divisors).toEqual({ N: 2, n_a: 1 })
    expect(result[1].step_key).toBe('s2')
    expect(result[1].budgetMinor).toBe(1500)
    expect(result[1].divisors).toEqual({ N: 2, n_a: 1 })
  })

  it('3. N=2 both on A -> 2500 each', () => {
    const result = splitBudget(
      input({
        steps: [
          { step_key: 's1', accountId: 'A' },
          { step_key: 's2', accountId: 'A' },
        ],
      }),
    )
    expect(result).toHaveLength(2)
    expect(result[0].budgetMinor).toBe(2500)
    expect(result[0].divisors).toEqual({ N: 2, n_a: 2 })
    expect(result[1].budgetMinor).toBe(2500)
    expect(result[1].divisors).toEqual({ N: 2, n_a: 2 })
  })

  it('4. N=4 across A and B -> 2500, 2500, 1500, 1500', () => {
    const result = splitBudget(
      input({
        steps: [
          { step_key: 's1', accountId: 'A' },
          { step_key: 's2', accountId: 'A' },
          { step_key: 's3', accountId: 'B' },
          { step_key: 's4', accountId: 'B' },
        ],
        clientHeadroomMinor: 40000,
        accountHeadroomMinor: { A: 10000, B: 6000 },
      }),
    )
    expect(result).toHaveLength(4)
    expect(result[0].budgetMinor).toBe(2500)
    expect(result[1].budgetMinor).toBe(2500)
    expect(result[2].budgetMinor).toBe(1500)
    expect(result[3].budgetMinor).toBe(1500)
  })

  it('5a. stale only -> 2500 and halve basis present', () => {
    const result = splitBudget(input({ halve: { stale: true, dailyUnknown: false } }))
    expect(result[0].budgetMinor).toBe(2500)
    expect(result[0].basis.some((b) => b.value.includes('按保守口径减半'))).toBe(true)
  })

  it('5b. dailyUnknown only -> 2500 and halve basis present', () => {
    const result = splitBudget(input({ halve: { stale: false, dailyUnknown: true } }))
    expect(result[0].budgetMinor).toBe(2500)
    expect(result[0].basis.some((b) => b.value.includes('按保守口径减半'))).toBe(true)
  })

  it('5c. both flags -> still 2500 (halved once) and halve basis present', () => {
    const result = splitBudget(input({ halve: { stale: true, dailyUnknown: true } }))
    expect(result[0].budgetMinor).toBe(2500)
    expect(result[0].basis.some((b) => b.value.includes('按保守口径减半'))).toBe(true)
  })

  it('5d. no flags -> no halve basis', () => {
    const result = splitBudget(input({ halve: { stale: false, dailyUnknown: false } }))
    expect(result[0].budgetMinor).toBe(5000)
    expect(result[0].basis.some((b) => b.value.includes('按保守口径减半'))).toBe(false)
  })

  it('6. odd rounding: raw 5001 halved -> 2500', () => {
    const result = splitBudget(
      input({
        clientHeadroomMinor: 10002,
        accountHeadroomMinor: { A: 100000, B: 3000 },
        halve: { stale: true, dailyUnknown: false },
      }),
    )
    expect(result[0].budgetMinor).toBe(2500)
  })

  it('7. dropped step does not change others (N stays 2)', () => {
    const result = splitBudget(
      input({
        steps: [
          { step_key: 's1', accountId: 'A' },
          { step_key: 's2', accountId: 'B' },
        ],
        accountHeadroomMinor: { A: 10000, B: 0 },
      }),
    )
    expect(result).toHaveLength(2)
    expect(result[0].step_key).toBe('s1')
    expect(result[0].budgetMinor).toBe(3750)
    expect(result[0].divisors.N).toBe(2)
    expect(result[1].step_key).toBe('s2')
    expect(result[1].budgetMinor).toBeNull()
    expect(result[1].why_empty).toBeDefined()
    expect(result[1].why_empty?.startsWith('预算余量不够这一步')).toBe(true)
  })

  it('8. humanCommitted reduces client and account headroom -> 4000', () => {
    const result = splitBudget(
      input({
        humanCommitted: { byAccount: { A: 2000 }, all: 5000 },
      }),
    )
    expect(result[0].budgetMinor).toBe(4000)
  })

  it('9. over-committed client -> budgetMinor null', () => {
    const result = splitBudget(
      input({
        humanCommitted: { byAccount: {}, all: 20000 },
      }),
    )
    expect(result[0].budgetMinor).toBeNull()
    expect(result[0].why_empty?.startsWith('预算余量不够这一步')).toBe(true)
  })

  it('10. empty steps -> []', () => {
    const result = splitBudget(input({ steps: [] }))
    expect(result).toEqual([])
  })

  it('11. basis numbers for test 2 s1', () => {
    const result = splitBudget(
      input({
        steps: [
          { step_key: 's1', accountId: 'A' },
          { step_key: 's2', accountId: 'B' },
        ],
      }),
    )
    const value = result[0].basis[0].value
    expect(value).toContain('客户余量 15000')
    expect(value).toContain('÷ N=2')
    expect(value).toContain('账户余量 10000')
    expect(value).toContain('÷ n_a=1')
    expect(value).toContain('取小者 × 剧本比例')
  })

  it('12. does not mutate the input', () => {
    const original = input({
      steps: [
        { step_key: 's1', accountId: 'A' },
        { step_key: 's2', accountId: 'B' },
      ],
      humanCommitted: { byAccount: { A: 1000 }, all: 2000 },
      halve: { stale: true, dailyUnknown: true },
    })
    const snapshot = structuredClone(original)
    deepFreeze(original)
    expect(() => splitBudget(original)).not.toThrow()
    expect(original).toEqual(snapshot)
  })

  it('13. result order equals input order', () => {
    const steps = [
      { step_key: 's3', accountId: 'B' },
      { step_key: 's1', accountId: 'A' },
      { step_key: 's2', accountId: 'A' },
    ]
    const result = splitBudget(input({ steps }))
    expect(result.map((r) => r.step_key)).toEqual(['s3', 's1', 's2'])
  })
})
