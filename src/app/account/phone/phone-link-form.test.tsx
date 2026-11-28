import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import PhoneLinkForm from './phone-link-form'

describe('PhoneLinkForm', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('lets the customer correct a number after requesting a code', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const user = userEvent.setup()
    render(<PhoneLinkForm isLinked={false} maskedPhone={null} />)

    const phoneInput = screen.getByLabelText(/中国大陆手机号/)
    await user.type(phoneInput, '13800001380')
    await user.click(screen.getByRole('button', { name: '发送验证码' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/phone-link/send',
      expect.objectContaining({ method: 'POST' }),
    ))
    expect(phoneInput).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '修改手机号' }))
    expect(phoneInput).toBeEnabled()
    await user.clear(phoneInput)
    await user.type(phoneInput, '13900001380')
    expect(phoneInput).toHaveValue('13900001380')
  })

  it('keeps the first send cooldown after a failed request', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: '发送失败' }), { status: 502 }))
    const user = userEvent.setup()
    render(<PhoneLinkForm isLinked={false} maskedPhone={null} />)

    await user.type(screen.getByLabelText(/中国大陆手机号/), '13800001380')
    await user.click(screen.getByRole('button', { name: '发送验证码' }))

    const resend = await screen.findByRole('button', { name: '60 秒后可重新发送' })
    expect(resend).toBeDisabled()
  })

  it('confirms the number is linked', () => {
    render(<PhoneLinkForm isLinked maskedPhone="+86 138****1380" />)

    expect(screen.getByText('手机号已绑定')).toBeInTheDocument()
    expect(screen.getByText(/\+86 138\*\*\*\*1380/)).toBeInTheDocument()
  })
})
