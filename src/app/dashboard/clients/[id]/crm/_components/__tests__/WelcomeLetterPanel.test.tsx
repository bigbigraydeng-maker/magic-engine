/**
 * 「欢迎信自动发送」页面：非管理员只看到一句话；授权先预览、再确认，并把页面上这一版的指纹交上去；
 * 有问题的提案不给授权按钮、说清楚为什么；撤销要写原因；页面上不出现任何密钥。
 * 接口全是假的（替换 fetch），数据是合成的。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WelcomeLetterPanel } from '../welcome-letter/WelcomeLetterPanel'
import { errorText, problemText, rehearsalHeadline, revokeErrorText } from '../welcome-letter/welcome-letter-text'

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
    expect((await screen.findByTestId('notice')).textContent).toContain('上面还有另一份授权')
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith('/status')).length).toBe(2))
  })
})

describe('WelcomeLetterPanel — round two', () => {
  const live = () =>
    status({ authorization: { record: record({ id: 'a-1', authorized_at: '2026-11-15T00:00:00.000Z' }), summary: ['x'], trial: false, state: 'active', template: null } })

  it('🔴 a brake that failed keeps the box and the reason, so pressing again is one click', async () => {
    statusBody = live()
    commandBody = { success: false, error: 'REVOKE_FAILED' }
    render(<WelcomeLetterPanel clientId={CLIENT} />)
    fireEvent.click(await screen.findByText('撤销授权'))
    fireEvent.change(screen.getByPlaceholderText('撤销原因（必填，一句话）'), { target: { value: 'stop' } })
    fireEvent.click(screen.getByText('确认撤销授权'))
    expect((await screen.findByTestId('notice')).textContent).toContain('请马上再点一次')
    expect((screen.getByPlaceholderText('撤销原因（必填，一句话）') as HTMLInputElement).value).toBe('stop')
  })

  it('🔴 a brake whose answer could not read what is open now never claims "nothing in force"', () => {
    const text = revokeErrorText({ error: 'ALREADY_REVOKED', current_unreadable: true })
    expect(text).toContain('查不到哪一份在生效')
    expect(text).not.toContain('现在没有生效的授权')
    expect(revokeErrorText({ error: 'ALREADY_REVOKED', current_authorization: null })).toContain('现在没有生效的授权')
  })

  it('🔴 a failed rollback after the old authorization was stopped does not also say "nothing in force"', () => {
    const text = errorText({ error: 'AUTHORIZATION_NOT_ACTIVATED', rollback: 'FAILED', replaced_authorization_revoked: true })
    expect(text).toContain('可能在生效')
    expect(text).toContain('之前生效的那份授权已经停了')
    expect(text).not.toContain('现在没有生效的授权')
  })

  it('"撤下提案" on a proposal another page authorized meanwhile says an authorization was stopped', async () => {
    commandBody = { success: true, mode: 'REVOKED', authorization: { id: 'p-1', authorized_at: '2026-11-19T01:00:00.000Z' } }
    render(<WelcomeLetterPanel clientId={CLIENT} />)
    fireEvent.click(await screen.findByText('撤下提案'))
    fireEvent.change(screen.getByPlaceholderText('撤销原因（必填，一句话）'), { target: { value: 'x' } })
    fireEvent.click(screen.getByText('确认撤下提案'))
    expect((await screen.findByTestId('notice')).textContent).toContain('已撤销授权')
  })

  it('🔴 a reload that fails keeps the last page (and the brake), says so, and keeps the notice', async () => {
    statusBody = live()
    commandBody = { success: false, error: 'REVOKE_FAILED' }
    render(<WelcomeLetterPanel clientId={CLIENT} />)
    fireEvent.click(await screen.findByText('撤销授权'))
    fireEvent.change(screen.getByPlaceholderText('撤销原因（必填，一句话）'), { target: { value: 'stop' } })
    statusBody = { success: false, error: 'INTERNAL_ERROR' }
    fireEvent.click(screen.getByText('确认撤销授权'))
    expect(await screen.findByTestId('reload-failed')).toBeTruthy()
    expect(screen.getByTestId('notice').textContent).toContain('请马上再点一次')
    expect(screen.getByText('确认撤销授权')).toBeTruthy()
  })

  it('a trial proposal says it needs no rehearsal; compared days without any batch say the batches were not read', async () => {
    statusBody = status({ proposal: { ...status().proposal, trial: true, rehearsal: null } })
    render(<WelcomeLetterPanel clientId={CLIENT} />)
    expect((await screen.findByTestId('proposal')).textContent).toContain('不需要彩排对照')
    cleanup()
    statusBody = status({ proposal: { ...status().proposal, rehearsal: { ...status().proposal.rehearsal, batches: [] } } })
    render(<WelcomeLetterPanel clientId={CLIENT} />)
    expect((await screen.findByTestId('batches-missing')).textContent).toContain('没有读到旧群发的批次记录')
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

describe('WelcomeLetterPanel — 最近发送 and 「结果不明」 (之二乙)', () => {
  const GUEST = 'b0000000-0000-4000-8000-000000000001'
  const SEEN = '2026-11-20T16:00:00.123456+00:00'
  const send = (over: Record<string, unknown> = {}) => ({
    id: 's-1',
    contact_id: GUEST,
    status: 'unknown_outcome',
    reason_code: 'expired_20h',
    last_block_reason: null,
    bounce_kind: null,
    provider_impact: 'PROVIDER_UNKNOWN',
    attempts: 2,
    first_attempt_at: '2026-11-19T20:00:00.000Z',
    sent_at: null,
    last_event_type: null,
    last_event_at: null,
    created_at: '2026-11-19T20:00:00.000Z',
    updated_at: SEEN,
    resolution: null,
    ...over,
  })
  const statusCalls = () => calls.filter((c) => c.url.endsWith('/status')).length

  it('🔴 lists the real letters in words, links each guest, never shows an address, and says how many need a person', async () => {
    statusBody = status({
      recent_sends: [
        send(),
        send({ id: 's-2', status: 'delivered', reason_code: null, provider_impact: 'PROVIDER_ACCEPTED', attempts: 1, sent_at: '2026-11-18T20:00:01.000Z' }),
        send({ id: 's-3', status: 'blocked', reason_code: 'missing_first_name', provider_impact: 'NONE', attempts: 0 }),
        send({ id: 's-4', status: 'bounced', reason_code: null, bounce_kind: 'permanent', provider_impact: 'PROVIDER_ACCEPTED', attempts: 1 }),
      ],
      recent_sends_limit: 20,
    })
    render(<WelcomeLetterPanel clientId={CLIENT} />)
    const box = await screen.findByTestId('recent-sends')
    expect(screen.getAllByTestId('recent-send')).toHaveLength(4)
    for (const words of ['结果不明', '已送达', '客人没有名字', '试过 2 次', '永久退信', '只显示最近 20 封']) expect(box.textContent, words).toContain(words)
    expect(screen.getByTestId('unknown-count').textContent).toContain('有 1 封信结果不明')
    expect(box.textContent).not.toContain('@')
    expect(box.querySelector('a')?.getAttribute('href')).toBe(`/dashboard/clients/${CLIENT}/crm/all?contact=${GUEST}`)
  })

  it('an empty list says nothing was sent yet; a failed read says it could not read them (never "nothing sent")', async () => {
    statusBody = status({ recent_sends: [] })
    render(<WelcomeLetterPanel clientId={CLIENT} />)
    expect((await screen.findByTestId('recent-sends')).textContent).toContain('还没有真发过信')
    cleanup()
    statusBody = status({ recent_sends: null })
    render(<WelcomeLetterPanel clientId={CLIENT} />)
    const box = await screen.findByTestId('recent-sends')
    expect(box.textContent).toContain('暂时读不到最近发送')
    expect(box.textContent).not.toContain('还没有真发过信')
  })

  it('🔴 「没发出」: a preview of the letter as seen, the consequence before confirming, then confirm and read the page again', async () => {
    statusBody = status({ recent_sends: [send()] })
    commandBody = { success: true, mode: 'PREVIEW', outcome: 'not_sent', consequence: 'NEVER_WELCOMED_AUTOMATICALLY_AGAIN' }
    render(<WelcomeLetterPanel clientId={CLIENT} />)
    fireEvent.click(await screen.findByText('核对后标「没发出」'))
    expect((await screen.findByTestId('resolve-preview')).textContent).toContain('以后不会再自动收到欢迎信')
    expect(posted('resolve-unknown')[0]).toEqual({ client_id: CLIENT, send_id: 's-1', outcome: 'not_sent', seen_updated_at: SEEN, confirm: false })

    commandBody = { success: true, mode: 'RESOLVED', outcome: 'not_sent', timeline: 'failed' }
    fireEvent.click(screen.getByText('确认标「没发出」'))
    await waitFor(() => expect(posted('resolve-unknown')).toHaveLength(2))
    expect(posted('resolve-unknown')[1]).toMatchObject({ outcome: 'not_sent', confirm: true, seen_updated_at: SEEN })
    const notice = (await screen.findByTestId('notice')).textContent
    expect(notice).toContain('已标「没发出」')
    expect(notice).toContain('时间线上那一条没改成')
    await waitFor(() => expect(statusCalls()).toBe(2))
  })

  it('a letter that moved on meanwhile is not marked: the page says so and reads again', async () => {
    statusBody = status({ recent_sends: [send()] })
    commandBody = { success: false, error: 'NOT_UNKNOWN' }
    render(<WelcomeLetterPanel clientId={CLIENT} />)
    fireEvent.click(await screen.findByText('核对后标「已发出」'))
    expect((await screen.findByTestId('notice')).textContent).toContain('状态已经变了')
    expect(screen.queryByTestId('resolve-preview')).toBeNull()
    await waitFor(() => expect(statusCalls()).toBe(2))
  })

  it('🔴 someone who may manage but is not the approver sees why there are no buttons', async () => {
    statusBody = status({ can_authorize: false, recent_sends: [send()] })
    render(<WelcomeLetterPanel clientId={CLIENT} />)
    expect((await screen.findByTestId('resolve-not-approver')).textContent).toContain('只有 PM 本人')
    expect(screen.queryByTestId('resolve-box')).toBeNull()
  })

  it('a settled letter shows who settled it and when, and offers no buttons', async () => {
    statusBody = status({
      recent_sends: [send({ status: 'failed', reason_code: 'not_sent_confirmed', resolution: { outcome: 'not_sent', by: 'pm@example.com', at: '2026-11-20T01:00:00.000Z' } })],
    })
    render(<WelcomeLetterPanel clientId={CLIENT} />)
    const box = await screen.findByTestId('recent-sends')
    expect(box.textContent).toContain('pm@example.com 在')
    expect(box.textContent).toContain('标了「没发出」')
    expect(screen.queryByTestId('resolve-box')).toBeNull()
    expect(screen.queryByTestId('unknown-count')).toBeNull()
  })

  it('🔴 says this version sends trials only: a formal proposal, its preview and a formal authorization all say they send nothing', async () => {
    statusBody = status({
      authorization: { record: record({ id: 'a-1', authorized_at: '2026-11-15T00:00:00.000Z' }), summary: ['x'], trial: false, state: 'formal_sending_not_enabled', template: null },
    })
    render(<WelcomeLetterPanel clientId={CLIENT} />)
    expect((await screen.findByTestId('trial-only-note')).textContent).toContain('只发内部邮箱的试跑')
    expect(screen.getByTestId('formal-proposal-note').textContent).toContain('正式名单就算批了也一封都不发')
    expect(screen.getByTestId('authorization').textContent).toContain('正式名单一封都不发')
    fireEvent.click(screen.getByText('预览授权'))
    expect((await screen.findByTestId('authorize-preview')).textContent).toContain('批了也一封都不发')
  })

  it('a trial in force with no formal proposal open reminds to propose one; with one open it does not', async () => {
    const trial = { record: record({ id: 'a-1', authorized_at: '2026-11-15T00:00:00.000Z' }), summary: ['x'], trial: true, state: 'active', template: null }
    statusBody = status({ authorization: trial, proposal: null })
    render(<WelcomeLetterPanel clientId={CLIENT} />)
    expect((await screen.findByTestId('trial-followup')).textContent).toContain('再提一份正式名单的提案')
    cleanup()
    statusBody = status({ authorization: trial })
    render(<WelcomeLetterPanel clientId={CLIENT} />)
    await screen.findByTestId('authorization')
    expect(screen.queryByTestId('trial-followup')).toBeNull()
  })

  it('the site address is one of the things a real send needs (yes/no only)', async () => {
    statusBody = status({ prerequisites: { ...status().prerequisites, app_url: false } })
    render(<WelcomeLetterPanel clientId={CLIENT} />)
    const row = [...(await screen.findByTestId('prerequisites')).querySelectorAll('li')].find((li) => li.textContent?.includes('站点地址'))
    expect(row?.textContent).toContain('✗')
  })
})
