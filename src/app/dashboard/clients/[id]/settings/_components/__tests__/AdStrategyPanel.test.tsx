/**
 * AdStrategyPanel — 保存被接口 403 拒绝时（非内部员工），要给人话提示，
 * 并且界面继续显示原来的设置，不能让人以为已经关掉了。
 */
import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { AdStrategyPanel } from '../AdStrategyPanel'

const CLIENT_ID = 'client-uuid-ad-strategy-panel-test'

function mockFetchSequence(responses: Array<{ status?: number; json: unknown }>) {
  let i = 0
  vi.stubGlobal('fetch', vi.fn(async () => {
    const r = responses[Math.min(i, responses.length - 1)]
    i += 1
    const status = r.status ?? 200
    return new Response(JSON.stringify(r.json), { status })
  }))
}

const CONFIG = { client_id: CLIENT_ID, enabled: true, digest_recipients: ['fde@staff.test'] }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AdStrategyPanel', () => {
  it('403 on save → plain-Chinese staff-only message, original state kept', async () => {
    mockFetchSequence([
      { json: { success: true, config: CONFIG } },
      { status: 403, json: { error: 'Forbidden' } },
    ])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<AdStrategyPanel clientId={CLIENT_ID} />)

    const toggle = await screen.findByRole('switch', { name: '开关广告健康监测' })
    fireEvent.click(toggle)

    await waitFor(() => {
      expect(screen.getByText(/只有 Magic Engine 内部同事能改这项/)).toBeInTheDocument()
    })
    expect(screen.getByText('监测中 · 每天体检')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: '开关广告健康监测' })).toHaveAttribute('aria-checked', 'true')
  })

  it('403 on recipients save → unsaved edit is put back to the stored list', async () => {
    mockFetchSequence([
      { json: { success: true, config: CONFIG } },
      { status: 403, json: { error: 'Forbidden' } },
    ])
    render(<AdStrategyPanel clientId={CLIENT_ID} />)

    const box = await screen.findByPlaceholderText(/zhang@example.com/)
    fireEvent.change(box, { target: { value: 'attacker@evil.test' } })
    fireEvent.click(screen.getByRole('button', { name: '保存收件人' }))

    await waitFor(() => {
      expect(screen.getByText(/只有 Magic Engine 内部同事能改这项/)).toBeInTheDocument()
    })
    expect(box).toHaveValue('fde@staff.test')
  })

  it('other save failures keep the generic retry message', async () => {
    mockFetchSequence([
      { json: { success: true, config: CONFIG } },
      { status: 500, json: { error: 'boom' } },
    ])
    render(<AdStrategyPanel clientId={CLIENT_ID} />)

    fireEvent.click(await screen.findByRole('button', { name: '保存收件人' }))

    await waitFor(() => {
      expect(screen.getByText(/保存没成功,原来的设置还在/)).toBeInTheDocument()
    })
    expect(screen.queryByText(/内部同事/)).not.toBeInTheDocument()
  })
})
