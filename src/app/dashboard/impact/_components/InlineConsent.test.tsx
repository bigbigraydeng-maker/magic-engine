import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/app/dashboard/clients/[id]/prescription/new/review-actions', () => ({
  PrescriptionReviewActions: ({ onApprove }: { onApprove: () => void }) => (
    <button type="button" onClick={onApprove}>同意</button>
  ),
}))

import { InlineConsent } from './InlineConsent'

describe('project desk prescription consent', () => {
  beforeEach(() => {
    refresh.mockReset()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows a conflict instead of claiming approval when the API returns 409', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409 }))
    render(<InlineConsent clientId="client-a" prescriptionId="rx-a" />)
    fireEvent.click(screen.getByRole('button', { name: '同意' }))
    await waitFor(() => expect(screen.getByText('这张方的状态已经变了。请刷新后再看。')).toBeTruthy())
    expect(screen.queryByText(/已记下同意/)).toBeNull()
    expect(refresh).toHaveBeenCalledOnce()
  })
})
