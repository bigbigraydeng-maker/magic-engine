// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/clients/c1',
}))

import DashboardShell from '../dashboard-shell'

afterEach(cleanup)

const base = {
  userEmail: 'partner@example.com',
  userTier: 'paid_client' as const,
  clientIndustry: null,
  children: <p>home</p>,
}

describe('工作区侧栏身份', () => {
  it('客户看到 Client view', () => {
    render(
      <DashboardShell
        {...base}
        userRole="client-viewer"
        allowedClientId="c1"
        roleLabel="Client view"
        exactGlobalAdmin={false}
      />,
    )
    expect(screen.getByText('Client view')).toBeInTheDocument()
    expect(screen.queryByText('Admin cockpit')).not.toBeInTheDocument()
    expect(screen.getByText('My client')).toBeInTheDocument()
    expect(screen.queryByText('视频工厂')).not.toBeInTheDocument()
  })

  it('内部账号仍显示 Admin cockpit', () => {
    render(
      <DashboardShell
        {...base}
        userRole="admin"
        allowedClientId={null}
        roleLabel="Admin cockpit"
        exactGlobalAdmin
      />,
    )
    expect(screen.getByText('Admin cockpit')).toBeInTheDocument()
    expect(screen.getByText('视频工厂')).toBeInTheDocument()
  })
})
