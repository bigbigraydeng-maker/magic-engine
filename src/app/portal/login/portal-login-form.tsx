'use client'

import { useState } from 'react'

interface Props {
  next: string
  authFailed?: boolean
}

export default function PortalLoginForm({ next, authFailed }: Props) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
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
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          redirectTo,
        }),
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
      <div className="py-4">
        <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-sm font-black text-emerald-900">
          OK
        </div>
        <h2 className="text-2xl font-black text-slate-950">Check your email</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          We sent a secure login link to <span className="font-bold text-slate-950">{email}</span>.
          The link expires in 15 minutes.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="portal-email" className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
          Email address
        </label>
        <input
          id="portal-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          className="mt-1.5 h-12 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-slate-950 focus:ring-4 focus:ring-slate-950/5"
        />
      </div>

      {(error || authFailed) && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
          {error || 'Authentication failed. Please request a new login link.'}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className={`flex h-12 w-full items-center justify-center rounded-lg text-sm font-black transition ${
          loading
            ? 'cursor-wait bg-slate-300 text-slate-600'
            : 'bg-slate-950 text-white hover:bg-slate-800'
        }`}
      >
        {loading ? 'Sending...' : 'Send magic link'}
      </button>
    </form>
  )
}
