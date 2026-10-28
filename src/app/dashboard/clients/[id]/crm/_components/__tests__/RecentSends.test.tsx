/**
 * 「最近发送」表：读回执，谁 / 给哪位客人 / 哪个模板 / 结果 / 原因。
 *
 * 钉死的事：读失败显示原因和重试，绝不显示成「还没有发送记录」；回执里的原因代码翻成人话；自己写的邮件没有模板键。
 */

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { RecentSends } from '../RecentSends'

const receipt = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  clientId: 'c1',
  contactId: 'p1',
  contactName: 'Amy Lee',
  requestId: 'req-1',
  actorEmail: 'lisa@cts.example',
  templateKey: 'post-call',
  templateVersion: 3,
  catalogVersion: 7,
  callBasis: 'system_call',
  outcome: 'sent',
  blockReason: null,
  blockDetail: null,
  mailbox: 'info@cts.example',
  conversationId: 'conv-1',
  providerMessageId: 'm1',
  editedAfterRender: false,
  warnings: [],
  renderedSha256: null,
  finalSha256: null,
  authBasis: 'human_click',
  createdAt: '2026-10-28T01:00:00Z',
  ...over,
})

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

describe('RecentSends', () => {
  it('shows who sent what to which guest with the result', async () => {
    const f = stub({ body: { receipts: [receipt(), receipt({ id: 'r2', templateKey: null, templateVersion: null, outcome: 'blocked', blockReason: 'frequency_cap', blockDetail: 'count=2;next=x', editedAfterRender: true, callBasis: 'none', contactName: null })] } })
    render(<RecentSends clientId="c1" />)
    const rows = await screen.findAllByRole('row')
    expect(f).toHaveBeenCalledWith('/api/clients/c1/crm/email-send-receipts')
    expect(rows[1]).toHaveTextContent('lisa')
    expect(rows[1]).toHaveTextContent('post-call 第 3 版')
    expect(rows[1]).toHaveTextContent('已发出')
    expect(rows[1]).toHaveTextContent('系统通话')
    expect(rows[2]).toHaveTextContent('自己写的')
    expect(rows[2]).toHaveTextContent('被拦')
    expect(rows[2]).toHaveTextContent('最近收到的邮件已达上限')
    expect(rows[2]).toHaveTextContent('count=2;next=x')
    expect(rows[2]).toHaveTextContent('改过')
    expect(rows[2]).toHaveTextContent('（没有名字）')
    expect(screen.getByRole('link', { name: 'Amy Lee' })).toHaveAttribute('href', '/dashboard/clients/c1/crm/all?contact=p1')
  })

  it.each([
    ['unknown', '状态不明'],
    ['failed', '出错'],
  ])('shows a %s result', async (outcome, text) => {
    stub({ body: { receipts: [receipt({ outcome, blockReason: 'send_unknown' })] } })
    render(<RecentSends clientId="c1" />)
    expect(await screen.findByText(text, { selector: 'span' })).toBeInTheDocument()
  })

  it('an unfamiliar reason code is shown as it is', async () => {
    stub({ body: { receipts: [receipt({ outcome: 'blocked', blockReason: 'brand_new_code' })] } })
    render(<RecentSends clientId="c1" />)
    expect(await screen.findByText('brand_new_code')).toBeInTheDocument()
  })

  it('a successful empty answer says there are no sends yet', async () => {
    stub({ body: { receipts: [] } })
    render(<RecentSends clientId="c1" />)
    expect(await screen.findByText('还没有发送记录。')).toBeInTheDocument()
  })

  it('a failed read is an error with a retry, never "no sends yet"', async () => {
    const f = stub({ status: 503, body: { error: '发送记录暂时读不到' } }, { body: { receipts: [receipt()] } })
    render(<RecentSends clientId="c1" />)
    expect(await screen.findByText(/暂时读不到发送记录：发送记录暂时读不到/)).toBeInTheDocument()
    expect(screen.queryByText('还没有发送记录。')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText('Amy Lee')).toBeInTheDocument()
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('a network failure is an error too, and 刷新 reads again', async () => {
    const f = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ receipts: [receipt()] }) })
    vi.stubGlobal('fetch', f)
    render(<RecentSends clientId="c1" />)
    expect(await screen.findByText(/暂时读不到发送记录：网络出错/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(await screen.findByText('Amy Lee')).toBeInTheDocument()
  })
})
