/**
 * 对比表：按夹逼后的值算，所以场景里有数被夹逼时必须在表上说出来；差值先取整再相减。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ComparePanel, type ScenarioRow } from '../ComparePanel'
import { DEFAULT_INPUTS } from '@/lib/crm/industry/travel-business-calculator'

afterEach(cleanup)

function row(name: string, over: Partial<typeof DEFAULT_INPUTS>): ScenarioRow {
  return {
    id: name, name, inputs: { ...DEFAULT_INPUTS, ...over }, formula_version: 1,
    created_by: 'a@b', created_at: '2026-10-15T00:00:00.000000+00:00', updated_at: '2026-10-15T00:00:00.000000+00:00',
  }
}

describe('ComparePanel', () => {
  it('两个场景的利润差值显示正确，并带「内部模拟」', () => {
    render(<ComparePanel a={row('A', {})} b={row('B', { cpl: 14 })} />)
    const table = screen.getByTestId('compare-table').textContent ?? ''
    expect(table).toContain('40,571')
    expect(document.body.textContent).toContain('不构成预算依据')
  })

  it('场景里佣金 30 > 毛利 20 被夹逼 → 对比表上方写明「已按 20 计算」', () => {
    render(<ComparePanel a={row('甲', { commissionRate: 30 })} b={row('乙', {})} />)
    const notes = screen.getByTestId('compare-clamp-notes').textContent ?? ''
    expect(notes).toContain('甲')
    expect(notes).toContain('Sales 佣金率')
    expect(notes).not.toContain('commissionRate')
    expect(notes).toContain('已按 20 计算')
    expect(notes).not.toContain('乙')
  })

  it('没有被夹逼就不出现提示区', () => {
    render(<ComparePanel a={row('A', {})} b={row('B', {})} />)
    expect(screen.queryByTestId('compare-clamp-notes')).toBeNull()
  })
})
