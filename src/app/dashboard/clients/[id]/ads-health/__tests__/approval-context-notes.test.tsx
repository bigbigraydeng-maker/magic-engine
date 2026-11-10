import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { ApprovalContextNotes } from '../approval-context-notes'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('ApprovalContextNotes', () => {
  it('拉取上下文并展示冷却行', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        context: {
          lastOnAdset: { kind: 'none' },
          cooldown: {
            kind: 'ok',
            data: { untilIso: '2026-11-05T06:00:00.000Z', untilLabel: '5 Nov 2026, 19:00' },
          },
          thisRunReadback: 'pending',
        },
      }),
    })))

    render(
      <ApprovalContextNotes
        clientId="c1"
        adsetId="adset-1"
        runId="run-1"
        runStatus="pending_approval"
      />,
    )
    await waitFor(() => expect(screen.getByText(/72 小时冷却中/)).toBeTruthy())
    expect(screen.getByText(/还没有过内核记录/)).toBeTruthy()
  })
})
