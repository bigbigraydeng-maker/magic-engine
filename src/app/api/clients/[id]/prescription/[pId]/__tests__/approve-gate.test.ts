import { describe, expect, it } from 'vitest'
import { approveDraftContentGate, isPrescriptionContentEmpty } from '../approve-gate'

const FILLED = {
  summary: '三阶段方案',
  phases: [],
  kpi_targets: [],
  budget_allocation: [],
}

describe('isPrescriptionContentEmpty', () => {
  it('空白字符串、空容器、全空字段算空', () => {
    expect(isPrescriptionContentEmpty(null)).toBe(true)
    expect(isPrescriptionContentEmpty(undefined)).toBe(true)
    expect(isPrescriptionContentEmpty('')).toBe(true)
    expect(isPrescriptionContentEmpty('   ')).toBe(true)
    expect(isPrescriptionContentEmpty({})).toBe(true)
    expect(isPrescriptionContentEmpty([])).toBe(true)
    expect(isPrescriptionContentEmpty({
      summary: '',
      narrative: ' \n ',
      phases: [],
      kpi_targets: [],
      budget_allocation: [],
    })).toBe(true)
    expect(isPrescriptionContentEmpty({ phases: [{ title: '  ' }] })).toBe(true)
  })

  it('有可读文字，或写了数字，不算空', () => {
    expect(isPrescriptionContentEmpty(FILLED)).toBe(false)
    expect(isPrescriptionContentEmpty({ summary: '有方案' })).toBe(false)
    expect(isPrescriptionContentEmpty({ narrative: '一段说明' })).toBe(false)
    expect(isPrescriptionContentEmpty({ phases: [{ title: '阶段一' }] })).toBe(false)
    expect(isPrescriptionContentEmpty({ kpi_targets: [{ target_value: 0 }] })).toBe(false)
  })
})

describe('approveDraftContentGate', () => {
  it('草稿且有内容 → 放行', () => {
    expect(approveDraftContentGate('draft', FILLED)).toEqual({ ok: true })
  })

  it('草稿但内容为空 → 422', () => {
    for (const content of [null, undefined, '', '  ', {}, { summary: '', phases: [] }]) {
      expect(approveDraftContentGate('draft', content)).toEqual({
        ok: false,
        httpStatus: 422,
        error: '处方内容为空，不能同意',
      })
    }
  })

  it('退回、失败和其他非草稿状态 → 409，哪怕内容是满的', () => {
    for (const status of ['rejected', 'failed', 'generating', 'superseded', 'approved', 'published']) {
      const result = approveDraftContentGate(status, FILLED)
      expect(result.ok).toBe(false)
      if (result.ok) continue
      expect(result.httpStatus).toBe(409)
      expect(result.error).toContain(status)
    }
  })
})
