/**
 * 「只别打电话」的人：抽屉里不给拨号，邮件照常，并给一条「放回电话名单」的路
 * （PM 2026-11-09；设计稿 docs/specs/2026-11-09-crm-do-not-call-split-design-v0.md v1 修订 D）。
 */

import React from 'react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PersonDrawer, type DrawerRow } from '../PersonDrawer'

const row = (over: Partial<DrawerRow> = {}): DrawerRow => ({
  contactId: 'c1',
  name: 'Sue Masson',
  phone: '+64211234567',
  email: 'sue@example.com',
  stage: null,
  stageLabel: null,
  ...over,
})

const draw = (over: Partial<DrawerRow> = {}) =>
  render(
    <PersonDrawer clientId="cts" row={row(over)} stages={[]} viewerEmail="fde@example.com" onClose={vi.fn()} onSaved={vi.fn()} />,
  )

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ timeline: [], omittedMessages: 0 }) })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const dialLink = () =>
  Array.from(document.querySelectorAll('a')).find((a) => a.getAttribute('href')?.startsWith('tel:'))
const btn = (contains: string): HTMLButtonElement | undefined =>
  Array.from(document.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes(contains))

describe('说过不要电话', () => {
  it('没有拨号链接，也没有「用 CTS 号码拨打」按钮', () => {
    draw({ doNotCall: true })
    expect(dialLink()).toBeUndefined()
    expect(btn('用 CTS 号码拨打')).toBeUndefined()
  })

  it('号码看得见、说清为什么拨不了；邮箱照旧能点', () => {
    draw({ doNotCall: true })
    expect(screen.getByText(/\+64211234567/)).toBeTruthy()
    expect(screen.getByText('拨号已关闭：这位客人说过不要电话，请用邮件或短信。')).toBeTruthy()
    expect(Array.from(document.querySelectorAll('a')).some((a) => a.getAttribute('href')?.startsWith('mailto:'))).toBe(true)
  })

  it('名字旁有「只别打电话」小标，下面是提示条', () => {
    draw({ doNotCall: true })
    expect(screen.getByText('只别打电话')).toBeTruthy()
    expect(screen.getByText(/这位客人说过不要电话，可以用邮件或短信联系他/)).toBeTruthy()
  })

  it('「放回电话名单」走现有的撤销接口（写 dnc_cleared）', async () => {
    draw({ doNotCall: true })
    fireEvent.click(btn('其实可以打电话？放回电话名单')!)
    fireEvent.click(btn('确认放回电话名单')!)
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url, init]) =>
        url === '/api/clients/cts/crm/contacts/c1/dnc' && (init as RequestInit | undefined)?.method === 'POST')).toBe(true),
    )
  })

  it('同时是「别再联系」→ 只出那一条更重的黄条，不出「只别打电话」小标', () => {
    draw({ doNotCall: true, doNotContact: true })
    expect(screen.queryByText('只别打电话')).toBeNull()
    expect(screen.getByText(/他被标成「别再联系」/)).toBeTruthy()
  })
})

describe('没说过不要电话 → 一个字都不变', () => {
  it('照旧能拨，没有小标和提示条', () => {
    draw()
    expect(dialLink()?.getAttribute('href')).toBe('tel:+64211234567')
    expect(btn('用 CTS 号码拨打')).toBeTruthy()
    expect(screen.queryByText('只别打电话')).toBeNull()
    expect(screen.queryByText(/拨号已关闭/)).toBeNull()
  })
})
