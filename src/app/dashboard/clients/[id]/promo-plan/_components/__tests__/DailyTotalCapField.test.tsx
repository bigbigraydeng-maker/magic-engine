import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { MarketingPlan } from '@/lib/marketing-plan/types'
import { baseSpec } from '@/lib/marketing-plan/promo/__tests__/fixtures'
import { PromoSpecForm } from '../PromoSpecForm'

describe('填写每天广告总上限', () => {
  it('用一句中文收这个数，不另加一排按钮', () => {
    const plan = {
      id: 'plan-1',
      updated_at: '2026-11-01T00:00:00.000Z',
      plan_data: { promo: baseSpec() },
      generation_meta: {},
    } as unknown as MarketingPlan
    render(<PromoSpecForm clientId="client-1" plan={plan} options={null} onSaved={() => {}} />)
    expect(screen.getByText('这位客户一天的广告总共不超过')).toBeTruthy()
    const buttons = screen.getAllByRole('button').map(node => node.textContent ?? '')
    expect(buttons.some(text => text.includes('上限'))).toBe(false)
  })
})
