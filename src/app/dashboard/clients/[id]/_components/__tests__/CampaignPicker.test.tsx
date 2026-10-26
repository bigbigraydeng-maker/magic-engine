// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CampaignPicker } from '../CampaignPicker'

const FIVE = [
  { id: 'a', title: 'Spring Launch · Four Tours · Daily Plan · Campaign' },
  { id: 'b', title: '秋季招募 · 新价 · 招 18 人 · Campaign' },
  { id: 'c', title: 'Search Ads Sprint · Campaign' },
  { id: 'd', title: 'Brand Engine — 30 day matrix · Campaign' },
  { id: 'e', title: 'SEO Foundation — expert hub · Campaign' },
]

afterEach(cleanup)

describe('CampaignPicker', () => {
  it('shows nothing when there is only one campaign (nothing to pick)', () => {
    const { container } = render(<CampaignPicker campaigns={FIVE.slice(0, 1)} selectedId="a" onSelect={vi.fn()} />)
    expect(container.textContent).toBe('')
  })

  it('more than three campaigns: a dropdown with short names, the full title kept on each option', () => {
    const onSelect = vi.fn()
    render(<CampaignPicker campaigns={FIVE} selectedId="a" onSelect={onSelect} />)
    const select = screen.getByLabelText('推广活动') as HTMLSelectElement
    expect(select.value).toBe('a')
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['Spring Launch', '秋季招募', 'Search Ads Sprint', 'Brand Engine', 'SEO Foundation'])
    expect(select.options[0].title).toBe(FIVE[0].title)
    expect(screen.getByText('共 5 个进行中')).toBeTruthy()
    fireEvent.change(select, { target: { value: 'c' } })
    expect(onSelect).toHaveBeenCalledWith('c')
  })

  it('two or three campaigns: side-by-side buttons with short names, the chosen one marked', () => {
    const onSelect = vi.fn()
    render(<CampaignPicker campaigns={FIVE.slice(0, 3)} selectedId="b" onSelect={onSelect} />)
    expect(screen.getByRole('group', { name: '推广活动' })).toBeTruthy()
    const chosen = screen.getByRole('button', { name: '秋季招募' })
    expect(chosen.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Spring Launch' }).getAttribute('aria-pressed')).toBe('false')
    expect(chosen.getAttribute('title')).toBe(FIVE[1].title)
    fireEvent.click(screen.getByRole('button', { name: 'Search Ads Sprint' }))
    expect(onSelect).toHaveBeenCalledWith('c')
  })
})
