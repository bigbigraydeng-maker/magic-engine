import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import NetworkPage from '../page'

const VIEW = {
  ready: false,
  displayName: '小王',
  status: 'approved',
  identityLabel: '尚未认定',
  monthLabel: '还没有销售月',
  pendingMuCents: 0,
  validMuCents: 0,
  retailRateLabel: '25.00%',
  retailNextLabel: null,
  teamMuCents: 0,
  teamTierLabel: '未到档',
  teamNextLabel: null,
  earnings: { retail: 0, l1: 0, l2: 0, team: 0, peer: 0, total: 0 },
  byProduct: [],
  tree: [{ id: 'b', name: '李四', identityLabel: '尚未认定', teamMuCents: 0, depth: 1 }],
  settlements: [],
  payoutStatusLabel: '还没有月结',
  fxLabel: null,
  localPayoutLabel: null,
  shares: [{ productName: 'Magic Lab AI 数字人管家', code: 'ABCD2345', url: 'https://app.magicengine.com.au/mn/p/magic-lab?ref=ABCD2345' }],
  notices: ['单位制账本还没启用，所以这里没有金额。'],
}

afterEach(() => vi.unstubAllGlobals())

describe('unit-system partner page', () => {
  it('asks for a new link when the portal session is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })))
    render(<NetworkPage />)
    expect(await screen.findByText(/登录链接已失效/)).toBeTruthy()
  })

  it('shows identity, team and the product share link without inventing a conversion', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => VIEW })))
    render(<NetworkPage />)
    expect(await screen.findByText(/小王/)).toBeTruthy()
    expect(screen.getByText('尚未认定')).toBeTruthy()
    expect(screen.getByText(/李四/)).toBeTruthy()
    expect(screen.getByText(/汇率还没锁定/)).toBeTruthy()
    const link = screen.getByLabelText(/Magic Lab AI 数字人管家/) as HTMLInputElement
    expect(link.value).toBe('https://app.magicengine.com.au/mn/p/magic-lab?ref=ABCD2345')
  })
})
