'use client'

import { useState } from 'react'

export default function RegisterForm() {
  const [form, setForm] = useState({
    businessName: '',
    email: '',
    password: '',
    websiteUrl: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/self-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email.trim().toLowerCase(),
          password: form.password,
          businessName: form.businessName.trim(),
          websiteUrl: form.websiteUrl.trim() || undefined,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Registration failed. Please try again.')
        return
      }
      setDone(true)
    } catch {
      setError('Unable to register. Please check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  if (done) {
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
          Confirmation link sent to{' '}
          <span className="font-semibold" style={{ color: '#16181D' }}>{form.email}</span>.
          {' '}Click the link to activate your account and receive your <strong>500 MTC</strong> welcome bonus.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="businessName" className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
          Business name
        </label>
        <input
          id="businessName"
          name="businessName"
          type="text"
          required
          value={form.businessName}
          onChange={handleChange}
          placeholder="Acme Co"
          className="mt-1.5 h-12 w-full rounded-xl border bg-white px-3 text-sm outline-none transition"
          style={{ border: '1.5px solid rgba(22,24,29,.14)', color: '#16181D' }}
          onFocus={e => { e.currentTarget.style.borderColor = '#BE8A2E'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(190,138,46,.12)' }}
          onBlur={e  => { e.currentTarget.style.borderColor = 'rgba(22,24,29,.14)'; e.currentTarget.style.boxShadow = 'none' }}
        />
      </div>

      <div>
        <label htmlFor="email" className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          value={form.email}
          onChange={handleChange}
          placeholder="you@company.com"
          className="mt-1.5 h-12 w-full rounded-xl border bg-white px-3 text-sm outline-none transition"
          style={{ border: '1.5px solid rgba(22,24,29,.14)', color: '#16181D' }}
          onFocus={e => { e.currentTarget.style.borderColor = '#BE8A2E'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(190,138,46,.12)' }}
          onBlur={e  => { e.currentTarget.style.borderColor = 'rgba(22,24,29,.14)'; e.currentTarget.style.boxShadow = 'none' }}
        />
      </div>

      <div>
        <label htmlFor="password" className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          value={form.password}
          onChange={handleChange}
          placeholder="At least 8 characters"
          className="mt-1.5 h-12 w-full rounded-xl border bg-white px-3 text-sm outline-none transition"
          style={{ border: '1.5px solid rgba(22,24,29,.14)', color: '#16181D' }}
          onFocus={e => { e.currentTarget.style.borderColor = '#BE8A2E'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(190,138,46,.12)' }}
          onBlur={e  => { e.currentTarget.style.borderColor = 'rgba(22,24,29,.14)'; e.currentTarget.style.boxShadow = 'none' }}
        />
      </div>

      <div>
        <label htmlFor="websiteUrl" className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
          Website URL <span className="font-medium text-slate-400">(optional)</span>
        </label>
        <input
          id="websiteUrl"
          name="websiteUrl"
          type="url"
          value={form.websiteUrl}
          onChange={handleChange}
          placeholder="https://yoursite.com.au"
          className="mt-1.5 h-12 w-full rounded-xl border bg-white px-3 text-sm outline-none transition"
          style={{ border: '1.5px solid rgba(22,24,29,.14)', color: '#16181D' }}
          onFocus={e => { e.currentTarget.style.borderColor = '#BE8A2E'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(190,138,46,.12)' }}
          onBlur={e  => { e.currentTarget.style.borderColor = 'rgba(22,24,29,.14)'; e.currentTarget.style.boxShadow = 'none' }}
        />
      </div>

      {error && (
        <p
          className="rounded-xl border px-3 py-2 text-sm font-semibold"
          style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C' }}
        >
          {error}
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
        {loading ? 'Creating account…' : 'Create account — free'}
      </button>
    </form>
  )
}
