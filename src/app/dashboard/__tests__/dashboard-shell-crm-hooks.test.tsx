// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}))

import DashboardShell from '../dashboard-shell'

afterEach(cleanup)

// The CRM workspace shell (crm/layout.tsx) collapses the big sidebar by targeting these two hooks.
// If they disappear, the CRM collapse silently stops working, so pin them here.
describe('dashboard shell hooks used by the CRM workspace shell', () => {
  it('marks the grid and the sidebar, without hiding anything by itself', () => {
    const { container } = render(
      <DashboardShell
        userEmail="a@example.com"
        userRole="admin"
        userTier="admin"
        allowedClientId={null}
        clientIndustry={null}
        roleLabel="Admin cockpit"
        exactGlobalAdmin
      >
        <p>home</p>
      </DashboardShell>,
    )
    const shell = container.querySelector('[data-me-shell]')
    const sidebar = container.querySelector('aside[data-me-sidebar]')
    expect(shell).not.toBeNull()
    expect(sidebar).not.toBeNull()
    expect(shell?.contains(sidebar)).toBe(true)
    // No collapse style is present unless the CRM layout injects it.
    expect(document.querySelector('style')).toBeNull()
  })
})
