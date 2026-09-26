/**
 * 门户「紧急全渠道停」按钮（issue #1589）。双向：停用 + 重新打开。
 *
 * 核心行为：二次确认短语打错/取消一律不发请求（防手滑），打对了才真的
 * 调用后端，并把后端返回的结果（成功/审计告警/失败）如实显示。两个方向
 * 各自独立的短语，不能互相混用。
 */

import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { MessengerEmergencyStopPanel } from '../MessengerEmergencyStopPanel'

const CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'

function mockFetch(body: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, json: async () => body })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('MessengerEmergencyStopPanel', () => {
  it('打开面板就能看到停用和重新打开两个按钮', () => {
    mockFetch({})
    render(<MessengerEmergencyStopPanel clientId={CLIENT_ID} />)
    expect(screen.getByRole('button', { name: /紧急全渠道停/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /重新打开/ })).toBeInTheDocument()
  })

  it('确认框输入不对 → 不发任何请求', async () => {
    const fetchMock = mockFetch({})
    vi.stubGlobal('prompt', vi.fn().mockReturnValue('算了'))
    render(<MessengerEmergencyStopPanel clientId={CLIENT_ID} />)

    await userEvent.click(screen.getByRole('button', { name: /紧急全渠道停/ }))

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('确认框取消（返回 null）→ 不发任何请求', async () => {
    const fetchMock = mockFetch({})
    vi.stubGlobal('prompt', vi.fn().mockReturnValue(null))
    render(<MessengerEmergencyStopPanel clientId={CLIENT_ID} />)

    await userEvent.click(screen.getByRole('button', { name: /紧急全渠道停/ }))

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('停用：确认框输入 STOP-ALL → 调后端 action=stop，成功后显示"已经停了"', async () => {
    const fetchMock = mockFetch({ success: true, stopped: true, auditWarning: null })
    vi.stubGlobal('prompt', vi.fn().mockReturnValue('STOP-ALL'))
    render(<MessengerEmergencyStopPanel clientId={CLIENT_ID} />)

    await userEvent.click(screen.getByRole('button', { name: /紧急全渠道停/ }))

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/clients/${CLIENT_ID}/messenger-agent/kill-switch`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'stop', confirm: 'STOP-ALL' }),
      }),
    )
    expect(await screen.findByText(/已经停了/)).toBeInTheDocument()
  })

  it('重新打开：确认框输入 RESUME-ALL → 调后端 action=resume，成功后显示"已经重新打开"', async () => {
    const fetchMock = mockFetch({ success: true, resumed: true, auditWarning: null })
    vi.stubGlobal('prompt', vi.fn().mockReturnValue('RESUME-ALL'))
    render(<MessengerEmergencyStopPanel clientId={CLIENT_ID} />)

    await userEvent.click(screen.getByRole('button', { name: /重新打开/ }))

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/clients/${CLIENT_ID}/messenger-agent/kill-switch`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'resume', confirm: 'RESUME-ALL' }),
      }),
    )
    expect(await screen.findByText(/已经重新打开/)).toBeInTheDocument()
  })

  it('停用按钮打的却是重新打开的短语 → 不发请求（短语跟按钮必须对应）', async () => {
    const fetchMock = mockFetch({})
    vi.stubGlobal('prompt', vi.fn().mockReturnValue('RESUME-ALL'))
    render(<MessengerEmergencyStopPanel clientId={CLIENT_ID} />)

    await userEvent.click(screen.getByRole('button', { name: /紧急全渠道停/ }))

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('开关翻了但审计写入失败 → 如实告诉用户，不假装完全成功', async () => {
    mockFetch({ success: true, stopped: true, auditWarning: '审计表写入失败' })
    vi.stubGlobal('prompt', vi.fn().mockReturnValue('STOP-ALL'))
    render(<MessengerEmergencyStopPanel clientId={CLIENT_ID} />)

    await userEvent.click(screen.getByRole('button', { name: /紧急全渠道停/ }))

    expect(await screen.findByText(/审计表写入失败/)).toBeInTheDocument()
  })

  it('后端拒绝（比如没权限）→ 显示错误，不谎称成功', async () => {
    mockFetch({ success: false, error: '只有 Magic Engine 内部人员能按这个开关' }, false)
    vi.stubGlobal('prompt', vi.fn().mockReturnValue('STOP-ALL'))
    render(<MessengerEmergencyStopPanel clientId={CLIENT_ID} />)

    await userEvent.click(screen.getByRole('button', { name: /紧急全渠道停/ }))

    expect(await screen.findByText(/只有 Magic Engine 内部人员能按这个开关/)).toBeInTheDocument()
  })
})
