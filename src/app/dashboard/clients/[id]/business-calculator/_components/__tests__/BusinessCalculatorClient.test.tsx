/**
 * 经营测算页：默认值必须算出计算器原值（黄金数字），改参数立刻变，被夹逼要说出来。
 * 场景保存走接口，这里只假 fetch 返回空列表，接口本身另有测试。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BusinessCalculatorClient } from '../BusinessCalculatorClient'

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ success: true, scenarios: [] }), { status: 200 })),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function setInput(key: string, value: string): void {
  fireEvent.change(screen.getByTestId(`input-${key}`), { target: { value } })
}

describe('BusinessCalculatorClient', () => {
  it('默认值算出计算器原值：利润 $40,571', async () => {
    render(<BusinessCalculatorClient clientId="c1" />)
    expect(screen.getByTestId('result-profit').textContent).toContain('40,571')
    expect(screen.getByTestId('result-panel').textContent).toContain('内部模拟')
    await waitFor(() => expect(fetch).toHaveBeenCalled())
  })

  it('改成交率立刻变：转化率 0 → 打平无法计算、利润 −$220,000', async () => {
    render(<BusinessCalculatorClient clientId="c1" />)
    setInput('conversion', '0')
    const panel = screen.getByTestId('result-panel').textContent ?? ''
    expect(screen.getByTestId('result-profit').textContent).toContain('220,000')
    expect(panel).toContain('无法计算')
    await waitFor(() => expect(fetch).toHaveBeenCalled())
  })

  it('佣金率高于毛利率时说出「已按 20 计算」', async () => {
    render(<BusinessCalculatorClient clientId="c1" />)
    setInput('commissionRate', '30')
    expect(screen.getByText(/已按 20 计算/)).toBeTruthy()
    await waitFor(() => expect(fetch).toHaveBeenCalled())
  })

  it('线索价低于 0.5 时红字提示参数可能不现实', async () => {
    render(<BusinessCalculatorClient clientId="c1" />)
    setInput('cpl', '0.4')
    expect(screen.getAllByText(/可能不现实/).length).toBeGreaterThan(0)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
  })

  it('页面不出现授权或承诺类字眼', async () => {
    render(<BusinessCalculatorClient clientId="c1" />)
    const text = document.body.textContent ?? ''
    for (const banned of ['可以加', '建议加', '有空间', '批准预算']) {
      expect(text).not.toContain(banned)
    }
    expect(text).toContain('不构成预算依据')
    await waitFor(() => expect(fetch).toHaveBeenCalled())
  })

  it('价格填负数：仍照算，但不让保存并说清原因', async () => {
    render(<BusinessCalculatorClient clientId="c1" />)
    setInput('tourPrice', '-3500')
    const reason = screen.getByTestId('save-blocked').textContent ?? ''
    expect(reason).toContain('暂时不能保存')
    expect(reason).toContain('Tour 人均价格')
    expect(reason).not.toContain('tourPrice')
    const save = screen.getByRole('button', { name: '保存当前' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
  })

  it('线索量折算人数的标签不带「建议」二字', async () => {
    render(<BusinessCalculatorClient clientId="c1" />)
    expect(document.body.textContent ?? '').not.toContain('建议')
    await waitFor(() => expect(fetch).toHaveBeenCalled())
  })
})
