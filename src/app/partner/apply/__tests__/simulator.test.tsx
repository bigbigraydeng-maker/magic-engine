/** 收益模拟器：默认按普通经销商算；改输入马上重算；自己一单不卖时提示团队奖励不发放。 */
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { Simulator } from '../simulator'

describe('Simulator', () => {
  it('starts as a standard distributor and recalculates when inputs change', () => {
    render(<Simulator />)
    // standard: retail 10 × 799 × 20% = 1,598 + peer 80 × 799 × 5% = 3,196 + team 71,910 × 6% = 4,314.60
    expect(screen.getByText('$9,108.60')).toBeTruthy()
    fireEvent.click(within(screen.getByRole('radiogroup', { name: '我的等级' })).getByRole('radio', { name: '特级' }))
    // premier: retail 10 × 799 × 35% = 2,796.50 + team 4,314.60
    expect(screen.getByText('$7,111.10')).toBeTruthy()
  })

  it('warns that the team reward is withheld when I sell nothing myself', () => {
    render(<Simulator />)
    fireEvent.change(screen.getByLabelText('我自己每月卖出'), { target: { value: '0' } })
    expect(screen.getByText(/团队奖励 \$3,835\.20 按规则不发放/)).toBeTruthy()
  })

  it('caps the steppers at their limits', () => {
    render(<Simulator />)
    const direct = screen.getByLabelText('我直接带的经销商') as HTMLInputElement
    fireEvent.change(direct, { target: { value: '9999' } })
    expect(direct.value).toBe('50')
    fireEvent.click(screen.getByRole('button', { name: '我直接带的经销商加 1' }))
    expect(direct.value).toBe('50')
  })
})
