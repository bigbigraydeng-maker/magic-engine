/** 申请页表单：没勾条款不能提交；提交成功后只显示「申请已收到」；失败时把原因说出来。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ApplyForm } from '../apply-form'
import { DISTRIBUTOR_TERMS_VERSION } from '@/lib/distributor/terms'

afterEach(() => vi.unstubAllGlobals())

function fill() {
  const field = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
  field(/^名字/, '王小明')
  field(/^邮箱/, 'wang@example.com')
  field(/^电话/, '+64 21 123 4567')
}

describe('ApplyForm', () => {
  it('keeps submit disabled until the terms are ticked, and prefills the referral code', () => {
    render(<ApplyForm termsVersion={DISTRIBUTOR_TERMS_VERSION} initialReferralCode="ABCD2345" />)
    expect((screen.getByRole('button', { name: '提交申请' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText(/^推荐码/) as HTMLInputElement).value).toBe('ABCD2345')
  })

  it('posts the form with the terms version and shows the confirmation', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ status: 201, json: async () => ({ ok: true }) }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ApplyForm termsVersion={DISTRIBUTOR_TERMS_VERSION} initialReferralCode={null} />)
    fill()
    fireEvent.click(screen.getByLabelText('我已阅读并同意上面的经销商规则'))
    fireEvent.click(screen.getByRole('button', { name: '提交申请' }))
    expect(await screen.findByText('申请已收到')).toBeTruthy()
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String(init.body))
    expect(body).toMatchObject({ display_name: '王小明', accept_terms: true, terms_version: DISTRIBUTOR_TERMS_VERSION, website: '' })
  })

  it('shows the reason the server gave', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 429, json: async () => ({ error: '提交太频繁了，请一小时后再试' }) })))
    render(<ApplyForm termsVersion={DISTRIBUTOR_TERMS_VERSION} initialReferralCode={null} />)
    fill()
    fireEvent.click(screen.getByLabelText('我已阅读并同意上面的经销商规则'))
    fireEvent.click(screen.getByRole('button', { name: '提交申请' }))
    expect((await screen.findByRole('alert')).textContent).toBe('提交太频繁了，请一小时后再试')
  })
})
