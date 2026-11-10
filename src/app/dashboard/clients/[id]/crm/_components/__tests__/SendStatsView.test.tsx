/**
 * 「发信统计」页：汇总卡片、按天和信的类型分组、每位客人一个状态；读失败给原因和重试，点击 / 回应读不到时不显示成 0。
 */

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { SendStatsView } from '../send-stats/SendStatsView'

const click = { label: '目录', firstClickedAt: '2026-11-10T03:00:00.000Z' }
const row = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  createdAt: '2026-11-10T02:00:00.000Z',
  contactId: 'p1',
  contactName: 'Amy Lee',
  templateKey: 'catalogue-send',
  templateName: '④一键发目录：2027 手册',
  outcome: 'sent',
  blockReason: null,
  clicks: [],
  reaction: null,
  ...over,
})
const payload = (rows: unknown[], over: Record<string, unknown> = {}) => ({ days: 7, truncated: false, reactionsReadable: true, rows, ...over })

function stub(...answers: Array<{ status?: number; body: unknown }>) {
  const f = vi.fn()
  for (const a of answers) f.mockResolvedValueOnce({ ok: (a.status ?? 200) < 300, status: a.status ?? 200, json: async () => a.body })
  vi.stubGlobal('fetch', f)
  return f
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('SendStatsView', () => {
  it('shows the four numbers and a coloured status per guest', async () => {
    stub({ body: payload([
      row({ id: 'a', contactName: 'Clicker', clicks: [click] }),
      row({ id: 'b', contactName: 'Quiet' }),
      row({ id: 'c', contactName: 'Replier', reaction: { at: '2026-11-10T05:00:00.000Z', kind: 'email' } }),
      row({ id: 'd', contactName: 'Blocked', outcome: 'blocked', blockReason: 'frequency_cap' }),
    ]) })
    render(<SendStatsView clientId="c1" />)
    await screen.findByText('Clicker')
    expect(screen.getByText('发出').nextElementSibling?.textContent).toBe('3')
    expect(screen.getByText('点了链接').nextElementSibling?.textContent).toBe('1')
    expect(screen.getByText('回了信 / 来了电话').nextElementSibling?.textContent).toBe('1')
    expect(screen.getByText('被拦 / 出错').nextElementSibling?.textContent).toBe('1')
    expect(screen.getByText(/点了目录/)).toBeTruthy()
    expect(screen.getAllByText('没点链接')).toHaveLength(2)
    expect(screen.getByText(/回信了/)).toBeTruthy()
    expect(screen.getByText(/被拦：最近收到的邮件已达上限/)).toBeTruthy()
    expect(screen.getByText(/系统只能看到点击，看不到「打开」/)).toBeTruthy()
  })

  it('the group header names the mail type in plain words (not the template key) and links each guest to the CRM drawer', async () => {
    stub({ body: payload([row()]) })
    render(<SendStatsView clientId="c1" />)
    const group = await screen.findByTestId('send-group')
    expect(within(group).getByText(/一键发目录/)).toBeTruthy()
    expect(group.textContent).not.toContain('catalogue-send')
    expect(within(group).getByText('Amy Lee').closest('a')?.getAttribute('href')).toBe('/dashboard/clients/c1/crm/all?contact=p1')
  })

  it('a mail-type chip filters the list and the numbers', async () => {
    stub({ body: payload([row({ id: 'a', contactName: 'Cat' }), row({ id: 'b', contactName: 'Count', templateKey: 'countdown-x', templateName: '倒计时信·离出发 4 个月' })]) })
    render(<SendStatsView clientId="c1" />)
    await screen.findByText('Cat')
    expect(screen.getByText('发出').nextElementSibling?.textContent).toBe('2')
    fireEvent.click(screen.getByRole('button', { name: '倒计时信' }))
    expect(screen.queryByText('Cat')).toBeNull()
    expect(screen.getByText('Count')).toBeTruthy()
    expect(screen.getByText('发出').nextElementSibling?.textContent).toBe('1')
  })

  it('🔴 clicks or replies unreadable are said so, never shown as zero', async () => {
    stub({ body: payload([row({ clicks: null })], { reactionsReadable: false }) })
    render(<SendStatsView clientId="c1" />)
    await screen.findByText('Amy Lee')
    expect(screen.getByText('点击读不到')).toBeTruthy()
    expect(screen.getAllByText('这一项读不到')).toHaveLength(2)
    expect(screen.getByText('回了信 / 来了电话').nextElementSibling?.textContent).toBe('—')
  })

  it('🔴 clicks unreadable: the 「点了链接」 card and the group line say so too (never a flat 0)', async () => {
    stub({ body: payload([row({ clicks: null })]) })
    render(<SendStatsView clientId="c1" />)
    await screen.findByText('Amy Lee')
    expect(screen.getByText('点了链接').nextElementSibling?.textContent).toBe('—')
    expect(screen.getByTestId('send-group').textContent).toContain('点击读不到')
    expect(screen.getByTestId('send-group').textContent).not.toContain('0 位点了链接')
  })

  it('changing the time range resets the mail-type filter (the chip may not exist in the new range)', async () => {
    stub({ body: payload([row({ templateKey: 'countdown-x', templateName: '倒计时信·离出发 4 个月' })]) }, { body: payload([row({ contactName: 'Cat' })]) })
    render(<SendStatsView clientId="c1" />)
    await screen.findByText('Amy Lee')
    fireEvent.click(screen.getByRole('button', { name: '倒计时信' }))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '30' } })
    await screen.findByText('Cat')
    expect(screen.getByRole('button', { name: '全部' }).className).toContain('bg-me-charcoal')
  })

  it('🔴 a failed read shows the reason and a retry, never "no mails"; retry asks again', async () => {
    const f = stub({ status: 503, body: { error: '发信统计暂时读不到' } }, { body: payload([row()]) })
    render(<SendStatsView clientId="c1" />)
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toContain('发信统计暂时读不到')
    expect(screen.queryByText(/没有发信记录/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await screen.findByText('Amy Lee')
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('an empty window says so; changing the time range asks for that many days', async () => {
    const f = stub({ body: payload([]) }, { body: payload([]) })
    render(<SendStatsView clientId="c1" />)
    await screen.findByText('这段时间没有发信记录。')
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '30' } })
    await waitFor(() => expect(f).toHaveBeenCalledTimes(2))
    expect(f.mock.calls[1]?.[0]).toBe('/api/clients/c1/crm/send-stats?days=30')
  })

  it('a long list shows the first few and expands on request', async () => {
    stub({ body: payload(Array.from({ length: 11 }, (_, i) => row({ id: `r${i}`, contactName: `Guest ${i}` }))) })
    render(<SendStatsView clientId="c1" />)
    await screen.findByText('还有 3 位 · 展开全部')
    expect(screen.queryByText('Guest 10')).toBeNull()
    fireEvent.click(screen.getByText('还有 3 位 · 展开全部'))
    expect(screen.getByText('Guest 10')).toBeTruthy()
  })
})
