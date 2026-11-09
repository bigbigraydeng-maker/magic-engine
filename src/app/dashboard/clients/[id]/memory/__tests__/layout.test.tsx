import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const access = vi.fn()
vi.mock('@/lib/auth/client-access', () => ({
  requireOperatorAccess: (...args: unknown[]) => access(...args),
}))

import ClientMemoryLayout from '../layout'

describe('客户记忆库页面门', () => {
  it('客户角色 403：不渲染编辑和导出', async () => {
    access.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden', reason: 'forbidden' })
    render(await ClientMemoryLayout({
      params: { id: 'client-1' },
      children: <button type="button">导出 JSON</button>,
    }))
    expect(screen.getByText('客户记忆库只对内部账号开放。')).toBeInTheDocument()
    expect(screen.queryByText('导出 JSON')).toBeNull()
    expect(access).toHaveBeenCalledWith('client-1')
  })

  it('内部账号仍渲染页面内容', async () => {
    access.mockResolvedValue({
      ok: true,
      role: 'admin',
      tier: 'admin',
      allowedClientId: null,
      user: { id: 'u', email: 'pm@magiclab.com' },
    })
    render(await ClientMemoryLayout({
      params: { id: 'client-1' },
      children: <button type="button">导出 JSON</button>,
    }))
    expect(screen.getByText('导出 JSON')).toBeInTheDocument()
    expect(screen.queryByText('客户记忆库只对内部账号开放。')).toBeNull()
  })
})
