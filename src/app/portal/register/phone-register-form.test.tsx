import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mocks = vi.hoisted(() => ({
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  getUser: vi.fn(),
  createBrowserClient: vi.fn(),
}))

vi.mock('@supabase/ssr', () => ({ createBrowserClient: mocks.createBrowserClient }))

import PhoneRegisterForm from './phone-register-form'

describe('PhoneRegisterForm', () => {
  beforeEach(() => {
    mocks.signInWithOtp.mockReset().mockResolvedValue({ error: null })
    mocks.verifyOtp.mockReset().mockResolvedValue({ error: null })
    mocks.getUser.mockReset().mockResolvedValue({ data: { user: null } })
    mocks.createBrowserClient.mockReset().mockReturnValue({ auth: {
      signInWithOtp: mocks.signInWithOtp,
      verifyOtp: mocks.verifyOtp,
      getUser: mocks.getUser,
    } })
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:54321')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ ok: true, redirect: '/dashboard/clients/client-1' }),
      { status: 201, headers: { 'Content-Type': 'application/json' } },
    )))
  })

  it('creates an Auth identity only on signup, verifies the phone, then creates the workspace', async () => {
    const user = userEvent.setup()
    render(<PhoneRegisterForm next="/dashboard" zh />)

    await user.type(screen.getByLabelText(/中国大陆手机号/), '13800001380')
    await user.click(screen.getByRole('button', { name: '发送验证码' }))
    await waitFor(() => expect(mocks.signInWithOtp).toHaveBeenCalledWith({
      phone: '+8613800001380',
      options: { shouldCreateUser: true },
    }))

    await user.type(await screen.findByLabelText(/短信验证码/), '123456')
    await user.click(screen.getByRole('button', { name: '验证手机号' }))
    await user.type(await screen.findByLabelText(/公司或工作区名称/), '我的公司')
    await user.click(screen.getByRole('button', { name: '创建工作区' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/auth/phone-register/complete', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ businessName: '我的公司', websiteUrl: '', next: '/dashboard' }),
    })))
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ phone: '+8613800001380', token: '123456', type: 'sms' })
  })

  it('lets a verified user resume phone verification if the server session expired', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: {
      phone: '+8613800001380', phone_confirmed_at: '2026-09-30T00:00:00Z',
    } } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ code: 'phone_verification_required', error: 'Verify your phone first.' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    )))
    const user = userEvent.setup()
    render(<PhoneRegisterForm next="/dashboard" zh />)

    await user.type(await screen.findByLabelText(/公司或工作区名称/), '我的公司')
    await user.click(screen.getByRole('button', { name: '创建工作区' }))
    await user.click(await screen.findByRole('button', { name: '重新验证手机号' }))

    expect(screen.getByLabelText(/中国大陆手机号/)).toHaveValue('+8613800001380')
  })
})
