/**
 * 「跟进人」下拉（issue #3158 part 3）要做对两件事：
 *
 * 1. 把登录用户在候选里标「（我）」—— 让员工一眼看出是不是自己的。
 * 2. 选完立即 PATCH 到接口，不出一个「确认」按钮（PM「按钮少」原则）。
 */

import React from 'react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { AssigneeSelect } from '../AssigneeSelect'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

function stubCandidates(emails: string[]) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes('/crm/assignees')) {
      return { ok: true, json: async () => ({ assignees: emails.map((email) => ({ email })) }) }
    }
    if (url.includes('/assignee')) {
      return { ok: true, json: async () => ({ assignee: 'ok' }) }
    }
    throw new Error(`unexpected fetch ${url}`)
  })
}

describe('AssigneeSelect', () => {
  it('候选加载完 —— 自己的邮箱标「（我）」', async () => {
    stubCandidates(['baker@cts.co.nz', 'lisa@cts.co.nz'])
    render(
      <AssigneeSelect
        clientId="cts"
        contactId="c1"
        current={null}
        viewerEmail="lisa@cts.co.nz"
        onSaved={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByText(/lisa@cts\.co\.nz（我）/)).toBeTruthy())
    expect(screen.getByText('baker@cts.co.nz')).toBeTruthy()
  })

  it('选一个 → 立即 PATCH；没有确认按钮', async () => {
    const onSaved = vi.fn()
    stubCandidates(['baker@cts.co.nz', 'lisa@cts.co.nz'])
    render(
      <AssigneeSelect
        clientId="cts"
        contactId="c1"
        current={null}
        viewerEmail={null}
        onSaved={onSaved}
      />,
    )
    await waitFor(() => expect(screen.getByLabelText('选择跟进人')).toBeTruthy())
    const select = screen.getByLabelText('选择跟进人') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'baker@cts.co.nz' } })
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/clients/cts/crm/contacts/c1/assignee',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ assignee: 'baker@cts.co.nz' }) }),
      ),
    )
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    // 没有「确认」/「保存」按钮：选完就改
    expect(screen.queryByRole('button', { name: /确认|保存/ })).toBeNull()
  })

  it('候选为空 → 给一句解释，别只是看到个空下拉', async () => {
    stubCandidates([])
    render(
      <AssigneeSelect
        clientId="cts"
        contactId="c1"
        current={null}
        viewerEmail={null}
        onSaved={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByText(/还没配跟进人/)).toBeTruthy())
  })

  it('current 不在候选里（名单里被移走）—— 保留显示但标「已不在名单里」', async () => {
    stubCandidates(['baker@cts.co.nz'])
    render(
      <AssigneeSelect
        clientId="cts"
        contactId="c1"
        current="former@cts.co.nz"
        viewerEmail={null}
        onSaved={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByText(/former@cts\.co\.nz（已不在名单里）/)).toBeTruthy())
  })
})
