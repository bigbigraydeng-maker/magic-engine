import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import AdsNextStepCard from '../ads-next-step-card'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const okView = {
  healthRedLights: { kind: 'ok' as const, data: { items: ['花钱没结果'] } },
  pendingActions: { kind: 'empty' as const },
  prescription: { kind: 'empty' as const },
}

describe('AdsNextStepCard', () => {
  it('渲染合并卡三行标签', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ view: okView }),
    })))

    render(<AdsNextStepCard clientId="client-1" />)
    await waitFor(() => expect(screen.getByText('花钱没结果')).toBeTruthy())
    expect(screen.getByText('广告下一步')).toBeTruthy()
  })

  it('加载中显示「读取中…」，不显示「没读到」', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    render(<AdsNextStepCard clientId="client-1" />)
    expect(screen.getAllByText('读取中…').length).toBe(3)
    expect(screen.queryByText('没读到')).toBeNull()
  })

  it('某行 unreadable 时只该行显示「没读到」', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        view: {
          healthRedLights: { kind: 'unreadable' },
          pendingActions: { kind: 'empty' },
          prescription: { kind: 'ok', data: { version: 1, statusLabel: '草稿', approvedAt: null } },
        },
      }),
    })))
    render(<AdsNextStepCard clientId="client-1" />)
    await waitFor(() => expect(screen.getByText('第 1 版 · 草稿')).toBeTruthy())
    const unreadable = screen.getAllByText('没读到')
    expect(unreadable.length).toBe(1)
  })

  it('fetch 非 ok 时三行都是「没读到」', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })))
    render(<AdsNextStepCard clientId="client-1" />)
    await waitFor(() => expect(screen.getAllByText('没读到').length).toBe(3))
  })

  it('fetch reject 时三行都是「没读到」', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network') }))
    render(<AdsNextStepCard clientId="client-1" />)
    await waitFor(() => expect(screen.getAllByText('没读到').length).toBe(3))
  })
})
