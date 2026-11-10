/**
 * MailchimpAudiencePanel —— 「Mailchimp 出口坏了」那条今日待办的落脚点。
 *
 * 待办让 FDE「打开设置页确认 audience 配置」，在这个组件出现之前那句话是空的：
 * 页面上根本没有这一栏，人只能回头找开发。所以这里最该钉的不是样式，而是
 * **这一栏真的能读出来、真的能存回去、存不进去时会说**。
 */
import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MailchimpAudiencePanel } from '../MailchimpAudiencePanel'

const CLIENT_ID = 'client-cts'

function mockFetchSequence(responses: Array<{ ok?: boolean; json: unknown }>) {
  const calls: { url: string; init?: RequestInit }[] = []
  let i = 0
  global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    const r = responses[Math.min(i, responses.length - 1)]
    i += 1
    return Promise.resolve({ ok: r.ok ?? true, json: async () => r.json })
  }) as unknown as typeof fetch
  return calls
}

beforeEach(() => { vi.restoreAllMocks() })
afterEach(() => { vi.restoreAllMocks() })

describe('MailchimpAudiencePanel', () => {
  it('把已配的 audience id 读出来显示 —— FDE 一眼看得到现在是什么', async () => {
    mockFetchSequence([{ json: { config: { mailchimpAudienceId: 'dda97b7e61' } } }])
    render(<MailchimpAudiencePanel clientId={CLIENT_ID} />)

    await waitFor(() => {
      expect(screen.getByDisplayValue('dda97b7e61')).toBeInTheDocument()
    })
  })

  it('没配 → 显示空，并说清楚「留空 = 不往 Mailchimp 送」不是没配好', async () => {
    mockFetchSequence([{ json: { config: { mailchimpAudienceId: '' } } }])
    render(<MailchimpAudiencePanel clientId={CLIENT_ID} />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText('留空则不送')).toHaveValue('')
    })
    expect(screen.getByText(/留空 = 这个客户的线索不往 Mailchimp 送/)).toBeInTheDocument()
  })

  it('改了才让点保存 —— 没改时按钮是禁用的，省得空存一次', async () => {
    mockFetchSequence([{ json: { config: { mailchimpAudienceId: 'dda97b7e61' } } }])
    render(<MailchimpAudiencePanel clientId={CLIENT_ID} />)

    await waitFor(() => expect(screen.getByDisplayValue('dda97b7e61')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()

    fireEvent.change(screen.getByPlaceholderText('留空则不送'), { target: { value: 'abc123def4' } })
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
  })

  it('保存 → 真的 PATCH 出去，并以服务端回的值为准', async () => {
    // 以服务端回的为准，是因为它才知道最后存进去的是什么（trim 过的）。
    const calls = mockFetchSequence([
      { json: { config: { mailchimpAudienceId: '' } } },
      { json: { config: { mailchimpAudienceId: 'dda97b7e61' } } },
    ])
    render(<MailchimpAudiencePanel clientId={CLIENT_ID} />)

    await waitFor(() => expect(screen.getByPlaceholderText('留空则不送')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText('留空则不送'), {
      target: { value: '  dda97b7e61  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(screen.getByText(/已保存/)).toBeInTheDocument())
    const patch = calls.find((c) => c.init?.method === 'PATCH')
    expect(patch).toBeDefined()
    expect(JSON.parse(String(patch?.init?.body))).toEqual({ mailchimpAudienceId: '  dda97b7e61  ' })
    expect(screen.getByDisplayValue('dda97b7e61')).toBeInTheDocument()
  })

  it('存不进去 → 把服务端的话原样显示，绝不假装存好了', async () => {
    // 假装存好了的后果：FDE 以为修完了走人，出口继续坏着，下一轮待办又来。
    mockFetchSequence([
      { json: { config: { mailchimpAudienceId: '' } } },
      { ok: false, json: { error: 'audience id 看着不对：应该是一串字母数字' } },
    ])
    render(<MailchimpAudiencePanel clientId={CLIENT_ID} />)

    await waitFor(() => expect(screen.getByPlaceholderText('留空则不送')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText('留空则不送'), { target: { value: 'bad' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(screen.getByText(/audience id 看着不对/)).toBeInTheDocument()
    })
    expect(screen.queryByText(/已保存/)).not.toBeInTheDocument()
  })

  it('加载失败 → 说出来，不显示成一个空的输入框骗人去填', async () => {
    mockFetchSequence([{ ok: false, json: { error: 'connection reset' } }])
    render(<MailchimpAudiencePanel clientId={CLIENT_ID} />)

    await waitFor(() => expect(screen.getByText(/connection reset/)).toBeInTheDocument())
    // 不给输入框 —— 空框会被读成「这个客户没配」，一填一存就改掉了没看见的旧值
    expect(screen.queryByPlaceholderText('留空则不送')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
  })
})
