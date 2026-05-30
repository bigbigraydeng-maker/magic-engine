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
        <div
          className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg text-sm font-black"
          style={{ background: '#EAF3EE', color: '#1F7A55' }}
        >
          ✓
        </div>
        <h3
          className="text-xl font-black"
          style={{ fontFamily: "'Fraunces', Georgia, serif", color: '#16181D', letterSpacing: '-.02em' }}
        >
          Check your email
        </h3>
        <p className="mt-2 text-sm leading-6" style={{ color: 'rgba(22,24,29,.60)' }}>
          Secure login link sent to{' '}
          <span className="font-semibold" style={{ color: '#16181D' }}>{email}</span>.
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
          className="block text-xs font-bold uppercase tracking-[0.12em] mb-1.5"
          style={{ color: 'rgba(22,24,29,.55)' }}
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
          className="h-12 w-full rounded-xl border bg-white px-3 text-sm outline-none transition"
          style={{ border: '1.5px solid rgba(22,24,29,.14)', color: '#16181D' }}
          onFocus={e => { e.currentTarget.style.borderColor = '#BE8A2E'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(190,138,46,.12)' }}
          onBlur={e  => { e.currentTarget.style.borderColor = 'rgba(22,24,29,.14)'; e.currentTarget.style.boxShadow = 'none' }}
        />
      </div>

      {(error || authFailed) && (
        <p
          className="rounded-xl border px-3 py-2 text-sm font-semibold"
          style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C' }}
        >
          {error || 'Authentication failed. Please request a new login link.'}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="flex h-12 w-full items-center justify-center rounded-xl text-sm font-bold transition"
        style={{
          background: loading ? 'rgba(190,138,46,.5)' : '#BE8A2E',
          color: '#fff',
          cursor: loading ? 'wait' : 'pointer',
        }}
      >
        {loading ? 'Sending…' : 'Send magic link →'}
      </button>
    </form>
  )
}
