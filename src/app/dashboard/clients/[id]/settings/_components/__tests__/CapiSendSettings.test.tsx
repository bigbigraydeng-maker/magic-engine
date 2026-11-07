import React from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CapiSendSettings } from '../CapiSendSettings'

afterEach(() => { vi.restoreAllMocks() })

describe('成交配置在记成交接上之前', () => {
  it('哪一笔记成成交和手录金额都标明还没生效', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ config: {}, stages: [] }),
    }))
    render(<CapiSendSettings clientId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" />)
    expect(await screen.findAllByText(/还没生效/)).toHaveLength(2)
  })
})
