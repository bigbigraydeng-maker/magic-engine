import React from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CapiSendSettings } from '../CapiSendSettings'

afterEach(() => { vi.restoreAllMocks() })

describe('成交配置已经接到记成交', () => {
  it('哪一笔记成成交和手录金额按已接上的说法写', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ config: {}, stages: [] }),
    }))
    render(<CapiSendSettings clientId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" />)
    expect(await screen.findByText(/自动记下成交并发送/)).toBeTruthy()
    expect(screen.getByText(/可以手填金额/)).toBeTruthy()
    expect(screen.queryByText(/还没生效/)).toBeNull()
  })
})
