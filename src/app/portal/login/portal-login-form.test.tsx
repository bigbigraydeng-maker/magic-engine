import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mocks = vi.hoisted(() => ({
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  signInWithPassword: vi.fn(),
  createBrowserClient: vi.fn(),
}))

vi.mock('@supabase/ssr', () => ({
  createBrowserClient: mocks.createBrowserClient,
}))

vi.mock('@/components/auth/GoogleSelfServeButton', () => ({
  GoogleSelfServeButton: ({ label }: { label: string }) => (
    <button type="button">{label}</button>
  ),
}))

import PortalLoginForm from './portal-login-form'

function stubSessionRoute(redirect = '/portal') {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ redirect }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('PortalLoginForm', () => {
  beforeEach(() => {
    mocks.signInWithOtp.mockReset().mockResolvedValue({ error: null })
    mocks.verifyOtp.mockReset().mockResolvedValue({ error: null })
    mocks.signInWithPassword.mockReset().mockResolvedValue({ error: null })
    mocks.createBrowserClient.mockReset().mockReturnValue({
      auth: {
        signInWithOtp: mocks.signInWithOtp,
        verifyOtp: mocks.verifyOtp,
        signInWithPassword: mocks.signInWithPassword,
      },
    })
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:54321')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')
  })

  it('uses Chinese phone OTP by default, prevents signup, and hands the session to session-route', async () => {
    const fetchMock = stubSessionRoute('/dashboard/clients/client-a')
    const user = userEvent.setup()
    render(<PortalLoginForm next="/dashboard/clients/client-a" />)

    await user.type(screen.getByLabelText(/中国大陆手机号/), '13800001380')
    await user.click(screen.getByRole('button', { name: '发送验证码' }))
    await waitFor(() => expect(mocks.signInWithOtp).toHaveBeenCalledWith({
      phone: '+8613800001380',
      options: { shouldCreateUser: false },
    }))

    await user.type(screen.getByLabelText(/短信验证码/), '123456')
    await user.click(screen.getByRole('button', { name: '验证码登录' }))
    await waitFor(() => expect(mocks.verifyOtp).toHaveBeenCalledWith({
      phone: '+8613800001380',
      token: '123456',
      type: 'sms',
    }))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/session-route?next=%2Fdashboard%2Fclients%2Fclient-a',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('shows a generic message when an SMS request fails', async () => {
    stubSessionRoute()
    mocks.signInWithOtp.mockResolvedValue({ error: { message: 'provider secret details' } })
    const user = userEvent.setup()
    render(<PortalLoginForm next="/dashboard" />)

    await user.type(screen.getByLabelText(/中国大陆手机号/), '13800001380')
    await user.click(screen.getByRole('button', { name: '发送验证码' }))

    expect(await screen.findByRole('status')).toHaveTextContent(/如果手机号已注册/)
    expect(screen.queryByText(/provider secret/i)).not.toBeInTheDocument()
  })

  it('signs in existing passwordless customers by email OTP and returns to the binding page', async () => {
    const fetchMock = stubSessionRoute('/account/phone')
    const user = userEvent.setup()
    render(<PortalLoginForm next="/account/phone" emailCodeFirst />)

    await user.type(screen.getByLabelText(/原账号邮箱/), 'Person@Example.com ')
    await user.click(screen.getByRole('button', { name: '发送邮箱验证码' }))
    await waitFor(() => expect(mocks.signInWithOtp).toHaveBeenCalledWith({
      email: 'person@example.com',
      options: { shouldCreateUser: false },
    }))

    await user.type(await screen.findByLabelText(/邮箱验证码/), '123456')
    await user.click(screen.getByRole('button', { name: '邮箱验证码登录' }))
    await waitFor(() => expect(mocks.verifyOtp).toHaveBeenCalledWith({
      email: 'person@example.com',
      token: '123456',
      type: 'email',
    }))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/session-route?next=%2Faccount%2Fphone',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('defaults to email OTP while phone login is not enabled', () => {
    render(<PortalLoginForm next="/portal" phoneEnabled={false} />)

    expect(screen.getByLabelText(/原账号邮箱/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/中国大陆手机号/)).not.toBeInTheDocument()
  })

  it('keeps email and password available as a fallback', async () => {
    const fetchMock = stubSessionRoute('/portal/reports')
    const user = userEvent.setup()
    render(<PortalLoginForm next="/portal/reports" />)

    await user.click(screen.getByRole('button', { name: '改用原邮箱验证码登录' }))
    await user.click(screen.getByRole('button', { name: '改用邮箱和密码登录' }))
    await user.type(screen.getByLabelText(/邮箱地址/), 'Person@Example.com ')
    await user.type(screen.getByLabelText(/密码/), 'strong-password')
    await user.click(screen.getByRole('button', { name: /邮箱和密码登录/i }))

    await waitFor(() => {
      expect(mocks.signInWithPassword).toHaveBeenCalledWith({
        email: 'person@example.com',
        password: 'strong-password',
      })
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/session-route?next=%2Fportal%2Freports',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('rejects a non-relative redirect from session-route after phone login', async () => {
    stubSessionRoute('https://evil.example/steal')
    const user = userEvent.setup()
    render(<PortalLoginForm next="/portal" />)

    await user.type(screen.getByLabelText(/中国大陆手机号/), '13800001380')
    await user.click(screen.getByRole('button', { name: '发送验证码' }))
    await user.type(await screen.findByLabelText(/短信验证码/), '123456')
    await user.click(screen.getByRole('button', { name: '验证码登录' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/登录失败/)
  })
})
