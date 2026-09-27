'use client'

import { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { GoogleSelfServeButton } from '@/components/auth/GoogleSelfServeButton'
import { isSafeInternalPath } from '@/lib/auth/safe-internal-path'

interface Props {
  next: string
  authFailed?: boolean
}

export default function PortalLoginForm({ next, authFailed }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function browserClient() {
    return createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
  }

  /** Hand the freshly-created browser session to the server so cookies sync. */
  async function completeSignIn() {
    const res = await fetch(`/api/auth/session-route?next=${encodeURIComponent(next)}`, {
      credentials: 'include',
      cache: 'no-store',
    })
    if (!res.ok) throw new Error('Session could not be started')
    const data = await res.json() as { redirect?: unknown }
    if (!isSafeInternalPath(data.redirect)) {
      throw new Error('Invalid sign-in destination')
    }
    window.location.href = data.redirect
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const supabase = browserClient()
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      })
      if (signInError) {
        setError('Email or password is incorrect.')
        return
      }

      await completeSignIn()
    } catch {
      setError('Sign in failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <GoogleSelfServeButton next={next} label="Continue with Google" />

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-me-charcoal/10" />
        <span className="text-xs font-bold uppercase tracking-[0.12em] text-me-charcoal/35">
          or
        </span>
        <div className="h-px flex-1 bg-me-charcoal/10" />
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div>
          <label
            htmlFor="portal-email"
            className="mb-1.5 block text-xs font-bold uppercase tracking-[0.12em] text-me-charcoal/55"
          >
            Email address
          </label>
          <input
            id="portal-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="h-12 w-full rounded-xl border-[1.5px] border-me-charcoal/14 bg-white px-3 text-sm text-me-charcoal outline-none transition focus:border-me-ochre focus:shadow-[0_0_0_3px_rgba(196,145,46,.12)]"
          />
        </div>

        <div>
          <label
            htmlFor="portal-password"
            className="mb-1.5 block text-xs font-bold uppercase tracking-[0.12em] text-me-charcoal/55"
          >
            Password
          </label>
          <input
            id="portal-password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="h-12 w-full rounded-xl border-[1.5px] border-me-charcoal/14 bg-white px-3 text-sm text-me-charcoal outline-none transition focus:border-me-ochre focus:shadow-[0_0_0_3px_rgba(196,145,46,.12)]"
          />
        </div>

        {(error || authFailed) && (
          <p className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-sm font-semibold text-[#B91C1C]">
            {error || 'Authentication failed. Please try again.'}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="flex h-12 w-full items-center justify-center rounded-xl text-sm font-bold text-[#2A2008] shadow-[0_18px_50px_rgba(196,145,46,.22)] transition active:translate-y-px disabled:cursor-wait disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg,#EBCB8B,#C4912E 55%,#A6781F)' }}
        >
          {loading ? 'Signing in…' : 'Sign in →'}
        </button>

        <p className="text-center text-xs leading-5 text-me-charcoal/45">
          Need a password? Ask your Magic Engine administrator to set or reset it.
        </p>
      </form>
    </div>
  )
}
