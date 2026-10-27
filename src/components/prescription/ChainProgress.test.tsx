import React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChainProgress } from './ChainProgress'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ChainProgress', () => {
  it('renders nine dots and the stuck sentence', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        chain: {
          prescriptionId: 'rx-1',
          snapshotStale: true,
          steps: [
            { id: 'inspect', label: '看', state: 'blocked', stateLabel: '卡住', detail: '广告现状快照超过 12 小时没更新。' },
            { id: 'measure', label: '量', state: 'done', stateLabel: '完成', detail: '' },
            { id: 'confirm', label: '确认', state: 'done', stateLabel: '完成', detail: '' },
            { id: 'prescribe', label: '开方', state: 'done', stateLabel: '完成', detail: '' },
            { id: 'consent', label: '同意', state: 'active', stateLabel: '进行中', detail: '等内部账号点同意。' },
            { id: 'plan', label: '计划', state: 'waiting', stateLabel: '还没到', detail: '' },
            { id: 'creative', label: '素材', state: 'waiting', stateLabel: '还没到', detail: '' },
            { id: 'draft', label: '草稿', state: 'unread', stateLabel: '读不到', detail: '读不到' },
            { id: 'launch', label: '开投', state: 'unread', stateLabel: '读不到', detail: '读不到' },
          ],
        },
      }),
    }))

    render(<ChainProgress clientId="client-1" prescriptionId="rx-1" />)
    expect(await screen.findByText('广告现状快照超过 12 小时没更新。')).toBeTruthy()
    expect(screen.getByRole('list', { name: '链路进度' }).children).toHaveLength(9)
    expect(screen.getAllByText('读不到')).toHaveLength(2)
    expect(screen.getAllByText('还没到').length).toBeGreaterThan(0)
  })

  it('shows 读不到 when the request fails, without filling the nine dots', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }))
    render(<ChainProgress clientId="client-1" prescriptionId="rx-1" />)
    await waitFor(() => expect(screen.getByText('读不到')).toBeTruthy())
    expect(screen.queryByRole('list', { name: '链路进度' })).toBeNull()
  })
})
