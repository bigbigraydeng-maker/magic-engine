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

import LoginForm from './login-form'

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

describe('LoginForm', () => {
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

  it('uses phone OTP first for customer routes and completes the same session route', async () => {
    const fetchMock = stubSessionRoute('/dashboard/clients/client-a')
    const user = userEvent.setup()
    render(<LoginForm next="/dashboard/clients/client-a" locale="zh-CN" />)

    await user.type(screen.getByLabelText(/中国大陆手机号/), '13800001380')
    await user.click(screen.getByRole('button', { name: '发送验证码' }))
    await waitFor(() => expect(mocks.signInWithOtp).toHaveBeenCalledWith({
      phone: '+8613800001380',
      options: { shouldCreateUser: false },
    }))

    await user.type(await screen.findByLabelText(/短信验证码/), '123456')
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

  it('shows a generic error when phone sign-in fails', async () => {
    stubSessionRoute()
    mocks.verifyOtp.mockResolvedValue({ error: { message: 'private auth provider details' } })
    const user = userEvent.setup()
    render(<LoginForm next="/portal" locale="zh-CN" />)

    await user.type(screen.getByLabelText(/中国大陆手机号/), '13800001380')
    await user.click(screen.getByRole('button', { name: '发送验证码' }))
    await user.type(await screen.findByLabelText(/短信验证码/), '123456')
    await user.click(screen.getByRole('button', { name: '验证码登录' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/手机号或验证码不正确/i)
    expect(screen.getByRole('alert')).not.toHaveTextContent(/private auth provider/i)
  })

  it('keeps the email and password path for staff and transition users', async () => {
    const fetchMock = stubSessionRoute('/portal/reports')
    const user = userEvent.setup()
    render(<LoginForm next="/portal/reports" phoneFirst={false} />)

    await user.type(screen.getByLabelText(/email address/i), 'Person@Example.com ')
    await user.type(screen.getByLabelText(/^password$/i), 'strong-password')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

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

  it('shows a generic error when the email credentials are rejected', async () => {
    stubSessionRoute()
    mocks.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } })
    const user = userEvent.setup()
    render(<LoginForm next="/portal" phoneFirst={false} />)

    await user.type(screen.getByLabelText(/email address/i), 'person@example.com')
    await user.type(screen.getByLabelText(/^password$/i), 'wrong-password')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText(/email or password is incorrect/i)).toBeInTheDocument()
  })

  it('rejects an unsafe post-sign-in redirect', async () => {
    stubSessionRoute('https://evil.example/steal')
    const user = userEvent.setup()
    render(<LoginForm next="/portal" phoneFirst={false} />)

    await user.type(screen.getByLabelText(/email address/i), 'person@example.com')
    await user.type(screen.getByLabelText(/^password$/i), 'strong-password')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText(/sign in failed/i)).toBeInTheDocument()
  })

  it('keeps the Google sign-in option', () => {
    stubSessionRoute()
    render(<LoginForm next="/portal" />)
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument()
  })
})
