import { describe, it, expect } from 'vitest'
import { ALL_UNKNOWN_SIGNALS, MATURITY_ORDER, deriveMaturity, isMaturityAbove } from '../maturity'
import type { MaturitySignals } from '../types'

const ALL_YES: MaturitySignals = {
  contractFrozen: 'yes',
  mergedToMain: 'yes',
  targetedTestsPassing: 'yes',
  realIntegration: 'yes',
  productionRun: 'yes',
  repeatedAttributableOutcome: 'yes',
}

const signals = (overrides: Partial<MaturitySignals> = {}): MaturitySignals => ({ ...ALL_YES, ...overrides })

describe('deriveMaturity — 阶梯', () => {
  it('全 yes 到 M5，且 limitedBy 为 null', () => {
    expect(deriveMaturity(ALL_YES)).toEqual({ level: 'M5', limitedBy: null, blockingSignal: null })
  })

  it('契约没冻结就停在 M0', () => {
    expect(deriveMaturity(signals({ contractFrozen: 'no' }))).toEqual({
      level: 'M0',
      limitedBy: 'confirmed_absent',
      blockingSignal: 'contractFrozen',
    })
  })

  it('M2 的两道信号缺一道就停在 M1', () => {
    expect(deriveMaturity(signals({ targetedTestsPassing: 'no' })).level).toBe('M1')
    expect(deriveMaturity(signals({ mergedToMain: 'no' })).level).toBe('M1')
  })

  it('没有真实集成证据就不得 M3', () => {
    const result = deriveMaturity(signals({ realIntegration: 'no' }))
    expect(result).toEqual({ level: 'M2', limitedBy: 'confirmed_absent', blockingSignal: 'realIntegration' })
  })

  it('没有生产运行证据就不得 M4', () => {
    expect(deriveMaturity(signals({ productionRun: 'no' })).level).toBe('M3')
  })

  it('没有重复可归因 outcome 就不得 M5', () => {
    const result = deriveMaturity(signals({ repeatedAttributableOutcome: 'no' }))
    expect(result).toEqual({ level: 'M4', limitedBy: 'confirmed_absent', blockingSignal: 'repeatedAttributableOutcome' })
  })

  it('低级证据不成立时，不看更高级信号（不许跳级）', () => {
    const result = deriveMaturity({
      ...ALL_UNKNOWN_SIGNALS,
      contractFrozen: 'no',
      repeatedAttributableOutcome: 'yes',
    })
    expect(result.level).toBe('M0')
  })
})

describe('deriveMaturity — unknown 与 no 必须分开', () => {
  it('全 unknown 时停在 M0，但标成 unknown 而不是 confirmed_absent', () => {
    expect(deriveMaturity(ALL_UNKNOWN_SIGNALS)).toEqual({
      level: 'M0',
      limitedBy: 'unknown',
      blockingSignal: 'contractFrozen',
    })
  })

  it('同一 level 下，「没查到」与「确定没有」结论不同', () => {
    const unknownAt = deriveMaturity(signals({ productionRun: 'unknown' }))
    const absentAt = deriveMaturity(signals({ productionRun: 'no' }))
    expect(unknownAt.level).toBe(absentAt.level)
    expect(unknownAt.limitedBy).toBe('unknown')
    expect(absentAt.limitedBy).toBe('confirmed_absent')
  })

  it('同一台阶里 no 优先于 unknown —— 确定不存在是更强的结论', () => {
    const result = deriveMaturity(signals({ mergedToMain: 'unknown', targetedTestsPassing: 'no' }))
    expect(result).toEqual({ level: 'M1', limitedBy: 'confirmed_absent', blockingSignal: 'targetedTestsPassing' })
  })

  it('unknown 卡住时报告第一道没查清的信号', () => {
    const result = deriveMaturity(signals({ mergedToMain: 'unknown', targetedTestsPassing: 'unknown' }))
    expect(result.blockingSignal).toBe('mergedToMain')
  })
})

describe('MATURITY_ORDER / isMaturityAbove', () => {
  it('顺序是 M0…M5', () => {
    expect(MATURITY_ORDER).toEqual(['M0', 'M1', 'M2', 'M3', 'M4', 'M5'])
  })

  it('按阶梯比较而不是字符串比较', () => {
    expect(isMaturityAbove('M5', 'M2')).toBe(true)
    expect(isMaturityAbove('M2', 'M5')).toBe(false)
    expect(isMaturityAbove('M3', 'M3')).toBe(false)
  })
})
