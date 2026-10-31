/**
 * 抽屉上的「通话后发邮件」提示条。
 *
 * 钉死的事：
 *  · 功能没开通 / 读失败：普通员工什么都看不到；全局管理员看到一行灰字和去设置的入口
 *  · 系统记录了接通电话、之后还没发过邮件 → 醒目提示；已经发过 → 退回两个小按钮
 *  · 两个小按钮分别带「销售确认」/「没有通话依据」进面板
 *  · 在抽屉里拨出电话后每隔一会儿重读，直到那通电话出现就停
 */

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('../TemplateEmailPanel', () => ({
  TemplateEmailPanel: (props: { initialCallBasis: string; onSent: () => void; onClose: () => void; templates: unknown[] }) => (
    <div data-testid="panel" data-basis={props.initialCallBasis} data-templates={props.templates.length}>
      <button type="button" onClick={props.onSent}>
        panel-sent
      </button>
      <button type="button" onClick={props.onClose}>
        panel-close
      </button>
    </div>
  ),
}))

import { PostCallEmailBar, formatCallTime } from '../PostCallEmailBar'

const tpl = { key: 'post-call', version: 1, name: 'Post call', pickMode: 'none', factSource: 'none' }
const base = { featureState: 'ready', templates: [tpl], callEvidenceAt: null, emailedSinceCall: false, canEditSettings: false }

function stub(...answers: Array<{ ok?: boolean; body: unknown } | Error>) {
  const f = vi.fn()
  for (const a of answers) {
    if (a instanceof Error) f.mockRejectedValueOnce(a)
    else f.mockResolvedValueOnce({ ok: a.ok ?? true, status: a.ok === false ? 500 : 200, json: async () => a.body })
  }
  // after the scripted answers, keep answering with the last body
  const last = answers[answers.length - 1]
  if (last && !(last instanceof Error)) f.mockResolvedValue({ ok: last.ok ?? true, status: 200, json: async () => last.body })
  vi.stubGlobal('fetch', f)
  return f
}

const draw = (over: Partial<React.ComponentProps<typeof PostCallEmailBar>> = {}) => {
  const onSent = vi.fn()
  const view = render(<PostCallEmailBar clientId="c1" contactId="p1" dialedAt={null} onSent={onSent} {...over} />)
  return { onSent, ...view }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('when the feature is not available', () => {
  it.each(['disabled', 'invalid', 'unconfigured', 'unreadable'])('%s: an ordinary staff member sees nothing at all', async (featureState) => {
    stub({ body: { ...base, featureState, templates: [] } })
    const { container } = draw()
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(container.innerHTML).toBe('')
  })

  it('a global administrator gets one grey line with the way to the settings', async () => {
    stub({ body: { ...base, featureState: 'disabled', templates: [], canEditSettings: true } })
    draw()
    const line = await screen.findByTestId('post-call-off')
    expect(line).toHaveTextContent('邮件模板功能没开通')
    expect(screen.getByRole('link', { name: '去设置' })).toHaveAttribute('href', '/dashboard/clients/c1/crm/templates#settings')
  })

  it('a failed read shows nothing (not a dead button)', async () => {
    stub({ ok: false, body: {} })
    const { container } = draw()
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(container.innerHTML).toBe('')
  })

  it('a network failure shows nothing', async () => {
    stub(new Error('offline'))
    const { container } = draw()
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(container.innerHTML).toBe('')
  })

  it('ready but no active template: nothing to offer', async () => {
    stub({ body: { ...base, templates: [] } })
    const { container } = draw()
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(container.innerHTML).toBe('')
  })
})

describe('with a system-recorded call', () => {
  const recent = new Date(Date.now() - 5 * 60_000).toISOString()

  it('prompts with the time of the call, and opens the panel with no claimed basis (the server knows the call)', async () => {
    stub({ body: { ...base, callEvidenceAt: recent } })
    draw()
    const prompt = await screen.findByTestId('post-call-prompt')
    expect(prompt).toHaveTextContent('刚和他通过电话')
    expect(prompt).toHaveTextContent(formatCallTime(recent))
    fireEvent.click(screen.getByRole('button', { name: '选模板' }))
    expect(screen.getByTestId('panel')).toHaveAttribute('data-basis', 'none')
    expect(screen.getByTestId('panel')).toHaveAttribute('data-templates', '1')
  })

  it('once an email went out after the call the prompt is gone and the small buttons remain', async () => {
    stub({ body: { ...base, callEvidenceAt: recent, emailedSinceCall: true } })
    draw()
    expect(await screen.findByTestId('post-call-buttons')).toBeInTheDocument()
    expect(screen.queryByTestId('post-call-prompt')).toBeNull()
  })
})

describe('without a system-recorded call', () => {
  it('"just spoke" is the staff member\'s own confirmation; "use a template" claims nothing', async () => {
    stub({ body: base })
    draw()
    fireEvent.click(await screen.findByRole('button', { name: '刚和他通过电话 · 发跟进邮件' }))
    expect(screen.getByTestId('panel')).toHaveAttribute('data-basis', 'staff_attested')
    fireEvent.click(screen.getByRole('button', { name: 'panel-close' }))
    fireEvent.click(await screen.findByRole('button', { name: '用模板写邮件' }))
    expect(screen.getByTestId('panel')).toHaveAttribute('data-basis', 'none')
  })

  it('after a send the drawer is told and the state is read again', async () => {
    const f = stub({ body: base })
    const { onSent } = draw()
    fireEvent.click(await screen.findByRole('button', { name: '用模板写邮件' }))
    fireEvent.click(screen.getByRole('button', { name: 'panel-sent' }))
    expect(onSent).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(f).toHaveBeenCalledTimes(2))
  })
})

describe('after he was dialled from the drawer', () => {
  it('re-reads until the new call shows up, then stops', async () => {
    const dialedAt = Date.now()
    const arrived = new Date(dialedAt + 1000).toISOString()
    const f = stub({ body: base }, { body: base }, { body: { ...base, callEvidenceAt: arrived } })
    draw({ dialedAt, pollMs: 15 })
    expect(await screen.findByTestId('post-call-prompt', {}, { timeout: 2000 })).toBeInTheDocument()
    const calls = f.mock.calls.length
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80))
    })
    expect(f.mock.calls.length).toBe(calls)
  })

  it('an OLDER call does not stop the waiting', async () => {
    const dialedAt = Date.now()
    const older = new Date(dialedAt - 3_600_000).toISOString()
    const f = stub({ body: { ...base, callEvidenceAt: older } })
    draw({ dialedAt, pollMs: 15 })
    await waitFor(() => expect(f.mock.calls.length).toBeGreaterThanOrEqual(4), { timeout: 2000 })
  })

  it('never polls when nothing was dialled', async () => {
    const f = stub({ body: base })
    draw({ dialedAt: null, pollMs: 15 })
    await screen.findByTestId('post-call-buttons')
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('stops polling when the ten-minute window is over', async () => {
    const f = stub({ body: base })
    draw({ dialedAt: Date.now() - 11 * 60_000, pollMs: 15 })
    await screen.findByTestId('post-call-buttons')
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(f).toHaveBeenCalledTimes(1)
  })
})

describe('formatCallTime', () => {
  const now = new Date('2026-10-28T02:00:00Z') // 15:00 on the 28th in Auckland
  it('says today / yesterday / the date, in the zone it is given', () => {
    const nz = 'Pacific/Auckland'
    expect(formatCallTime('2026-10-28T00:42:00Z', now, nz)).toBe('今天 13:42')
    expect(formatCallTime('2026-10-27T00:42:00Z', now, nz)).toBe('昨天 13:42')
    expect(formatCallTime('2026-10-20T00:42:00Z', now, nz)).toMatch(/^10月20日 13:42$|^10\/20 13:42$/)
    expect(formatCallTime('not a date', now, nz)).toBe('刚才')
    // the same instant is a different clock time in another country's zone
    expect(formatCallTime('2026-10-28T00:42:00Z', now, 'Australia/Perth')).toBe('今天 08:42')
  })
})
