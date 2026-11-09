/**
 * 员工手记在抽屉时间线里：原话是主行，AI 整理只是旁边的小字（PM 2026-10-30）。
 * 同时钉住：最新一条（刚记的笔记）折叠时也看得见，不藏在「看更早的往来」后面。
 */

import React from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ContactTimeline, type TimelineEntry } from '../ContactTimeline'

const NOTE = '大瑞测试，可能感兴趣 14 days China unveiled'

const touch = (over: Partial<TimelineEntry> = {}): TimelineEntry => ({
  kind: 'touch',
  at: '2026-10-30T04:06:42Z',
  channel: 'phone',
  direction: 'outbound',
  summary: '客户可能对中国之旅有兴趣。',
  raw: NOTE,
  rawKind: 'verbatim',
  staffNote: true,
  loggedBy: 'info@ctstours.co.nz',
  ...over,
})

function mockTimeline(timeline: TimelineEntry[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ contact: { name: 'Nathan', phone: null, email: null, stageLabel: null }, timeline }),
    }),
  )
}

beforeEach(() => vi.unstubAllGlobals())

describe('员工手记显示原话', () => {
  it('主行是员工原话 + 标明「员工记录」和是谁记的', async () => {
    mockTimeline([touch()])
    render(<ContactTimeline clientId="cts" contactId="c1" />)
    const main = await screen.findByTestId('staff-note')
    expect(main.textContent).toContain('员工记录')
    expect(main.textContent).toContain('info@ctstours.co.nz')
    expect(main.textContent).toContain(NOTE)
  })

  it('AI 整理是单独一行小字，标「AI 整理」，不替代原话', async () => {
    mockTimeline([touch()])
    render(<ContactTimeline clientId="cts" contactId="c1" />)
    const ai = await screen.findByTestId('staff-note-ai')
    expect(ai.textContent).toContain('AI 整理')
    expect(ai.textContent).toContain('客户可能对中国之旅有兴趣')
    expect(screen.getByTestId('staff-note').textContent).not.toContain('客户可能对中国之旅有兴趣')
  })

  it('AI 整理与原话一样时不重复画第二行', async () => {
    mockTimeline([touch({ summary: NOTE })])
    render(<ContactTimeline clientId="cts" contactId="c1" />)
    await screen.findByTestId('staff-note')
    expect(screen.queryByTestId('staff-note-ai')).toBeNull()
  })

  it('非员工手记（例如电话系统的记录）保持原样，没有「员工记录」', async () => {
    mockTimeline([touch({ staffNote: undefined, loggedBy: undefined, summary: '通话 3 分钟', raw: null })])
    render(<ContactTimeline clientId="cts" contactId="c1" />)
    await waitFor(() => expect(screen.getByText('通话 3 分钟')).toBeTruthy())
    expect(screen.queryByTestId('staff-note')).toBeNull()
  })
})

describe('刚记的笔记折叠时也看得见', () => {
  it('往来很多时，最新一条笔记在折叠视图里，不藏在「看更早的往来」后面', async () => {
    const older: TimelineEntry[] = Array.from({ length: 8 }, (_, i) => ({
      kind: 'touch',
      at: `2026-10-1${i}T00:00:00Z`,
      channel: 'email',
      direction: 'inbound',
      summary: `旧往来 ${i}`,
    }))
    mockTimeline([...older, touch()])
    render(<ContactTimeline clientId="cts" contactId="c1" collapsible />)
    await screen.findByTestId('staff-note')
    expect(screen.getByText(/看更早的往来/)).toBeTruthy()
  })
})
