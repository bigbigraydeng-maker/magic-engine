'use client'

import { useState } from 'react'

interface Props {
  next: string
  authFailed?: boolean
}

export default function PortalLoginForm({ next, authFailed }: Props) {
  const [email, setEmail]     = useState('')
  const [sent, setSent]       = useState(false)
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const redirectTo = `${window.location.origin}/auth/implicit-callback?next=${encodeURIComponent(next)}`
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), redirectTo }),
      })
      if (!res.ok) {
        setError('Unable to send link. Please check your email address.')
      } else {
        setSent(true)
      }
    } catch {
      setError('Unable to send link. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div className="py-2">
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-[#EAF3EE] text-sm font-black text-[#1F7A55]">
          ✓
        </div>
        <h3 className="font-display text-xl font-bold tracking-tight text-me-charcoal">
          Check your email
        </h3>
        <p className="mt-2 text-sm leading-6 text-me-charcoal/60">
          Secure login link sent to{' '}
          <span className="font-semibold text-me-charcoal">{email}</span>.
          {' '}Expires in 15 minutes.
        </p>
      </div>
    )
  }

  return (
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

      {(error || authFailed) && (
        <p className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-sm font-semibold text-[#B91C1C]">
          {error || 'Authentication failed. Please request a new login link.'}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="flex h-12 w-full items-center justify-center rounded-xl text-sm font-bold text-[#2A2008] shadow-[0_18px_50px_rgba(196,145,46,.22)] transition active:translate-y-px disabled:cursor-wait disabled:opacity-60"
        style={{ background: 'linear-gradient(135deg,#EBCB8B,#C4912E 55%,#A6781F)' }}
      >
        {loading ? 'Sending…' : 'Send magic link →'}
      </button>
    </form>
  )
}
