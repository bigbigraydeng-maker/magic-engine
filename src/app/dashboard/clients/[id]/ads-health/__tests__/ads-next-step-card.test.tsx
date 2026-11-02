import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import AdsNextStepCard from '../ads-next-step-card'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('AdsNextStepCard', () => {
  it('渲染合并卡三行标签', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        view: {
          healthRedLights: { kind: 'ok', data: { items: ['花钱没结果'] } },
          pendingActions: { kind: 'empty' },
          prescription: { kind: 'empty' },
        },
      }),
    })))

    render(<AdsNextStepCard clientId="client-1" />)
    await waitFor(() => expect(screen.getByText('花钱没结果')).toBeTruthy())
    expect(screen.getByText('广告下一步')).toBeTruthy()
    expect(screen.getByText('体检红灯')).toBeTruthy()
    expect(screen.getByText('待批动作')).toBeTruthy()
    expect(screen.getByText('处方状态')).toBeTruthy()
  })
})
