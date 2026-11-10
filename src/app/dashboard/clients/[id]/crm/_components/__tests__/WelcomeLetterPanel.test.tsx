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
    can_authorize: true,
    mode: 'practice',
    authorization: null,
    proposal: {
      record: record(),
      summary: ['谁会收到：Facebook 表单留资的新客人', '正式：所有符合条件的新客人都会收到'],
      problem: null,
      trial: false,
      rehearsal: {
        requiredDays: 5,
        consecutiveDays: 5,
        runFrom: '2026-11-14',
        runTo: '2026-11-18',
        undatedRows: 0,
        rowsCounted: 30,
        batchGap: 0,
        batches: [{ campaignId: 'c1', title: 'auto_e1_batch_20261119', sentAt: '2026-11-18T19:01:00Z', emailsSent: 6, matchedContacts: 6, gap: 0 }],
        calendar: [{ day: '2026-11-18', kind: 'consistent', stats: { leadLocalDay: '2026-11-18', total: 6, agree: 6, explained: 0, unexplained: 0, unavailable: 0, unexplainedContactIds: [] } }],
      },
      template: { key: 'auto-welcome', readable: true, version: 3, subject: 'Welcome, {{ first_name }}', body: 'Hi {{first_name}}', check: 'ok' },
      warnings: [],
    },
    prerequisites: { account: 'cts', account_key: false, unsubscribe_secret: true, events: true, trial_domains: false },
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
    expect(screen.getByTestId('rehearsal').textContent).toContain('2026-11-14 到 2026-11-18：连续 5 天')
    expect(screen.getByTestId('batches').textContent).toContain('auto_e1_batch_20261119')
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
    expect((await screen.findByTestId('notice')).textContent).toContain('已授权')
  })

  it('🔴 a failed authorize that already stopped the old authorization says so, and the page is read again', async () => {
    render(<WelcomeLetterPanel clientId={CLIENT} />)
    fireEvent.click(await screen.findByText('预览授权'))
    await screen.findByTestId('authorize-preview')
    commandBody = { success: false, error: 'AUTHORIZE_WINDOW_REFUSED', replaced_authorization_revoked: true }
    fireEvent.click(screen.getByText('确认授权'))
    expect((await screen.findByTestId('notice')).textContent).toContain('之前生效的那份授权已经停了')
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith('/status')).length).toBe(2))
  })

  it('when replacing an authorization in force, the backfill defaults to 35 hours', async () => {
    statusBody = status({
      authorization: { record: record({ id: 'a-1', authorized_at: '2026-11-15T00:00:00.000Z' }), summary: ['x'], trial: false, state: 'active', template: null },
    })
    render(<WelcomeLetterPanel clientId={CLIENT} />)
    fireEvent.click(await screen.findByText('预览授权'))
    await waitFor(() => expect(posted('authorize')).toHaveLength(1))
    expect(posted('authorize')[0]).toMatchObject({ backfill_hours: 35 })
  })

  it('someone who may manage but is not the approver sees why there is no authorize button', async () => {
    statusBody = status({ can_authorize: false })
    render(<WelcomeLetterPanel clientId={CLIENT} />)
    expect((await screen.findByTestId('not-approver')).textContent).toContain('只有 PM 本人')
    expect(screen.queryByTestId('authorize-box')).toBeNull()
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
    expect((await screen.findByTestId('notice')).textContent).toContain('已撤销授权')
  })

  it('🔴 a brake pressed on a stale page points at the authorization that is really in force', async () => {
    statusBody = status({
      authorization: { record: record({ id: 'a-1', authorized_at: '2026-11-15T00:00:00.000Z' }), summary: ['x'], trial: true, state: 'active', template: null },
    })
    commandBody = { success: false, error: 'ALREADY_REVOKED', current_authorization: { id: 'a-2' } }
    render(<WelcomeLetterPanel clientId={CLIENT} />)
    fireEvent.click(await screen.findByText('撤销授权'))
    fireEvent.change(screen.getByPlaceholderText('撤销原因（必填，一句话）'), { target: { value: 'stop' } })
    fireEvent.click(screen.getByText('确认撤销授权'))
    expect((await screen.findByTestId('notice')).textContent).toContain('另一份「生效中」的授权')
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith('/status')).length).toBe(2))
  })
})

describe('welcome-letter-text', () => {
  it('a failed rollback always tells the PM to revoke by hand, and never also says it was rolled back', () => {
    const text = errorText({ error: 'AUTHORIZATION_EVENT_NOT_SENT', rollback: 'FAILED' })
    expect(text).toContain('请马上点它的「撤销授权」')
    expect(text).not.toContain('已自动撤回')
    expect(errorText({ error: 'AUTHORIZATION_EVENT_NOT_SENT', rollback: 'OK' })).toContain('要重新提案')
    expect(errorText({ error: 'SOMETHING_NEW' })).toBe('出错了，稍后再试。')
    expect(errorText({ error: 'INVALID_AUTHORIZE_COMMAND' })).toBe('提交的内容格式不对。')
  })

  it('the rehearsal headline gives the dates, not "recently"', () => {
    const base = { requiredDays: 5, rowsCounted: 9, calendar: [], undatedRows: 0, batches: [], batchGap: 0 }
    expect(rehearsalHeadline({ ...base, consecutiveDays: 2, runFrom: '2026-11-18', runTo: '2026-11-19' })).toBe(
      '2026-11-18 到 2026-11-19：连续 2 天，ME「本该发」和旧群发「实际发」逐人一致，要满 5 天。',
    )
    expect(rehearsalHeadline({ ...base, consecutiveDays: 0, runFrom: null, runTo: null })).toContain('到昨天为止没有连续一致的日子')
    expect(rehearsalHeadline({ ...base, consecutiveDays: 0, runFrom: null, runTo: null, undatedRows: 2 })).toContain('算不出是哪天的线索')
  })
})
