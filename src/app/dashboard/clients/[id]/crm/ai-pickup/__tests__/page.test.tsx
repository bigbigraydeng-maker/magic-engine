/**
 * 「交给 AI 跟进」页：名单按组分，员工一组一组放行（PM 2026-11-28）。
 * 钉住：三组各自成块、带人数；「员工留言要目录」默认不勾，另两组默认勾；「全选这一组」只动这一组；发送按钮的人数跟着勾选走。
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import CrmAiPickupPage from '../page'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'

function row(id: string, rule: 'not_reached' | 'never_called' | 'catalogue_asked', status = 'ready') {
  return {
    contactId: id, name: `Guest ${id}`, rule, keepWithStaff: rule === 'catalogue_asked', why: '', leadAt: '2026-11-10T00:00:00Z',
    dials: 0, lastCallAt: null, lastNote: rule === 'catalogue_asked' ? 'please follow up 2027 brochure' : null,
    status, recipient: `${id}@example.com`, sentLast7Days: 0, message: null,
  }
}

function stub(rows: unknown[]) {
  const f = vi.fn().mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({ catalogue: { versionLabel: '2027', validUntil: '2027-12-31' }, dailyMax: 30, rows }),
  })
  vi.stubGlobal('fetch', f)
  return f
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('交给 AI 跟进页 · 按组放行', () => {
  it('三组各自成块、带人数；留言要目录默认不勾，另两组默认勾', async () => {
    stub([row('a1', 'catalogue_asked'), row('a2', 'catalogue_asked'), row('n1', 'not_reached'), row('v1', 'never_called'), row('v2', 'never_called'), row('q1', 'never_called', 'queued')])
    render(<CrmAiPickupPage params={{ id: CLIENT }} />)
    const asked = await screen.findByTestId('ready-group-catalogue_asked')
    expect(within(asked).getByRole('heading').textContent).toContain('员工留言要目录 · 2 位')
    expect(within(asked).getByRole('heading').textContent).toContain('已勾 0 位')
    expect(within(screen.getByTestId('ready-group-not_reached')).getByRole('heading').textContent).toContain('打了没接通 · 1 位')
    const never = screen.getByTestId('ready-group-never_called')
    expect(within(never).getByRole('heading').textContent).toContain('询价 7 天没人打 · 2 位')
    expect(within(never).getByRole('heading').textContent).toContain('已勾 2 位')
    expect(screen.getByRole('button', { name: /给勾选的 3 位发 2027 目录/ })).toBeTruthy()
  })

  it('「全选这一组」只动这一组；「全不选」只清这一组', async () => {
    stub([row('a1', 'catalogue_asked'), row('a2', 'catalogue_asked'), row('n1', 'not_reached')])
    render(<CrmAiPickupPage params={{ id: CLIENT }} />)
    const asked = await screen.findByTestId('ready-group-catalogue_asked')
    fireEvent.click(within(asked).getByRole('button', { name: '全选这一组' }))
    expect(within(asked).getByRole('heading').textContent).toContain('已勾 2 位')
    expect(screen.getByRole('button', { name: /给勾选的 3 位发 2027 目录/ })).toBeTruthy()
    fireEvent.click(within(screen.getByTestId('ready-group-not_reached')).getByRole('button', { name: '全不选' }))
    expect(within(asked).getByRole('heading').textContent).toContain('已勾 2 位')
    expect(screen.getByRole('button', { name: /给勾选的 2 位发 2027 目录/ })).toBeTruthy()
  })

  it('某一组今天没人 → 这一组不出现', async () => {
    stub([row('n1', 'not_reached')])
    render(<CrmAiPickupPage params={{ id: CLIENT }} />)
    await screen.findByTestId('ready-group-not_reached')
    expect(screen.queryByTestId('ready-group-catalogue_asked')).toBeNull()
    expect(screen.queryByTestId('ready-group-never_called')).toBeNull()
  })
})
