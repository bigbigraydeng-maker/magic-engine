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

  it('🔴 读不出设置 → 显示后端的中文提示和重试按钮，不给开关和收件人输入框', async () => {
    mockFetchSequence([
      { status: 503, json: { error: '读不出这个客户当前的广告设置，请稍后再试' } },
    ])
    render(<AdStrategyPanel clientId={CLIENT_ID} />)

    await screen.findByText(/读不出这个客户当前的广告设置/)
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByPlaceholderText(/zhang@example.com/)).toBeNull()
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
    expect(screen.getByText(/加载失败:读不出这个客户当前的广告设置/)).toBeInTheDocument()
  })

  it('🔴 保存已写库但回读失败、重读成功 → 显示重读到的真值，不说「保存没成功」', async () => {
    mockFetchSequence([
      { json: { success: true, config: CONFIG } },
      { status: 503, json: { error: '设置已保存，但读不出保存后的结果，请刷新页面确认', saved: true } },
      { json: { success: true, config: { ...CONFIG, enabled: false } } },
    ])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<AdStrategyPanel clientId={CLIENT_ID} />)

    const toggle = await screen.findByRole('switch', { name: '开关广告健康监测' })
    fireEvent.click(toggle)

    await waitFor(() => {
      expect(screen.getByText('已暂停 · 不体检')).toBeInTheDocument()
    })
    expect(screen.queryByText(/保存没成功/)).not.toBeInTheDocument()
    // 成功提示要出现（已保存是事实）
    expect(screen.getByText(/已暂停,这个客户不再体检、不再预警/)).toBeInTheDocument()
    // 重读必须是一次读取（第 3 次请求不带 method），不是把保存再发一遍
    const calls = vi.mocked(fetch).mock.calls
    expect(calls).toHaveLength(3)
    expect(calls[2][1]).toBeUndefined()
  })

  it('🔴 保存已写库但回读失败、重读也失败 → 说「已保存但读不出来」，不给表单', async () => {
    mockFetchSequence([
      { json: { success: true, config: CONFIG } },
      { status: 503, json: { error: '设置已保存，但读不出保存后的结果，请刷新页面确认', saved: true } },
      { status: 503, json: { error: '读不出这个客户当前的广告设置，请稍后再试' } },
    ])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<AdStrategyPanel clientId={CLIENT_ID} />)

    const toggle = await screen.findByRole('switch', { name: '开关广告健康监测' })
    fireEvent.click(toggle)

    await screen.findByText(/设置已保存，但现在读不出来/)
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByText(/保存没成功/)).not.toBeInTheDocument()
    expect(screen.queryByText(/加载失败/)).not.toBeInTheDocument()
  })

  it('读取失败后点重试、这次读到了 → 表单出现', async () => {
    mockFetchSequence([
      { status: 503, json: { error: '读不出这个客户当前的广告设置，请稍后再试' } },
      { json: { success: true, config: CONFIG } },
    ])
    render(<AdStrategyPanel clientId={CLIENT_ID} />)

    fireEvent.click(await screen.findByRole('button', { name: '重试' }))

    expect(await screen.findByRole('switch', { name: '开关广告健康监测' })).toBeInTheDocument()
  })
})
