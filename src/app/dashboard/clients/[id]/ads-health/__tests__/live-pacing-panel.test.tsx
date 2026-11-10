/** @vitest-environment jsdom */
import React from 'react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import LivePacingPanel from '../live-pacing-panel'

describe('LivePacingPanel', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          view: {
            readAtIso: '2026-11-09T08:00:00.000Z',
            accounts: [
              {
                adAccountId: 'act_synth',
                readState: 'ok',
                reason: null,
                currency: 'NZD',
                accountDay: '2026-11-09',
                active: [{ adsetId: '1', spendToday: 12.5, impressionsToday: 100, name: 'A', status: 'ACTIVE', dailyBudget: null, budgetLevel: 'campaign' as const, createdToday: false, adCount: 1 }],
                newToday: [],
              },
            ],
          },
        }),
      })),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows honest insufficient state for forecast metrics', async () => {
    render(<LivePacingPanel clientId="client-synth" />)
    expect(await screen.findByText('节奏 / 收盘预测')).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByText('12.50 NZD')).toBeTruthy()
    })
    expect(screen.getAllByText(/数据不足/).length).toBeGreaterThan(0)
  })

  it('shows a spend forecast when samples exist, and not a results forecast', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          view: {
            readAtIso: '2026-11-09T08:00:00.000Z',
            accounts: [
              {
                adAccountId: 'act_synth',
                readState: 'ok',
                reason: null,
                currency: 'NZD',
                accountDay: '2026-11-09',
                active: [{ adsetId: '1', spendToday: 8, impressionsToday: 100, name: 'A', status: 'ACTIVE', dailyBudget: null, budgetLevel: 'campaign' as const, createdToday: false, adCount: 1 }],
                newToday: [],
              },
            ],
          },
          pacing: {
            clientOverCap: true,
            capMajor: 10,
            forecastMajor: 14.22,
            currency: 'NZD',
            accounts: [{
              adAccountId: 'act_synth',
              accountDay: '2026-11-09',
              timezone: 'Pacific/Auckland',
              currency: 'NZD',
              sampledAt: '2026-11-09T01:00:00.000Z',
              spendMajor: 8,
              forecastStatus: 'ok',
              forecastReason: null,
              pointMinor: 1422,
              pointMajor: 14.22,
              lowMajor: 12,
              highMajor: 16,
              priorMedianMajor: 5.8,
              segmentMajor: null,
              cpm: 80,
            }],
          },
        }),
      })),
    )
    render(<LivePacingPanel clientId="client-synth" />)
    expect(await screen.findByText(/14\.22 NZD/)).toBeTruthy()
    expect(screen.getByText(/高于已批准计划的每天上限/)).toBeTruthy()
    expect(screen.getAllByText(/没有结果或链接点击/).length).toBeGreaterThan(0)
  })
})
