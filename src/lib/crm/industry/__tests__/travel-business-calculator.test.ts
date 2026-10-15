import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INPUTS,
  calculate,
  clampNotes,
  unrealisticWarnings,
  validateInputs,
  type CalculatorInputs,
  type CalculatorResult,
} from '../travel-business-calculator'
import golden from './fixtures/travel-business-calculator.golden.json'

type GoldenCase = {
  input: CalculatorInputs
  output: Record<string, number | 'Infinity' | '-Infinity' | 'NaN'>
}

const cases = golden as Record<string, GoldenCase>
const caseNames = Object.keys(cases)

describe('calculate matches the reference golden fixture', () => {
  it.each(caseNames)('%s', (name) => {
    const { input, output } = cases[name]
    const result = calculate(input) as unknown as Record<string, number>
    for (const key of Object.keys(output)) {
      const expected = output[key]
      if (expected === 'NaN') {
        expect(Number.isNaN(result[key])).toBe(true)
      } else if (expected === '-Infinity') {
        expect(result[key]).toBe(-Infinity)
      } else if (expected === 'Infinity') {
        expect(result[key]).toBe(Infinity)
      } else {
        expect(result[key]).toBeCloseTo(expected, 4)
      }
    }
  })
})

describe('calculate named assertions on the default case', () => {
  const result: CalculatorResult = calculate(DEFAULT_INPUTS)

  it('profit rounds to 40571', () => {
    expect(Math.round(result.profit)).toBe(40571)
  })

  it('sales rounds to 2605714', () => {
    expect(Math.round(result.sales)).toBe(2605714)
  })

  it('passengers is 720', () => {
    expect(result.passengers).toBe(720)
  })

  it('leads rounds to 8571', () => {
    expect(Math.round(result.leads)).toBe(8571)
  })

  it('orders rounds to 429', () => {
    expect(Math.round(result.orders)).toBe(429)
  })

  it('breakEvenPassengers is 575', () => {
    expect(result.breakEvenPassengers).toBe(575)
  })

  it('salesRequired is 2', () => {
    expect(result.salesRequired).toBe(2)
  })
})

describe('clampNotes', () => {
  it('reports commissionRate clamped to grossMargin', () => {
    const notes = clampNotes({ ...DEFAULT_INPUTS, commissionRate: 30, grossMargin: 20 })
    expect(notes).toContainEqual({ field: 'commissionRate', entered: 30, used: 20 })
  })

  it('reports conversion clamped to 100', () => {
    const notes = clampNotes({ ...DEFAULT_INPUTS, conversion: 150 })
    expect(notes).toContainEqual({ field: 'conversion', entered: 150, used: 100 })
  })

  it('reports cpl clamped to 0.01', () => {
    const notes = clampNotes({ ...DEFAULT_INPUTS, cpl: 0.001 })
    expect(notes).toContainEqual({ field: 'cpl', entered: 0.001, used: 0.01 })
  })

  it('returns no notes for DEFAULT_INPUTS', () => {
    expect(clampNotes(DEFAULT_INPUTS)).toEqual([])
  })
})

describe('validateInputs', () => {
  it('fills missing keys from DEFAULT_INPUTS', () => {
    const result = validateInputs({})
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual(DEFAULT_INPUTS)
    }
  })

  it('rejects a non-number value', () => {
    expect(validateInputs({ cpl: 'x' }).ok).toBe(false)
  })

  it('rejects an unknown field', () => {
    expect(validateInputs({ foo: 1 }).ok).toBe(false)
  })

  it('rejects a negative value', () => {
    expect(validateInputs({ adSpend: -1 }).ok).toBe(false)
  })

  it('accepts an out-of-range percent without clamping', () => {
    const result = validateInputs({ conversion: 150 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.conversion).toBe(150)
    }
  })

  it('rejects null', () => {
    expect(validateInputs(null).ok).toBe(false)
  })

  it('rejects an array', () => {
    expect(validateInputs([]).ok).toBe(false)
  })
})

describe('unrealisticWarnings', () => {
  it('warns when cpl is below 0.5', () => {
    const input = { ...DEFAULT_INPUTS, adSpend: 1000, cpl: 0.4 }
    const warnings = unrealisticWarnings(input, calculate(input))
    expect(warnings).toEqual(['每条线索成本低于 0.5，参数可能不现实'])
  })

  it('returns no warnings for DEFAULT_INPUTS', () => {
    expect(unrealisticWarnings(DEFAULT_INPUTS, calculate(DEFAULT_INPUTS))).toEqual([])
  })
})

describe('clampNotes 浮点噪音', () => {
  it.each([7, 3, 10, 9, 0.1])('毛利 20、佣金 %s 不冒出假的夹逼提示', commissionRate => {
    expect(clampNotes({ ...DEFAULT_INPUTS, grossMargin: 20, commissionRate })).toEqual([])
  })

  it('毛利 15、佣金 7、毛利 100 搭配佣金 7 也都没有提示', () => {
    expect(clampNotes({ ...DEFAULT_INPUTS, grossMargin: 15, commissionRate: 7 })).toEqual([])
    expect(clampNotes({ ...DEFAULT_INPUTS, grossMargin: 100, commissionRate: 7 })).toEqual([])
  })
})
