import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mocks = vi.hoisted(() => ({
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
    mocks.signInWithPassword.mockReset().mockResolvedValue({ error: null })
    mocks.createBrowserClient.mockReset().mockReturnValue({
      auth: {
        signInWithPassword: mocks.signInWithPassword,
      },
    })
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:54321')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')
  })

  it('signs in with a password and hands the session to session-route', async () => {
    const fetchMock = stubSessionRoute('/portal/reports')
    const user = userEvent.setup()
    render(<PortalLoginForm next="/portal/reports" />)

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

  it('shows a generic error when the password is rejected', async () => {
    stubSessionRoute()
    mocks.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } })
    const user = userEvent.setup()
    render(<PortalLoginForm next="/portal" />)

    await user.type(screen.getByLabelText(/email address/i), 'person@example.com')
    await user.type(screen.getByLabelText(/^password$/i), 'wrong-password')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText(/email or password is incorrect/i)).toBeInTheDocument()
  })

  it('offers no magic-link or one-time-code sign-in path', () => {
    stubSessionRoute()
    render(<PortalLoginForm next="/portal" />)

    expect(screen.queryByRole('button', { name: /sign-in link/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /resend code/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /verify code/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/6-digit code/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/magic link/i)).not.toBeInTheDocument()
  })

  it('rejects a non-relative redirect from session-route', async () => {
    stubSessionRoute('https://evil.example/steal')
    const user = userEvent.setup()
    render(<PortalLoginForm next="/portal" />)

    await user.type(screen.getByLabelText(/email address/i), 'person@example.com')
    await user.type(screen.getByLabelText(/^password$/i), 'strong-password')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText(/sign in failed/i)).toBeInTheDocument()
  })
})
