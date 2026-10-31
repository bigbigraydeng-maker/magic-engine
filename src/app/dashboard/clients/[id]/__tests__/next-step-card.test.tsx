import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { NextStepCard } from '../_components/NextStepCard'

describe('下一步卡片', () => {
  afterEach(cleanup)

  it('opens the prescription dialog and does not send people to a diagnosis first', () => {
    render(<NextStepCard discoveryStatus="confirmed" prescriptionStatus="none" clientId="c1" />)
    expect(screen.queryByText(/诸葛亮/)).not.toBeInTheDocument()
    expect(screen.queryByText(/诊断/)).not.toBeInTheDocument()
    expect(screen.queryByText(/广告 Agent/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '打开处方 →' })).toHaveAttribute(
      'href',
      '/dashboard/clients/c1/prescription/new',
    )
  })

  it('does not offer a diagnosis detour when writing failed', () => {
    render(<NextStepCard discoveryStatus="confirmed" prescriptionStatus="failed" clientId="c1" />)
    expect(screen.queryByText(/诊断/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '打开处方 →' })).toBeInTheDocument()
  })
})
