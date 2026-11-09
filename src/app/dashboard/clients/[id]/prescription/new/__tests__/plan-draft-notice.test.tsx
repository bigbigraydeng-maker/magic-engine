import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { PlanDraftNotice } from '../plan-draft-notice'

function receipt(text: string) {
  return { ok: true, json: async () => ({ plan_draft: { tone: 'ok', text, settled: true } }) }
}

describe('推广计划草稿卡', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('re-reads and shows the new receipt after a refine on the same prescription id', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(receipt('没有广告打法，没有起草。'))
      .mockResolvedValueOnce(receipt('已根据处方第 1 版起草一份未批准的推广计划。'))
    vi.stubGlobal('fetch', fetchMock)

    const { rerender } = render(<PlanDraftNotice clientId="c1" prescriptionId="p1" refineRound={0} />)
    await waitFor(() => expect(screen.getByText('没有广告打法，没有起草。')).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledTimes(1)

    rerender(<PlanDraftNotice clientId="c1" prescriptionId="p1" refineRound={1} />)
    await waitFor(() => expect(screen.getByText('已根据处方第 1 版起草一份未批准的推广计划。')).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('没有广告打法，没有起草。')).toBeNull()
  })
})
