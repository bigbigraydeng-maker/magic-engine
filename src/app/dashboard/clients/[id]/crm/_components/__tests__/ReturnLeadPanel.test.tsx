/**
 * 「不是有效咨询（退回）」/「这是真客人」按钮。
 * 钉死：客户没有「非咨询」阶段 → 不渲染；退回必须选原因才能确认；请求走现有改阶段接口，
 * note 是固定格式（系统之后靠它学），并带 expectedFromStage；已在「非咨询」的人只给「拉回」。
 */

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReturnLeadPanel } from '../ReturnLeadPanel'

const STAGES = [{ stageKey: 'new' }, { stageKey: 'not_enquiry' }]
const draw = (over: Partial<React.ComponentProps<typeof ReturnLeadPanel>> = {}) => {
  const onDone = vi.fn()
  render(<ReturnLeadPanel clientId="c1" contactId="p1" currentStage="new" stages={STAGES} onDone={onDone} {...over} />)
  return onDone
}
const okFetch = () => {
  const f = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ stage: 'x' }) })
  vi.stubGlobal('fetch', f)
  return f
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ReturnLeadPanel', () => {
  it('renders nothing when the client has no 非咨询 stage configured', () => {
    const { container } = render(<ReturnLeadPanel clientId="c1" contactId="p1" currentStage="new" stages={[{ stageKey: 'new' }]} onDone={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })

  it('confirm is disabled until a reason is chosen; then PATCHes stage with a structured note + expectedFromStage', async () => {
    const f = okFetch()
    const onDone = draw()
    fireEvent.click(screen.getByRole('button', { name: '不是有效咨询（退回）' }))
    const confirm = screen.getByRole('button', { name: '确认退回' })
    expect(confirm).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '推销 / 合作邀请' }))
    fireEvent.change(screen.getByLabelText('补充说明'), { target: { value: '越南地接社' } })
    expect(confirm).not.toBeDisabled()
    fireEvent.click(confirm)
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('/api/clients/c1/crm/contacts/p1/stage')
    expect((init as { method: string }).method).toBe('PATCH')
    expect(JSON.parse((init as { body: string }).body)).toEqual({
      toStage: 'not_enquiry',
      note: '[退回|solicitation] 越南地接社',
      expectedFromStage: 'new',
    })
  })

  it('a null current stage is sent as expectedFromStage null (not omitted)', async () => {
    const f = okFetch()
    draw({ currentStage: null })
    fireEvent.click(screen.getByRole('button', { name: '不是有效咨询（退回）' }))
    fireEvent.click(screen.getByRole('button', { name: '其他' }))
    fireEvent.click(screen.getByRole('button', { name: '确认退回' }))
    await waitFor(() => expect(f).toHaveBeenCalled())
    expect(JSON.parse((f.mock.calls[0][1] as { body: string }).body)).toHaveProperty('expectedFromStage', null)
  })

  it('a server refusal (409 someone else changed it) shows the reason and does not close or report success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: '刚被别人改过了' }) }))
    const onDone = draw()
    fireEvent.click(screen.getByRole('button', { name: '不是有效咨询（退回）' }))
    fireEvent.click(screen.getByRole('button', { name: '群发营销' }))
    fireEvent.click(screen.getByRole('button', { name: '确认退回' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('刚被别人改过了')
    expect(onDone).not.toHaveBeenCalled()
  })

  it('a person already in 非咨询 only gets the pull-back button, which PATCHes back to new with a 真客人 note', async () => {
    const f = okFetch()
    const onDone = draw({ currentStage: 'not_enquiry' })
    expect(screen.queryByRole('button', { name: '不是有效咨询（退回）' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '这是真客人，拉回来' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(JSON.parse((f.mock.calls[0][1] as { body: string }).body)).toEqual({
      toStage: 'new',
      note: '[真客人]',
      expectedFromStage: 'not_enquiry',
    })
  })
})
