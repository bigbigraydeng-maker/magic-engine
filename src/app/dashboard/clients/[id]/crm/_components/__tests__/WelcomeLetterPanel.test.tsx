/**
 * 「欢迎信自动发送」页面：非管理员只看到一句话；授权先预览、再确认，并把页面上这一版的指纹交上去；
 * 有问题的提案不给授权按钮、说清楚为什么；撤销要写原因；页面上不出现任何密钥。
 * 接口全是假的（替换 fetch），数据是合成的。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WelcomeLetterPanel } from '../welcome-letter/WelcomeLetterPanel'
import { errorText, problemText, rehearsalHeadline } from '../welcome-letter/welcome-letter-text'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const RULE_SHA = 'a'.repeat(64)
const TEMPLATE_SHA = 'b'.repeat(64)

function record(over: Record<string, unknown> = {}) {
  return {
    id: 'p-1',
    account: 'cts',
    rule_sha256: RULE_SHA,
    template_version: 3,
    template_sha256: TEMPLATE_SHA,
    daily_cap: 20,
    proposed_by_email: 'fde@example.com',
    proposed_at: '2026-11-19T00:00:00.000Z',
    authorized_by_email: null,
    authorized_at: null,
    live_from: null,
    expires_at: null,
    activated_at: null,
    ...over,
  }
}

function status(over: Record<string, unknown> = {}) {
  return {
    success: true,
    can_manage: true,
    mode: 'practice',
    authorization: null,
    proposal: {
      record: record(),
      summary: ['谁会收到：Facebook 表单留资的新客人', '正式：所有符合条件的新客人都会收到'],
      problem: null,
      trial: false,
      rehearsal: { requiredDays: 5, consecutiveDays: 5, rowsCounted: 30, days: [{ leadLocalDay: '2026-11-18', total: 6, agree: 6, explained: 0, unexplained: 0, unavailable: 0, unexplainedContactIds: [] }] },
      template: { key: 'auto-welcome', readable: true, version: 3, subject: 'Welcome, {{ first_name }}', body: 'Hi {{first_name}}', check: 'ok' },
      warnings: [],
    },
    prerequisites: { account: 'cts', account_key: false, unsubscribe_secret: true, receipts_webhook: false },
    ...over,
  }
}

type Call = { url: string; init?: RequestInit }
let calls: Call[]
let statusBody: unknown
let commandBody: unknown

beforeEach(() => {
  calls = []
  statusBody = status()
  commandBody = { success: true, mode: 'PREVIEW', preview: { trial: false, live_from: '2026-11-20T00:00:00.000Z', expires_at: '2027-02-17T23:00:00.000Z', daily_cap: 20, replaces_authorization_id: null, warnings: ['SALES_FREQUENCY_CAP_WIDER'] } }
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const body = url.endsWith('/status') ? statusBody : commandBody
    return { ok: true, status: 200, json: async () => body } as Response
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function posted(name: string): Record<string, unknown>[] {
  return calls.filter((c) => c.url.endsWith(`/${name}`)).map((c) => JSON.parse(String(c.init?.body)))
}

describe('WelcomeLetterPanel', () => {
  it('someone who is not a global administrator sees one sentence and nothing else', async () => {
    statusBody = { success: true, can_manage: false }
    render(<WelcomeLetterPanel clientId={CLIENT} />)
    expect(await screen.findByText('只有管理员能看这一页。')).toBeTruthy()
    expect(screen.queryByTestId('proposal')).toBeNull()
  })

  it('shows the proposal in words, the letter, the rehearsal, and what a real send still needs', async () => {
    render(<WelcomeLetterPanel clientId={CLIENT} />)
    await screen.findByTestId('welcome-letter-panel')
    expect(screen.getByText('正式：所有符合条件的新客人都会收到')).toBeTruthy()
    expect(screen.getByTestId('letter').textContent).toContain('Welcome, {{ first_name }}')
    expect(screen.getByTestId('rehearsal').textContent).toContain('最近连续 5 天')
    expect(screen.getByTestId('prerequisites').textContent).toContain('真发开关：关着')
    expect(screen.getByTestId('prerequisites').textContent).toContain('发信账号「cts」的钥匙已放进 Render')
  })

  it('🔴 authorize: preview first with this version’s fingerprints, then confirm, then reload', async () => {
    render(<WelcomeLetterPanel clientId={CLIENT} />)
    await screen.findByTestId('authorize-box')
    expect((screen.getByText('确认授权') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByText('预览授权'))
    await screen.findByTestId('authorize-preview')
    expect(screen.getByTestId('authorize-preview').textContent).toContain('销售手发那条路')
    expect(posted('authorize')[0]).toMatchObject({ client_id: CLIENT, authorization_id: 'p-1', rule_sha256: RULE_SHA, template_sha256: TEMPLATE_SHA, confirm: false, backfill_hours: 0, expires_in_days: 90 })

    commandBody = { success: true, mode: 'AUTHORIZED' }
    fireEvent.click(screen.getByText('确认授权'))
    await waitFor(() => expect(posted('authorize')).toHaveLength(2))
    expect(posted('authorize')[1]).toMatchObject({ confirm: true })
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith('/status')).length).toBe(2))
  })

  it('a proposal that cannot be authorized says why and offers no authorize button', async () => {
    statusBody = status({ proposal: { ...status().proposal, problem: 'REHEARSAL_NOT_READY' } })
    render(<WelcomeLetterPanel clientId={CLIENT} />)
    expect((await screen.findByTestId('proposal-problem')).textContent).toBe(problemText('REHEARSAL_NOT_READY'))
    expect(screen.queryByTestId('authorize-box')).toBeNull()
  })

  it('🔴 revoke needs a reason, then posts it', async () => {
    statusBody = status({
      authorization: { record: record({ id: 'a-1', authorized_at: '2026-11-15T00:00:00.000Z', authorized_by_email: 'pm@example.com' }), summary: ['x'], trial: false, state: 'active', template: null },
    })
    commandBody = { success: true, mode: 'REVOKED' }
    render(<WelcomeLetterPanel clientId={CLIENT} />)
    fireEvent.click(await screen.findByText('撤销授权'))
    const confirm = screen.getByText('确认撤销授权') as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText('撤销原因（必填，一句话）'), { target: { value: '先停一下' } })
    fireEvent.click(confirm)
    await waitFor(() => expect(posted('revoke')).toHaveLength(1))
    expect(posted('revoke')[0]).toEqual({ client_id: CLIENT, authorization_id: 'a-1', reason: '先停一下' })
  })
})

describe('welcome-letter-text', () => {
  it('a failed rollback always tells the PM to revoke by hand', () => {
    expect(errorText({ error: 'AUTHORIZATION_EVENT_NOT_SENT', rollback: 'FAILED' })).toContain('请马上点「撤销」')
    expect(errorText({ error: 'SOMETHING_NEW' })).toBe('出错了，稍后再试。')
    expect(errorText({ error: 'INVALID_AUTHORIZE_COMMAND' })).toBe('提交的内容格式不对。')
  })

  it('the rehearsal headline says how far from five days', () => {
    expect(rehearsalHeadline({ requiredDays: 5, consecutiveDays: 2, rowsCounted: 9, days: [] })).toContain('要满 5 天才能授权正式名单')
    expect(rehearsalHeadline({ requiredDays: 5, consecutiveDays: 0, rowsCounted: 0, days: [] })).toBe('这份规则还没有彩排记录。')
  })
})
