/**
 * 板桥 2026-08-11 PR6 复审: the 诸葛亮 FAB (internal FDE workbench, all-Chinese
 * UI) used to mount unconditionally for every visitor to /dashboard/clients/[id]
 * — including self_serve customers going through the plain-English onboarding
 * wizard. This locks in the fix: self_serve never sees it, everyone else does.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const headersMock = vi.fn<() => { get: (k: string) => string | null }>()
vi.mock('next/headers', () => ({
  headers: () => headersMock(),
}))

vi.mock('../_components/ZhugeGlobalFab', () => ({
  ZhugeGlobalFab: ({ clientId }: { clientId: string }) => <div data-testid="zhuge-fab">{clientId}</div>,
}))
vi.mock('@/lib/meta/ai/entitlement',()=>({ pilotEntryVisible:vi.fn().mockResolvedValue(false) }))

import ClientLayout from '../layout'

function setTier(value: string | null) {
  headersMock.mockReturnValue({
    get: (k: string) => (k === 'x-user-tier' ? value : null),
  })
}

beforeEach(() => {
  headersMock.mockReset()
})

describe('ClientLayout — 诸葛亮 FAB gating', () => {
  it('hides the FAB for self_serve visitors', async () => {
    setTier('self_serve')
    render(await ClientLayout({ params:{ id:'client-1' },children:<p>page content</p> }))
    expect(screen.getByText('page content')).toBeTruthy()
    expect(screen.queryByTestId('zhuge-fab')).toBeNull()
  })

  it('shows the FAB for paid_client visitors', async () => {
    setTier('paid_client')
    render(await ClientLayout({ params:{ id:'client-1' },children:<p>page content</p> }))
    expect(screen.getByTestId('zhuge-fab')).toBeTruthy()
  })

  it('shows the FAB for admin visitors', async () => {
    setTier('admin')
    render(await ClientLayout({ params:{ id:'client-1' },children:<p>page content</p> }))
    expect(screen.getByTestId('zhuge-fab')).toBeTruthy()
  })

  it('shows the FAB when the tier header is missing (fails open, matches readUserTier default)', async () => {
    setTier(null)
    render(await ClientLayout({ params:{ id:'client-1' },children:<p>page content</p> }))
    expect(screen.getByTestId('zhuge-fab')).toBeTruthy()
  })
})
